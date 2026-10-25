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
