from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import current_user
from ..models import User, UserSettings
from ..schemas import SettingsOut

router = APIRouter()

# ---------- Settings ----------
def _settings_row(db: Session, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if not row:
        row = UserSettings(user_id=user.id)
        db.add(row)
        db.commit()
    return row


@router.get("/api/settings", response_model=SettingsOut)
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _settings_row(db, user)


@router.put("/api/settings", response_model=SettingsOut)
def put_settings(body: SettingsOut, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _settings_row(db, user)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return row
