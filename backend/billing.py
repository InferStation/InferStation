"""Monthly post-paid billing.

USD-only as of 2026-05-09. The historical multi-currency code paths
were removed; every invoice / usage row is treated as USD.

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

import os
from datetime import date, datetime, timedelta
from typing import Iterable

from database import get_db

GRACE_DAYS = 7  # days after period_end before an invoice is considered overdue

# Platform monetization model (locked 2026-05-14):
#   consumer pays gross  (= token × backend price; 100% lands in balance after topup)
#   per-call accounting:
#     platform_fee = gross × PLATFORM_RATE         (gateway keeps)
#     channel_fee  = gross × FREEMIUS_FEE_ESTIMATE (Freemius takes; provider absorbs)
#     provider_cut = gross × (1 - PLATFORM_RATE - FREEMIUS_FEE_ESTIMATE)
# FREEMIUS_FEE_ESTIMATE is a forecast used for per-call splits; the actual
# Freemius fee on each topup is recorded in topups.channel_fee_cents (real).
# Quarterly admins should reconcile estimate vs realised and adjust this constant.
PLATFORM_RATE = float(os.environ.get("BILLING_PLATFORM_RATE", "0.10"))
FREEMIUS_FEE_ESTIMATE = float(os.environ.get("BILLING_CHANNEL_FEE_ESTIMATE", "0.076"))
PROVIDER_CUT_RATE = max(0.0, 1.0 - PLATFORM_RATE - FREEMIUS_FEE_ESTIMATE)

# Test-mode auto-pay: while the platform is in beta we do not actually
# collect money. Every freshly generated invoice is immediately marked
# paid (with paid_at = now) so that no user accumulates dunning state.
# Flip BILLING_TEST_AUTOPAY=0 in the environment to restore real billing.
TEST_AUTOPAY = os.environ.get("BILLING_TEST_AUTOPAY", "1") not in ("", "0", "false", "False")


async def _archive_owner_deletions(db, owner_id: int, period_end_iso: str) -> None:
    """Soft-deleted backends whose deletion timestamp falls within the just-billed
    period are advanced to the terminal 'archived' state."""
    await db.execute(
        """UPDATE backends
              SET deletion_status = 'archived'
            WHERE owner_id = ?
              AND deletion_status = 'deleted'
              AND COALESCE(deleted_at, '') < ?""",
        (owner_id, period_end_iso),
    )


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
    One invoice per (user, month)."""
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT MIN(ym) FROM (
                   SELECT substr(day,1,7) AS ym FROM usage_daily WHERE user_id = ?
                   UNION ALL
                   SELECT substr(hour_start,1,7) AS ym FROM usage_hourly WHERE user_id = ?
               )""",
            (user_id, user_id),
        )
        row = await cur.fetchone()
        earliest_ym = row[0] if row else None
        if not earliest_ym:
            return

        today = date.today()
        current_ym = today.strftime("%Y-%m")
        if earliest_ym >= current_ym:
            return

        cur = await db.execute(
            "SELECT strftime('%Y-%m', period_start) FROM invoices WHERE user_id = ?",
            (user_id,),
        )
        existing = {r[0] for r in await cur.fetchall()}

        for period_start, period_end in _month_range_labels(earliest_ym, current_ym):
            ym = period_start[:7]
            if ym in existing:
                continue
            # Self-owned model waiver: usage on the user's own backends is
            # fully waived in summaries and invoices.
            cur = await db.execute(
                """SELECT COALESCE(SUM(cost),0) AS total FROM (
                       SELECT u.cost
                       FROM usage_daily u
                       LEFT JOIN backends b ON u.backend_id = b.id
                       WHERE u.user_id = ? AND u.day >= ? AND u.day < ?
                         AND (b.owner_id IS NULL OR b.owner_id != ?)
                       UNION ALL
                       SELECT u.cost
                       FROM usage_hourly u
                       LEFT JOIN backends b ON u.backend_id = b.id
                       WHERE u.user_id = ? AND substr(u.hour_start,1,10) >= ?
                                            AND substr(u.hour_start,1,10) <  ?
                         AND (b.owner_id IS NULL OR b.owner_id != ?)
                   )""",
                (user_id, period_start, period_end, user_id,
                 user_id, period_start, period_end, user_id),
            )
            total = float((await cur.fetchone())["total"] or 0.0)
            pe = date.fromisoformat(period_end)
            due_date = (pe - timedelta(days=1) + timedelta(days=GRACE_DAYS)).isoformat()
            if TEST_AUTOPAY or total <= 0:
                status = "paid"
                paid_at = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
            else:
                status, paid_at = "unpaid", None
            platform_fee_cents = round(total * PLATFORM_RATE * 100)
            channel_fee_cents = round(total * FREEMIUS_FEE_ESTIMATE * 100)
            provider_cut_cents = round(total * PROVIDER_CUT_RATE * 100)
            await db.execute(
                "INSERT INTO invoices (user_id, period_start, period_end, total_cost, status, due_date, paid_at, "
                "platform_fee_cents, channel_fee_cents, provider_cut_cents) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, period_start, period_end, total, status, due_date, paid_at,
                 platform_fee_cents, channel_fee_cents, provider_cut_cents),
            )
            await _archive_owner_deletions(db, user_id, period_end)
        await db.commit()
    finally:
        await db.close()


async def get_billing_status(user_id: int) -> dict:
    """Return current-month running cost (USD) and unpaid invoices."""
    await ensure_invoices_for_user(user_id)
    db = await get_db()
    try:
        today = date.today()
        month_start = _month_first(today).isoformat()
        next_month = _next_month_first(today).isoformat()
        cur = await db.execute(
            """SELECT COALESCE(SUM(cost),0) AS total FROM (
                   SELECT u.cost
                   FROM usage_daily u
                   LEFT JOIN backends b ON u.backend_id = b.id
                   WHERE u.user_id = ? AND u.day >= ? AND u.day < ?
                     AND (b.owner_id IS NULL OR b.owner_id != ?)
                   UNION ALL
                   SELECT u.cost
                   FROM usage_hourly u
                   LEFT JOIN backends b ON u.backend_id = b.id
                   WHERE u.user_id = ? AND substr(u.hour_start,1,10) >= ?
                                        AND substr(u.hour_start,1,10) <  ?
                     AND (b.owner_id IS NULL OR b.owner_id != ?)
               )""",
            (user_id, month_start, next_month, user_id,
             user_id, month_start, next_month, user_id),
        )
        current_month_cost = float((await cur.fetchone())["total"] or 0.0)

        cur = await db.execute(
            "SELECT id, period_start, period_end, total_cost, "
            "status, due_date, created_at, paid_at "
            "FROM invoices WHERE user_id = ? ORDER BY period_start DESC",
            (user_id,),
        )
        invoices = []
        for r in await cur.fetchall():
            d = dict(r)
            d["currency"] = "USD"
            invoices.append(d)
        today_s = today.isoformat()
        unpaid = [i for i in invoices if i["status"] == "unpaid"]
        overdue = [i for i in unpaid if i["due_date"] < today_s]

        unpaid_total = sum(float(i["total_cost"] or 0.0) for i in unpaid)
        overdue_total = sum(float(i["total_cost"] or 0.0) for i in overdue)
        return {
            "current_month_cost": current_month_cost,
            "current_month_by_currency": {"USD": current_month_cost},
            "current_month_period": {"start": month_start, "end": next_month},
            "invoices": invoices,
            "unpaid_total": unpaid_total,
            "unpaid_by_currency": {"USD": unpaid_total} if unpaid_total else {},
            "overdue_total": overdue_total,
            "overdue_by_currency": {"USD": overdue_total} if overdue_total else {},
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


async def get_balance_status(user_id: int) -> dict:
    """Return (balance, credit_limit_usd, available_credit_usd, over_limit).

    balance can be negative (within credit_limit); over_limit is True when
    balance + credit_limit_usd <= 0, meaning the next paid call must be refused.
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT balance, credit_limit_cents FROM users WHERE id = ?",
            (user_id,),
        )
        row = await cur.fetchone()
        if not row:
            return {
                "balance": 0.0,
                "credit_limit_usd": 0.0,
                "available_credit_usd": 0.0,
                "over_limit": False,
            }
        balance = float(row["balance"] or 0.0)
        credit_limit_usd = float(row["credit_limit_cents"] or 0) / 100.0
        available = balance + credit_limit_usd
        return {
            "balance": balance,
            "credit_limit_usd": credit_limit_usd,
            "available_credit_usd": available,
            "over_limit": available <= 0,
        }
    finally:
        await db.close()


