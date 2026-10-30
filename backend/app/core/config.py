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


DATABASE_URL = _database_url()
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
TOKEN_DAYS = int(os.environ.get("TOKEN_DAYS", "30"))
ALLOW_REGISTRATION = os.environ.get("ALLOW_REGISTRATION", "true").lower() == "true"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

# ---------- Learning library ----------
# PDFs placed in this folder are loaded into the database at startup and shown to every signed-in user (read-only).
LIBRARY_DIR = os.environ.get("LIBRARY_DIR", "").strip() or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "library")

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
REQUIRE_EMAIL_VERIFICATION = os.environ.get("REQUIRE_EMAIL_VERIFICATION", str(EMAIL_ENABLED)).lower() == "true"
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
CALENDAR_RETRY_MIN = int(os.environ.get("CALENDAR_RETRY_MIN", "10"))  # never try more often than this, even after a failure

# ---------- Trade screenshots ----------
# Screenshots are kept in the database (table stored_images). The limits keep one account from filling it.
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(2 * 1024 * 1024)))  # the app shrinks screenshots well below this
MAX_IMAGES_PER_USER = int(os.environ.get("MAX_IMAGES_PER_USER", "600"))
