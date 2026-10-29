from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, false, true
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    # Accounts that existed before email verification was added are marked verified by ensure_columns.
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default=true())
    # is_admin mirrors config.ADMIN_EMAILS (see security.sync_admin); is_active=False blocks the account.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # NULL for accounts that existed before this column was added.
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    lot: Mapped[float] = mapped_column(Float, default=0.02)
    min_rr: Mapped[float] = mapped_column(Float, default=2)
    max_trades: Mapped[int] = mapped_column(Integer, default=4)
    max_sl: Mapped[int] = mapped_column(Integer, default=4)
    # The four time columns below are no longer used (replaced by `killzones`). They stay in the model because
    # existing databases have them as NOT NULL, so new rows must keep supplying their defaults.
    london_start: Mapped[str] = mapped_column(String(5), default="12:30")
    london_end: Mapped[str] = mapped_column(String(5), default="17:30")
    session_start: Mapped[str] = mapped_column(String(5), default="18:00")
    session_end: Mapped[str] = mapped_column(String(5), default="22:30")
    balance: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(4), default="$")
    # Market killzones in New York time. NULL means "use the defaults" (see schemas.DEFAULT_KILLZONES).
    killzones: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Fixed lot size per pair. NULL means "use the defaults" (see schemas.DEFAULT_PAIRS).
    pairs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Which checklist rules are switched off and the user's own rules. NULL means "all built-in rules on, none custom".
    rules: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # High-impact news the user added: { "lead_min": minutes before the news to stop trading, "events": [{ at, title }] }.
    # NULL means no news added and the default lead time.
    news: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Money limits { daily, overall, since }: the most the user may lose in a day / in total (see lib/risk.js). NULL means none set.
    loss_limits: Mapped[dict | None] = mapped_column(JSON, nullable=True)


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
    emotion: Mapped[str | None] = mapped_column(String(20), nullable=True)
    emotion_after: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Trade screenshots: { "before": storage key, "after": storage key } (see images.py). NULL means none.
    images: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class StoredImage(Base):
    """A trade screenshot kept in the database (see storage.DatabaseStorage). Entry.images points at it by key."""

    __tablename__ = "stored_images"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(30))
    data: Mapped[bytes] = mapped_column(LargeBinary)


class LibraryBook(Base):
    """A PDF in the shared Learning library, loaded from the library folder (see library.py). The bytes are `deferred`,
    so listing books never loads the files."""

    __tablename__ = "library_books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(200), unique=True)  # the file in the library folder identifies the book
    title: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))  # tells the startup sync whether the file changed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)


class ReadingProgress(Base):
    """Where one user is in one book. Kept per user, because the books themselves are shared."""

    __tablename__ = "reading_progress"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("library_books.id", ondelete="CASCADE"), primary_key=True)
    last_page: Mapped[int] = mapped_column(Integer, default=1)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)  # page count, reported by this user's reader
