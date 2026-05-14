"""Freemius hosted-checkout helper for one-time USD topups.

Adapted from skill_mart_website (永乐集) freemius.py, stripped to what
llm-gateway v1 needs: pure prepaid balance topups (no subscriptions).

Webhook verification:
- HMAC-SHA256 over raw body, hex digest, header `x-signature`.
- Freemius signs with the *product* secret key (`FREEMIUS_PRODUCT_SECRET`);
  legacy events may be signed with `FREEMIUS_DEVELOPER_SECRET`, so we accept
  either to avoid a fragile rollout.

Per-call (token billing) splits live in billing.py; the platform pre-funds
the channel fee at topup time, so balance credit = gross_usd_cents.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Optional
from urllib.parse import urlencode

# Config is loaded from gateway CONFIG["payments"]["freemius"]; this module
# stays free of FastAPI imports so it can be unit-tested in isolation.

_CHECKOUT_HOST = "https://checkout.freemius.com"


def _sandbox_qs(cfg: dict) -> list[tuple[str, str]]:
    """Hosted-checkout sandbox token. Mirrors Freemius JS SDK CheckoutService.

      token = md5(timestamp + product_id + product_secret + product_public_key + "checkout")
      ctx   = timestamp
    Returns [] when sandbox disabled.
    """
    if not (cfg.get("sandbox") and cfg.get("product_secret") and cfg.get("product_public_key")):
        return []
    ts = str(int(time.time()))
    raw = (
        ts
        + str(cfg["product_id"])
        + cfg["product_secret"]
        + cfg["product_public_key"]
        + "checkout"
    )
    token = hashlib.md5(raw.encode("utf-8")).hexdigest()
    return [("sandbox", token), ("s_ctx_ts", ts)]


# v1 topup presets. plan_id / pricing_id must be created on Freemius dashboard
# under product type = SaaS (4.7% base, no +2.3% WordPress surcharge) and set
# to ONE-TIME billing_cycle = lifetime.
PRESETS: dict[str, dict] = {
    "starter":  {"usd_cents": 2000,   "plan_id": "TBD_STARTER",  "pricing_id": "TBD_STARTER_P",  "label": "$20"},
    "standard": {"usd_cents": 10000,  "plan_id": "TBD_STANDARD", "pricing_id": "TBD_STANDARD_P", "label": "$100"},
    "pro":      {"usd_cents": 50000,  "plan_id": "TBD_PRO",      "pricing_id": "TBD_PRO_P",      "label": "$500"},
    "studio":   {"usd_cents": 200000, "plan_id": "TBD_STUDIO",   "pricing_id": "TBD_STUDIO_P",   "label": "$2000"},
}


def get_cfg(global_cfg: dict) -> dict:
    """Pull and normalise the freemius section out of gateway CONFIG.

    Recognised keys (all under CONFIG['payments']['freemius']):
      enabled, sandbox, product_id, plan_id (legacy),
      product_public_key, product_secret, developer_secret, api_bearer,
      presets (optional override of PRESETS dict).
    """
    payments = (global_cfg or {}).get("payments", {}) or {}
    fs = payments.get("freemius", {}) or {}
    return {
        "enabled": bool(fs.get("enabled")),
        "sandbox": bool(fs.get("sandbox")),
        "product_id": fs.get("product_id"),
        "product_public_key": fs.get("product_public_key"),
        "product_secret": fs.get("product_secret"),
        "developer_secret": fs.get("developer_secret"),
        "api_bearer": fs.get("api_bearer"),
        "presets": fs.get("presets") or PRESETS,
    }


def is_configured(cfg: dict) -> bool:
    return bool(
        cfg.get("enabled")
        and cfg.get("product_id")
        and (cfg.get("product_secret") or cfg.get("developer_secret"))
    )


def verify_webhook_signature(raw_body: bytes, header_signature: Optional[str], cfg: dict) -> bool:
    if not header_signature:
        return False
    sig = header_signature.strip().lower()
    for key in (cfg.get("product_secret"), cfg.get("developer_secret")):
        if not key:
            continue
        expected = hmac.new(key.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected.lower(), sig):
            return True
    return False


def build_checkout_url(
    *,
    cfg: dict,
    user_email: str,
    user_id: int,
    preset_key: str,
    return_url: Optional[str] = None,
) -> tuple[str, dict]:
    """Hosted-checkout URL for a one-time topup. Returns (url, preset_info)."""
    presets = cfg.get("presets") or PRESETS
    info = presets.get(preset_key)
    if not info:
        raise ValueError(f"unknown topup preset {preset_key!r}")
    base = f"{_CHECKOUT_HOST}/product/{cfg['product_id']}/plan/{info['plan_id']}/"
    qs: list[tuple[str, str]] = [
        ("pricing_id", str(info["pricing_id"])),
        ("billing_cycle", "lifetime"),
        ("user_email", user_email),
        ("readonly_user", "true"),
        ("data[user_id]", str(user_id)),
        ("data[preset]", preset_key),
    ]
    qs.extend(_sandbox_qs(cfg))
    if return_url:
        qs.append(("success_url", return_url))
    return f"{base}?{urlencode(qs)}", dict(info)


def parse_event(raw_body: bytes) -> dict:
    try:
        return json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _coerce_custom(payload) -> dict:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            v = json.loads(payload)
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            return {}
    return {}


def extract_payment_summary(event: dict) -> dict:
    """Pull the fields we need out of `payment.*` and friends.

    Real-world Freemius payloads drop `custom_data` in many cases; callers
    must be ready to fall back to the PendingFreemiusCheckout bridge table
    using (fs_user_email, fs_plan_id).
    """
    objects = event.get("objects") or {}
    payment = objects.get("payment") or {}
    license_ = objects.get("license") or {}
    user = objects.get("user") or {}
    plan = objects.get("plan") or {}
    pricing = objects.get("pricing") or {}

    gross = payment.get("gross") or payment.get("amount") or "0"
    try:
        gross_cents = int(round(float(gross) * 100))
    except (ValueError, TypeError):
        gross_cents = 0

    net = payment.get("net") or payment.get("payout") or None
    try:
        net_cents = int(round(float(net) * 100)) if net is not None else None
    except (ValueError, TypeError):
        net_cents = None

    # Pull plan_id with fallback chain (real payloads have None at objects.plan.id).
    plan_id = (
        plan.get("id")
        or payment.get("plan_id")
        or license_.get("plan_id")
    )

    custom = _coerce_custom(payment.get("custom_data") or license_.get("custom_data") or {})

    def _as_int(x):
        try:
            return int(x)
        except (TypeError, ValueError):
            return None

    return {
        "payment_id": str(payment.get("id") or "") or None,
        "license_id": str(license_.get("id") or "") or None,
        "fs_user_id": str(user.get("id") or "") or None,
        "plan_id": str(plan_id or "") or None,
        "pricing_id": str(pricing.get("id") or "") or None,
        "gross_cents": gross_cents,
        "net_cents": net_cents,
        "channel_fee_cents": (gross_cents - net_cents) if (net_cents is not None and gross_cents) else None,
        "buyer_email": user.get("email") or None,
        "is_sandbox": bool(payment.get("is_sandbox") or license_.get("is_sandbox") or False),
        "user_id_hint": _as_int(custom.get("user_id")),
        "preset_hint": custom.get("preset"),
        "custom_data": custom,
    }


def preset_for_plan_id(cfg: dict, plan_id) -> Optional[tuple[str, dict]]:
    if plan_id in (None, "", 0, "0"):
        return None
    pid = str(plan_id)
    for key, info in (cfg.get("presets") or PRESETS).items():
        if str(info.get("plan_id")) == pid:
            return key, dict(info)
    return None
