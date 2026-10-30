"""two factor sign-in

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-30 23:35:08.224071
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('totp_secret', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('totp_enabled', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('totp_last_step', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('recovery_hashes', sa.JSON(), nullable=True))




def downgrade() -> None:

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('recovery_hashes')
        batch_op.drop_column('totp_last_step')
        batch_op.drop_column('totp_enabled')
        batch_op.drop_column('totp_secret')


