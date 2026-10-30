import pytest
from conftest import signup
from sqlalchemy import select

from app.core import config
from app.core.db import SessionLocal
from app.models import StoredImage

BODY = {"timestamp": 1_700_000_000_000, "pair": "XAUUSD"}
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 40
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40


def files():
    """The stored images (the client fixture recreates every table for each test, so this starts empty)."""
    with SessionLocal() as db:
        return list(db.scalars(select(StoredImage.key)))


def entry(client, h):
    return client.post("/api/entries", json=BODY, headers=h).json()["id"]


def put(client, h, eid, slot="before", data=WEBP):
    return client.put(f"/api/entries/{eid}/images/{slot}", content=data, headers=h)


def test_upload_then_read_back(client):
    h = signup(client)
    eid = entry(client, h)
    assert client.get("/api/entries", headers=h).json()[0]["images"] == {}
    r = put(client, h, eid)
    assert r.status_code == 200 and list(r.json()["images"]) == ["before"]
    got = client.get(f"/api/entries/{eid}/images/before", headers=h)
    assert got.status_code == 200 and got.content == WEBP and got.headers["content-type"] == "image/webp"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/entries", headers=h).json()[0]["images"] == r.json()["images"]


def test_png_and_jpeg_are_accepted_with_their_own_type(client):
    h = signup(client)
    eid = entry(client, h)
    put(client, h, eid, "before", PNG)
    put(client, h, eid, "after", JPEG)
    assert client.get(f"/api/entries/{eid}/images/before", headers=h).headers["content-type"] == "image/png"
    assert client.get(f"/api/entries/{eid}/images/after", headers=h).headers["content-type"] == "image/jpeg"


def test_token_is_not_the_storage_key_and_changes_on_replace(client):
    h = signup(client)
    eid = entry(client, h)
    first = put(client, h, eid).json()["images"]["before"]
    assert "/" not in first and "." not in first
    second = put(client, h, eid, data=PNG).json()["images"]["before"]
    assert first != second
    assert len(files()) == 1  # the replaced file is gone


def test_rejects_non_images_and_oversize(client, monkeypatch):
    h = signup(client)
    eid = entry(client, h)
    for bad in (b"", b"hello", b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"GIF89a" + b"\x00" * 20, b"%PDF-1.4"):
        assert put(client, h, eid, data=bad).status_code == 415, bad
    monkeypatch.setattr(config, "MAX_IMAGE_BYTES", 100)
    assert put(client, h, eid, data=WEBP + b"\x00" * 100).status_code == 413
    assert files() == []


def test_bad_slot_and_unknown_entry(client):
    h = signup(client)
    eid = entry(client, h)
    assert put(client, h, eid, "middle").status_code == 422
    assert put(client, h, "nope").status_code == 404
    assert client.get(f"/api/entries/{eid}/images/before", headers=h).status_code == 404


def test_images_are_private_to_their_owner(client):
    a, b = signup(client, "alice"), signup(client, "bob")
    eid = entry(client, a)
    put(client, a, eid)
    assert client.get(f"/api/entries/{eid}/images/before").status_code == 401
    assert client.get(f"/api/entries/{eid}/images/before", headers=b).status_code == 404
    assert put(client, b, eid).status_code == 404
    assert client.delete(f"/api/entries/{eid}/images/before", headers=b).status_code == 404


def test_images_cannot_be_set_through_the_entry_body(client):
    h = signup(client)
    eid = entry(client, h)
    put(client, h, eid)
    updated = client.put(f"/api/entries/{eid}", json={**BODY, "images": {"before": "1/evil.webp"}}, headers=h).json()
    assert list(updated["images"]) == ["before"] and "evil" not in updated["images"]["before"]


def test_delete_image(client):
    h = signup(client)
    eid = entry(client, h)
    put(client, h, eid)
    r = client.delete(f"/api/entries/{eid}/images/before", headers=h)
    assert r.status_code == 200 and r.json()["images"] == {}
    assert files() == []
    assert client.delete(f"/api/entries/{eid}/images/before", headers=h).status_code == 404


def test_per_user_limit_counts_new_images_not_replacements(client, monkeypatch):
    h = signup(client)
    monkeypatch.setattr(config, "MAX_IMAGES_PER_USER", 2)
    one, two = entry(client, h), entry(client, h)
    assert put(client, h, one).status_code == 200
    assert put(client, h, one, "after").status_code == 200
    assert put(client, h, two).status_code == 409
    assert put(client, h, one, "after", PNG).status_code == 200


def test_deleting_entries_removes_their_files(client):
    h = signup(client)
    a, b = entry(client, h), entry(client, h)
    put(client, h, a)
    put(client, h, b, "after")
    assert len(files()) == 2
    client.delete(f"/api/entries/{a}", headers=h)
    assert len(files()) == 1
    client.delete("/api/entries", headers=h)
    assert files() == []


def test_deleting_the_account_removes_their_files(client):
    h = signup(client)
    put(client, h, entry(client, h))
    assert client.post("/api/auth/delete-account", json={"password": "password123"}, headers=h).status_code == 204
    assert files() == []
