"""school name from email

Revision ID: a3c9e1f47b20
Revises: e5ccabf5357a
Create Date: 2026-10-09T00:00:00.000000

The university shown on a profile is now read from the email's domain each
time, so the stored copy -- empty for accounts that hadn't signed in since it
was added -- goes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3c9e1f47b20'
down_revision: Union[str, None] = 'e5ccabf5357a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('users', 'school_name')


def downgrade() -> None:
    op.add_column('users', sa.Column('school_name', sa.String(length=200), nullable=True))
