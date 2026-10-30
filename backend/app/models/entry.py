from sqlalchemy import JSON, BigInteger, Boolean, Float, ForeignKey, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class Entry(Base):
    """One journal entry. Timestamps are epoch milliseconds, as the UI already uses."""

    __tablename__ = "entries"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, index=True)
    pair: Mapped[str] = mapped_column(String(30), default="")
    dir: Mapped[str | None] = mapped_column(String(4), nullable=True)
    setup: Mapped[str | None] = mapped_column(String(20), nullable=True)
    lot: Mapped[float | None] = mapped_column(Float, nullable=True)
    entry: Mapped[float | None] = mapped_column(Float, nullable=True)
    sl: Mapped[float | None] = mapped_column(Float, nullable=True)
    tp: Mapped[float | None] = mapped_column(Float, nullable=True)
    rr: Mapped[float | None] = mapped_column(Float, nullable=True)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    failed_rules: Mapped[list] = mapped_column(JSON, default=list)
    traded: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[str] = mapped_column(String(10), default="open")
    exit: Mapped[float | None] = mapped_column(Float, nullable=True)
    pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    closed_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    lesson: Mapped[str] = mapped_column(Text, default="")
    # How the trader felt before taking the trade and after closing it (keys such as "calm", "fomo"; the UI owns the list).
    emotion: Mapped[str | None] = mapped_column(String(255), nullable=True)
    emotion_after: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Trade screenshots: { "before": storage key, "after": storage key } (see images.py). NULL means none.
    images: Mapped[dict | None] = mapped_column(JSON, nullable=True)



class StoredImage(Base):
    """A trade screenshot kept in the database (see storage.DatabaseStorage). Entry.images points at it by key."""

    __tablename__ = "stored_images"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(30))
    data: Mapped[bytes] = mapped_column(LargeBinary)
