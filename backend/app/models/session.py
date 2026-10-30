from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class AuthSession(Base):
    """One login on one device. The browser holds a random refresh token in an HttpOnly cookie; only its SHA-256 is stored
    here, so a database leak does not hand out logins. Every access token carries this row's id, so revoking the row
    ends the login at once (logout, password reset, disabled account)."""

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # The refresh token before the last rotation. A second tab may still send it for a few seconds; later it means the
    # token was copied, and the session is revoked.
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    last_used_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(200), nullable=True)
