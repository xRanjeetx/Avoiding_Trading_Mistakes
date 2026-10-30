from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, false, true
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


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
    # False while a new sign-up waits for an admin (see config.REQUIRE_APPROVAL). Existing accounts were approved by the migration.
    approved: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Two-factor sign-in. The seed is stored encrypted (core/crypto.py); it exists before totp_enabled is set while the user
    # is still confirming their first code. totp_last_step blocks re-use of a code; recovery_hashes are SHA-256 of the unused
    # single-use recovery codes.
    totp_secret: Mapped[str | None] = mapped_column(String(200), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    totp_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recovery_hashes: Mapped[list | None] = mapped_column(JSON, nullable=True)
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
