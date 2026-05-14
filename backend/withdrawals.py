"""Provider earnings & withdrawal endpoints.

Routes (mounted in gateway.py):
- GET  /api/provider/earnings              — current provider's earnings ledger
- POST /api/provider/withdrawals           — file a withdrawal request
- GET  /api/provider/withdrawals           — own withdrawal history
- GET  /api/admin/withdrawals              — admin: list pending/all
- POST /api/admin/withdrawals/{id}/approve
- POST /api/admin/withdrawals/{id}/reject
- POST /api/admin/withdrawals/{id}/paid
- POST /api/admin/provider-earnings/settle — admin: force-settle a closed month
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_admin
from billing import (
    get_provider_earnings,
    settle_provider_earnings,
)
from database import get_db

router = APIRouter(tags=["payout"])


# ─────────────────────────────────────────────────────────────────────
# Provider-facing
# ─────────────────────────────────────────────────────────────────────
@router.get("/api/provider/earnings")
async def my_earnings(user=Depends(get_current_user)):
    if user["role"] not in ("provider", "both", "admin"):
        raise HTTPException(403, "Provider role required")
    return await get_provider_earnings(user["id"])


class WithdrawIn(BaseModel):
    amount_usd_cents: int = Field(..., gt=0)
    payout_method: str = Field(..., min_length=1, max_length=32)
    payout_address: str = Field(..., min_length=1, max_length=512)


@router.post("/api/provider/withdrawals")
async def file_withdrawal(payload: WithdrawIn, user=Depends(get_current_user)):
    if user["role"] not in ("provider", "both", "admin"):
        raise HTTPException(403, "Provider role required")
    summary = await get_provider_earnings(user["id"])
    if payload.amount_usd_cents > summary["available_cents"]:
        raise HTTPException(
            400,
            f"requested {payload.amount_usd_cents}¢ exceeds available "
            f"{summary['available_cents']}¢",
        )
    # 50 USD minimum payout — keeps Wise/PayPal fee overhead reasonable.
    if payload.amount_usd_cents < 5000:
        raise HTTPException(400, "Minimum withdrawal is $50")

    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO withdrawal_requests "
            "(user_id, amount_usd_cents, payout_method, payout_address) "
            "VALUES (?, ?, ?, ?)",
            (user["id"], payload.amount_usd_cents, payload.payout_method, payload.payout_address),
        )
        wid = cur.lastrowid
        # Persist the user's preferred payout coordinates for next time.
        await db.execute(
            "UPDATE users SET payout_method = ?, payout_address = ? WHERE id = ?",
            (payload.payout_method, payload.payout_address, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"id": wid, "status": "pending"}


@router.get("/api/provider/withdrawals")
async def list_my_withdrawals(user=Depends(get_current_user), limit: int = 50):
    limit = max(1, min(limit, 200))
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, amount_usd_cents, payout_method, payout_address, status, "
            "channel_ref, review_note, created_at, reviewed_at, paid_at "
            "FROM withdrawal_requests WHERE user_id = ? "
            "ORDER BY id DESC LIMIT ?",
            (user["id"], limit),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {"withdrawals": rows, "count": len(rows)}


# ─────────────────────────────────────────────────────────────────────
# Admin
# ─────────────────────────────────────────────────────────────────────
@router.get("/api/admin/withdrawals")
async def admin_list_withdrawals(
    status: Optional[str] = None,
    limit: int = 100,
    user=Depends(require_admin),
):
    limit = max(1, min(limit, 500))
    db = await get_db()
    try:
        if status:
            cur = await db.execute(
                "SELECT w.*, u.username, u.email FROM withdrawal_requests w "
                "JOIN users u ON w.user_id = u.id "
                "WHERE w.status = ? ORDER BY w.id DESC LIMIT ?",
                (status, limit),
            )
        else:
            cur = await db.execute(
                "SELECT w.*, u.username, u.email FROM withdrawal_requests w "
                "JOIN users u ON w.user_id = u.id "
                "ORDER BY w.id DESC LIMIT ?",
                (limit,),
            )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {"withdrawals": rows, "count": len(rows)}


class ReviewIn(BaseModel):
    note: Optional[str] = None
    channel_ref: Optional[str] = None  # only meaningful on paid


async def _transition(wid: int, *, new_status: str, allowed_from: tuple[str, ...],
                      reviewer_id: int, note: Optional[str], channel_ref: Optional[str]):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM withdrawal_requests WHERE id = ?", (wid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "withdrawal not found")
        if row["status"] not in allowed_from:
            raise HTTPException(
                400, f"cannot transition {row['status']} → {new_status}"
            )
        sql_set = ["status = ?", "reviewer_id = ?", "reviewed_at = datetime('now')"]
        params: list = [new_status, reviewer_id]
        if note is not None:
            sql_set.append("review_note = ?")
            params.append(note)
        if new_status == "paid":
            sql_set.append("paid_at = datetime('now')")
            if channel_ref is not None:
                sql_set.append("channel_ref = ?")
                params.append(channel_ref)
        params.append(wid)
        await db.execute(
            f"UPDATE withdrawal_requests SET {', '.join(sql_set)} WHERE id = ?",
            params,
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM withdrawal_requests WHERE id = ?", (wid,))
        return dict(await cur.fetchone())
    finally:
        await db.close()


@router.post("/api/admin/withdrawals/{wid}/approve")
async def admin_approve_withdrawal(wid: int, payload: ReviewIn, user=Depends(require_admin)):
    return await _transition(
        wid, new_status="approved", allowed_from=("pending",),
        reviewer_id=user["id"], note=payload.note, channel_ref=None,
    )


@router.post("/api/admin/withdrawals/{wid}/reject")
async def admin_reject_withdrawal(wid: int, payload: ReviewIn, user=Depends(require_admin)):
    return await _transition(
        wid, new_status="rejected", allowed_from=("pending", "approved"),
        reviewer_id=user["id"], note=payload.note, channel_ref=None,
    )


@router.post("/api/admin/withdrawals/{wid}/paid")
async def admin_mark_paid(wid: int, payload: ReviewIn, user=Depends(require_admin)):
    if not payload.channel_ref:
        raise HTTPException(400, "channel_ref (transaction id) is required when marking paid")
    return await _transition(
        wid, new_status="paid", allowed_from=("pending", "approved"),
        reviewer_id=user["id"], note=payload.note, channel_ref=payload.channel_ref,
    )


class SettleIn(BaseModel):
    period_ym: Optional[str] = None  # YYYY-MM; None = previous closed month


@router.post("/api/admin/provider-earnings/settle")
async def admin_settle_earnings(payload: SettleIn, user=Depends(require_admin)):
    rows = await settle_provider_earnings(payload.period_ym)
    return {"settled": len(rows), "rows": rows, "period_ym": payload.period_ym}