async def is_over_credit_limit(user_id: int) -> tuple[bool, float, float]:
    """Auth-path helper. Returns (over_limit, balance, available_credit)."""
    s = await get_balance_status(user_id)
    return s["over_limit"], s["balance"], s["available_credit_usd"]


async def deduct_user_balance(user_id: int, cost_usd: float) -> None:
    """Atomically subtract cost_usd from users.balance. Skips when cost <= 0.

    Caller is responsible for skipping self-owned-backend usage (waiver).
    """
    if cost_usd is None or cost_usd <= 0:
        return
    db = await get_db()
    try:
        await db.execute(
            "UPDATE users SET balance = balance - ? WHERE id = ?",
            (cost_usd, user_id),
        )
        await db.commit()
    finally:
        await db.close()


async def credit_user_balance(user_id: int, amount_usd: float) -> None:
    """Atomically add amount_usd to users.balance (used by topup webhook)."""
    if amount_usd is None or amount_usd <= 0:
        return
    db = await get_db()
    try:
        await db.execute(
            "UPDATE users SET balance = balance + ? WHERE id = ?",
            (amount_usd, user_id),
        )
        await db.commit()
    finally:
        await db.close()


SETTLE_IDLE_MINUTES = 30


async def is_user_idle_for_settle(user_id: int, idle_minutes: int = SETTLE_IDLE_MINUTES) -> tuple[bool, str | None]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT MAX(hour_start) FROM usage_hourly WHERE user_id = ?",
            (user_id,),
        )
        latest = (await cur.fetchone())[0]
        if not latest:
            return True, None
        cur = await db.execute(
            "SELECT datetime('now','+8 hours','-' || ? || ' minutes')",
            (idle_minutes,),
        )
        cutoff = (await cur.fetchone())[0]
        return latest < cutoff, latest
    finally:
        await db.close()


