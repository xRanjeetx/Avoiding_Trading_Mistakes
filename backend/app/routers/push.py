from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..core.security import current_user
from ..models import PushSubscription, User
from ..schemas import CamelModel
from ..services.push import clean_prefs, endpoint_allowed

router = APIRouter(prefix="/api/push", tags=["push"])


class PushKeys(CamelModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class PrefsIn(CamelModel):
    on: bool = False
    lead: int = 5
    close_lead: int = 5
    long_min: int = 120
    tz: str = "UTC"


class SubscribeIn(CamelModel):
    endpoint: str = Field(min_length=1, max_length=1000)
    keys: PushKeys
    prefs: PrefsIn


class UnsubscribeIn(CamelModel):
    endpoint: str = Field(min_length=1, max_length=1000)


@router.get("/key")
def public_key(_: User = Depends(current_user)):
    """The VAPID public key the browser needs to subscribe; empty when push is not set up on this server."""
    return {"publicKey": config.VAPID_PUBLIC_KEY if config.PUSH_ENABLED else ""}


@router.put("/subscription", status_code=204)
def save_subscription(body: SubscribeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Registers this device, or updates its reminder preferences."""
    if not config.PUSH_ENABLED:
        raise HTTPException(503, "Push reminders are not set up on this server")
    if not endpoint_allowed(body.endpoint):
        raise HTTPException(400, "Unsupported push service")
    prefs = clean_prefs(body.prefs.model_dump(by_alias=True))
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        db.add(PushSubscription(user_id=user.id, endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth, prefs=prefs, sent=[]))
    else:
        sub.user_id, sub.p256dh, sub.auth, sub.prefs = user.id, body.keys.p256dh, body.keys.auth, prefs
    db.commit()


@router.post("/unsubscribe", status_code=204)
def remove_subscription(body: UnsubscribeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id))
    if sub:
        db.delete(sub)
        db.commit()
