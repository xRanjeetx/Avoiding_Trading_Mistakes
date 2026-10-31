"""Test setup: choose the database BEFORE the app is imported.

    pytest                      -> SQLite file test.db (default, fast)
    TEST_DB=postgres pytest     -> the real local PostgreSQL database `tradeguard_test`
    TEST_DATABASE_URL=...       -> any explicit URL

The tests drop and recreate every table, so a safety check refuses to run against any
database whose name does not look like a test database (never your real journal).
"""
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from dotenv import dotenv_values


def _pick_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    if os.environ.get("TEST_DB", "").lower() in ("pg", "postgres", "postgresql"):
        dev = dotenv_values(Path(__file__).resolve().parents[1] / ".env").get("DATABASE_URL")
        if not dev:
            raise RuntimeError("TEST_DB=postgres needs DATABASE_URL in backend/.env (its database name is swapped for tradeguard_test)")
        parts = urlsplit(dev)
        return urlunsplit(parts._replace(path="/tradeguard_test"))
    return "sqlite:///./test.db"


def _assert_is_test_db(url: str) -> None:
    name = urlsplit(url).path.rsplit("/", 1)[-1].lower()
    if not (name.endswith("_test") or name.endswith("test.db") or name.startswith("test")):
        raise RuntimeError(f"Refusing to run tests against '{name}': the database name must look like a test database.")


TEST_URL = _pick_url()
_assert_is_test_db(TEST_URL)
os.environ["DATABASE_URL"] = TEST_URL
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"
os.environ["ALLOW_REGISTRATION"] = "true"
os.environ["LIBRARY_DIR"] = os.path.join(os.path.dirname(__file__), "_no_library")  # tests never load real books
os.environ["CHECKLIST_FILE"] = os.path.join(os.path.dirname(__file__), "_no_checklists.json")  # tests load their own checklists
os.environ["CALENDAR_ENABLED"] = "false"  # tests never download the real feed; test_calendar.py turns it on with a fake one
os.environ["SMTP_HOST"] = ""  # never send real mail from tests (an empty value also beats backend/.env)
os.environ.pop("REQUIRE_EMAIL_VERIFICATION", None)
os.environ["ENVIRONMENT"] = ""  # tests never run with the production start-up checks
os.environ["RATE_LIMIT_ENABLED"] = "false"  # test_abuse_protection.py turns it on; elsewhere many logins come from one address
os.environ["BREACH_CHECK_ENABLED"] = "false"  # tests never call the Have I Been Pwned service
os.environ["TURNSTILE_SECRET"] = ""
os.environ["TWO_FACTOR_ENABLED"] = "true"  # 2FA is off by default for now; the code is kept working and tested
os.environ["PROXY_HOPS"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from sqlalchemy import text  # noqa: E402

from app.core.db import Base, engine  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.main import app  # noqa: E402

assert str(engine.url.database).lower().endswith(("_test", "test.db")) or "test" in str(engine.url.database).lower()


def wipe_database():
    """Every table, including Alembic's own version table (otherwise the next start-up would think the schema exists)."""
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.fixture()
def client():
    limiter.reset()
    wipe_database()
    with TestClient(app) as c:  # runs lifespan -> migrations
        yield c
    wipe_database()


def signup(client, name="alice", password="correct-horse-42"):
    r = client.post("/api/auth/register", json={"email": f"{name}@example.com", "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def auth(client):
    return signup(client)
