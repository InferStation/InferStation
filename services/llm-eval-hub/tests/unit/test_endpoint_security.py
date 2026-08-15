from __future__ import annotations

import ipaddress

import pytest

from apps.api.app.core import network
from apps.api.app.core.network import EndpointPolicyError, normalize_base_url, validate_endpoint_url
from apps.api.app.core.settings import Settings
from apps.api.app.schemas.endpoints import ProbeRequest
from apps.api.app.services.endpoints import sanitized_extra_headers


def _settings(
    *,
    hosts: list[str] | None = None,
    cidrs: list[str] | None = None,
    allow_public_https: bool = False,
) -> Settings:
    return Settings(
        app_env="test",
        allowed_endpoint_hosts=hosts or [],
        allowed_endpoint_cidrs=cidrs or ["10.0.0.0/8"],
        allow_insecure_http=True,
        allow_public_https_endpoints=allow_public_https,
    )


def test_normalize_base_url_canonicalizes_host_and_ipv6() -> None:
    assert normalize_base_url(
        "https://PROVIDER.Example./api/", allow_insecure_http=True
    ) == "https://provider.example/api/v1"
    assert normalize_base_url(
        "http://[2001:db8::1]:8000", allow_insecure_http=True
    ) == "http://[2001:db8::1]:8000/v1"


@pytest.mark.parametrize(
    "endpoint_url",
    [
        "https://provider.example/api/v1/chat/completions",
        "https://provider.example/api/v1/completions/",
        "https://provider.example/api/v1/models",
    ],
)
def test_normalize_base_url_accepts_full_openai_endpoint_urls(endpoint_url: str) -> None:
    assert normalize_base_url(endpoint_url, allow_insecure_http=True) == (
        "https://provider.example/api/v1"
    )


def test_probe_timeout_is_configurable_and_bounded() -> None:
    assert ProbeRequest().timeout_seconds == 60
    assert ProbeRequest(timeout_seconds=180).timeout_seconds == 180
    with pytest.raises(ValueError):
        ProbeRequest(timeout_seconds=301)


@pytest.mark.asyncio
async def test_allowlisted_hostname_still_rejects_loopback_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def resolve(_: str) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        return {ipaddress.ip_address("127.0.0.1")}

    monkeypatch.setattr(network, "_resolve_addresses", resolve)
    with pytest.raises(EndpointPolicyError, match="forbidden"):
        await validate_endpoint_url(
            "https://rebind.example/v1",
            _settings(hosts=["rebind.example"]),
        )


@pytest.mark.asyncio
async def test_allowlisted_hostname_accepts_public_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def resolve(_: str) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        return {ipaddress.ip_address("203.0.113.10")}

    monkeypatch.setattr(network, "_resolve_addresses", resolve)
    assert (
        await validate_endpoint_url(
            "https://Provider.Example./v1",
            _settings(hosts=["provider.example"]),
        )
        == "https://provider.example/v1"
    )


@pytest.mark.asyncio
async def test_private_cidr_is_allowed_but_public_literal_is_rejected() -> None:
    assert (
        await validate_endpoint_url("http://10.20.30.40:8000", _settings())
        == "http://10.20.30.40:8000/v1"
    )
    with pytest.raises(EndpointPolicyError, match="outside the configured allowlist"):
        await validate_endpoint_url("https://8.8.8.8/v1", _settings())


@pytest.mark.asyncio
async def test_arbitrary_public_https_can_be_enabled_without_allowing_public_http() -> None:
    settings = _settings(allow_public_https=True)

    assert (
        await validate_endpoint_url("https://8.8.8.8/v1", settings)
        == "https://8.8.8.8/v1"
    )
    with pytest.raises(EndpointPolicyError, match="outside the configured allowlist"):
        await validate_endpoint_url("http://8.8.8.8/v1", settings)


@pytest.mark.parametrize(
    "header_name",
    [
        "Authorization",
        "Proxy-Authorization",
        "api-key",
        "X-API-Key",
        "Cookie",
        "Set-Cookie",
    ],
)
def test_sensitive_extra_headers_are_rejected(header_name: str) -> None:
    with pytest.raises(ValueError, match="Forbidden extra headers"):
        sanitized_extra_headers({header_name: "must-not-enter-config-json"})


def test_non_sensitive_extra_headers_are_preserved() -> None:
    assert sanitized_extra_headers({"X-Tenant-ID": "tenant-a"}) == {
        "X-Tenant-ID": "tenant-a"
    }