async def settle_user_partial(user_id: int, today: date | None = None) -> list[dict]:
    """Generate an early-settlement invoice for the running month.

    Sums usage from month-start through today (inclusive) and inserts one
    invoice that does not yet have a current-month invoice.  Returns the rows
    just created.  Idempotent: a second call within the same calendar month
    returns [].
    """
    today = today or date.today()
    month_start = _month_first(today).isoformat()
    next_day = (today + timedelta(days=1)).isoformat()
    ym = month_start[:7]
    db = await get_db()
    created: list[dict] = []
    try:
        cur = await db.execute(
            "SELECT 1 FROM invoices WHERE user_id = ? AND strftime('%Y-%m', period_start) = ?",
            (user_id, ym),
        )
        if await cur.fetchone():
            return []

        cur = await db.execute(
            """SELECT COALESCE(SUM(cost),0) AS total FROM (
                   SELECT u.cost
                   FROM usage_daily u
                   LEFT JOIN backends b ON u.backend_id = b.id
                   WHERE u.user_id = ? AND u.day >= ? AND u.day < ?
                     AND (b.owner_id IS NULL OR b.owner_id != ?)
                   UNION ALL
                   SELECT u.cost
                   FROM usage_hourly u
                   LEFT JOIN backends b ON u.backend_id = b.id
                   WHERE u.user_id = ? AND substr(u.hour_start,1,10) >= ?
                                        AND substr(u.hour_start,1,10) <  ?
                     AND (b.owner_id IS NULL OR b.owner_id != ?)
               )""",
            (user_id, month_start, next_day, user_id,
             user_id, month_start, next_day, user_id),
        )
        total = float((await cur.fetchone())["total"] or 0.0)

        period_end = next_day
        due_date = (today + timedelta(days=GRACE_DAYS)).isoformat()
        now_iso = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
        if TEST_AUTOPAY or total <= 0:
            status, paid_at = "paid", now_iso
        else:
            status, paid_at = "unpaid", None
        platform_fee_cents = round(total * PLATFORM_RATE * 100)
        channel_fee_cents = round(total * FREEMIUS_FEE_ESTIMATE * 100)
        provider_cut_cents = round(total * PROVIDER_CUT_RATE * 100)
        cur = await db.execute(
            "INSERT INTO invoices (user_id, period_start, period_end, total_cost, status, due_date, paid_at, "
            "platform_fee_cents, channel_fee_cents, provider_cut_cents) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, month_start, period_end, total, status, due_date, paid_at,
             platform_fee_cents, channel_fee_cents, provider_cut_cents),
        )
        created.append({
            "id": cur.lastrowid,
            "period_start": month_start,
            "period_end": period_end,
            "currency": "USD",
            "total_cost": total,
            "status": status,
            "due_date": due_date,
            "paid_at": paid_at,
            "platform_fee_cents": platform_fee_cents,
            "channel_fee_cents": channel_fee_cents,
            "provider_cut_cents": provider_cut_cents,
        })
        await _archive_owner_deletions(db, user_id, period_end)
        await db.commit()
        return created
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


