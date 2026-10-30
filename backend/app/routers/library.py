"""Learning library: a fixed set of PDFs shown to every signed-in user, read-only.

The files live in a folder (config.LIBRARY_DIR, default backend/data/library). `sync_library` copies them into the database
at startup, so the deployed server has them without any upload step, and it can be run by hand:

    python -m app.routers.library            add new files and update changed ones
    python -m app.routers.library --prune    also remove books whose file is no longer in the folder

Each user only owns their reading progress (which page they are on); the books themselves are shared."""
import hashlib
import logging
import re
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..models import LibraryBook, ReadingProgress, User
from ..schemas import CamelModel
from ..core.security import current_user

log = logging.getLogger("tradeguard.library")

router = APIRouter(prefix="/api/library", tags=["library"])

MAX_FILE_MB = 100  # a bigger file would not be practical to keep in the database or to read on a phone


# ---------- Loading the folder ----------
def title_from_filename(name: str) -> str:
    """"02 - Trading_in_the_Zone.pdf" -> "Trading in the Zone". A leading number only sets the order."""
    stem = re.sub(r"\.pdf$", "", name, flags=re.I)
    stem = re.sub(r"^\d{1,3}[\s._-]+(?=\S)", "", stem)
    return (re.sub(r"[\s_]+", " ", stem).strip() or "Untitled")[:120]


def sync_library(db: Session, folder: str | None = None, prune: bool = False) -> dict:
    """Make the database match the folder: add new PDFs, update changed ones. Books are only removed with prune=True,
    so a deploy that is missing the folder can never wipe the library."""
    path = Path(folder or config.LIBRARY_DIR)
    out = {"added": 0, "updated": 0, "unchanged": 0, "skipped": 0, "removed": 0}
    if not path.is_dir():
        log.info("No library folder at %s: nothing to load", path)
        return out

    seen = set()
    for file in sorted((f for f in path.iterdir() if f.is_file() and f.suffix.lower() == ".pdf"), key=lambda f: f.name.lower()):
        name = file.name[:200]
        if file.stat().st_size > MAX_FILE_MB * 1024 * 1024:
            log.warning("Skipping %s: larger than %d MB", name, MAX_FILE_MB)
            out["skipped"] += 1
            continue
        data = file.read_bytes()
        if not data.startswith(b"%PDF-"):
            log.warning("Skipping %s: not a PDF", name)
            out["skipped"] += 1
            continue
        seen.add(name)
        digest = hashlib.sha256(data).hexdigest()
        book = db.scalar(select(LibraryBook).where(LibraryBook.filename == name))
        if book is None:
            db.add(LibraryBook(filename=name, title=title_from_filename(name), size=len(data), sha256=digest, data=data))
            out["added"] += 1
        elif book.sha256 != digest:
            book.title, book.size, book.sha256, book.data = title_from_filename(name), len(data), digest, data
            # The new file may have a different number of pages, so readers report the count again.
            db.execute(ReadingProgress.__table__.update().where(ReadingProgress.book_id == book.id).values(pages=None))
            out["updated"] += 1
        else:
            out["unchanged"] += 1
        db.commit()  # one book at a time, so a large file never sits in memory with the next one

    if prune:
        for book in db.scalars(select(LibraryBook).where(LibraryBook.filename.not_in(seen) if seen else True)).all():
            db.execute(delete(ReadingProgress).where(ReadingProgress.book_id == book.id))
            db.delete(book)
            out["removed"] += 1
        db.commit()
    log.info("Library synced from %s: %s", path, out)
    return out


def delete_progress_for(db: Session, user_id: int) -> None:
    """Used when an account is deleted. Explicit, because SQLite (dev/tests) does not enforce ON DELETE CASCADE."""
    db.execute(delete(ReadingProgress).where(ReadingProgress.user_id == user_id))


# ---------- API ----------
class ProgressIn(CamelModel):
    last_page: int = Field(ge=1, le=100_000)
    pages: int | None = Field(None, ge=1, le=100_000)


@router.get("")
def list_library(user: User = Depends(current_user), db: Session = Depends(get_db)):
    books = db.execute(
        select(LibraryBook.id, LibraryBook.title, LibraryBook.size).order_by(func.lower(LibraryBook.filename))
    ).all()
    mine = {p.book_id: p for p in db.scalars(select(ReadingProgress).where(ReadingProgress.user_id == user.id))}
    return [
        {
            "id": b.id, "title": b.title, "size": b.size,
            "lastPage": mine[b.id].last_page if b.id in mine else 1,
            "pages": mine[b.id].pages if b.id in mine else None,
        }
        for b in books
    ]


@router.get("/{book_id}/file")
def read_book(book_id: int, request: Request, _: User = Depends(current_user), db: Session = Depends(get_db)):
    digest = db.scalar(select(LibraryBook.sha256).where(LibraryBook.id == book_id))
    if digest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Book not found")
    headers = {"ETag": f'"{digest}"', "Cache-Control": "private, no-cache"}  # the browser re-checks, and gets a 304 if unchanged
    if request.headers.get("if-none-match") == headers["ETag"]:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    data = db.scalar(select(LibraryBook.data).where(LibraryBook.id == book_id))
    return Response(content=data, media_type="application/pdf", headers={**headers, "Content-Disposition": 'inline; filename="book.pdf"'})


@router.put("/{book_id}/progress")
def save_progress(book_id: int, body: ProgressIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Remember the page this user is on (and the book's page count, once their reader knows it)."""
    if db.scalar(select(LibraryBook.id).where(LibraryBook.id == book_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Book not found")
    row = db.get(ReadingProgress, (user.id, book_id))
    if row is None:
        row = ReadingProgress(user_id=user.id, book_id=book_id, last_page=1)
        db.add(row)
    if body.pages is not None:
        row.pages = body.pages
    row.last_page = min(body.last_page, row.pages) if row.pages else body.last_page
    db.commit()
    return {"lastPage": row.last_page, "pages": row.pages}


if __name__ == "__main__":
    from ..core.db import Base, SessionLocal, engine

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        print(sync_library(session, prune="--prune" in sys.argv))
