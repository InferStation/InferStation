"""HTTP-level smoke test using FastAPI TestClient.

Exercises:
- POST /api/payments/freemius/webhook with HMAC-signed body
- GET  /api/payments/my-topups (auth required)
- GET  /api/billing/balance (auth required, returns *_cents fields)
- POST /api/payments/topup/checkout (issues a Freemius URL + bridge row)
"""
import hashlib
import hmac
import json
import os
import tempfile

TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
os.environ["DB_PATH"] = TMP
os.environ["JWT_SECRET"] = "test-secret"

import database  # noqa: E402

database.DB_PATH = TMP

import asyncio  # noqa: E402

import gateway  # noqa: E402  # imports payments + withdrawals routers
import auth  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


# Install freemius config directly into the live CONFIG dict.
SECRET = "shh-test"
gateway.CONFIG["payments"] = {
    "freemius": {
        "enabled": True,
        "sandbox": False,
        "product_id": 12345,
        "product_public_key": "pk_x",
        "product_secret": SECRET,
        "developer_secret": None,
    }
}


async def _setup():
    await database.init_db()
    db = await database.get_db()
    try:
        await db.execute(
            "INSERT INTO users (id,username,email,password_hash,role,is_active,balance,credit_limit_cents) "
            "VALUES (1,'cons','c@x','h','user',1,0,0)"
        )
        await db.commit()
    finally:
        await db.close()


asyncio.get_event_loop().run_until_complete(_setup())


def _token_for(user_id: int) -> str:
    from jose import jwt
    return jwt.encode({"sub": str(user_id)}, auth.JWT_SECRET, algorithm=auth.JWT_ALGORITHM)


client = TestClient(gateway.app)
hdr = {"Authorization": f"Bearer {_token_for(1)}"}

print("== GET /api/billing/balance (empty) ==")
r = client.get("/api/billing/balance", headers=hdr)
assert r.status_code == 200, r.text
b = r.json()
print(" ", b)
assert b["balance_cents"] == 0 and b["over_limit"] is True

print("== GET /api/payments/topup/presets ==")
r = client.get("/api/payments/topup/presets", headers=hdr)
assert r.status_code == 200, r.text
print(" ", r.json()["enabled"], len(r.json()["presets"]))
assert r.json()["enabled"] is True
assert len(r.json()["presets"]) == 3

print("== POST /api/payments/topup/checkout ==")
r = client.post("/api/payments/topup/checkout", headers=hdr,
                json={"preset": "standard"})
assert r.status_code == 200, r.text
co = r.json()
print(" ", {k: co[k] for k in ("preset", "usd_cents")})
assert co["preset"] == "standard" and co["usd_cents"] == 10000
assert "checkout.freemius.com/product/12345/plan/" in co["url"]

print("== POST /api/payments/freemius/webhook (bad signature) ==")
body = json.dumps({"type": "payment.created"}).encode()
r = client.post("/api/payments/freemius/webhook", content=body,
                headers={"x-signature": "deadbeef"})
assert r.status_code == 401, r.text

print("== POST /api/payments/freemius/webhook (valid $100 payment) ==")
event = {
    "type": "payment.created",
    "objects": {
        "payment": {
            "id": 7777,
            "gross": "100.00",
            "net": "92.40",
            "custom_data": {"user_id": 1, "preset": "standard"},
        },
        "user": {"id": 100, "email": "c@x"},
        "plan": {"id": "48781"},
        "pricing": {"id": "63581"},
    },
}
raw = json.dumps(event).encode()
sig = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
r = client.post("/api/payments/freemius/webhook", content=raw,
                headers={"x-signature": sig, "Content-Type": "application/json"})
assert r.status_code == 200, r.text
print(" ", r.json())
assert r.json()["credited_usd"] == 100.0

print("== webhook idempotency (replay same payment_id) ==")
r = client.post("/api/payments/freemius/webhook", content=raw,
                headers={"x-signature": sig, "Content-Type": "application/json"})
assert r.status_code == 200
assert r.json().get("duplicate") is True

print("== GET /api/billing/balance (after topup) ==")
r = client.get("/api/billing/balance", headers=hdr)
b = r.json()
print(" ", b["balance_cents"], b["available_cents"], b["over_limit"])
assert b["balance_cents"] == 10000
assert b["available_cents"] == 10000
assert b["over_limit"] is False

print("== GET /api/payments/my-topups ==")
r = client.get("/api/payments/my-topups", headers=hdr)
assert r.status_code == 200
js = r.json()
print(" ", js["count"], js["topups"][0]["status"])
assert js["count"] == 1
assert js["topups"][0]["gross_usd_cents"] == 10000
assert js["topups"][0]["status"] == "succeeded"

print("\nALL OK — Day 7 HTTP e2e green")
