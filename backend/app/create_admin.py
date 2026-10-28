"""Create (or promote) an admin account directly in the database.

    python -m app.create_admin admin@example.com 'a-strong-password'

If the email already exists it is promoted to admin, verified, enabled and its password is reset.
"""
import sys

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .main import ensure_columns
from .models import User, UserSettings
from .schemas import Credentials
from .security import hash_password


def create_admin(email: str, password: str) -> str:
    creds = Credentials(email=email, password=password)  # same validation as sign-up
    Base.metadata.create_all(engine)
    ensure_columns(engine)
    email = creds.email.strip().lower()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        created = user is None
        if created:
            user = User(email=email, password_hash="")
            db.add(user)
            db.flush()
            db.add(UserSettings(user_id=user.id))
        user.password_hash = hash_password(creds.password)
        user.email_verified = True
        user.is_active = True
        user.is_admin = True
        db.commit()
    return "created" if created else "promoted"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m app.create_admin EMAIL PASSWORD")
    print(f"Admin {create_admin(sys.argv[1], sys.argv[2])}: {sys.argv[1].strip().lower()}")
