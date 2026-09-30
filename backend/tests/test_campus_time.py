import httpx
import pytest

from app.campus_time import (
    MAX_SCHOOLS_PER_DOMAIN,
    NOT_FOUND,
    SchoolLookup,
    fetch_location_timezone,
    find_school_ids,
    lookup_school,
)

# --- domain -> school (bundled NCES data) ---


@pytest.mark.parametrize(
    "domain,expected",
    [
        ("harvard.edu", ["166027"]),
        ("HARVARD.EDU", ["166027"]),
        ("cs.harvard.edu", ["166027"]),  # subdomain of a known institution
        ("grad.cs.harvard.edu", ["166027"]),  # multi-level subdomain
        ("not-a-real-school.edu", []),
        ("harvard.edu.fake.com", []),  # known domain as a suffix, not the actual domain
        ("edu", []),
    ],
)
def test_find_school_ids(domain, expected):
    assert find_school_ids(domain) == expected


# --- school -> timezone (campus-time API) ---


def _fake_get(status_code=200, json=None, text=None):
    def fake_get(url, timeout):
        fake_get.url = url
        request = httpx.Request("GET", url)
        if text is not None:
            return httpx.Response(status_code, text=text, request=request)
        return httpx.Response(status_code, json=json, request=request)

    return fake_get


def test_fetch_location_timezone_reads_the_timezone(monkeypatch):
    fake = _fake_get(json={"locationId": "edge:243744", "timezone": "America/Los_Angeles"})
    monkeypatch.setattr("app.campus_time.httpx.get", fake)

    assert fetch_location_timezone("243744") == "America/Los_Angeles"
    assert fake.url.endswith("/api/locations/edge:243744/time")


@pytest.mark.parametrize("status_code", [404, 409, 500])
def test_fetch_location_timezone_none_on_error_status(monkeypatch, status_code):
    # 404 unknown location, 409 held back with no approved timezone, 5xx outage.
    monkeypatch.setattr("app.campus_time.httpx.get", _fake_get(status_code, json={"error": "nope"}))
    assert fetch_location_timezone("243744") is None


def test_fetch_location_timezone_none_on_network_error(monkeypatch):
    def raise_timeout(url, timeout):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr("app.campus_time.httpx.get", raise_timeout)
    assert fetch_location_timezone("243744") is None


def test_fetch_location_timezone_none_on_non_json_body(monkeypatch):
    monkeypatch.setattr("app.campus_time.httpx.get", _fake_get(text="<html>Replit is waking up</html>"))
    assert fetch_location_timezone("243744") is None


# --- lookup_school: both steps together ---


def test_lookup_school_unknown_domain_never_calls_the_api(monkeypatch):
    def fail_if_called(school_id):
        raise AssertionError("should not call campus-time for a domain with no known school")

    monkeypatch.setattr("app.campus_time.fetch_location_timezone", fail_if_called)
    assert lookup_school("not-a-real-school.edu") == NOT_FOUND


def test_lookup_school_known_domain_with_timezone():
    # conftest's fake campus-time knows harvard.edu's school.
    assert lookup_school("cs.harvard.edu") == SchoolLookup(found=True, timezone="America/New_York")


def test_lookup_school_known_domain_without_timezone(monkeypatch):
    monkeypatch.setattr("app.campus_time.fetch_location_timezone", lambda school_id: None)
    assert lookup_school("harvard.edu") == SchoolLookup(found=True, timezone=None)


@pytest.mark.parametrize(
    "timezones",
    [
        {"1": "America/Phoenix", "2": "America/Phoenix"},  # campuses share a zone
        {"1": "America/Phoenix", "2": None},  # e.g. ASU: online-only unit held back (409)
    ],
)
def test_lookup_school_uses_the_timezone_placed_campuses_share(monkeypatch, timezones):
    monkeypatch.setattr("app.campus_time.find_school_ids", lambda domain: ["1", "2"])
    monkeypatch.setattr("app.campus_time.fetch_location_timezone", timezones.get)
    assert lookup_school("multi.edu") == SchoolLookup(found=True, timezone="America/Phoenix")


@pytest.mark.parametrize(
    "timezones",
    [
        {"1": "America/Phoenix", "2": "America/Denver"},  # campuses in different zones
        {"1": None, "2": None},  # no campus campus-time can place
    ],
)
def test_lookup_school_no_timezone_without_one_agreed_zone(monkeypatch, timezones):
    monkeypatch.setattr("app.campus_time.find_school_ids", lambda domain: ["1", "2"])
    monkeypatch.setattr("app.campus_time.fetch_location_timezone", timezones.get)
    assert lookup_school("multi.edu") == SchoolLookup(found=True, timezone=None)


def test_lookup_school_skips_the_api_for_large_chains(monkeypatch):
    def fail_if_called(school_id):
        raise AssertionError("should not call campus-time once per campus for a chain")

    ids = [str(n) for n in range(MAX_SCHOOLS_PER_DOMAIN + 1)]
    monkeypatch.setattr("app.campus_time.find_school_ids", lambda domain: ids)
    monkeypatch.setattr("app.campus_time.fetch_location_timezone", fail_if_called)
    assert lookup_school("chain.edu") == SchoolLookup(found=True, timezone=None)
