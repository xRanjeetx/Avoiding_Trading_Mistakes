from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class CalendarEvent(Base):
    """A high or medium impact news release from the public calendar feed (see calendar.py). Shared by all users."""

    __tablename__ = "calendar_events"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)  # hash of time, currency and title
    at: Mapped[int] = mapped_column(BigInteger, index=True)  # epoch milliseconds
    currency: Mapped[str] = mapped_column(String(8))
    title: Mapped[str] = mapped_column(String(200))
    impact: Mapped[str] = mapped_column(String(10))  # "high" or "medium"
    forecast: Mapped[str] = mapped_column(String(30), default="")
    previous: Mapped[str] = mapped_column(String(30), default="")
    seen_at: Mapped[int] = mapped_column(BigInteger)  # when a download last contained this event
