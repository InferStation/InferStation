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
    """Generate any missing invoices for months that have fully elapsed.
    One invoice is generated per (user, month, currency)."""
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

        # Existing invoice (period, currency) pairs
        cur = await db.execute(
            "SELECT strftime('%Y-%m', period_start), currency FROM invoices WHERE user_id = ?",
            (user_id,),
        )
        existing = {(r[0], r[1] or "CNY") for r in await cur.fetchall()}

        for period_start, period_end in _month_range_labels(earliest_ym, current_ym):
            ym = period_start[:7]
            # Sum usage for that month, grouped by currency
            cur = await db.execute(
                "SELECT COALESCE(currency,'CNY') AS currency, COALESCE(SUM(cost),0) AS total "
                "FROM usage_logs WHERE user_id = ? AND created_at >= ? AND created_at < ? "
                "GROUP BY COALESCE(currency,'CNY')",
                (user_id, period_start, period_end),
            )
            sums = await cur.fetchall()
            pe = date.fromisoformat(period_end)
            due_date = (pe - timedelta(days=1) + timedelta(days=GRACE_DAYS)).isoformat()
            for r in sums:
                currency = r["currency"] or "CNY"
                if (ym, currency) in existing:
                    continue
                total = float(r["total"] or 0.0)
                status = "paid" if total <= 0 else "unpaid"
                paid_at = datetime.utcnow().isoformat(sep=" ", timespec="seconds") if total <= 0 else None
                await db.execute(
                    "INSERT INTO invoices (user_id, period_start, period_end, total_cost, currency, status, due_date, paid_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (user_id, period_start, period_end, total, currency, status, due_date, paid_at),
                )
        await db.commit()
    finally:
        await db.close()


async def get_billing_status(user_id: int) -> dict:
    """Return current-month running cost (per currency) and unpaid invoices."""
    await ensure_invoices_for_user(user_id)
    db = await get_db()
    try:
        today = date.today()
        month_start = _month_first(today).isoformat()
        next_month = _next_month_first(today).isoformat()
        cur = await db.execute(
            "SELECT COALESCE(currency,'CNY') AS currency, COALESCE(SUM(cost),0) AS total "
            "FROM usage_logs WHERE user_id = ? AND created_at >= ? AND created_at < ? "
            "GROUP BY COALESCE(currency,'CNY')",
            (user_id, month_start, next_month),
        )
        cm_rows = await cur.fetchall()
        current_month_by_currency: dict[str, float] = {
            (r["currency"] or "CNY"): float(r["total"] or 0.0) for r in cm_rows
        }

        cur = await db.execute(
            "SELECT id, period_start, period_end, total_cost, COALESCE(currency,'CNY') AS currency, "
            "status, due_date, created_at, paid_at "
            "FROM invoices WHERE user_id = ? ORDER BY period_start DESC, currency ASC",
            (user_id,),
        )
        invoices = [dict(r) for r in await cur.fetchall()]
        today_s = today.isoformat()
        unpaid = [i for i in invoices if i["status"] == "unpaid"]
        overdue = [i for i in unpaid if i["due_date"] < today_s]

        unpaid_by_currency: dict[str, float] = {}
        for i in unpaid:
            c = i.get("currency") or "CNY"
            unpaid_by_currency[c] = unpaid_by_currency.get(c, 0.0) + float(i["total_cost"] or 0.0)
        overdue_by_currency: dict[str, float] = {}
        for i in overdue:
            c = i.get("currency") or "CNY"
            overdue_by_currency[c] = overdue_by_currency.get(c, 0.0) + float(i["total_cost"] or 0.0)

        # Legacy single-number fields kept for backward compatibility.
        # They sum across currencies (numerically meaningless for mixed-currency
        # users, but UIs should prefer the *_by_currency dicts).
        current_month_cost = sum(current_month_by_currency.values())
        unpaid_total = sum(unpaid_by_currency.values())
        overdue_total = sum(overdue_by_currency.values())
        return {
            "current_month_cost": current_month_cost,
            "current_month_by_currency": current_month_by_currency,
            "current_month_period": {"start": month_start, "end": next_month},
            "invoices": invoices,
            "unpaid_total": unpaid_total,
            "unpaid_by_currency": unpaid_by_currency,
            "overdue_total": overdue_total,
            "overdue_by_currency": overdue_by_currency,
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
