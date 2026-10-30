"""Logging and error reporting.

Security events go to the "tradeguard.security" logger as one line each (what happened, from which address, for which
account id). They never contain passwords, tokens or reset links, so the log is safe to read and to ship."""
import logging

from . import config

security_log = logging.getLogger("tradeguard.security")


def setup_logging() -> None:
    logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def security_event(event: str, ip: str = "-", user_id: int | None = None, **detail) -> None:
    extra = " ".join(f"{k}={v}" for k, v in detail.items())
    security_log.warning("%s ip=%s user=%s %s", event, ip, user_id if user_id is not None else "-", extra.strip())


def setup_sentry() -> None:
    """Sends unhandled errors to Sentry when SENTRY_DSN is set. No request bodies, cookies or user details are attached."""
    if not config.SENTRY_DSN:
        return
    import sentry_sdk

    def scrub(event, _hint):
        request = event.get("request") or {}
        for key in ("data", "cookies", "headers", "query_string"):
            request.pop(key, None)
        return event

    sentry_sdk.init(
        dsn=config.SENTRY_DSN, environment="production" if config.IS_PRODUCTION else "development",
        send_default_pii=False, traces_sample_rate=0, before_send=scrub,
    )
