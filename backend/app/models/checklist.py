from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class ChecklistItem(Base):
    """One line of a shared Learning checklist, loaded from data/checklists.json (see routers/checklists.py)."""

    __tablename__ = "checklist_items"
    __table_args__ = (UniqueConstraint("kind", "position", name="uq_checklist_kind_position"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # "mistakes", "remember" or "management"
    group: Mapped[str] = mapped_column(String(60), default="")  # a heading inside the list, "" for none
    position: Mapped[int] = mapped_column(Integer)  # order within the kind
    text: Mapped[str] = mapped_column(String(500))


class ChecklistTick(Base):
    """An item one user has ticked. Kept per user, because the items themselves are shared."""

    __tablename__ = "checklist_ticks"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("checklist_items.id", ondelete="CASCADE"), primary_key=True)
