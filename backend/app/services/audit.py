"""Records admin actions in the audit_log table, in the same transaction as the action itself."""
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy.orm import Session

from ..core.ratelimit import client_ip
from ..models import AuditLog, User


def record(db: Session, admin: User, action: str, request: Request, target_email: str | None = None, detail: str | None = None) -> None:
    """Adds the row; the caller's commit saves it together with the change."""
    db.add(AuditLog(
        at=datetime.now(timezone.utc).replace(tzinfo=None), admin_email=admin.email, action=action,
        target_email=target_email, ip=client_ip(request), detail=detail,
    ))