# ══════════════════════════════════════════════════════════════════════
# Provider earnings ledger (Day 3)
# ══════════════════════════════════════════════════════════════════════
async def settle_provider_earnings(period_ym: str | None = None) -> list[dict]:
    """Aggregate the closed month's consumer spend by backend owner and
    write a provider_earnings row per (owner, period_ym).

    period_ym: 'YYYY-MM'. If None, settles the previous calendar month
    (today's month - 1) — typically called by the daily rollover on the 1st.

    Self-owned waiver: usage where backend.owner_id == usage.user_id is
    excluded (consumer == provider; nothing to pay out).

    Idempotent via UNIQUE(user_id, period_ym): re-running updates totals
    in place. finalized_at is set once on first finalization and never
    overwritten so admins can detect re-runs.
    """
    today = date.today()
    if period_ym is None:
        first = _month_first(today)
        prev_last = first - timedelta(days=1)
        period_ym = prev_last.strftime("%Y-%m")
    # Guard against accidentally settling the still-open current month.
    if period_ym >= today.strftime("%Y-%m"):
        return []

    period_start = f"{period_ym}-01"
    pe = date.fromisoformat(period_start)
    period_end = _next_month_first(pe).isoformat()

    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT b.owner_id AS owner_id, COALESCE(SUM(u.cost), 0) AS gross
                 FROM usage_daily u
                 JOIN backends b ON u.backend_id = b.id
                WHERE u.day >= ? AND u.day < ?
                  AND b.owner_id IS NOT NULL
                  AND b.owner_id != u.user_id
                GROUP BY b.owner_id
                HAVING gross > 0""",
            (period_start, period_end),
        )
        rows = await cur.fetchall()
        out: list[dict] = []
        for r in rows:
            owner_id = int(r["owner_id"])
            gross_usd = float(r["gross"] or 0.0)
            gross_cents = round(gross_usd * 100)
            channel_fee_cents = round(gross_usd * FREEMIUS_FEE_ESTIMATE * 100)
            platform_fee_cents = round(gross_usd * PLATFORM_RATE * 100)
            provider_cut_cents = gross_cents - channel_fee_cents - platform_fee_cents
            await db.execute(
                """INSERT INTO provider_earnings
                       (user_id, period_ym, gross_usd_cents, channel_fee_cents,
                        platform_fee_cents, provider_cut_cents, finalized_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(user_id, period_ym) DO UPDATE SET
                       gross_usd_cents    = excluded.gross_usd_cents,
                       channel_fee_cents  = excluded.channel_fee_cents,
                       platform_fee_cents = excluded.platform_fee_cents,
                       provider_cut_cents = excluded.provider_cut_cents
                """,
                (owner_id, period_ym, gross_cents, channel_fee_cents,
                 platform_fee_cents, provider_cut_cents),
            )
            out.append({
                "user_id": owner_id,
                "period_ym": period_ym,
                "gross_usd_cents": gross_cents,
                "channel_fee_cents": channel_fee_cents,
                "platform_fee_cents": platform_fee_cents,
                "provider_cut_cents": provider_cut_cents,
            })
        await db.commit()
        return out
    finally:
        await db.close()


async def get_provider_earnings(user_id: int) -> dict:
    """Lifetime earnings summary for a provider.

      total_earned_cents = SUM(provider_cut_cents over all finalized months)
      total_withdrawn_cents = SUM(amount over withdrawal_requests where status='paid')
      pending_withdraw_cents = SUM(amount where status IN ('pending','approved'))
      available_cents = total_earned - total_withdrawn - pending_withdraw
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT COALESCE(SUM(provider_cut_cents),0) AS e "
            "FROM provider_earnings WHERE user_id = ?",
            (user_id,),
        )
        earned = int((await cur.fetchone())["e"] or 0)
        cur = await db.execute(
            "SELECT COALESCE(SUM(amount_usd_cents),0) AS a FROM withdrawal_requests "
            "WHERE user_id = ? AND status = 'paid'",
            (user_id,),
        )
        paid = int((await cur.fetchone())["a"] or 0)
        cur = await db.execute(
            "SELECT COALESCE(SUM(amount_usd_cents),0) AS a FROM withdrawal_requests "
            "WHERE user_id = ? AND status IN ('pending','approved')",
            (user_id,),
        )
        in_flight = int((await cur.fetchone())["a"] or 0)
        cur = await db.execute(
            "SELECT period_ym, gross_usd_cents, channel_fee_cents, platform_fee_cents, "
            "provider_cut_cents, finalized_at FROM provider_earnings "
            "WHERE user_id = ? ORDER BY period_ym DESC LIMIT 24",
            (user_id,),
        )
        history = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {
        "total_earned_cents": earned,
        "total_paid_cents": paid,
        "pending_withdraw_cents": in_flight,
        "available_cents": max(0, earned - paid - in_flight),
        "history": history,
    }
