import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core import config
from app.core.db import SessionLocal
from app.routers.library import sync_library, title_from_filename
from app.main import app
from app.models import LibraryBook, ReadingProgress
from conftest import signup
from test_admin import signup_admin, user_id

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def sync(folder, **kw):
    with SessionLocal() as db:
        return sync_library(db, str(folder), **kw)


def books():
    with SessionLocal() as db:
        return [(b.filename, b.title, b.size) for b in db.scalars(select(LibraryBook).order_by(LibraryBook.filename))]


def count(model):
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model))


@pytest.fixture()
def lib(client, tmp_path):
    """The client (tables ready) plus an empty library folder."""
    return tmp_path


def put(folder, name, body=PDF):
    (folder / name).write_bytes(body)


# ---------- titles ----------
@pytest.mark.parametrize("name,title", [
    ("Trading_in_the_Zone.pdf", "Trading in the Zone"),
    ("01 - My Strategy.PDF", "My Strategy"),
    ("2. Psychology.pdf", "Psychology"),
    ("  spaced   out  .pdf", "spaced out"),
    ("1984.pdf", "1984"),  # a number with nothing after it is the title, not an order prefix
    (".pdf", "Untitled"),
])
def test_title_from_filename(name, title):
    assert title_from_filename(name) == title


# ---------- loading the folder ----------
def test_sync_adds_pdfs_and_is_safe_to_repeat(lib):
    put(lib, "02 - Psychology.pdf")
    put(lib, "01 - Strategy.pdf", PDF + b"strategy")
    assert sync(lib) == {"added": 2, "updated": 0, "unchanged": 0, "skipped": 0, "removed": 0}
    assert books() == [("01 - Strategy.pdf", "Strategy", len(PDF) + 8), ("02 - Psychology.pdf", "Psychology", len(PDF))]
    assert sync(lib) == {"added": 0, "updated": 0, "unchanged": 2, "skipped": 0, "removed": 0}
    assert count(LibraryBook) == 2


def test_sync_updates_a_book_whose_file_changed_and_resets_page_counts(client, lib):
    put(lib, "a.pdf")
    sync(lib)
    h = signup(client)
    bid = client.get("/api/library", headers=h).json()[0]["id"]
    client.put(f"/api/library/{bid}/progress", json={"lastPage": 30, "pages": 50}, headers=h)
    put(lib, "a.pdf", PDF + b"new edition")
    assert sync(lib)["updated"] == 1
    assert client.get(f"/api/library/{bid}/file", headers=h).content == PDF + b"new edition"
    mine = client.get("/api/library", headers=h).json()[0]
    assert mine["pages"] is None and mine["lastPage"] == 30  # place kept, page count to be reported again


def test_sync_ignores_other_files_and_fake_pdfs(lib):
    put(lib, "real.pdf")
    put(lib, "notes.txt", b"hello")
    put(lib, "fake.pdf", b"not really a pdf")
    put(lib, "empty.pdf", b"")
    (lib / "sub").mkdir()
    put(lib / "sub", "nested.pdf")
    assert sync(lib)["added"] == 1
    assert [b[0] for b in books()] == ["real.pdf"]
    assert sync(lib)["skipped"] == 2


def test_missing_or_empty_folder_never_removes_books(lib):
    put(lib, "a.pdf")
    sync(lib)
    assert sync(lib / "does-not-exist")["removed"] == 0
    (lib / "a.pdf").unlink()
    assert sync(lib) == {"added": 0, "updated": 0, "unchanged": 0, "skipped": 0, "removed": 0}
    assert count(LibraryBook) == 1  # a deploy that lost the files must not wipe the library


def test_prune_removes_books_and_their_progress(client, lib):
    put(lib, "keep.pdf")
    put(lib, "drop.pdf")
    sync(lib)
    h = signup(client)
    drop = next(b["id"] for b in client.get("/api/library", headers=h).json() if b["title"] == "drop")
    client.put(f"/api/library/{drop}/progress", json={"lastPage": 3}, headers=h)
    (lib / "drop.pdf").unlink()
    assert sync(lib, prune=True)["removed"] == 1
    assert [b[0] for b in books()] == ["keep.pdf"]
    assert count(ReadingProgress) == 0
    assert sync(lib, prune=True)["removed"] == 0


def test_prune_with_an_empty_folder_removes_everything_on_request(lib):
    put(lib, "a.pdf")
    sync(lib)
    (lib / "a.pdf").unlink()
    assert sync(lib, prune=True)["removed"] == 1
    assert books() == []


def test_the_app_loads_the_folder_at_startup(tmp_path, monkeypatch):
    put(tmp_path, "Startup Book.pdf")
    monkeypatch.setattr(config, "LIBRARY_DIR", str(tmp_path))
    from app.core.db import Base, engine

    Base.metadata.drop_all(engine)
    with TestClient(app):  # entering the client runs the startup, which fills the library
        assert [b[1] for b in books()] == ["Startup Book"]
    Base.metadata.drop_all(engine)


