"""Password strength beyond length: common passwords, passwords built from the email, and known data breaches."""
import hashlib

import httpx
from fastapi import HTTPException, status

from . import config

# The most-used passwords that are long enough to pass the length rule. The breach check below covers the rest.
COMMON = frozenset("""
password123 password1234 password12 1234567890 0123456789 123456789a 12345678910 123456789012 9876543210 1234512345
qwertyuiop qwerty12345 qwerty123456 1q2w3e4r5t 1qaz2wsx3e asdfghjkl1 asdfghjkl; zxcvbnm123 abcdefghij abc1234567
iloveyou12 iloveyou123 letmein123 welcome123 changeme123 administrator passw0rd123 p@ssword123 p@ssw0rd123 password123!
monkey1234 dragon1234 football12 baseball12 superman12 sunshine12 princess12 1111111111 0000000000
tradeguard tradeguard1 tradeguard123 trading123 tradingview
""".split())


def weakness(password: str, email: str | None = None) -> str | None:
    """Why the password is too weak, or None. Local checks only (no network)."""
    low = password.lower()
    if low in COMMON:
        return "That password is too common"
    if len(set(low)) < 4:
        return "That password is too repetitive"
    local = (email or "").split("@")[0].lower()
    if len(local) >= 4 and local in low:
        return "The password must not contain your email name"
    return None


def is_breached(password: str) -> bool:
    """True if the password appears in the Have I Been Pwned breach list. Only the first 5 characters of its SHA-1 leave
    this server. If the service cannot be reached the password is let through, so sign-up never depends on it."""
    if not config.BREACH_CHECK_ENABLED:
        return False
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        res = httpx.get(f"https://api.pwnedpasswords.com/range/{prefix}", timeout=3, headers={"Add-Padding": "true"})
        res.raise_for_status()
    except httpx.HTTPError:
        return False
    for line in res.text.splitlines():
        found, _, count = line.strip().partition(":")
        if found == suffix and count.isdigit() and int(count) > 0:  # padding rows have a count of 0
            return True
    return False


def require_strong(password: str, email: str | None = None) -> None:
    problem = weakness(password, email)
    if not problem and is_breached(password):
        problem = "That password has appeared in a data breach"
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{problem}. Choose a different one.")
