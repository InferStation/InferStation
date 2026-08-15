from cryptography.fernet import Fernet, InvalidToken

from apps.api.app.core.settings import get_settings


class SecretCipher:
    def __init__(self, key: bytes | None = None):
        self._fernet = Fernet(key or get_settings().fernet_key)

    def encrypt(self, secret: str | None) -> str | None:
        if not secret:
            return None
        return self._fernet.encrypt(secret.encode("utf-8")).decode("ascii")

    def decrypt(self, ciphertext: str | None) -> str | None:
        if not ciphertext:
            return None
        try:
            return self._fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise ValueError("Unable to decrypt endpoint credential") from exc
