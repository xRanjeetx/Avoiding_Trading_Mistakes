"""user checklist items and open wait

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-02 22:26:13.013137
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('user_checklist_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('text', sa.String(length=500), nullable=False),
    sa.Column('done', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_user_checklist_user_kind', 'user_checklist_items', ['user_id', 'kind'], unique=False)
    op.add_column('user_settings', sa.Column('open_wait_min', sa.Integer(), server_default='5', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'open_wait_min')
    op.drop_index('ix_user_checklist_user_kind', table_name='user_checklist_items')
    op.drop_table('user_checklist_items')
