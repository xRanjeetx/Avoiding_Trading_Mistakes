import logging
import os

from dotenv import load_dotenv

# Reads backend/.env if present. Real environment variables (e.g. on Render) take priority.
load_dotenv()


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///./dev.db")
    # Neon / Render hand out postgres:// or postgresql://; SQLAlchemy needs the psycopg driver named.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DEV_SECRET_KEY = "dev-only-change-me"
# Render sets RENDER=true on its services, so a deploy there is treated as production even if ENVIRONMENT is forgotten.
IS_PRODUCTION = os.environ.get("ENVIRONMENT", "").strip().lower() == "production" or os.environ.get("RENDER", "").lower() == "true"

DATABASE_URL = _database_url()
SECRET_KEY = os.environ.get("SECRET_KEY", DEV_SECRET_KEY)
# A login is a short-lived access token (kept in the page's memory) plus a refresh token in an HttpOnly cookie.
ACCESS_MINUTES = int(os.environ.get("ACCESS_MINUTES", "15"))  # how long one access token works before the app silently renews it
TOKEN_DAYS = int(os.environ.get("TOKEN_DAYS", "30"))  # how long a login survives without use (each renewal restarts it)
SESSION_MAX_DAYS = int(os.environ.get("SESSION_MAX_DAYS", "90"))  # after this the user logs in again, however active
REFRESH_COOKIE = "tg_refresh"
# "none" lets a web app and an API on different domains (Vercel + Render) share the cookie, but Safari and some other
# browsers block such cross-site cookies. Proxying /api through the web host (see README) allows "strict".
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "none" if IS_PRODUCTION else "lax").strip().lower()
if COOKIE_SAMESITE not in ("lax", "strict", "none"):
    raise RuntimeError("COOKIE_SAMESITE must be lax, strict or none")
COOKIE_SECURE = IS_PRODUCTION or COOKIE_SAMESITE == "none"  # browsers drop SameSite=None cookies that are not Secure
ALLOW_REGISTRATION = os.environ.get("ALLOW_REGISTRATION", "true").lower() == "true"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
# Optional allow-list of Host headers (e.g. "api.example.com"). Empty = any host.
TRUSTED_HOSTS = [h.strip() for h in os.environ.get("TRUSTED_HOSTS", "").split(",") if h.strip()]

# New sign-ups must be approved by an admin (Admin tab) before they can log in, after they have verified their email.
# On by default in production. Accounts that already exist stay approved; admin-created accounts are approved.
REQUIRE_APPROVAL = os.environ.get("REQUIRE_ADMIN_APPROVAL", str(IS_PRODUCTION)).lower() == "true"

# Admins must use two-factor sign-in to reach the admin tools. On by default in production; off locally so a fresh checkout works.
ADMIN_REQUIRE_2FA = os.environ.get("ADMIN_REQUIRE_2FA", str(IS_PRODUCTION)).lower() == "true"

# ---------- Monitoring ----------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()  # optional: unhandled errors are reported to Sentry (no request data attached)

# ---------- Abuse protection ----------
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(5 * 1024 * 1024)))  # largest request body (the CSV import is the biggest)
# Limits are counted in memory per server process, which is right for a single instance (Render free/starter).
RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true"
# How many proxies sit between the internet and this app and append to X-Forwarded-For (0 = none, use the socket address).
# Behind Render use 1; with a wrong value every visitor can share one limit bucket, or an attacker can choose their own address.
PROXY_HOPS = int(os.environ.get("PROXY_HOPS", "0"))
PASSWORD_MIN_LENGTH = 10
# Reject passwords found in known data breaches (HIBP range API: only the first 5 characters of a SHA-1 are sent). Fails open.
BREACH_CHECK_ENABLED = os.environ.get("BREACH_CHECK_ENABLED", "true").lower() == "true"
# Cloudflare Turnstile (free CAPTCHA). Empty = off. When set, sign-up and "forgot password" need a solved challenge.
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET", "").strip()

# ---------- Learning library ----------
# PDFs placed in this folder are loaded into the database at startup and shown to every signed-in user (read-only).
LIBRARY_DIR = os.environ.get("LIBRARY_DIR", "").strip() or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "library")

# The Learning checklists (common mistakes, points to remember, trade management) are loaded from this file at startup.
CHECKLIST_FILE = os.environ.get("CHECKLIST_FILE", "").strip() or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "checklists.json")

