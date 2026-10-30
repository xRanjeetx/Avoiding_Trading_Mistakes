"""Cloudflare Turnstile check for sign-up and "forgot password". Off (always passes) when TURNSTILE_SECRET is empty."""
import httpx

from ..core import config

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify_captcha(token: str | None, ip: str) -> bool:
    if not config.TURNSTILE_SECRET:
        return True
    if not token:
        return False
    try:
        res = httpx.post(VERIFY_URL, data={"secret": config.TURNSTILE_SECRET, "response": token, "remoteip": ip}, timeout=5)
        return bool(res.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False  # cannot confirm it is a person, so do not let it through
