"""remove email verification

Revision ID: f2a7c95d1e04
Revises: d4f8a13e6b90
Create Date: 2026-08-12T00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a7c95d1e04'
down_revision: Union[str, None] = 'd4f8a13e6b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_users_verification_code'), table_name='users')
    op.drop_column('users', 'last_verification_email_sent_at')
    op.drop_column('users', 'verification_code_attempts')
    op.drop_column('users', 'verification_code_expires_at')
    op.drop_column('users', 'verification_code')
    op.drop_column('users', 'is_verified')


def downgrade() -> None:
    op.add_column('users', sa.Column('is_verified', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('verification_code', sa.String(length=6), nullable=True))
    op.add_column('users', sa.Column('verification_code_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('verification_code_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('last_verification_email_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_users_verification_code'), 'users', ['verification_code'], unique=False)
