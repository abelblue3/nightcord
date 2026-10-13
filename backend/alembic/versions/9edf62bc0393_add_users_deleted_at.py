"""add users deleted_at

Revision ID: 9edf62bc0393
Revises: d1d989cd75d8
Create Date: 2026-10-13 09:57:56.348372

Students can delete their account. The row stays (messages, rooms, reports
and consent records point at it) but is wiped, and deleted_at marks it so
its messages show as "deleted student".
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9edf62bc0393'
down_revision: Union[str, None] = 'd1d989cd75d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'deleted_at')
