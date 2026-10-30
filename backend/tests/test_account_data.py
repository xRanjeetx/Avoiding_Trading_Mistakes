from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import Entry, User, UserSettings
from conftest import signup
from test_admin import signup_admin


def count(model, **where):
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model).filter_by(**where))


def test_delete_account_needs_the_right_password(client):
    auth = signup(client)
    assert client.post("/api/auth/delete-account", json={"password": "nope-nope"}, headers=auth).status_code == 403
    assert client.get("/api/auth/me", headers=auth).status_code == 200  # still signed in and still there


def test_delete_account_erases_user_and_all_their_data(client):
    auth = signup(client)
    other = signup(client, "bob")
    for h in (auth, other):
        assert client.post("/api/entries", json={"timestamp": 1_700_000_000_000, "pair": "EURUSD"}, headers=h).status_code == 201
    assert client.post("/api/auth/delete-account", json={"password": "password123"}, headers=auth).status_code == 204
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "password123"}).status_code == 401
    assert count(User) == 1 and count(Entry) == 1 and count(UserSettings) == 1  # bob's data is untouched
    assert client.get("/api/entries", headers=other).json()[0]["pair"] == "EURUSD"


def test_admin_cannot_delete_own_account_here(client):
    admin = signup_admin(client)
    assert client.post("/api/auth/delete-account", json={"password": "password123"}, headers=admin).status_code == 400
    assert client.get("/api/auth/me", headers=admin).status_code == 200


def test_delete_account_requires_login(client):
    assert client.post("/api/auth/delete-account", json={"password": "password123"}).status_code == 401


def test_import_adds_entries_and_skips_existing_ids(client):
    auth = signup(client)
    rows = [
        {"id": "a1", "timestamp": 1_700_000_000_000, "pair": "XAUUSD", "result": "tp", "pnl": 20, "notes": "n1"},
        {"id": "a2", "timestamp": 1_700_000_100_000, "pair": "EURUSD"},
        {"timestamp": 1_700_000_200_000, "pair": "GBPUSD"},  # no id: one is generated
    ]
    r = client.post("/api/entries/import", json=rows, headers=auth)
    assert r.status_code == 200 and r.json() == {"imported": 3, "skipped": 0}
    again = client.post("/api/entries/import", json=rows[:2], headers=auth)
    assert again.json() == {"imported": 0, "skipped": 2}
    listed = client.get("/api/entries", headers=auth).json()
    assert [e["pair"] for e in listed] == ["XAUUSD", "EURUSD", "GBPUSD"]
    assert listed[0]["pnl"] == 20 and listed[0]["notes"] == "n1"


def test_import_is_per_user_and_rejects_bad_rows_without_partial_writes(client):
    a, b = signup(client), signup(client, "bob")
    row = {"id": "same", "timestamp": 1_700_000_000_000, "pair": "XAUUSD"}
    assert client.post("/api/entries/import", json=[row], headers=a).json()["imported"] == 1
    assert client.post("/api/entries/import", json=[row], headers=b).json()["imported"] == 1  # same id, other user
    bad = [{"id": "ok1", "timestamp": 1_700_000_000_000}, {"id": "bad", "timestamp": 1_700_000_000_000, "result": "banana"}]
    assert client.post("/api/entries/import", json=bad, headers=a).status_code == 422
    assert [e["id"] for e in client.get("/api/entries", headers=a).json()] == ["same"]


def test_import_requires_login_and_caps_size(client):
    assert client.post("/api/entries/import", json=[]).status_code == 401
    auth = signup(client)
    too_many = [{"timestamp": 1_700_000_000_000}] * 5001
    assert client.post("/api/entries/import", json=too_many, headers=auth).status_code == 422
