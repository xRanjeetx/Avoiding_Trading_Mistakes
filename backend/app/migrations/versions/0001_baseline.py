"""baseline: the schema as of the introduction of Alembic

Every table is created only if it is missing, and the columns that older versions of the app added by hand (the old
ensure_columns) are added only if they are missing. So this one revision brings ANY database - empty, or one created by
an earlier release - to the same starting point, and it is safe to run against the live database: it never drops or
rewrites existing data. Later changes are ordinary, separate revisions.

Revision ID: 0001
Revises: 
Create Date: 2026-10-30 23:32:37.671170
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None



def _exists(bind, table: str) -> bool:
    return inspect(bind).has_table(table)


def upgrade() -> None:
    bind = op.get_bind()
    if not _exists(bind, "audit_log"):
        op.create_table('audit_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('at', sa.DateTime(), nullable=False),
        sa.Column('admin_email', sa.String(length=254), nullable=False),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('target_email', sa.String(length=254), nullable=True),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('detail', sa.String(length=200), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('audit_log', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_audit_log_at'), ['at'], unique=False)

    if not _exists(bind, "calendar_events"):
        op.create_table('calendar_events',
        sa.Column('id', sa.String(length=24), nullable=False),
        sa.Column('at', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(length=8), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('impact', sa.String(length=10), nullable=False),
        sa.Column('forecast', sa.String(length=30), nullable=False),
        sa.Column('previous', sa.String(length=30), nullable=False),
        sa.Column('seen_at', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('calendar_events', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_calendar_events_at'), ['at'], unique=False)

    if not _exists(bind, "library_books"):
        op.create_table('library_books',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(length=200), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('filename')
        )

    if not _exists(bind, "stored_images"):
        op.create_table('stored_images',
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('content_type', sa.String(length=30), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.PrimaryKeyConstraint('key')
        )

    if not _exists(bind, "users"):
        op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=254), nullable=False),
        sa.Column('password_hash', sa.String(length=100), nullable=False),
        sa.Column('email_verified', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('is_admin', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    if not _exists(bind, "auth_sessions"):
        op.create_table('auth_sessions',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('prev_hash', sa.String(length=64), nullable=True),
        sa.Column('rotated_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('user_agent', sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('auth_sessions', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_auth_sessions_prev_hash'), ['prev_hash'], unique=False)
            batch_op.create_index(batch_op.f('ix_auth_sessions_token_hash'), ['token_hash'], unique=True)
            batch_op.create_index(batch_op.f('ix_auth_sessions_user_id'), ['user_id'], unique=False)

    if not _exists(bind, "entries"):
        op.create_table('entries',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('timestamp', sa.BigInteger(), nullable=False),
        sa.Column('pair', sa.String(length=30), nullable=False),
        sa.Column('dir', sa.String(length=4), nullable=True),
        sa.Column('setup', sa.String(length=20), nullable=True),
        sa.Column('lot', sa.Float(), nullable=True),
        sa.Column('entry', sa.Float(), nullable=True),
        sa.Column('sl', sa.Float(), nullable=True),
        sa.Column('tp', sa.Float(), nullable=True),
        sa.Column('rr', sa.Float(), nullable=True),
        sa.Column('answers', sa.JSON(), nullable=False),
        sa.Column('failed_rules', sa.JSON(), nullable=False),
        sa.Column('traded', sa.Boolean(), nullable=False),
        sa.Column('result', sa.String(length=10), nullable=False),
        sa.Column('exit', sa.Float(), nullable=True),
        sa.Column('pnl', sa.Float(), nullable=True),
        sa.Column('closed_at', sa.BigInteger(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('lesson', sa.Text(), nullable=False),
        sa.Column('emotion', sa.String(length=255), nullable=True),
        sa.Column('emotion_after', sa.String(length=255), nullable=True),
        sa.Column('images', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'id')
        )
        with op.batch_alter_table('entries', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_entries_timestamp'), ['timestamp'], unique=False)

    if not _exists(bind, "reading_progress"):
        op.create_table('reading_progress',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('last_page', sa.Integer(), nullable=False),
        sa.Column('pages', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['book_id'], ['library_books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'book_id')
        )

    if not _exists(bind, "user_settings"):
        op.create_table('user_settings',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('lot', sa.Float(), nullable=False),
        sa.Column('min_rr', sa.Float(), nullable=False),
        sa.Column('max_trades', sa.Integer(), nullable=False),
        sa.Column('max_sl', sa.Integer(), nullable=False),
        sa.Column('london_start', sa.String(length=5), nullable=False),
        sa.Column('london_end', sa.String(length=5), nullable=False),
        sa.Column('session_start', sa.String(length=5), nullable=False),
        sa.Column('session_end', sa.String(length=5), nullable=False),
        sa.Column('balance', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=4), nullable=False),
        sa.Column('killzones', sa.JSON(), nullable=True),
        sa.Column('pairs', sa.JSON(), nullable=True),
        sa.Column('rules', sa.JSON(), nullable=True),
        sa.Column('news', sa.JSON(), nullable=True),
        sa.Column('loss_limits', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id')
        )

    _add_columns_older_releases_lacked(bind)


def _add_columns_older_releases_lacked(bind) -> None:
    insp = inspect(bind)  # a fresh inspector: the tables above may have just been created

    def have(table: str) -> set[str]:
        return {c["name"] for c in insp.get_columns(table)}

    settings = have("user_settings")
    for col in ("killzones", "pairs", "rules", "news", "loss_limits"):
        if col not in settings:
            op.add_column("user_settings", sa.Column(col, sa.JSON(), nullable=True))

    entries = have("entries")
    for col in ("emotion", "emotion_after"):
        if col not in entries:
            op.add_column("entries", sa.Column(col, sa.String(length=255), nullable=True))
    if "images" not in entries:
        op.add_column("entries", sa.Column("images", sa.JSON(), nullable=True))
    # An older build created the emotion columns as INTEGER. The app stores a key such as "calm", which PostgreSQL rejects,
    # so every new entry failed. Convert them to text (existing numbers become their text form) and widen the old
    # VARCHAR(20), since a trade can hold several comma-separated emotions.
    if bind.dialect.name == "postgresql":
        for c in insp.get_columns("entries"):
            if c["name"] in ("emotion", "emotion_after") and (
                not isinstance(c["type"], sa.String) or (c["type"].length or 255) < 255
            ):
                op.execute(text(f"ALTER TABLE entries ALTER COLUMN {c['name']} TYPE VARCHAR(255) USING {c['name']}::text"))

    users = have("users")
    # Accounts that already exist count as verified, active and not admin (the defaults backfill them).
    if "email_verified" not in users:
        op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.true()))
    if "is_admin" not in users:
        op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "is_active" not in users:
        op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    if "created_at" not in users:
        op.add_column("users", sa.Column("created_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    raise NotImplementedError("The baseline is never rolled back: it would delete every table.")
