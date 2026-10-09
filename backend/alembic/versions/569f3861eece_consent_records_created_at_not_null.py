"""consent records created_at not null

Revision ID: 569f3861eece
Revises: 632c015fdfca
Create Date: 2026-10-08T00:00:00.000000

The model has always required created_at (every row gets one), but
c4d1e8f3a920 created the column as nullable; this makes the database match.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '569f3861eece'
down_revision: Union[str, None] = '632c015fdfca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('consent_records', 'created_at', existing_type=sa.DateTime(timezone=True), nullable=False)


def downgrade() -> None:
    op.alter_column('consent_records', 'created_at', existing_type=sa.DateTime(timezone=True), nullable=True)
