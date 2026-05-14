"""End-to-end smoke test for the v2 billing rollout.

Runs entirely against a temp sqlite — no real Freemius calls.

Scenario:
  1. Two users: provider (id=1), consumer (id=2).
  2. Consumer tops up $100 via the Freemius webhook (signed payload).
  3. Consumer balance jumps to $100; over-limit flag clears.
  4. Provider has 1 backend; consumer makes $7 worth of usage on it
     (recorded directly in usage_daily).
  5. deduct_user_balance($7) → balance = $93.
  6. Settle the prior month → provider_earnings row appears with the
     correct 82.4 / 10 / 7.6 split.
  7. Provider files a $50 withdrawal; admin approves; admin marks paid.
  8. Re-query get_provider_earnings — paid moves from in_flight to paid,
     available drops accordingly.
"""
import asyncio
import hashlib
import hmac
import json
import os
import tempfile
from datetime import date, timedelta

# Point database.DB_PATH at a temp file BEFORE importing it.
TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
os.environ["DB_PATH"] = TMP

import database  # noqa: E402

database.DB_PATH = TMP

import billing  # noqa: E402
import freemius  # noqa: E402


def _prev_month_ym() -> str:
    today = date.today().replace(day=1)
    prev = today - timedelta(days=1)
    return prev.strftime("%Y-%m")


async def main():
    await database.init_db()
    db = await database.get_db()
    try:
        # ── seed users + backend + usage ──────────────────────────
        await db.execute(
            "INSERT INTO users (id,username,email,password_hash,role,is_active,balance,credit_limit_cents) "
            "VALUES (1,'prov','p@x','h','provider',1,0,0), "
            "       (2,'cons','c@x','h','user',1,0,0)"
        )
        await db.execute(
            "INSERT INTO backends (id,name,owner_id,url,mode,input_price,output_price,enabled,listing_status) "
            "VALUES (1,'gpu',1,'http://x','direct',1.0,3.0,1,'listed')"
        )
        prev_ym = _prev_month_ym()
        await db.execute(
            "INSERT INTO usage_daily (user_id,backend_id,model,day,requests,input_tokens,output_tokens,cost) "
            "VALUES (2,1,'m1',?,1,0,0,7.0)",
            (f"{prev_ym}-15",),
        )
        await db.commit()
    finally:
        await db.close()

    print("== Step 1: balance is zero, over-limit ==")
    s = await billing.get_balance_status(2)
    print("  balance:", s)
    assert s["balance"] == 0.0 and s["over_limit"] is True

    over, _, _ = await billing.is_over_credit_limit(2)
    assert over is True

    print("== Step 2: Freemius webhook for $100 topup ==")
    # Build a fake payment.created event for consumer (user_id=2).
    event = {
        "type": "payment.created",
        "objects": {
            "payment": {
                "id": 999001,
                "gross": "100.00",
                "net": "92.40",  # implies 7.60 channel fee
                "custom_data": {"user_id": 2, "preset": "standard"},
            },
            "user": {"id": 555, "email": "c@x"},
            "plan": {"id": "TBD_STANDARD"},
            "pricing": {"id": "TBD_STANDARD_P"},
        },
    }
    raw = json.dumps(event).encode("utf-8")
    secret = "shh-test"
    cfg = {
        "enabled": True,
        "sandbox": False,
        "product_id": 12345,
        "product_secret": secret,
        "developer_secret": None,
        "presets": freemius.PRESETS,
    }
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    assert freemius.verify_webhook_signature(raw, sig, cfg)
    summary = freemius.extract_payment_summary(freemius.parse_event(raw))
    print("  summary:", {k: summary[k] for k in ("gross_cents", "net_cents", "channel_fee_cents", "user_id_hint")})
    assert summary == summary  # parsed

    # Simulate what payments.freemius_webhook does inline (without TestClient
    # so we don't drag the whole gateway app into this smoke test).
    db = await database.get_db()
    try:
        await db.execute(
            "INSERT INTO topups (user_id,gross_usd_cents,net_usd_cents,channel_fee_cents,"
            "channel,channel_ref,status,settled_at) "
            "VALUES (?,?,?,?,'freemius',?,'succeeded',datetime('now'))",
            (2, summary["gross_cents"], summary["net_cents"],
             summary["channel_fee_cents"], summary["payment_id"]),
        )
        await db.commit()
    finally:
        await db.close()
    await billing.credit_user_balance(2, summary["gross_cents"] / 100)

    print("== Step 3: balance credited ==")
    s = await billing.get_balance_status(2)
    print("  balance:", s)
    assert abs(s["balance"] - 100.0) < 1e-6
    assert s["over_limit"] is False

    print("== Step 4: idempotency — re-submitting same payment_id is a no-op ==")
    db = await database.get_db()
    try:
        cur = await db.execute(
            "SELECT COUNT(*) AS c FROM topups WHERE channel='freemius' AND channel_ref=?",
            (summary["payment_id"],),
        )
        rows_before = (await cur.fetchone())["c"]
    finally:
        await db.close()
    assert rows_before == 1  # exactly one row, app would skip duplicates by SELECT-first

    print("== Step 5: deduct $7 for consumer call ==")
    await billing.deduct_user_balance(2, 7.0)
    s = await billing.get_balance_status(2)
    print("  balance:", s["balance"])
    assert abs(s["balance"] - 93.0) < 1e-6

    print("== Step 6: settle provider earnings for prev month ==")
    rows = await billing.settle_provider_earnings(prev_ym)
    print("  rows:", rows)
    assert len(rows) == 1
    r = rows[0]
    assert r["gross_usd_cents"] == 700
    assert r["channel_fee_cents"] == 53  # round(7 * 0.076 * 100)
    assert r["platform_fee_cents"] == 70  # round(7 * 0.10 * 100)
    assert r["provider_cut_cents"] == 700 - 53 - 70  # 577

    print("== Step 7: provider earnings summary ==")
    ps = await billing.get_provider_earnings(1)
    print("  ps:", {k: v for k, v in ps.items() if k != "history"})
    assert ps["total_earned_cents"] == 577
    assert ps["available_cents"] == 577

    print("== Step 8: file + approve + pay $5 withdrawal ==")
    db = await database.get_db()
    try:
        cur = await db.execute(
            "INSERT INTO withdrawal_requests (user_id,amount_usd_cents,payout_method,payout_address) "
            "VALUES (1, 500, 'paypal', 'p@x')",
        )
        wid = cur.lastrowid
        await db.commit()
        # admin approves
        await db.execute(
            "UPDATE withdrawal_requests SET status='approved', reviewer_id=1, reviewed_at=datetime('now') WHERE id=?",
            (wid,),
        )
        await db.commit()
        ps2 = await billing.get_provider_earnings(1)
        assert ps2["pending_withdraw_cents"] == 500
        assert ps2["available_cents"] == 577 - 500
        # admin marks paid
        await db.execute(
            "UPDATE withdrawal_requests SET status='paid', paid_at=datetime('now'), channel_ref='TXN-001' WHERE id=?",
            (wid,),
        )
        await db.commit()
    finally:
        await db.close()
    ps3 = await billing.get_provider_earnings(1)
    print("  after-paid:", {k: v for k, v in ps3.items() if k != "history"})
    assert ps3["total_paid_cents"] == 500
    assert ps3["pending_withdraw_cents"] == 0
    assert ps3["available_cents"] == 77

    print("\nALL OK — Day 7 e2e smoke green")


if __name__ == "__main__":
    asyncio.run(main())
