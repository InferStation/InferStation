"""Monthly post-paid billing.

Design:
- Users do NOT have a balance. Usage is logged per-request with a cost.
- Each calendar month becomes one invoice per user (generated lazily after
  the month ends). Status starts as 'unpaid'. Admin can mark 'paid'.
- due_date = period_end + GRACE_DAYS. If today > due_date and still 'unpaid',
  the user is considered in arrears and service is suspended.
- Unpaid invoices accumulate; paying any individual invoice only clears that
  one. Suspension requires no unpaid invoice past its due_date.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable

from database import get_db

GRACE_DAYS = 7  # days after period_end before an invoice is considered overdue


def _month_first(d: date) -> date:
    return d.replace(day=1)


def _next_month_first(d: date) -> date:
    y, m = d.year, d.month
    return date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)


def _month_range_labels(start_ym: str, end_excl_ym: str) -> Iterable[tuple[str, str]]:
    """Yield (period_start, period_end) as YYYY-MM-01 strings from start to end exclusive."""
    ys, ms = map(int, start_ym.split("-"))
    ye, me = map(int, end_excl_ym.split("-"))
    cur = date(ys, ms, 1)
    end = date(ye, me, 1)
    while cur < end:
        nxt = _next_month_first(cur)
        yield cur.isoformat(), nxt.isoformat()
        cur = nxt


async def ensure_invoices_for_user(user_id: int) -> None:
    """Generate any missing invoices for months that have fully elapsed."""
    db = await get_db()
    try:
        # Earliest usage month for this user
        cur = await db.execute(
            "SELECT MIN(strftime('%Y-%m', created_at)) FROM usage_logs WHERE user_id = ?",
            (user_id,),
        )
        row = await cur.fetchone()
        earliest_ym = row[0] if row else None
        if not earliest_ym:
            return

        today = date.today()
        current_ym = today.strftime("%Y-%m")
        if earliest_ym >= current_ym:
            return  # no elapsed month yet

        # Existing invoice periods
        cur = await db.execute(
            "SELECT strftime('%Y-%m', period_start) FROM invoices WHERE user_id = ?",
            (user_id,),
        )
        existing = {r[0] for r in await cur.fetchall()}

        for period_start, period_end in _month_range_labels(earliest_ym, current_ym):
            ym = period_start[:7]
            if ym in existing:
                continue
            # Sum usage for that month
            cur = await db.execute(
                "SELECT COALESCE(SUM(cost),0) FROM usage_logs "
                "WHERE user_id = ? AND created_at >= ? AND created_at < ?",
                (user_id, period_start, period_end),
            )
            total = float((await cur.fetchone())[0] or 0.0)
            pe = date.fromisoformat(period_end)
            due_date = (pe - timedelta(days=1) + timedelta(days=GRACE_DAYS)).isoformat()
            status = "paid" if total <= 0 else "unpaid"
            paid_at = datetime.utcnow().isoformat(sep=" ", timespec="seconds") if total <= 0 else None
            await db.execute(
                "INSERT INTO invoices (user_id, period_start, period_end, total_cost, status, due_date, paid_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, period_start, period_end, total, status, due_date, paid_at),
            )
        await db.commit()
    finally:
        await db.close()


async def get_billing_status(user_id: int) -> dict:
    """Return current-month running cost and list of unpaid invoices."""
    await ensure_invoices_for_user(user_id)
    db = await get_db()
    try:
        today = date.today()
        month_start = _month_first(today).isoformat()
        next_month = _next_month_first(today).isoformat()
        cur = await db.execute(
            "SELECT COALESCE(SUM(cost),0) FROM usage_logs "
            "WHERE user_id = ? AND created_at >= ? AND created_at < ?",
            (user_id, month_start, next_month),
        )
        current_month_cost = float((await cur.fetchone())[0] or 0.0)

        cur = await db.execute(
            "SELECT id, period_start, period_end, total_cost, status, due_date, created_at, paid_at "
            "FROM invoices WHERE user_id = ? ORDER BY period_start DESC",
            (user_id,),
        )
        invoices = [dict(r) for r in await cur.fetchall()]
        today_s = today.isoformat()
        unpaid = [i for i in invoices if i["status"] == "unpaid"]
        overdue = [i for i in unpaid if i["due_date"] < today_s]
        unpaid_total = sum(i["total_cost"] for i in unpaid)
        overdue_total = sum(i["total_cost"] for i in overdue)
        return {
            "current_month_cost": current_month_cost,
            "current_month_period": {"start": month_start, "end": next_month},
            "invoices": invoices,
            "unpaid_total": unpaid_total,
            "overdue_total": overdue_total,
            "is_suspended": len(overdue) > 0,
            "grace_days": GRACE_DAYS,
        }
    finally:
        await db.close()


async def is_user_suspended(user_id: int) -> tuple[bool, float]:
    """Fast path check for request auth. Returns (suspended, overdue_total)."""
    await ensure_invoices_for_user(user_id)
    db = await get_db()
    try:
        today_s = date.today().isoformat()
        cur = await db.execute(
            "SELECT COALESCE(SUM(total_cost),0) FROM invoices "
            "WHERE user_id = ? AND status = 'unpaid' AND due_date < ?",
            (user_id, today_s),
        )
        total = float((await cur.fetchone())[0] or 0.0)
        return total > 0, total
    finally:
        await db.close()


async def mark_invoice_paid(invoice_id: int) -> dict | None:
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
        row = await cur.fetchone()
        if not row:
            return None
        inv = dict(row)
        if inv["status"] == "paid":
            return inv
        now = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
        await db.execute(
            "UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?",
            (now, invoice_id),
        )
        await db.commit()
        inv["status"] = "paid"
        inv["paid_at"] = now
        return inv
    finally:
        await db.close()
