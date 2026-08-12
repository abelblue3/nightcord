import json
from pathlib import Path

_DATA_PATH = Path(__file__).parent / "data" / "edu_domains.json"

with open(_DATA_PATH, encoding="utf-8") as f:
    KNOWN_EDU_DOMAINS: frozenset[str] = frozenset(json.load(f))


def is_known_edu_institution(domain: str) -> bool:
    """True if `domain` (or a parent of it, e.g. cs.harvard.edu -> harvard.edu)
    matches a real, accredited U.S. institution in our vendored dataset
    (github.com/Hipo/university-domains-list, filtered to US .edu domains).
    """
    domain = domain.lower()
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in KNOWN_EDU_DOMAINS:
            return True
    return False
