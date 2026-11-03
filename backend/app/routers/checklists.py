"""Learning checklists: common mistakes, points to remember, trading psychology and trade management, taken from the strategy book.

The lines live in data/checklists.json (config.CHECKLIST_FILE). `sync_checklists` copies them into the database at startup,
so editing the file and restarting is all it takes, and it can be run by hand:

    python -m app.routers.checklists

Everyone sees the same lines; each user owns which ones they have ticked, and may reword or remove a line for themselves
(ChecklistOverride), which changes nothing for anybody else."""
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..core.security import current_user
from ..models import ChecklistItem, ChecklistOverride, ChecklistTick, User, UserChecklistItem
from ..schemas import CamelModel

log = logging.getLogger("tradeguard.checklists")

router = APIRouter(prefix="/api/checklists", tags=["checklists"])

# "rules" has no lines in the file: it is the user's own list of most important rules.
KINDS = ("mistakes", "remember", "psychology", "management", "rules")
FILE_KINDS = tuple(k for k in KINDS if k != "rules")
MINE_GROUP = "My points"
MINE_LIMIT = 100  # own lines per list


# ---------- Loading the file ----------
def read_checklist_file(path: Path) -> dict[str, list[tuple[str, str]]]:
    """{kind: [(group, text), ...]} in file order. Raises ValueError if the file is not shaped as expected."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, list[tuple[str, str]]] = {}
    for kind, groups in data.items():
        if kind not in FILE_KINDS:
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
            db.execute(delete(ChecklistOverride).where(ChecklistOverride.item_id == item.id))
            db.delete(item)
            out["removed"] += 1
    db.commit()
    log.info("Checklists synced from %s: %s", path, out)
    return out


def delete_ticks_for(db: Session, user_id: int) -> None:
    """Used when an account is deleted. Explicit, because SQLite (dev/tests) does not enforce ON DELETE CASCADE."""
    db.execute(delete(ChecklistTick).where(ChecklistTick.user_id == user_id))
    db.execute(delete(ChecklistOverride).where(ChecklistOverride.user_id == user_id))
    db.execute(delete(UserChecklistItem).where(UserChecklistItem.user_id == user_id))


# ---------- API ----------
class TickIn(CamelModel):
    done: bool


class MineIn(CamelModel):
    kind: str
    text: str = Field(min_length=1, max_length=500)


class MineEdit(CamelModel):
    text: str = Field(min_length=1, max_length=500)


def mine_out(i: UserChecklistItem, position: int) -> dict:
    return {"id": i.id, "kind": i.kind, "group": MINE_GROUP, "position": position, "text": i.text, "done": i.done, "mine": True}


def own_item(db: Session, user: User, item_id: int) -> UserChecklistItem:
    row = db.get(UserChecklistItem, item_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist item not found")
    return row


def clean_text(text: str) -> str:
    text = text.strip()
    if not text:
        raise HTTPException(422, "Write something first")
    return text


@router.get("")
def list_checklists(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ticked = set(db.scalars(select(ChecklistTick.item_id).where(ChecklistTick.user_id == user.id)))
    changes = {o.item_id: o for o in db.scalars(select(ChecklistOverride).where(ChecklistOverride.user_id == user.id))}
    items = db.scalars(select(ChecklistItem).order_by(ChecklistItem.kind, ChecklistItem.position))
    out = []
    last = {}  # kind -> number of the last line shown, so the lines the user kept (and their own) are numbered 1, 2, 3...
    for i in items:
        change = changes.get(i.id)
        hidden = bool(change and change.hidden)
        if not hidden:
            last[i.kind] = last.get(i.kind, 0) + 1
        out.append({
            "id": i.id, "kind": i.kind, "group": i.group, "position": 0 if hidden else last[i.kind],
            "text": change.text if change and change.text else i.text, "done": i.id in ticked, "mine": False,
            "edited": bool(change and change.text), "hidden": hidden,
        })
    for i in db.scalars(select(UserChecklistItem).where(UserChecklistItem.user_id == user.id).order_by(UserChecklistItem.id)):
        last[i.kind] = last.get(i.kind, 0) + 1
        out.append(mine_out(i, last[i.kind]))
    out.sort(key=lambda o: (KINDS.index(o["kind"]), o["position"]))
    return out


@router.post("/mine", status_code=status.HTTP_201_CREATED)
def add_mine(body: MineIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Adds a line of the user's own to one list."""
    if body.kind not in KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist not found")
    text = clean_text(body.text)
    n = db.scalar(select(func.count()).select_from(UserChecklistItem).where(UserChecklistItem.user_id == user.id, UserChecklistItem.kind == body.kind))
    if n >= MINE_LIMIT:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A list can hold {MINE_LIMIT} of your own lines. Delete one first")
    row = UserChecklistItem(user_id=user.id, kind=body.kind, text=text)
    db.add(row)
    db.commit()
    shared = db.scalar(select(func.count()).select_from(ChecklistItem).where(ChecklistItem.kind == body.kind))
    return mine_out(row, shared + n + 1)


@router.put("/mine/{item_id}")
def edit_mine(item_id: int, body: MineEdit, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = own_item(db, user, item_id)
    row.text = clean_text(body.text)
    db.commit()
    return {"id": row.id, "text": row.text}


@router.put("/mine/{item_id}/tick")
def tick_mine(item_id: int, body: TickIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = own_item(db, user, item_id)
    row.done = body.done
    db.commit()
    return {"id": row.id, "done": row.done}


@router.delete("/mine/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mine(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(own_item(db, user, item_id))
    db.commit()


def shared_item(db: Session, item_id: int) -> ChecklistItem:
    item = db.get(ChecklistItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist item not found")
    return item


def override_row(db: Session, user: User, item_id: int) -> ChecklistOverride:
    row = db.get(ChecklistOverride, (user.id, item_id))
    if row is None:
        row = ChecklistOverride(user_id=user.id, item_id=item_id, hidden=False)
        db.add(row)
    return row


@router.put("/{item_id}/override")
def reword_shared(item_id: int, body: MineEdit, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Rewords a shared line for this user only. The original wording is kept: Restore brings it back."""
    item = shared_item(db, item_id)
    text = clean_text(body.text)
    row = override_row(db, user, item_id)
    row.text = None if text == item.text else text
    if row.text is None and not row.hidden:
        db.delete(row)
    db.commit()
    return {"id": item_id, "text": text}


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_shared(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Removes a shared line from this user's list only."""
    shared_item(db, item_id)
    override_row(db, user, item_id).hidden = True
    db.commit()


@router.post("/{kind}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_kind(kind: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Brings back every line this user removed or reworded in one list, with its original wording."""
    if kind not in KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checklist not found")
    ids = select(ChecklistItem.id).where(ChecklistItem.kind == kind)
    db.execute(delete(ChecklistOverride).where(ChecklistOverride.user_id == user.id, ChecklistOverride.item_id.in_(ids)))
    db.commit()


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
    db.execute(update(UserChecklistItem).where(UserChecklistItem.user_id == user.id, UserChecklistItem.kind == kind).values(done=False))
    db.commit()


if __name__ == "__main__":
    from ..core.db import Base, SessionLocal, engine

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        print(sync_checklists(session))
