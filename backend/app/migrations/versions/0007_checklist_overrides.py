"""checklist overrides

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-03 21:10:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('checklist_overrides',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('item_id', sa.Integer(), nullable=False),
    sa.Column('text', sa.String(length=500), nullable=True),
    sa.Column('hidden', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['checklist_items.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'item_id')
    )


def downgrade() -> None:
    op.drop_table('checklist_overrides')
