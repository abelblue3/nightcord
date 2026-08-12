"""replace verification token with code

Revision ID: d4f8a13e6b90
Revises: c7e2b48f915a
Create Date: 2026-08-12T00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f8a13e6b90'
down_revision: Union[str, None] = 'c7e2b48f915a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_users_verification_token'), table_name='users')
    op.drop_column('users', 'verification_token_expires_at')
    op.drop_column('users', 'verification_token')

    op.add_column('users', sa.Column('verification_code', sa.String(length=6), nullable=True))
    op.add_column('users', sa.Column('verification_code_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('verification_code_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('last_verification_email_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_users_verification_code'), 'users', ['verification_code'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_verification_code'), table_name='users')
    op.drop_column('users', 'last_verification_email_sent_at')
    op.drop_column('users', 'verification_code_attempts')
    op.drop_column('users', 'verification_code_expires_at')
    op.drop_column('users', 'verification_code')

    op.add_column('users', sa.Column('verification_token', sa.String(length=64), nullable=True))
    op.add_column('users', sa.Column('verification_token_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_users_verification_token'), 'users', ['verification_token'], unique=True)
