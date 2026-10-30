import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import current_user
from ..models import Entry, User
from ..schemas import EntryIn, EntryOut
from ..services.storage import delete_quietly
from .images import keys_of, user_image_keys

router = APIRouter()

# ---------- Entries ----------
def _get_entry(db: Session, user: User, entry_id: str) -> Entry:
    row = db.get(Entry, (user.id, entry_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return row


@router.get("/api/entries", response_model=list[EntryOut])
def list_entries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Entry).where(Entry.user_id == user.id).order_by(Entry.timestamp)).all()


@router.post("/api/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    entry_id = body.id or uuid.uuid4().hex
    if db.get(Entry, (user.id, entry_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Entry id already exists")
    row = Entry(user_id=user.id, id=entry_id, **body.model_dump(exclude={"id"}))
    db.add(row)
    db.commit()
    return row


@router.post("/api/entries/import")
def import_entries(
    body: Annotated[list[EntryIn], Body(max_length=5000)], user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Bulk add (CSV import). Entries whose id already exists are skipped, so importing the same file twice is safe."""
    have = set(db.scalars(select(Entry.id).where(Entry.user_id == user.id)))
    imported = skipped = 0
    for item in body:
        entry_id = item.id or uuid.uuid4().hex
        if entry_id in have:
            skipped += 1
            continue
        have.add(entry_id)
        db.add(Entry(user_id=user.id, id=entry_id, **item.model_dump(exclude={"id"})))
        imported += 1
    db.commit()
    return {"imported": imported, "skipped": skipped}


@router.put("/api/entries/{entry_id}", response_model=EntryOut)
def update_entry(entry_id: str, body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _get_entry(db, user, entry_id)
    for key, value in body.model_dump(exclude={"id"}).items():
        setattr(row, key, value)
    db.commit()
    return row


@router.delete("/api/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _get_entry(db, user, entry_id)
    images = keys_of([row])
    db.delete(row)
    db.commit()
    delete_quietly(images)


@router.delete("/api/entries", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_entries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    images = user_image_keys(db, user.id)
    db.execute(delete(Entry).where(Entry.user_id == user.id))
    db.commit()
    delete_quietly(images)
