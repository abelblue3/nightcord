import json
from pathlib import Path

_DATA_PATH = Path(__file__).parent / "data" / "edu_domains.json"

with open(_DATA_PATH, encoding="utf-8") as f:
    # domain -> IANA timezone string, or None if the domain is a known
    # institution but we couldn't resolve its location (see backend/scripts/
    # backfill notes in the handoff doc for how this was built).
    _EDU_DOMAINS: dict[str, str | None] = json.load(f)


def _matching_entry(domain: str) -> tuple[bool, str | None]:
    """Walks from the full domain up through its parent domains (e.g.
    grad.cs.harvard.edu -> cs.harvard.edu -> harvard.edu) looking for a match.
    Returns (found, timezone).
    """
    domain = domain.lower()
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in _EDU_DOMAINS:
            return True, _EDU_DOMAINS[candidate]
    return False, None


def is_known_edu_institution(domain: str) -> bool:
    """True if `domain` (or a parent of it, e.g. cs.harvard.edu -> harvard.edu)
    matches a real, accredited U.S. institution in our vendored dataset
    (github.com/Hipo/university-domains-list, filtered to US .edu domains).
    """
    found, _ = _matching_entry(domain)
    return found


def get_institution_timezone(domain: str) -> str | None:
    """The institution's IANA timezone, backfilled from the College Scorecard
    API (US Dept of Education) by matching each domain to its school's state.
    Returns None if the domain isn't a known institution, or is known but its
    location couldn't be resolved (~16% of institutions -- mostly community
    college districts and non-degree-granting entities Scorecard doesn't
    track the same way).
    """
    _, timezone = _matching_entry(domain)
    return timezone
