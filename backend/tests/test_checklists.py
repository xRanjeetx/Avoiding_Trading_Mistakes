import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core import config
from app.core.db import SessionLocal
from app.models import ChecklistItem, ChecklistOverride, ChecklistTick, UserChecklistItem
from app.routers.checklists import FILE_KINDS, KINDS, MINE_LIMIT, sync_checklists
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
    assert set(lines) == set(FILE_KINDS)
    assert len(lines["mistakes"]) == 37  # 20 in the book's diagram + 17 in detail
    assert len(lines["remember"]) == 32
    assert len(lines["psychology"]) == 31  # 29 principles + 2 key rules
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


# ---------- a user's own lines ----------
def add_mine(client, h, kind="rules", text="Never move my stop away"):
    return client.post("/api/checklists/mine", json={"kind": kind, "text": text}, headers=h)


def test_own_lines_are_added_listed_ticked_edited_and_deleted(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    made = add_mine(client, h, "remember", "  My own point  ")
    assert made.status_code == 201
    mine = made.json()
    assert (mine["text"], mine["mine"], mine["group"], mine["position"], mine["done"]) == ("My own point", True, "My points", 2, False)
    add_mine(client, h)  # a line for the user-only list

    items = client.get("/api/checklists", headers=h).json()
    assert [(i["kind"], i["mine"]) for i in items] == [
        ("mistakes", False), ("mistakes", False), ("mistakes", False), ("remember", False), ("remember", True), ("rules", True)]
    assert [i["position"] for i in items if i["kind"] == "remember"] == [1, 2]

    assert client.put(f"/api/checklists/mine/{mine['id']}/tick", json={"done": True}, headers=h).json() == {"id": mine["id"], "done": True}
    assert client.put(f"/api/checklists/mine/{mine['id']}", json={"text": "Changed"}, headers=h).json()["text"] == "Changed"
    again = {i["text"]: i for i in client.get("/api/checklists", headers=h).json()}
    assert again["Changed"]["done"] is True

    assert client.delete(f"/api/checklists/mine/{mine['id']}", headers=h).status_code == 204
    assert count(UserChecklistItem) == 1


def test_own_lines_are_private(client, tmp_path):
    a, b = signup(client, "alice"), signup(client, "bob")
    sync(write(tmp_path, SAMPLE))
    mine = add_mine(client, a).json()
    assert [i for i in client.get("/api/checklists", headers=b).json() if i["mine"]] == []
    for call in (
        client.put(f"/api/checklists/mine/{mine['id']}/tick", json={"done": True}, headers=b),
        client.put(f"/api/checklists/mine/{mine['id']}", json={"text": "x"}, headers=b),
        client.delete(f"/api/checklists/mine/{mine['id']}", headers=b),
    ):
        assert call.status_code == 404
    assert count(UserChecklistItem) == 1


def test_own_line_validation_and_limit(client, tmp_path):
    h = signup(client)
    assert add_mine(client, h, "nope").status_code == 404
    assert add_mine(client, h, "rules", "   ").status_code == 422
    assert add_mine(client, h, "rules", "x" * 501).status_code == 422
    with SessionLocal() as db:
        db.add_all(UserChecklistItem(user_id=1, kind="rules", text=f"r{n}") for n in range(MINE_LIMIT))
        db.commit()
    assert add_mine(client, h).status_code == 409


def test_reset_unticks_own_lines_of_that_list_only(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    r, m = add_mine(client, h).json(), add_mine(client, h, "mistakes", "Mine").json()
    for i in (r, m):
        client.put(f"/api/checklists/mine/{i['id']}/tick", json={"done": True}, headers=h)
    client.delete("/api/checklists/rules/ticks", headers=h)
    done = {i["text"]: i["done"] for i in client.get("/api/checklists", headers=h).json() if i["mine"]}
    assert done == {"Never move my stop away": False, "Mine": True}


def test_the_file_sync_leaves_own_lines_alone(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    add_mine(client, h, "mistakes", "Mine")
    sync(write(tmp_path, {"remember": SAMPLE["remember"]}))  # drops every mistakes line
    assert count(UserChecklistItem) == 1


def test_deleting_an_account_removes_its_own_lines(client, tmp_path):
    admin = signup_admin(client)
    h = signup(client, "bob")
    add_mine(client, h)
    assert count(UserChecklistItem) == 1
    assert client.delete(f"/api/admin/users/{user_id('bob@example.com')}", headers=admin).status_code == 204
    assert count(UserChecklistItem) == 0


def test_own_lines_are_in_the_data_export(client):
    h = signup(client)
    add_mine(client, h)
    data = client.get("/api/auth/export", headers=h).json()
    assert data["learningLines"] == [{"list": "rules", "text": "Never move my stop away", "done": False}]


# ---------- a user's changes to the shared lines ----------
def lines(client, h, kind="mistakes"):
    return [i for i in client.get("/api/checklists", headers=h).json() if i["kind"] == kind]


def test_a_shared_line_can_be_reworded_for_one_user_only(client, tmp_path):
    a, b = signup(client, "alice"), signup(client, "bob")
    sync(write(tmp_path, SAMPLE))
    first = lines(client, a)[0]
    assert client.put(f"/api/checklists/{first['id']}/override", json={"text": "  Never chase price  "}, headers=a).json() == {"id": first["id"], "text": "Never chase price"}
    mine = lines(client, a)[0]
    assert (mine["text"], mine["edited"]) == ("Never chase price", True)
    assert (lines(client, b)[0]["text"], lines(client, b)[0]["edited"]) == ("No FOMO", False)
    # writing the original wording back is not a change
    client.put(f"/api/checklists/{first['id']}/override", json={"text": "No FOMO"}, headers=a)
    assert lines(client, a)[0]["edited"] is False
    assert count(ChecklistOverride) == 0
    assert client.put(f"/api/checklists/{first['id']}/override", json={"text": "   "}, headers=a).status_code == 422
    assert client.put("/api/checklists/9999/override", json={"text": "x"}, headers=a).status_code == 404


def test_a_shared_line_can_be_removed_for_one_user_and_the_rest_renumber(client, tmp_path):
    a, b = signup(client, "alice"), signup(client, "bob")
    sync(write(tmp_path, SAMPLE))
    first = lines(client, a)[0]
    assert client.delete(f"/api/checklists/{first['id']}", headers=a).status_code == 204
    got = lines(client, a)
    assert [(i["text"], i["hidden"], i["position"]) for i in got] == [("No FOMO", True, 0), ("No revenge trading", False, 1), ("No gambling.", False, 2)]
    assert [(i["hidden"], i["position"]) for i in lines(client, b)] == [(False, 1), (False, 2), (False, 3)]
    assert client.delete("/api/checklists/9999", headers=a).status_code == 404
    # the user's own lines carry on after the visible shared ones
    add_mine(client, a, kind="mistakes", text="Mine")
    assert lines(client, a)[-1]["position"] == 3


def test_restore_brings_back_removed_and_reworded_lines_of_one_list(client, tmp_path):
    h = signup(client)
    sync(write(tmp_path, SAMPLE))
    m = lines(client, h)
    client.delete(f"/api/checklists/{m[0]['id']}", headers=h)
    client.put(f"/api/checklists/{m[1]['id']}/override", json={"text": "Changed"}, headers=h)
    other = lines(client, h, "remember")[0]
    client.delete(f"/api/checklists/{other['id']}", headers=h)
    assert client.post("/api/checklists/mistakes/restore", headers=h).status_code == 204
    assert [(i["text"], i["hidden"], i["edited"]) for i in lines(client, h)] == [("No FOMO", False, False), ("No revenge trading", False, False), ("No gambling.", False, False)]
    assert lines(client, h, "remember")[0]["hidden"] is True  # another list is untouched
    assert client.post("/api/checklists/nope/restore", headers=h).status_code == 404


def test_deleting_an_account_removes_its_overrides(client, tmp_path):
    admin = signup_admin(client)
    h = signup(client, "bob")
    sync(write(tmp_path, SAMPLE))
    client.delete(f"/api/checklists/{lines(client, h)[0]['id']}", headers=h)
    assert count(ChecklistOverride) == 1
    assert client.delete(f"/api/admin/users/{user_id('bob@example.com')}", headers=admin).status_code == 204
    assert count(ChecklistOverride) == 0
