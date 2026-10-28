import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import SECRET_KEY, TOKEN_DAYS
from .db import get_db
from .models import User

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def make_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    return jwt.encode({"sub": str(user.id), "exp": exp}, SECRET_KEY, algorithm="HS256")


def _fingerprint(user: User) -> str:
    # Ties a reset link to the current password, so it stops working once the password changes (single use).
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:16]


def make_purpose_token(user: User, purpose: str, minutes: int) -> str:
    """Short-lived signed token for an emailed link ("verify" or "reset"). Never valid as a login token."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode({"sub": str(user.id), "purpose": purpose, "pw": _fingerprint(user), "exp": exp}, SECRET_KEY, algorithm="HS256")


def user_from_purpose_token(db: Session, token: str, purpose: str) -> User:
    bad = HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired")
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        if data.get("purpose") != purpose:
            raise bad
        user = db.get(User, int(data["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise bad
    if not user or data.get("pw") != _fingerprint(user):
        raise bad
    return user


def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired login", {"WWW-Authenticate": "Bearer"})
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        if "purpose" in data:  # emailed verify/reset tokens must not work as login tokens
            raise invalid
        user_id = int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise invalid
    user = db.get(User, user_id)
    if not user:
        raise invalid
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
