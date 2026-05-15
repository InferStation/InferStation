"""Freemius topup endpoints — prepaid balance for llm-gateway v1.

Routes (mounted in gateway.py):
- GET  /api/payments/topup/presets
- POST /api/payments/topup/checkout       → returns hosted-checkout URL
- POST /api/payments/freemius/webhook     → server-to-server, raw body, signed
- GET  /api/payments/my-topups            → user's topup history

Idempotency:
- Each Freemius `payment_id` may only credit balance once. We enforce this
  via `topups.channel_ref UNIQUE per (channel, channel_ref)` lookup.
- The PendingFreemiusCheckout bridge table backs out missing custom_data
  by reverse-lookup on (user_id, fs_plan_id, consumed_at IS NULL).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import freemius as _fs
from auth import get_current_user
from billing import credit_user_balance
from database import get_db

router = APIRouter(prefix="/api/payments", tags=["payments"])


def _cfg(request: Request) -> dict:
    """Pull current freemius config out of the live gateway CONFIG."""
    import gateway  # late import to avoid circular dependency at module load
    return _fs.get_cfg(gateway.CONFIG)


# ─────────────────────────────────────────────────────────────────────
# GET /api/payments/topup/presets — list available topup tiers
# ─────────────────────────────────────────────────────────────────────
@router.get("/topup/presets")
async def list_topup_presets(request: Request):
    cfg = _cfg(request)
    presets = cfg.get("presets") or _fs.PRESETS
    return {
        "enabled": _fs.is_configured(cfg),
        "sandbox": cfg.get("sandbox", False),
        "presets": [
            {
                "key": k,
                "label": info.get("label"),
                "usd_cents": info["usd_cents"],
                "usd": info["usd_cents"] / 100,
            }
            for k, info in presets.items()
        ],
    }


# ─────────────────────────────────────────────────────────────────────
# POST /api/payments/topup/checkout — issue hosted-checkout URL
# ─────────────────────────────────────────────────────────────────────
class CheckoutIn(BaseModel):
    preset: str
    return_url: Optional[str] = None


@router.post("/topup/checkout")
async def topup_checkout(
    payload: CheckoutIn,
    request: Request,
    user=Depends(get_current_user),
):
    cfg = _cfg(request)
    if not _fs.is_configured(cfg):
        raise HTTPException(503, "Freemius is not configured on this gateway")
    presets = cfg.get("presets") or _fs.PRESETS
    if payload.preset not in presets:
        raise HTTPException(400, f"unknown preset {payload.preset!r}")

    url, info = _fs.build_checkout_url(
        cfg=cfg,
        user_email=user["email"],
        user_id=user["id"],
        preset_key=payload.preset,
        return_url=payload.return_url,
    )

    # Bridge: store a pending row so the webhook can recover user_id/preset
    # even when Freemius drops custom_data.
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO pending_freemius_checkouts (user_id, fs_plan_id) VALUES (?, ?)",
            (user["id"], str(info["plan_id"])),
        )
        await db.commit()
    finally:
        await db.close()

    return {
        "url": url,
        "preset": payload.preset,
        "usd_cents": info["usd_cents"],
        "sandbox": cfg.get("sandbox", False),
    }


# ─────────────────────────────────────────────────────────────────────
# POST /api/payments/freemius/webhook
# ─────────────────────────────────────────────────────────────────────
@router.post("/freemius/webhook")
async def freemius_webhook(request: Request):
    cfg = _cfg(request)
    if not _fs.is_configured(cfg):
        # Refuse silently rather than letting Freemius retry forever.
        raise HTTPException(503, "Freemius not configured")
    raw = await request.body()
    sig = request.headers.get("x-signature") or request.headers.get("X-Signature")
    if not _fs.verify_webhook_signature(raw, sig, cfg):
        raise HTTPException(401, "invalid webhook signature")

    event = _fs.parse_event(raw)
    event_type = (event.get("type") or "").lower()

    # Refunds: handled separately (debit balance, mark topup row).
    if event_type == "payment.refund":
        return await _handle_refund(event)

    # We only credit balance on payment.created. Subscription/license/lifetime
    # purchase events are acknowledged but no-op for v1.
    if event_type != "payment.created":
        return {"ok": True, "ignored": event_type or "unknown"}

    summary = _fs.extract_payment_summary(event)
    if not summary["payment_id"]:
        raise HTTPException(400, "payment_id missing in event")

    db = await get_db()
    try:
        # Idempotency: skip if we've already booked this payment_id.
        cur = await db.execute(
            "SELECT id, status FROM topups WHERE channel = 'freemius' AND channel_ref = ?",
            (summary["payment_id"],),
        )
        existing = await cur.fetchone()
        if existing and existing["status"] == "succeeded":
            return {"ok": True, "duplicate": True, "topup_id": existing["id"]}

        # Resolve user_id: custom_data hint first, else bridge table lookup.
        user_id: Optional[int] = summary["user_id_hint"]
        if not user_id and summary["plan_id"]:
            cur = await db.execute(
                "SELECT id, user_id FROM pending_freemius_checkouts "
                "WHERE fs_plan_id = ? AND consumed_at IS NULL "
                "ORDER BY id DESC LIMIT 1",
                (summary["plan_id"],),
            )
            row = await cur.fetchone()
            if row:
                user_id = row["user_id"]
                await db.execute(
                    "UPDATE pending_freemius_checkouts SET consumed_at = datetime('now') WHERE id = ?",
                    (row["id"],),
                )
        if not user_id and summary["buyer_email"]:
            cur = await db.execute("SELECT id FROM users WHERE email = ?", (summary["buyer_email"],))
            row = await cur.fetchone()
            if row:
                user_id = row["id"]

        if not user_id:
            # We accept the webhook (200) so Freemius stops retrying, but mark
            # the topup orphan for manual reconciliation.
            await db.execute(
                "INSERT INTO topups (user_id, gross_usd_cents, net_usd_cents, channel_fee_cents, "
                "channel, channel_ref, status, settled_at) "
                "VALUES (0, ?, ?, ?, 'freemius', ?, 'orphan', datetime('now'))",
                (
                    summary["gross_cents"],
                    summary["net_cents"] or summary["gross_cents"],
                    summary["channel_fee_cents"] or 0,
                    summary["payment_id"],
                ),
            )
            await db.commit()
            return {"ok": True, "orphan": True, "reason": "user not found"}

        gross = summary["gross_cents"]
        net = summary["net_cents"] if summary["net_cents"] is not None else gross
        channel_fee = summary["channel_fee_cents"] if summary["channel_fee_cents"] is not None else (gross - net)

        await db.execute(
            "INSERT INTO topups (user_id, gross_usd_cents, net_usd_cents, channel_fee_cents, "
            "channel, channel_ref, status, settled_at) "
            "VALUES (?, ?, ?, ?, 'freemius', ?, 'succeeded', datetime('now'))",
            (user_id, gross, net, channel_fee, summary["payment_id"]),
        )
        await db.commit()
    finally:
        await db.close()

    # Credit balance with the GROSS amount: user sees the full topup; the
    # channel fee is absorbed by providers via per-call splits in billing.py.
    await credit_user_balance(user_id, gross / 100.0)

    return {"ok": True, "credited_usd": gross / 100.0, "user_id": user_id}


# ─────────────────────────────────────────────────────────────────────
# payment.refund handler (clawback balance, mark topup row)
# ─────────────────────────────────────────────────────────────────────
async def _handle_refund(event: dict) -> dict:
    """Process a Freemius payment.refund event.

    The event references the original payment via objects.payment.id.
    Strategy:
      - Find topup row by (channel='freemius', channel_ref=payment_id).
      - Determine refund amount: prefer payment.refund_amount fields if
        present, else default to the topup's full gross.
      - Atomically: mark topup.status='refunded' (or 'partially_refunded'),
        debit user balance by refund amount.
      - Idempotent: a topup already in 'refunded' state with the same
        cumulative refund cents short-circuits.
    """
    objects = event.get("objects") or {}
    payment = objects.get("payment") or {}
    parent_payment_id = (
        str(payment.get("id") or "")
        or str(payment.get("parent_payment_id") or "")
        or ""
    )
    if not parent_payment_id:
        return {"ok": True, "ignored": "refund missing payment id"}

    # Refund amount: try payment.refund_amount, else payment.gross (a refund
    # event echoes the original gross when full).
    refund_raw = (
        payment.get("refund_amount")
        or payment.get("amount")
        or payment.get("gross")
        or "0"
    )
    try:
        refund_cents = int(round(float(refund_raw) * 100))
    except (TypeError, ValueError):
        refund_cents = 0

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, user_id, gross_usd_cents, status FROM topups "
            "WHERE channel = 'freemius' AND channel_ref = ?",
            (parent_payment_id,),
        )
        topup = await cur.fetchone()
        if not topup:
            return {"ok": True, "ignored": "no matching topup", "payment_id": parent_payment_id}
        if topup["status"] in ("refunded", "orphan"):
            return {"ok": True, "duplicate": True, "topup_id": topup["id"], "status": topup["status"]}

        if refund_cents <= 0 or refund_cents > topup["gross_usd_cents"]:
            refund_cents = topup["gross_usd_cents"]
        new_status = "refunded" if refund_cents >= topup["gross_usd_cents"] else "partially_refunded"

        await db.execute(
            "UPDATE topups SET status = ?, settled_at = datetime('now') WHERE id = ?",
            (new_status, topup["id"]),
        )
        # Clawback balance (allowed to go negative; user can be put on hold).
        await db.execute(
            "UPDATE users SET balance = balance - ? WHERE id = ?",
            (refund_cents / 100.0, topup["user_id"]),
        )
        await db.commit()
    finally:
        await db.close()

    return {
        "ok": True,
        "refunded_usd": refund_cents / 100.0,
        "user_id": topup["user_id"],
        "topup_id": topup["id"],
        "status": new_status,
    }


# ─────────────────────────────────────────────────────────────────────
# GET /api/payments/my-topups
# ─────────────────────────────────────────────────────────────────────
@router.get("/my-topups")
async def my_topups(user=Depends(get_current_user), limit: int = 50):
    limit = max(1, min(limit, 200))
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, gross_usd_cents, net_usd_cents, channel_fee_cents, "
            "channel, channel_ref, status, created_at, settled_at "
            "FROM topups WHERE user_id = ? "
            "ORDER BY id DESC LIMIT ?",
            (user["id"], limit),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {"topups": rows, "count": len(rows)}
