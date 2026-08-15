from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

from apps.api.app.core.settings import Settings


class EndpointPolicyError(ValueError):
    pass


FORBIDDEN_ENDPOINT_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("100.100.100.200/32"),
    ipaddress.ip_network("192.0.0.192/32"),
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("fd00:ec2::254/128"),
)


def _canonical_hostname(hostname: str) -> str:
    value = hostname.rstrip(".")
    if not value:
        raise EndpointPolicyError("Endpoint URL must contain a valid host")
    try:
        return value.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise EndpointPolicyError("Endpoint URL contains an invalid hostname") from exc


def normalize_base_url(url: str, *, allow_insecure_http: bool) -> str:
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise EndpointPolicyError("Endpoint URL must use http or https")
    if parsed.scheme == "http" and not allow_insecure_http:
        raise EndpointPolicyError("Plain HTTP endpoints are disabled")
    if not parsed.hostname or parsed.username or parsed.password:
        raise EndpointPolicyError("Endpoint URL must contain a host and no embedded credentials")
    if parsed.query or parsed.fragment:
        raise EndpointPolicyError("Endpoint URL cannot contain query parameters or a fragment")
    hostname = _canonical_hostname(parsed.hostname)
    try:
        port = parsed.port
    except ValueError as exc:
        raise EndpointPolicyError("Endpoint URL contains an invalid port") from exc
    path = parsed.path.rstrip("/")
    if not path.endswith("/v1"):
        path = f"{path}/v1" if path else "/v1"
    netloc = f"[{hostname}]" if ":" in hostname else hostname
    if port:
        netloc = f"{netloc}:{port}"
    return urlunsplit((parsed.scheme, netloc, path, "", ""))


async def _resolve_addresses(hostname: str) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return {ipaddress.ip_address(hostname)}
    except ValueError:
        loop = asyncio.get_running_loop()
        try:
            records = await loop.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise EndpointPolicyError(f"Endpoint hostname cannot be resolved: {hostname}") from exc
        return {ipaddress.ip_address(record[4][0]) for record in records}


def _address_is_forbidden(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or any(address in network for network in FORBIDDEN_ENDPOINT_NETWORKS)
    )


async def validate_endpoint_url(url: str, settings: Settings) -> str:
    normalized = normalize_base_url(url, allow_insecure_http=settings.allow_insecure_http)
    hostname = urlsplit(normalized).hostname
    assert hostname is not None
    canonical_hostname = _canonical_hostname(hostname)
    allowed_hosts = {_canonical_hostname(host) for host in settings.allowed_endpoint_hosts}
    addresses = await _resolve_addresses(canonical_hostname)
    is_public_https = urlsplit(normalized).scheme == "https"

    allowed_networks = [ipaddress.ip_network(cidr) for cidr in settings.allowed_endpoint_cidrs]
    for address in addresses:
        if _address_is_forbidden(address):
            raise EndpointPolicyError(f"Endpoint address is forbidden: {address}")
        explicitly_allowed = canonical_hostname in allowed_hosts or any(
            address in network for network in allowed_networks
        )
        public_https_allowed = (
            settings.allow_public_https_endpoints and is_public_https and address.is_global
        )
        if not explicitly_allowed and not public_https_allowed:
            raise EndpointPolicyError(
                f"Endpoint address is outside the configured allowlist: {address}"
            )
    return normalized