# ---------- the API ----------
@pytest.mark.parametrize("method,path", [("get", "/api/library"), ("get", "/api/library/1/file"), ("put", "/api/library/1/progress")])
def test_library_needs_login(client, method, path):
    assert getattr(client, method)(path).status_code == 401


def test_everyone_sees_the_same_books_read_only(client, lib):
    put(lib, "Book A.pdf")
    put(lib, "Book B.pdf", PDF + b"b")
    sync(lib)
    a, b = signup(client), signup(client, "bobby")
    la, lb = client.get("/api/library", headers=a).json(), client.get("/api/library", headers=b).json()
    assert [x["title"] for x in la] == ["Book A", "Book B"] == [x["title"] for x in lb]
    assert la[0] == {"id": la[0]["id"], "title": "Book A", "size": len(PDF), "lastPage": 1, "pages": None}
    got = client.get(f"/api/library/{lb[1]['id']}/file", headers=b)
    assert got.status_code == 200 and got.content == PDF + b"b" and got.headers["content-type"] == "application/pdf"
    for method in ("post", "patch", "delete"):  # users cannot add, rename or remove books
        assert getattr(client, method)(f"/api/library/{la[0]['id']}", headers=a).status_code in (404, 405)
    assert client.post("/api/library", headers=a, content=PDF).status_code in (404, 405)


def test_file_download_supports_etag_so_reopening_is_cheap(client, lib):
    put(lib, "a.pdf")
    sync(lib)
    h = signup(client)
    bid = client.get("/api/library", headers=h).json()[0]["id"]
    first = client.get(f"/api/library/{bid}/file", headers=h)
    etag = first.headers["etag"]
    assert first.status_code == 200 and etag
    again = client.get(f"/api/library/{bid}/file", headers={**h, "If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    assert client.get(f"/api/library/{bid}/file", headers={**h, "If-None-Match": '"stale"'}).status_code == 200
    put(lib, "a.pdf", PDF + b"changed")
    sync(lib)
    assert client.get(f"/api/library/{bid}/file", headers={**h, "If-None-Match": etag}).status_code == 200  # changed file


def test_unknown_book_is_404(client, lib):
    h = signup(client)
    assert client.get("/api/library/999/file", headers=h).status_code == 404
    assert client.put("/api/library/999/progress", json={"lastPage": 2}, headers=h).status_code == 404


def test_progress_is_remembered_per_user(client, lib):
    put(lib, "a.pdf")
    sync(lib)
    a, b = signup(client), signup(client, "bobby")
    bid = client.get("/api/library", headers=a).json()[0]["id"]
    r = client.put(f"/api/library/{bid}/progress", json={"lastPage": 12, "pages": 200}, headers=a)
    assert r.json() == {"lastPage": 12, "pages": 200}
    mine = client.get("/api/library", headers=a).json()[0]
    assert (mine["lastPage"], mine["pages"]) == (12, 200)
    theirs = client.get("/api/library", headers=b).json()[0]
    assert (theirs["lastPage"], theirs["pages"]) == (1, None)  # bobby is unaffected
    client.put(f"/api/library/{bid}/progress", json={"lastPage": 40}, headers=a)  # page count kept when not sent again
    assert client.get("/api/library", headers=a).json()[0]["pages"] == 200


def test_progress_cannot_go_past_the_last_page_or_be_invalid(client, lib):
    put(lib, "a.pdf")
    sync(lib)
    h = signup(client)
    bid = client.get("/api/library", headers=h).json()[0]["id"]
    assert client.put(f"/api/library/{bid}/progress", json={"lastPage": 500, "pages": 210}, headers=h).json()["lastPage"] == 210
    for bad in ({"lastPage": 0}, {"lastPage": 100_001}, {"lastPage": 5, "pages": 0}, {}, {"lastPage": "x"}):
        assert client.put(f"/api/library/{bid}/progress", json=bad, headers=h).status_code == 422, bad


def test_deleting_an_account_removes_only_its_progress(client, lib):
    put(lib, "a.pdf")
    sync(lib)
    a, b = signup(client), signup(client, "bobby")
    bid = client.get("/api/library", headers=a).json()[0]["id"]
    for h in (a, b):
        client.put(f"/api/library/{bid}/progress", json={"lastPage": 7}, headers=h)
    assert client.post("/api/auth/delete-account", json={"password": "password123"}, headers=a).status_code == 204
    assert count(ReadingProgress) == 1 and count(LibraryBook) == 1  # the shared book stays
    assert client.get("/api/library", headers=b).json()[0]["lastPage"] == 7


def test_admin_deleting_a_user_removes_their_progress(client, lib):
    put(lib, "a.pdf")
    sync(lib)
    admin = signup_admin(client)
    bob = signup(client, "bob")
    bid = client.get("/api/library", headers=bob).json()[0]["id"]
    client.put(f"/api/library/{bid}/progress", json={"lastPage": 4}, headers=bob)
    assert client.delete(f"/api/admin/users/{user_id('bob@example.com')}", headers=admin).status_code == 204
    assert count(ReadingProgress) == 0
