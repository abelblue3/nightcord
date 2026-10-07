"""add clerk user id

Revision ID: b7c3e9a2d514
Revises: f2a7c95d1e04
Create Date: 2026-09-30T00:00:00.000000

Sign-in moves to Clerk. The pre-Clerk auth columns (hashed_password,
google_id, failed_login_attempts, lockout_until, token_version) are left in
place so the previous release can still run against this schema; a later
migration drops them once Clerk is live.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c3e9a2d514'
down_revision: Union[str, None] = 'f2a7c95d1e04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('clerk_user_id', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_users_clerk_user_id'), 'users', ['clerk_user_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_clerk_user_id'), table_name='users')
    op.drop_column('users', 'clerk_user_id')
