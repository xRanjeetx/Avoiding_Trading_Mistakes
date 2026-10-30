"""Trade screenshots: one "before" and one "after" image per journal entry.

The app shrinks each screenshot to a small WebP before uploading, so the API takes the raw image bytes as the request
body (no multipart) and keeps them in storage.py. Entry.images maps a slot to its storage key; clients only ever see a
short token per slot, which changes whenever the image is replaced (so browsers can cache by it)."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..models import Entry, User
from ..schemas import EntryOut
from ..core.security import current_user
from ..services.storage import delete_quietly, get_storage

router = APIRouter(prefix="/api/entries", tags=["images"])

Slot = Literal["before", "after"]
# Only formats a browser shows safely as <img>. Checked by content, never by the name or header the client sends
# (no SVG: it can carry scripts).
TYPES = {"image/webp": "webp", "image/png": "png", "image/jpeg": "jpg"}
EXT_TYPE = {ext: mime for mime, ext in TYPES.items()}


def sniff(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return None


def keys_of(rows) -> list[str]:
    return [key for row in rows for key in (row.images or {}).values()]


def user_image_keys(db: Session, user_id: int) -> list[str]:
    return keys_of(db.scalars(select(Entry).where(Entry.user_id == user_id)))


def _entry(db: Session, user: User, entry_id: str) -> Entry:
    row = db.get(Entry, (user.id, entry_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return row


@router.put("/{entry_id}/images/{slot}", response_model=EntryOut)
async def put_image(entry_id: str, slot: Slot, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limit = config.MAX_IMAGE_BYTES
    too_big = HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Image is too large ({limit // 1024 // 1024} MB at most)")
    if int(request.headers.get("content-length") or 0) > limit:
        raise too_big
    data = await request.body()
    if len(data) > limit:
        raise too_big
    mime = sniff(data)
    if not mime:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a WebP, PNG or JPEG image")

    row = _entry(db, user, entry_id)
    old = (row.images or {}).get(slot)
    if old is None:  # a replacement does not add to the user's total
        have = sum(len(r.images or {}) for r in db.scalars(select(Entry).where(Entry.user_id == user.id)))
        if have >= config.MAX_IMAGES_PER_USER:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Image limit reached ({config.MAX_IMAGES_PER_USER}). Delete some screenshots first.")

    key = f"{user.id}/{uuid.uuid4().hex}.{TYPES[mime]}"
    get_storage().put(key, data, mime)
    row.images = {**(row.images or {}), slot: key}  # a new dict, so the JSON column notices the change
    db.commit()
    if old:
        delete_quietly([old])
    return row


@router.get("/{entry_id}/images/{slot}")
def get_image(entry_id: str, slot: Slot, user: User = Depends(current_user), db: Session = Depends(get_db)):
    key = (_entry(db, user, entry_id).images or {}).get(slot)
    data = get_storage().get(key) if key else None
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No image")
    # The key changes whenever the image does, so the browser may keep it (the app also keeps it by token).
    return Response(
        content=data, media_type=EXT_TYPE[key.rsplit(".", 1)[-1]],
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{entry_id}/images/{slot}", response_model=EntryOut)
def delete_image(entry_id: str, slot: Slot, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _entry(db, user, entry_id)
    images = dict(row.images or {})
    key = images.pop(slot, None)
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No image")
    row.images = images
    db.commit()
    delete_quietly([key])
    return row
