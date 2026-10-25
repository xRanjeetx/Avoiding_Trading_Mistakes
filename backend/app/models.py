from sqlalchemy import JSON, BigInteger, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    lot: Mapped[float] = mapped_column(Float, default=0.02)
    min_rr: Mapped[float] = mapped_column(Float, default=2)
    max_trades: Mapped[int] = mapped_column(Integer, default=4)
    max_sl: Mapped[int] = mapped_column(Integer, default=4)
    london_start: Mapped[str] = mapped_column(String(5), default="12:30")
    london_end: Mapped[str] = mapped_column(String(5), default="17:30")
    session_start: Mapped[str] = mapped_column(String(5), default="18:00")
    session_end: Mapped[str] = mapped_column(String(5), default="22:30")
    balance: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(4), default="$")


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
