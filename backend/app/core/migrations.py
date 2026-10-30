"""Database schema upgrades, run with Alembic (revisions live in app/migrations/versions).

run_migrations() is called at startup and by the create_admin command. It upgrades any database to the newest revision:
an empty one gets every table, and a database created by an earlier release (before Alembic) is adopted by the baseline
revision without losing data. To change the schema: edit the model, then from the backend folder run
    alembic revision --autogenerate -m "what changed"
check the generated file in app/migrations/versions, and commit it together with the model change."""
from pathlib import Path

from alembic import command
from alembic.config import Config

SCRIPTS = Path(__file__).resolve().parents[1] / "migrations"


def run_migrations(connection=None, revision: str = "head") -> None:
    """Upgrades to the newest revision (or to `revision`). `connection` lets tests aim it at another database; by default
    the app's is used."""
    cfg = Config()
    cfg.set_main_option("script_location", str(SCRIPTS))
    if connection is not None:
        cfg.attributes["connection"] = connection
    command.upgrade(cfg, revision)
