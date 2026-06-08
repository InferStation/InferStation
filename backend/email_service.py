"""Email sending + verification-code helpers.

Relies on a `smtp` section in config.yaml. If missing, the service runs in
"dev mode": codes are logged to the gateway log instead of being delivered,
and — if `smtp.expose_dev_code: true` — the code is also echoed back in the
/api/auth/send-code response (useful for local development only).

config.yaml example:

    smtp:
      host: smtp.exmail.qq.com
      port: 465
      username: no-reply@example.com
      password: "xxxx"
      from: "天枢网关 <no-reply@example.com>"
      use_tls: true         # true = implicit TLS (465), false = STARTTLS (587)
      expose_dev_code: false
"""
from __future__ import annotations

import logging
import secrets
from typing import Optional

logger = logging.getLogger("email")

_SMTP: dict = {}


def configure(smtp_cfg: Optional[dict]) -> None:
    global _SMTP
    _SMTP = dict(smtp_cfg or {})


def is_dev_mode() -> bool:
    return not (_SMTP.get("host") and _SMTP.get("username") and _SMTP.get("password"))


def expose_dev_code() -> bool:
    return bool(_SMTP.get("expose_dev_code", False)) and is_dev_mode()


def generate_code(n: int = 6) -> str:
    return f"{secrets.randbelow(10 ** n):0{n}d}"


def _build_message(to_addr: str, subject: str, body: str):
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["From"] = _SMTP.get("from") or _SMTP.get("username", "no-reply@localhost")
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    return msg


async def send_verification_code(to_addr: str, code: str, purpose: str, locale: Optional[str] = None) -> None:
    """Send the code email. In dev mode, just log it.

    `locale` is the recipient's configured language. Currently we recognise
    "zh" (Simplified Chinese); any other value — including None / "" — falls
    back to English. This means: emails default to English unless the
    recipient has explicitly chosen Chinese in their account settings.
    """
    use_zh = (locale or "").lower().startswith("zh")
    if use_zh:
        purpose_text = {
            "register": "注册",
            "change-email": "修改邮箱",
            "delete-account": "注销账号",
            "login": "登录",
        }.get(purpose, purpose)
        subject = f"[天枢网关] 您的{purpose_text}验证码"
        body = (
            f"您正在进行「{purpose_text}」操作。\n"
            f"验证码：{code}\n"
            f"10 分钟内有效，请勿向他人泄露。\n"
            f"\n如非本人操作，请忽略此邮件。"
        )
    else:
        purpose_text = {
            "register": "sign-up",
            "change-email": "email change",
            "delete-account": "account deletion",
            "login": "sign-in",
        }.get(purpose, purpose)
        subject = f"[Tianshu Gateway] Your {purpose_text} verification code"
        body = (
            f"You are completing a {purpose_text} on Tianshu Gateway.\n"
            f"Verification code: {code}\n"
            f"This code expires in 10 minutes. Do not share it with anyone.\n"
            f"\nIf this wasn't you, please ignore this email."
        )

    if is_dev_mode():
        logger.warning("[email-dev] to=%s purpose=%s code=%s (SMTP not configured)", to_addr, purpose, code)
        return

    try:
        import aiosmtplib  # type: ignore
    except ImportError as e:
        logger.error("aiosmtplib missing, install with: pip install aiosmtplib (code=%s)", code)
        raise RuntimeError("邮件服务未就绪（缺少 aiosmtplib）") from e

    msg = _build_message(to_addr, subject, body)
    host = _SMTP["host"]
    port = int(_SMTP.get("port", 465))
    username = _SMTP["username"]
    password = _SMTP["password"]
    use_tls = bool(_SMTP.get("use_tls", port == 465))

    try:
        if use_tls:
            await aiosmtplib.send(
                msg, hostname=host, port=port, username=username, password=password,
                use_tls=True, timeout=20,
            )
        else:
            await aiosmtplib.send(
                msg, hostname=host, port=port, username=username, password=password,
                start_tls=True, timeout=20,
            )
    except Exception as e:
        logger.exception("smtp send failed to=%s", to_addr)
        raise RuntimeError(f"邮件发送失败：{e}") from e
