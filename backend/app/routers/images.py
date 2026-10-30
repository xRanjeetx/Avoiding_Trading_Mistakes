"""Trade screenshots: one "before" and one "after" image per journal entry.

The app shrinks each screenshot to a small WebP before uploading, so the API takes the raw image bytes as the request
body (no multipart). The server does not trust that: it decodes whatever arrives and stores its own WebP re-encoding
(no metadata such as camera location, nothing hidden in the file), in storage.py. Entry.images maps a slot to its storage key; clients only ever see a
short token per slot, which changes whenever the image is replaced (so browsers can cache by it)."""
import io
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..core.ratelimit import limiter, too_many
from ..models import Entry, StoredImage, User
from ..schemas import EntryOut
from ..core.security import current_user
from ..services.storage import delete_quietly, get_storage

Image.MAX_IMAGE_PIXELS = config.MAX_IMAGE_PIXELS

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


def clean(data: bytes) -> bytes | None:
    """Decodes the upload and returns it re-encoded as WebP, or None if it is not a real, reasonably sized image.
    Re-encoding drops EXIF data (location, device) and anything appended to or hidden in the original file."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in ("WEBP", "PNG", "JPEG") or im.width * im.height > config.MAX_IMAGE_PIXELS:
                return None
            im.load()
            im = ImageOps.exif_transpose(im)  # keep the orientation the camera recorded before the EXIF is dropped
            im.thumbnail((config.MAX_IMAGE_SIDE, config.MAX_IMAGE_SIDE))
            transparent = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
            out = io.BytesIO()
            im.convert("RGBA" if transparent else "RGB").save(out, "WEBP", quality=85, method=4)
            return out.getvalue()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):  # includes UnidentifiedImageError
        return None


async def read_limited(request: Request, limit: int, too_big: HTTPException) -> bytes:
    """The request body, refusing as soon as it passes `limit` instead of reading it all first."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise too_big
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_big
        chunks.append(chunk)
    return b"".join(chunks)


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
    wait = limiter.hit(f"upload:user:{user.id}", 60, 600)  # decoding is real work: at most 60 uploads per 10 minutes
    if wait:
        raise too_many(wait)
    limit = config.MAX_IMAGE_BYTES
    too_big = HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Image is too large ({limit // 1024 // 1024} MB at most)")
    data = await read_limited(request, limit, too_big)
    not_an_image = HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a WebP, PNG or JPEG image")
    if not sniff(data):
        raise not_an_image
    data = await run_in_threadpool(clean, data)
    if data is None:
        raise not_an_image

    row = _entry(db, user, entry_id)
    old = (row.images or {}).get(slot)
    if old is None:  # a replacement does not add to the user's total
        have = sum(len(r.images or {}) for r in db.scalars(select(Entry).where(Entry.user_id == user.id)))
        if have >= config.MAX_IMAGES_PER_USER:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Image limit reached ({config.MAX_IMAGES_PER_USER}). Delete some screenshots first.")
    size_of = lambda *where: db.scalar(select(func.coalesce(func.sum(func.length(StoredImage.data)), 0)).where(*where)) or 0  # noqa: E731
    used = size_of(StoredImage.key.like(f"{user.id}/%")) - (size_of(StoredImage.key == old) if old else 0)
    if used + len(data) > config.MAX_USER_IMAGE_BYTES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Screenshot storage is full. Delete some screenshots first.")

    mime = "image/webp"
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
