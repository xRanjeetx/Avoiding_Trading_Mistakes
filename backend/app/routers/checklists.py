"""Learning checklists: common mistakes, points to remember, trading psychology and trade management, taken from the strategy book.

The lines live in data/checklists.json (config.CHECKLIST_FILE). `sync_checklists` copies them into the database at startup,
so editing the file and restarting is all it takes, and it can be run by hand:

    python -m app.routers.checklists

Everyone sees the same lines; each user only owns which ones they have ticked."""
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..core.security import current_user
from ..models import ChecklistItem, ChecklistTick, User
from ..schemas import CamelModel

log = logging.getLogger("tradeguard.checklists")

router = APIRouter(prefix="/api/checklists", tags=["checklists"])

KINDS = ("mistakes", "remember", "psychology", "management")


# ---------- Loading the file ----------
def read_checklist_file(path: Path) -> dict[str, list[tuple[str, str]]]:
    """{kind: [(group, text), ...]} in file order. Raises ValueError if the file is not shaped as expected."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, list[tuple[str, str]]] = {}
    for kind, groups in data.items():
        if kind not in KINDS:
            raise ValueError(f"unknown checklist kind {kind!r}")
        lines: list[tuple[str, str]] = []
        for g in groups:
            name = str(g.get("group", ""))[:60]
            for line in g["items"]:
                line = str(line).strip()
                if line:
                    lines.append((name, line[:500]))
        out[kind] = lines
    return out


def sync_checklists(db: Session, file: str | None = None) -> dict:
    """Make the database match the file. A line is identified by its kind and place in the list, so editing its wording keeps
    everyone's tick; lines the file no longer has are removed with their ticks. A missing file changes nothing."""
    path = Path(file or config.CHECKLIST_FILE)
    out = {"added": 0, "updated": 0, "unchanged": 0, "removed": 0}
    if not path.is_file():
        log.info("No checklist file at %s: nothing to load", path)
        return out
    wanted = read_checklist_file(path)  # read it all first, so a bad file changes nothing

    have = {(i.kind, i.position): i for i in db.scalars(select(ChecklistItem))}
    keep = set()
    for kind, lines in wanted.items():
        for position, (group, text) in enumerate(lines, start=1):
            keep.add((kind, position))
            item = have.get((kind, position))
            if item is None:
                db.add(ChecklistItem(kind=kind, group=group, position=position, text=text))
                out["added"] += 1
            elif (item.group, item.text) != (group, text):
                item.group, item.text = group, text
                out["updated"] += 1
            else:
                out["unchanged"] += 1
    for key, item in have.items():
        if key not in keep:
            db.execute(delete(ChecklistTick).where(ChecklistTick.item_id == item.id))
            db.delete(item)
            out["removed"] += 1
    db.commit()
    log.info("Checklists synced from %s: %s", path, out)
    return out


def delete_ticks_for(db: Session, user_id: int) -> None:
    """Used when an account is deleted. Explicit, because SQLite (dev/tests) does not enforce ON DELETE CASCADE."""
    db.execute(delete(ChecklistTick).where(ChecklistTick.user_id == user_id))


# ---------- API ----------
class TickIn(CamelModel):
    done: bool


@router.get("")
def list_checklists(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ticked = set(db.scalars(select(ChecklistTick.item_id).where(ChecklistTick.user_id == user.id)))
    items = db.scalars(select(ChecklistItem).order_by(ChecklistItem.kind, ChecklistItem.position))
    return [
        {"id": i.id, "kind": i.kind, "group": i.group, "position": i.position, "text": i.text, "done": i.id in ticked}
        for i in items
    ]


@router.put("/{item_id}/tick")
def tick_item(item_id: int, body: TickIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(ChecklistItem, item_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist item not found")
    row = db.get(ChecklistTick, (user.id, item_id))
    if body.done and row is None:
        db.add(ChecklistTick(user_id=user.id, item_id=item_id))
    elif not body.done and row is not None:
        db.delete(row)
    db.commit()
    return {"id": item_id, "done": body.done}


@router.delete("/{kind}/ticks", status_code=status.HTTP_204_NO_CONTENT)
def clear_ticks(kind: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Untick every line of one list, to start it again."""
    if kind not in KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist not found")
    ids = select(ChecklistItem.id).where(ChecklistItem.kind == kind)
    db.execute(delete(ChecklistTick).where(ChecklistTick.user_id == user.id, ChecklistTick.item_id.in_(ids)))
    db.commit()


if __name__ == "__main__":
    from ..core.db import Base, SessionLocal, engine

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        print(sync_checklists(session))
