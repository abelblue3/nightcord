import pytest
from starlette.requests import Request

from app.rate_limit import client_ip, user_or_ip_key
from tests.conftest import make_token


def _request(forwarded_for=None, socket_host="10.0.0.5", bearer=None):
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    if bearer:
        headers.append((b"authorization", f"Bearer {bearer}".encode()))
    return Request({"type": "http", "headers": headers, "client": (socket_host, 12345)})


# --- client_ip ---


def test_uses_the_address_our_proxy_appended():
    assert client_ip(_request("203.0.113.9")) == "203.0.113.9"


def test_a_spoofed_leftmost_entry_is_ignored():
    # The client typed 1.2.3.4; Railway's edge appended the real address.
    assert client_ip(_request("1.2.3.4, 203.0.113.9")) == "203.0.113.9"


@pytest.mark.parametrize("internal_hop", ["10.1.2.3", "172.16.0.9", "192.168.1.1", "100.64.0.7", "127.0.0.1"])
def test_our_own_internal_hops_are_skipped(internal_hop):
    # e.g. client -> Railway edge -> Ruby web layer -> FastAPI
    assert client_ip(_request(f"1.2.3.4, 203.0.113.9, {internal_hop}")) == "203.0.113.9"


def test_garbage_entries_are_skipped():
    assert client_ip(_request("203.0.113.9, not-an-ip")) == "203.0.113.9"


def test_falls_back_to_the_socket_address_without_a_usable_header():
    assert client_ip(_request(None, socket_host="198.51.100.4")) == "198.51.100.4"
    assert client_ip(_request("10.0.0.1", socket_host="198.51.100.4")) == "198.51.100.4"


# --- user_or_ip_key ---


def test_signed_in_requests_are_keyed_by_account():
    key = user_or_ip_key(_request("203.0.113.9", bearer=make_token("user_abc")))
    assert key == "user:user_abc"


def test_a_forged_token_falls_back_to_the_ip():
    key = user_or_ip_key(_request("203.0.113.9", bearer="not.a.real-token"))
    assert key == "203.0.113.9"
