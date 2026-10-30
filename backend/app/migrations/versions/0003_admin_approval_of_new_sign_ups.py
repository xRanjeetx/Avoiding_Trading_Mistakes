"""admin approval of new sign-ups

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-30 23:54:45.377566
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('approved', sa.Boolean(), server_default=sa.true(), nullable=False))



def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('approved')

