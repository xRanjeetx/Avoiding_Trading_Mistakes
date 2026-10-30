"""Turn off two-factor sign-in for an account (lost phone and recovery codes), straight in the database.

    python -m app.cli.reset_2fa user@example.com

Use this when an admin is locked out. Other users can be reset by an admin in the app (POST /api/admin/users/{id}/reset-2fa).
"""
import sys

from sqlalchemy import select

from ..core.db import SessionLocal
from ..core.migrations import run_migrations
from ..core.sessions import revoke_all
from ..models import User
from ..routers.twofactor import clear_two_factor


def reset_2fa(email: str) -> bool:
    run_migrations()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if not user:
            return False
        clear_two_factor(user)
        revoke_all(db, user.id, commit=False)
        db.commit()
        return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.cli.reset_2fa EMAIL")
    print("Two-factor sign-in turned off." if reset_2fa(sys.argv[1]) else "No such user.")
