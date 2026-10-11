"""drop pre-clerk auth columns

Revision ID: dffe3dd3b34f
Revises: a3c9e1f47b20
Create Date: 2026-10-10 20:25:54.007658

Sign-in has run through Clerk since b7c3e9a2d514, which kept the old
password, Google and lockout columns so a rollback stayed possible. Nothing
has read them since, so they go. Downgrading brings the columns back empty:
what they held is not restored.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dffe3dd3b34f'
down_revision: Union[str, None] = 'a3c9e1f47b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_users_google_id', table_name='users')
    op.drop_column('users', 'google_id')
    op.drop_column('users', 'hashed_password')
    op.drop_column('users', 'failed_login_attempts')
    op.drop_column('users', 'lockout_until')
    op.drop_column('users', 'token_version')


def downgrade() -> None:
    op.add_column('users', sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('lockout_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('hashed_password', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('google_id', sa.String(length=64), nullable=True))
    op.create_index('ix_users_google_id', 'users', ['google_id'], unique=True)
