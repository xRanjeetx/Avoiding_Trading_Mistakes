"""Where trade screenshots are kept: in the database (table stored_images), under an opaque key such as "12/9f3c….webp".
The API checks the login before it returns any image."""
import logging

from sqlalchemy import delete, select

from .db import SessionLocal
from .models import StoredImage

log = logging.getLogger("tradeguard.storage")


class DatabaseStorage:
    """Each call uses its own short session, so the bytes are never held by the request's session and listing
    entries never loads them."""

    def put(self, key: str, data: bytes, content_type: str) -> None:
        with SessionLocal() as db:
            db.merge(StoredImage(key=key, content_type=content_type, data=data))
            db.commit()

    def get(self, key: str) -> bytes | None:
        with SessionLocal() as db:
            return db.scalar(select(StoredImage.data).where(StoredImage.key == key))

    def delete(self, key: str) -> None:
        with SessionLocal() as db:
            db.execute(delete(StoredImage).where(StoredImage.key == key))
            db.commit()


_storage = DatabaseStorage()


def get_storage() -> DatabaseStorage:
    return _storage


def delete_quietly(keys) -> None:
    """Remove stored images after the entry change is committed. A failure only leaves an orphan row, so it is
    logged rather than shown to the user."""
    store = get_storage()
    for key in keys:
        try:
            store.delete(key)
        except Exception:
            log.exception("Could not delete stored image %s", key)
