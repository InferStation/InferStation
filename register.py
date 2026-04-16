#!/usr/bin/env python3
"""
Register / unregister a vLLM backend with the LLM Gateway.

Examples:
  # Register as admin (auto-detect models from vLLM)
  python register.py --gateway http://82.156.115.203:8080 \
      --token sk-admin-xxx --name halo4 --url http://10.161.176.98:8000/v1

  # Register as user (with user API key)
  python register.py --gateway http://82.156.115.203:8080 \
      --api-key sk-xxx --name my-backend --url http://10.161.176.98:8000/v1

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
import os
import platform
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error


def collect_system_info() -> dict:
    """Collect hostname, OS, GPU info from the local machine."""
    info = {
        "hostname": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "arch": platform.machine(),
        "python": platform.python_version(),
        "gpus": [],
    }
    # Try rocm-smi (AMD)
    try:
        out = subprocess.check_output(
            ["rocm-smi", "--showproductname", "--showmeminfo", "vram", "--csv"],
            timeout=5, stderr=subprocess.DEVNULL
        ).decode()
        for line in out.strip().split("\n")[1:]:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                gpu = {"id": parts[0], "name": parts[1] if len(parts) > 1 else ""}
                # try to extract VRAM from additional columns
                for p in parts[2:]:
                    if p.isdigit():
                        gpu["vram_mb"] = int(p) // (1024 * 1024) if int(p) > 1_000_000 else int(p)
                info["gpus"].append(gpu)
    except Exception:
        pass
    # Try nvidia-smi (NVIDIA)
    if not info["gpus"]:
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode()
            for line in out.strip().split("\n"):
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 3:
                    info["gpus"].append({"id": parts[0], "name": parts[1], "vram_mb": int(parts[2])})
        except Exception:
            pass
    return info


def fetch_models(url: str) -> list[str]:
    """Auto-detect models from vLLM /v1/models endpoint."""
    try:
        req = urllib.request.Request(f"{url.rstrip('/')}/v1/models")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        print(f"Warning: failed to auto-detect models from {url}: {e}", file=sys.stderr)
        return []


def register(gateway: str, name: str, url: str, models: list[str],
             client_info: dict = None, owner: str = None, pricing: dict = None,
             model_map: dict = None, token: str = None, api_key: str = None) -> dict:
    body = {"name": name, "url": url, "models": models}
    headers = {"Content-Type": "application/json"}
    if token:
        body["token"] = token
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if client_info:
        body["client_info"] = client_info
    if owner is not None:
        body["owner"] = owner
    if pricing:
        body["pricing"] = pricing
    if model_map:
        body["model_map"] = model_map
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{gateway.rstrip('/')}/register",
        data=payload,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def unregister(gateway: str, name: str, token: str = None, api_key: str = None) -> dict:
    body = {"name": name}
    headers = {"Content-Type": "application/json"}
    if token:
        body["token"] = token
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{gateway.rstrip('/')}/unregister",
        data=payload,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def main():
    p = argparse.ArgumentParser(description="Register/unregister vLLM backend with LLM Gateway")
    p.add_argument("--gateway", required=True, help="Gateway URL, e.g. http://82.156.115.203:8080")
    p.add_argument("--token", default=None, help="Admin token for authentication")
    p.add_argument("--api-key", default=None, help="User API key for authentication (alternative to --token)")
    p.add_argument("--name", required=True, help="Backend name, e.g. halo4")
    p.add_argument("--url", help="vLLM backend URL, e.g. http://10.161.176.98:8000/v1")
    p.add_argument("--models", nargs="+", default=[], help="Model names (auto-detected if omitted)")
    p.add_argument("--owner", default=None, help="Owner username (omit for shared backend)")
    p.add_argument("--input-price", type=float, default=None, help="Input token price per million (e.g. 1.0)")
    p.add_argument("--output-price", type=float, default=None, help="Output token price per million (e.g. 3.0)")
    p.add_argument("--model-map", nargs="+", default=[], metavar="DISPLAY=API",
                   help="Model name mapping: display_name=api_name (e.g. Qwen3.5-35B-A3B=red-serving-api)")
    p.add_argument("--unregister", action="store_true", help="Unregister instead of register")
    p.add_argument("--heartbeat", type=int, default=0, help="Re-register every N seconds (0=once)")
    args = p.parse_args()

    if not args.token and not args.api_key:
        p.error("Either --token (admin) or --api-key (user) is required")

    if args.unregister:
        result = unregister(args.gateway, args.name, token=args.token, api_key=args.api_key)
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

    print("Collecting system info ...", file=sys.stderr)
    client_info = collect_system_info()
    print(f"  Host: {client_info['hostname']}  GPUs: {len(client_info['gpus'])}", file=sys.stderr)

    pricing = None
    if args.input_price is not None or args.output_price is not None:
        pricing = {
            "input": args.input_price if args.input_price is not None else 1.0,
            "output": args.output_price if args.output_price is not None else 3.0,
        }
        print(f"  Pricing: input={pricing['input']}/M  output={pricing['output']}/M", file=sys.stderr)

    model_map = None
    if args.model_map:
        model_map = {}
        for entry in args.model_map:
            if "=" not in entry:
                p.error(f"Invalid --model-map format: {entry}  (expected DISPLAY=API)")
            display, api = entry.split("=", 1)
            model_map[display] = api
        print(f"  Model map: {model_map}", file=sys.stderr)

    while True:
        try:
            result = register(args.gateway, args.name, args.url, models, client_info, args.owner, pricing, model_map, token=args.token, api_key=args.api_key)
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
