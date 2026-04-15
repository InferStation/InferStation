#!/usr/bin/env python3
"""
Register / unregister a vLLM backend with the LLM Gateway.

Examples:
  # Register (auto-detect models from vLLM)
  python register.py --gateway http://82.156.115.203:8080 \
      --token sk-admin-xxx --name halo4 --url http://10.161.176.98:8000/v1

  # Register with explicit models
  python register.py --gateway http://82.156.115.203:8080 \
      --token sk-admin-xxx --name halo4 --url http://10.161.176.98:8000/v1 \
      --models MiniMax-M2.5 Qwen3-8B

  # Unregister
  python register.py --gateway http://82.156.115.203:8080 \
      --token sk-admin-xxx --name halo4 --unregister

  # Heartbeat mode (re-register every N seconds)
  python register.py --gateway http://82.156.115.203:8080 \
      --token sk-admin-xxx --name halo4 --url http://10.161.176.98:8000/v1 \
      --heartbeat 60
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error


def fetch_models(url: str) -> list[str]:
    """Auto-detect models from vLLM /models endpoint."""
    try:
        req = urllib.request.Request(f"{url.rstrip('/')}/models")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        print(f"Warning: failed to auto-detect models from {url}: {e}", file=sys.stderr)
        return []


def register(gateway: str, token: str, name: str, url: str, models: list[str]) -> dict:
    payload = json.dumps({"name": name, "url": url, "models": models, "token": token}).encode()
    req = urllib.request.Request(
        f"{gateway.rstrip('/')}/register",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def unregister(gateway: str, token: str, name: str) -> dict:
    payload = json.dumps({"name": name, "token": token}).encode()
    req = urllib.request.Request(
        f"{gateway.rstrip('/')}/unregister",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def main():
    p = argparse.ArgumentParser(description="Register/unregister vLLM backend with LLM Gateway")
    p.add_argument("--gateway", required=True, help="Gateway URL, e.g. http://82.156.115.203:8080")
    p.add_argument("--token", required=True, help="Admin token for authentication")
    p.add_argument("--name", required=True, help="Backend name, e.g. halo4")
    p.add_argument("--url", help="vLLM backend URL, e.g. http://10.161.176.98:8000/v1")
    p.add_argument("--models", nargs="+", default=[], help="Model names (auto-detected if omitted)")
    p.add_argument("--unregister", action="store_true", help="Unregister instead of register")
    p.add_argument("--heartbeat", type=int, default=0, help="Re-register every N seconds (0=once)")
    args = p.parse_args()

    if args.unregister:
        result = unregister(args.gateway, args.token, args.name)
        print(json.dumps(result, indent=2))
        return

    if not args.url:
        p.error("--url is required for registration")

    models = args.models
    if not models:
        print(f"Auto-detecting models from {args.url} ...", file=sys.stderr)
        models = fetch_models(args.url)
        if models:
            print(f"  Found: {', '.join(models)}", file=sys.stderr)
        else:
            print("  No models found, registering with empty list", file=sys.stderr)

    while True:
        try:
            result = register(args.gateway, args.token, args.name, args.url, models)
            print(json.dumps(result, indent=2))
        except urllib.error.HTTPError as e:
            print(f"Error: {e.code} {e.read().decode()}", file=sys.stderr)
            if args.heartbeat <= 0:
                sys.exit(1)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            if args.heartbeat <= 0:
                sys.exit(1)

        if args.heartbeat <= 0:
            break
        time.sleep(args.heartbeat)


if __name__ == "__main__":
    main()
