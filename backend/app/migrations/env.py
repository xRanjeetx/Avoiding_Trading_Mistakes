"""Alembic environment. Used by app.core.migrations.run_migrations() at startup and by the `alembic` command line
(see alembic.ini). The connection can be passed in (config.attributes["connection"]); otherwise the app's engine is used."""
from alembic import context

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.core.db import Base, engine

target_metadata = Base.metadata


def _run(connection) -> None:
    context.configure(
        connection=connection, target_metadata=target_metadata, compare_type=True,
        render_as_batch=connection.dialect.name == "sqlite",  # SQLite cannot ALTER most things in place
    )
    with context.begin_transaction():
        context.run_migrations()
    if connection.in_transaction():  # databases without transactional DDL (SQLite) leave the version row uncommitted
        connection.commit()


def run_migrations_online() -> None:
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    with engine.connect() as connection:
        _run(connection)


run_migrations_online()
