from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class PushSubscription(Base):
    """One browser or phone that agreed to receive reminders while the app is closed (Web Push). The server sends them
    (services/push.py); `prefs` is a copy of the device's reminder settings, because the server has to decide what is due."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    # { on, lead, closeLead, longMin, tz }: the same preferences the app keeps in localStorage, plus the device's time zone.
    prefs: Mapped[dict] = mapped_column(JSON, default=dict)
    # Keys of the reminders already pushed (newest last), so each one is sent once.
    sent: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
