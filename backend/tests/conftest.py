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
os.environ["CALENDAR_ENABLED"] = "false"  # tests never download the real feed; test_calendar.py turns it on with a fake one
os.environ["SMTP_HOST"] = ""  # never send real mail from tests (an empty value also beats backend/.env)
os.environ.pop("REQUIRE_EMAIL_VERIFICATION", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

assert str(engine.url.database).lower().endswith(("_test", "test.db")) or "test" in str(engine.url.database).lower()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as c:  # runs lifespan -> create_all
        yield c
    Base.metadata.drop_all(engine)


def signup(client, name="alice", password="password123"):
    r = client.post("/api/auth/register", json={"email": f"{name}@example.com", "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def auth(client):
    return signup(client)
