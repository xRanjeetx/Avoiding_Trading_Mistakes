"""Alembic: any database is brought to the current schema, and the revisions stay in step with the models."""
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.db import Base
from app.core.migrations import SCRIPTS, run_migrations
from alembic.config import Config


@pytest.fixture()
def conn():
    engine = create_engine("sqlite://")
    with engine.connect() as c:
        yield c


def newest_revision():
    cfg = Config()
    cfg.set_main_option("script_location", str(SCRIPTS))
    return ScriptDirectory.from_config(cfg).get_current_head()


def version(conn):
    return conn.execute(text("select version_num from alembic_version")).scalar()


def test_an_empty_database_gets_every_table_and_matches_the_models(conn):
    run_migrations(conn)
    tables = set(inspect(conn).get_table_names())
    assert tables == set(Base.metadata.tables) | {"alembic_version"}
    assert version(conn) == newest_revision()
    # If this fails, a model changed without a migration: run `alembic revision --autogenerate -m "..."` in backend/.
    assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []


def test_running_the_migrations_again_changes_nothing(conn):
    run_migrations(conn)
    conn.execute(text("insert into users (id, email, password_hash) values (1, 'a@example.com', 'x')"))
    conn.commit()
    run_migrations(conn)
    assert conn.execute(text("select count(*) from users")).scalar() == 1


def test_a_database_from_before_alembic_is_adopted_without_losing_data(conn):
    """Like the live one: tables made by an older release, missing columns that were added later."""
    for statement in (
        "create table user_settings (user_id integer primary key, lot float)",
        "insert into user_settings values (1, 0.05)",
        "create table users (id integer primary key, email text, password_hash text)",
        "insert into users values (1, 'old@example.com', 'x')",
        "create table entries (user_id integer, id varchar(40), pair varchar(30))",
        "insert into entries values (1, 'a', 'XAUUSD')",
    ):
        conn.execute(text(statement))
    conn.commit()
    run_migrations(conn)
    run_migrations(conn)  # again: harmless
    cols = lambda t: {c["name"] for c in inspect(conn).get_columns(t)}  # noqa: E731
    assert "killzones" in cols("user_settings")
    assert {"emotion", "emotion_after", "images"} <= cols("entries")
    assert {"email_verified", "is_admin", "is_active", "created_at", "totp_enabled", "totp_secret", "approved"} <= cols("users")
    # Trades that predate emotion tags keep their data and simply have no tag.
    assert conn.execute(text("select pair, emotion, emotion_after from entries")).one() == ("XAUUSD", None, None)
    assert conn.execute(text("select lot, killzones from user_settings")).one() == (0.05, None)
    # Accounts that predate email verification stay able to log in, and existing users count as approved (so switching
    # admin approval on does not lock them out); nobody becomes an admin or has 2FA.
    assert tuple(conn.execute(text("select email_verified, is_admin, is_active, totp_enabled, approved from users")).one()) == (1, 0, 1, 0, 1)
    assert version(conn) == newest_revision()
    assert set(Base.metadata.tables) <= set(inspect(conn).get_table_names())


def test_a_database_at_the_baseline_is_upgraded_by_later_revisions(conn):
    run_migrations(conn, "0001")
    assert "totp_enabled" not in {c["name"] for c in inspect(conn).get_columns("users")}
    conn.execute(text("insert into users (id, email, password_hash) values (1, 'a@example.com', 'x')"))
    conn.commit()
    run_migrations(conn)
    assert tuple(conn.execute(text("select email, totp_enabled, totp_secret from users")).one()) == ("a@example.com", 0, None)
    assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []


def test_revisions_form_a_single_unbroken_chain():
    cfg = Config()
    cfg.set_main_option("script_location", str(SCRIPTS))
    scripts = ScriptDirectory.from_config(cfg)
    assert len(scripts.get_heads()) == 1
    assert [s.revision for s in scripts.walk_revisions()][::-1][0] == "0001"
