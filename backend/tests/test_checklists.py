import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core import config
from app.core.db import SessionLocal
from app.models import ChecklistItem, ChecklistTick
from app.routers.checklists import KINDS, sync_checklists
from conftest import signup
from test_admin import signup_admin, user_id


def write(folder, data, name="checklists.json"):
    path = folder / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def sync(file):
    with SessionLocal() as db:
        return sync_checklists(db, file)


def count(model):
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model))


SAMPLE = {
    "mistakes": [{"group": "Quick", "items": ["No FOMO", "No revenge trading"]}, {"group": "Detail", "items": ["No gambling."]}],
    "remember": [{"group": "", "items": ["Wait for structure"]}],
}


# ---------- the shipped file ----------
def test_the_shipped_file_has_the_expected_lines():
    from app.routers.checklists import read_checklist_file

    root = Path(__file__).resolve().parents[1] / "data" / "checklists.json"
    lines = read_checklist_file(root)
    assert set(lines) == set(KINDS)
    assert len(lines["mistakes"]) == 37  # 20 in the book's diagram + 17 in detail
    assert len(lines["remember"]) == 32
    assert len(lines["management"]) == 24
    for kind, items in lines.items():
        texts = [t for _, t in items]
        assert len(set(texts)) == len(texts), f"duplicate line in {kind}"


# ---------- loading the file ----------
def test_sync_adds_lines_in_order_and_is_safe_to_repeat(client, tmp_path):
    f = write(tmp_path, SAMPLE)
    assert sync(f) == {"added": 4, "updated": 0, "unchanged": 0, "removed": 0}
    assert sync(f) == {"added": 0, "updated": 0, "unchanged": 4, "removed": 0}
    with SessionLocal() as db:
        rows = db.scalars(select(ChecklistItem).order_by(ChecklistItem.kind, ChecklistItem.position)).all()
    assert [(r.kind, r.group, r.position, r.text) for r in rows] == [
        ("mistakes", "Quick", 1, "No FOMO"), ("mistakes", "Quick", 2, "No revenge trading"),
        ("mistakes", "Detail", 3, "No gambling."), ("remember", "", 1, "Wait for structure"),
    ]


def test_editing_a_line_keeps_its_ticks_and_dropping_one_removes_them(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    ids = {i["text"]: i["id"] for i in client.get("/api/checklists", headers=h).json()}
    for text in ("No FOMO", "No gambling."):
        client.put(f"/api/checklists/{ids[text]}/tick", json={"done": True}, headers=h)

    edited = {"mistakes": [{"group": "Quick", "items": ["No FOMO at all", "No revenge trading"]}], "remember": SAMPLE["remember"]}
    assert sync(write(tmp_path, edited)) == {"added": 0, "updated": 1, "unchanged": 2, "removed": 1}
    items = {i["id"]: i for i in client.get("/api/checklists", headers=h).json()}
    assert items[ids["No FOMO"]]["text"] == "No FOMO at all" and items[ids["No FOMO"]]["done"] is True
    assert ids["No gambling."] not in items
    assert count(ChecklistTick) == 1  # the tick on the removed line went with it


def test_a_missing_file_changes_nothing(client, tmp_path):
    sync(write(tmp_path, SAMPLE))
    assert sync(str(tmp_path / "gone.json")) == {"added": 0, "updated": 0, "unchanged": 0, "removed": 0}
    assert count(ChecklistItem) == 4


def test_a_bad_file_changes_nothing(client, tmp_path):
    sync(write(tmp_path, SAMPLE))
    with pytest.raises(ValueError):
        sync(write(tmp_path, {"nonsense": [{"items": ["x"]}]}, "bad.json"))
    assert count(ChecklistItem) == 4


# ---------- API ----------
def test_ticks_are_per_user_and_can_be_cleared(client, tmp_path):
    a, b = signup(client, "alice"), signup(client, "bob")
    sync(write(tmp_path, SAMPLE))
    items = client.get("/api/checklists", headers=a).json()
    assert [i["done"] for i in items] == [False] * 4
    first, last = items[0]["id"], items[-1]["id"]

    assert client.put(f"/api/checklists/{first}/tick", json={"done": True}, headers=a).json() == {"id": first, "done": True}
    client.put(f"/api/checklists/{first}/tick", json={"done": True}, headers=a)  # repeating is harmless
    client.put(f"/api/checklists/{last}/tick", json={"done": True}, headers=a)
    assert [i["done"] for i in client.get("/api/checklists", headers=a).json()] == [True, False, False, True]
    assert [i["done"] for i in client.get("/api/checklists", headers=b).json()] == [False] * 4

    client.put(f"/api/checklists/{first}/tick", json={"done": False}, headers=a)
    assert [i["done"] for i in client.get("/api/checklists", headers=a).json()] == [False, False, False, True]

    assert client.delete("/api/checklists/remember/ticks", headers=a).status_code == 204
    assert [i["done"] for i in client.get("/api/checklists", headers=a).json()] == [False] * 4


def test_clearing_one_list_leaves_the_others(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    for i in client.get("/api/checklists", headers=h).json():
        client.put(f"/api/checklists/{i['id']}/tick", json={"done": True}, headers=h)
    client.delete("/api/checklists/mistakes/ticks", headers=h)
    done = {i["kind"]: i["done"] for i in client.get("/api/checklists", headers=h).json()}
    assert done == {"mistakes": False, "remember": True}


def test_unknown_item_or_list(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    assert client.put("/api/checklists/9999/tick", json={"done": True}, headers=h).status_code == 404
    assert client.delete("/api/checklists/nope/ticks", headers=h).status_code == 404


def test_sign_in_is_required(client):
    assert client.get("/api/checklists").status_code == 401
    assert client.put("/api/checklists/1/tick", json={"done": True}).status_code == 401


def test_deleting_an_account_removes_its_ticks(client, tmp_path):
    admin = signup_admin(client)
    h = signup(client, "bob")
    sync(write(tmp_path, SAMPLE))
    item = client.get("/api/checklists", headers=h).json()[0]["id"]
    client.put(f"/api/checklists/{item}/tick", json={"done": True}, headers=h)
    assert count(ChecklistTick) == 1
    assert client.delete(f"/api/admin/users/{user_id('bob@example.com')}", headers=admin).status_code == 204
    assert count(ChecklistTick) == 0
