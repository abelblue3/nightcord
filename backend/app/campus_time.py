"""Finds a student's school and its timezone from their email domain.

The timezone comes from the campus-time API (settings.campus_time_api_url),
looked up once at signup and stored on the account -- the night gate never
calls it per request.

Temporary: campus-time can't search by email domain yet, so the domain ->
school step uses data/school_domains.json (each school website host in NCES
IPEDS mapped to its institution IDs, no timezones; regenerate with
scripts/build_school_domains.py). campus-time location IDs are
"edge:<institution ID>", so each school's timezone is one API call. Once
campus-time supports a domain search, find_school_ids and that JSON file
can be replaced by it.
"""
import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import settings

CAMPUS_TIME_TIMEOUT_SECONDS = 3.0

# Chains sharing one website across many campuses (e.g. a beauty school with
# 72 locations) aren't one place. Treat them as known schools with no single
# timezone rather than making dozens of calls to find that out.
MAX_SCHOOLS_PER_DOMAIN = 5

_DATA_PATH = Path(__file__).parent / "data" / "school_domains.json"

with open(_DATA_PATH, encoding="utf-8") as f:
    _SCHOOL_IDS_BY_DOMAIN: dict[str, list[str]] = json.load(f)


@dataclass(frozen=True)
class SchoolLookup:
    found: bool  # the domain belongs to a known institution
    timezone: str | None  # its one IANA timezone, if campus-time has one


NOT_FOUND = SchoolLookup(found=False, timezone=None)


def find_school_ids(domain: str) -> list[str]:
    """Walks from the full domain up through its parents (e.g.
    grad.cs.harvard.edu -> cs.harvard.edu -> harvard.edu) and returns the
    institution IDs of the first match, or [] if none.
    """
    parts = domain.lower().split(".")
    for i in range(len(parts) - 1):
        ids = _SCHOOL_IDS_BY_DOMAIN.get(".".join(parts[i:]))
        if ids:
            return ids
    return []


def fetch_location_timezone(school_id: str) -> str | None:
    """None when campus-time doesn't know the location (404), holds it back
    without an approved timezone (409), or can't be reached -- every case
    where signup should fall back instead of guessing.
    """
    try:
        response = httpx.get(
            f"{settings.campus_time_api_url}/api/locations/edge:{school_id}/time",
            timeout=CAMPUS_TIME_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json().get("timezone")
    except (httpx.HTTPError, ValueError):
        return None


def lookup_school(domain: str) -> SchoolLookup:
    school_ids = find_school_ids(domain)
    if not school_ids:
        return NOT_FOUND
    if len(school_ids) > MAX_SCHOOLS_PER_DOMAIN:
        return SchoolLookup(found=True, timezone=None)

    # Campuses campus-time won't place (e.g. ASU's online-only unit, held back
    # with a 409) are skipped. Of the rest, only trust a timezone they all
    # agree on -- a school spanning zones has no single right answer.
    timezones = {fetch_location_timezone(school_id) for school_id in school_ids} - {None}
    timezone = timezones.pop() if len(timezones) == 1 else None
    return SchoolLookup(found=True, timezone=timezone)
