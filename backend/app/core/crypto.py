"""Encryption of small secrets stored in the database (the 2FA seed), so a leaked database copy alone cannot generate codes.
The key is derived from SECRET_KEY, so rotating SECRET_KEY makes stored 2FA seeds unreadable: users then set 2FA up again
(an admin can clear it with the reset-2fa command)."""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from . import config


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(f"tradeguard-secrets-v1:{config.SECRET_KEY}".encode()).digest())
    return Fernet(key)


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None