# ---------- Email (verification + password reset) ----------
# Any SMTP provider works (Gmail app password, Brevo, Resend SMTP, ...). With SMTP_HOST empty, emails are not
# sent: the link is printed to the server log instead and verification is not required, so local dev still works.
APP_URL = os.environ.get("APP_URL", "http://localhost:5173").rstrip("/")
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "") or SMTP_USER or "no-reply@localhost"
SMTP_SSL = os.environ.get("SMTP_SSL", "false").lower() == "true"  # true = implicit TLS (port 465), else STARTTLS
EMAIL_ENABLED = bool(SMTP_HOST)
# In production verification is always on (and SMTP_HOST is required), so nobody can sign up with an address they do not own.
REQUIRE_EMAIL_VERIFICATION = IS_PRODUCTION or os.environ.get("REQUIRE_EMAIL_VERIFICATION", str(EMAIL_ENABLED)).lower() == "true"
VERIFY_HOURS = int(os.environ.get("VERIFY_HOURS", "48"))
RESET_MINUTES = int(os.environ.get("RESET_MINUTES", "60"))

# ---------- News calendar ----------
# High-impact events come from the free ForexFactory-style weekly JSON feeds (unofficial; they refresh about hourly and
# allow only a few downloads per few minutes per IP). The server downloads them for everyone, at most once per
# CALENDAR_REFRESH_MIN, and keeps the last good copy if a download fails. CALENDAR_ENABLED=false turns it off.
CALENDAR_ENABLED = os.environ.get("CALENDAR_ENABLED", "true").lower() == "true"
CALENDAR_URLS = [
    u.strip() for u in os.environ.get(
        "CALENDAR_URLS",
        "https://nfs.faireconomy.media/ff_calendar_thisweek.json,https://nfs.faireconomy.media/ff_calendar_nextweek.json",
    ).split(",") if u.strip()
]
CALENDAR_REFRESH_MIN = int(os.environ.get("CALENDAR_REFRESH_MIN", "60"))  # data older than this is downloaded again
MAX_FEED_BYTES = 2 * 1024 * 1024  # a calendar download larger than this is dropped
CALENDAR_RETRY_MIN = int(os.environ.get("CALENDAR_RETRY_MIN", "10"))  # never try more often than this, even after a failure

# ---------- Trade screenshots ----------
# Screenshots are kept in the database (table stored_images). The limits keep one account from filling it.
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(2 * 1024 * 1024)))  # the app shrinks screenshots well below this
MAX_IMAGES_PER_USER = int(os.environ.get("MAX_IMAGES_PER_USER", "600"))
MAX_USER_IMAGE_BYTES = int(os.environ.get("MAX_USER_IMAGE_BYTES", str(150 * 1024 * 1024)))  # all of one account's screenshots together
MAX_IMAGE_PIXELS = 25_000_000  # larger pictures are refused before they are decoded (decompression bombs)
MAX_IMAGE_SIDE = 4096  # bigger pictures are scaled down to this on upload


# ---------- Production safety checks ----------
def production_problems() -> list[str]:
    """Settings that are fine on a laptop but unsafe on the internet. Empty when everything is OK."""
    problems = []
    if SECRET_KEY == DEV_SECRET_KEY or len(SECRET_KEY) < 32:
        problems.append("SECRET_KEY must be set to a random value of at least 32 characters")
    for origin in CORS_ORIGINS:
        host = origin.split("://", 1)[-1].split(":")[0]
        if origin == "*" or host in ("localhost", "127.0.0.1"):
            problems.append(f"CORS_ORIGINS must list only your real frontend URL (found '{origin}')")
        elif not origin.startswith("https://"):
            problems.append(f"CORS_ORIGINS entries must use https (found '{origin}')")
    for url in CALENDAR_URLS:
        if CALENDAR_ENABLED and not url.lower().startswith("https://"):  # (production only: http://localhost is fetched in development)
            problems.append(f"CALENDAR_URLS entries must use https (found '{url}')")
    if not EMAIL_ENABLED:
        problems.append("SMTP_HOST must be set: email verification is required in production")
    if not DATABASE_URL.startswith("postgresql"):
        problems.append("DATABASE_URL must point to PostgreSQL, not the local SQLite file")
    return problems


def check_production() -> None:
    if not IS_PRODUCTION:
        return
    if "sslmode=" not in DATABASE_URL and "localhost" not in DATABASE_URL:
        logging.getLogger("tradeguard.config").warning(
            "DATABASE_URL has no sslmode setting. Add ?sslmode=require unless the database is on a private network."
        )
    problems = production_problems()
    if problems:
        raise RuntimeError("Refusing to start in production:\n - " + "\n - ".join(problems))
