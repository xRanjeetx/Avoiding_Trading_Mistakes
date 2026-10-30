"""Time-based one-time passwords (RFC 6238) for authenticator apps, plus single-use recovery codes.

Written against the RFC with the standard library only; the tests check it with the RFC's own test vectors."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

import segno

PERIOD = 30  # seconds per code
DIGITS = 6
ISSUER = "Trade Guard"
RECOVERY_CODES = 10


def new_secret() -> str:
    """160 random bits, base32 (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def code_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 10**DIGITS
    return f"{number:0{DIGITS}d}"


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // PERIOD)


def check(secret: str, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """The time step the code belongs to, or None if it is wrong. The previous and next step are accepted (clock drift),
    and a step at or before `last_step` is refused, so a code that was already used cannot be used again."""
    code = "".join(code.split())
    if len(code) != DIGITS or not code.isdigit():
        return None
    step = current_step(now)
    for candidate in (step - 1, step, step + 1):
        if candidate > (last_step if last_step is not None else -1) and hmac.compare_digest(code_at(secret, candidate), code):
            return candidate
    return None


def provisioning_uri(secret: str, email: str) -> str:
    label = quote(f"{ISSUER}:{email}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}&algorithm=SHA1&digits={DIGITS}&period={PERIOD}"


def qr_data_uri(uri: str) -> str:
    """The QR code for `uri` as an SVG data: URL, drawn black on white so it scans in dark mode too."""
    return segno.make(uri, error="m").svg_data_uri(scale=5, border=2, dark="#000000", light="#ffffff")


# ---------- recovery codes ----------
def _normal(code: str) -> str:
    return "".join(ch for ch in code.lower() if ch.isalnum())


def _hash(code: str) -> str:
    return hashlib.sha256(_normal(code).encode()).hexdigest()


def new_recovery_codes() -> tuple[list[str], list[str]]:
    """(codes to show the user once, hashes to store). 50 random bits each, so a fast hash is enough."""
    codes = []
    for _ in range(RECOVERY_CODES):
        raw = secrets.token_hex(5)
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes, [_hash(c) for c in codes]


def use_recovery_code(stored: list[str] | None, code: str) -> list[str] | None:
    """The stored hashes without the one that matches, or None if no code matches."""
    wanted = _hash(code)
    for h in stored or []:
        if hmac.compare_digest(h, wanted):
            return [x for x in stored if x != h]
    return None
