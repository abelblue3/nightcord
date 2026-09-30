"""Regenerates app/data/school_domains.json: every .edu website host in the
NCES IPEDS institution directory, mapped to the institution IDs (UNITIDs)
that use it. No timezones are stored -- those come from the campus-time API
at signup (see app/campus_time.py).

Temporary: this exists only because campus-time can't yet search by email
domain. Once it can, delete this script and the JSON it writes.

Uses the same HD2024 file, pinned to the same SHA-256, that campus-time's
catalog is built from (GET /api/catalog -> sources), so the UNITIDs here
line up with its `edge:<UNITID>` location IDs.

Usage:
    python scripts/build_school_domains.py
"""
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import httpx

HD_URL = "https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip"
HD_SHA256 = "d98425c123d7c0e872aec6e83960dfb501884818bf17385c340790f3d1f28345"
HD_MEMBER = "HD2024.csv"
OUTPUT_PATH = Path(__file__).parent.parent / "app" / "data" / "school_domains.json"


def website_host(web_address: str) -> str:
    """'https://www.Stanford.edu/about' -> 'stanford.edu'."""
    host = re.sub(r"^[a-z]+://", "", web_address.strip().lower())
    host = re.split(r"[/?#:]", host, maxsplit=1)[0]
    return re.sub(r"^www\d*\.", "", host)


def main() -> None:
    archive = httpx.get(HD_URL, timeout=60, follow_redirects=True).raise_for_status().content
    digest = hashlib.sha256(archive).hexdigest()
    if digest != HD_SHA256:
        raise SystemExit(f"{HD_URL} changed (sha256 {digest}); review it before updating HD_SHA256.")

    with zipfile.ZipFile(io.BytesIO(archive)) as zf, zf.open(HD_MEMBER) as raw:
        rows = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace"))
        ids_by_host: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            host = website_host(row["WEBADDR"])
            if host.endswith(".edu"):
                ids_by_host[host].add(row["UNITID"])

    # One entry per line so a regenerated file diffs readably.
    lines = [f"{json.dumps(host)}: {json.dumps(sorted(ids))}" for host, ids in sorted(ids_by_host.items())]
    OUTPUT_PATH.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")
    print(f"wrote {len(lines)} domains to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
