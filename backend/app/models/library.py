from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


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
