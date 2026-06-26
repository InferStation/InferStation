#!/usr/bin/env python3
"""GitHub Actions helper for the future InferStation daily bench.

Default mode is preview-only: it builds the representative daily unit list and
prints the request body. Dispatch mode is opt-in and requires access to the
running dispatcher URL from the runner.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[1]
UNITS_DIR = Path(os.environ.get("INFERSTATION_UNITS_DIR", ROOT / "admin_api" / "units"))
LEGACY_DAILY_SCRIPT = Path(os.environ.get("INFERSTATION_LEGACY_DAILY_SCRIPT", "/home/lkang/bin/inferstation-daily-bench.sh"))

REPRESENTATIVE_MODELS = {
    "Gemma-4-26B-A4B-it",
    "Qwen3.6-35B-A3B",
    "MiMo-V2.5",
    "Step-3.5-Flash",
}

ALLOWED_QUANTS = {
    "Gemma-4-26B-A4B-it": {"BF16", "Q8_0", "UD-Q4_K_M"},
    "Qwen3.6-35B-A3B": {"BF16", "Q8_0", "UD-Q4_K_M"},
    "MiMo-V2.5": {"UD-Q2_K_XL"},
    "Step-3.5-Flash": {"Q4_K_S"},
}

HOST_MAP = {
    "AMD Ryzen AI Max+ 395 (Strix Halo)": "halo6-shanghai",
    "NVIDIA RTX 4090": "4090",
    "AMD Radeon AI PRO R9700": "9700x8",
    "NVIDIA DGX Spark": "spark2-shanghai",
}

DEFAULT_REPRESENTATIVE_UNIT_IDS = [
    "223339e1dc",
    "0f74de7ebf",
    "33acee9370",
    "4db7e5a52f",
    "d71494ba88",
    "3bbd01053e",
    "44dc3d5888",
    "520312f017",
    "bb04014d99",
    "fbe6c3d46c",
    "be702df805",
    "8757aa0b73",
    "d4dc468b69",
    "2f7b3e218f",
    "faea9284ad",
    "ab6bbafa56",
    "cf8cc3b683",
    "bd51058fa8",
    "2866f5be23",
    "bbb17a156a",
    "6b50f83582",
    "508d11ae81",
    "b5a6e506c9",
    "69afa9edd3",
    "d9cab2e84a",
    "d11dc6024d",
    "a3bb54480c",
    "94265bb66b",
    "1a271cf80f",
    "d54c7c95e9",
    "983e644e94",
    "nv4090-gemma426ba4bit-bf16-vllm",
    "nv4090-gemma426ba4bit-bf16-vulkan",
    "nv4090-gemma426ba4bit-q80-vulkan",
    "nv4090-gemma426ba4bit-udq4km-vulkan",
    "nv4090-qwen3635ba3b-bf16-vllm",
    "nv4090-qwen3635ba3b-bf16-vulkan",
    "nv4090-qwen3635ba3b-q80-vulkan",
    "nv4090-qwen3635ba3b-udq4km-vulkan",
    "r9700-gemma426ba4bit-bf16-vllm",
    "r9700-gemma426ba4bit-bf16-vulkan",
    "r9700-gemma426ba4bit-q80-vulkan",
    "r9700-gemma426ba4bit-udq4km-vulkan",
    "r9700-qwen3635ba3b-bf16-vllm",
    "r9700-qwen3635ba3b-bf16-vulkan",
    "b643137087",
    "5c8e7281de",
    "b2b43d7074",
    "f32a8807c9",
    "667f346635",
    "242d4e0b0f",
    "a194f7976d",
    "51f7f1c9a8",
    "28d807f63c",
    "77ae50b925",
    "d22f86f121",
    "2ff92ac274",
    "14c0ca7705",
    "8e9b4b18f5",
    "3e7b9f1196",
    "8297207d99",
    "ab00c9d479"
]

BASE_SUFFIX_RULES = [
    (re.compile(r"-AWQ-4bit$"), ""),
    (re.compile(r"-AWQ-INT4$"), ""),
    (re.compile(r"-AWQ$"), ""),
    (re.compile(r"-CT\.w4a16$"), ""),
    (re.compile(r"-quantized\.w4a16$"), ""),
    (re.compile(r"\.w4a16$"), ""),
]


def base_model(model: str) -> str:
    out = model
    for pattern, repl in BASE_SUFFIX_RULES:
        out = pattern.sub(repl, out)
    return out


def unit_model(unit: dict) -> str:
    tags = unit.get("tags") or {}
    name = unit.get("name") or ""
    raw = tags.get("model_series") or name.split("@")[0].rsplit("-", 2)[0]
    return base_model(raw)


def unit_quant(unit: dict) -> str:
    return (unit.get("tags") or {}).get("quant") or ""


def list_units() -> list[tuple[str, dict]]:
    try:
        exists = UNITS_DIR.exists()
    except PermissionError:
        exists = False
    if not exists:
        raise SystemExit(f"units dir not found: {UNITS_DIR}")
    rows: list[tuple[str, dict]] = []
    for path in sorted(UNITS_DIR.glob("*.json")):
        with path.open(encoding="utf-8") as fh:
            rows.append((path.stem, json.load(fh)))
    return rows


def representative_unit_ids() -> list[str]:
    seed_ids: list[str] | None = None
    if LEGACY_DAILY_SCRIPT.exists():
        match = re.search(r"^UNIT_IDS='(\[.*?\])'", LEGACY_DAILY_SCRIPT.read_text(), re.S | re.M)
        if match:
            seed_ids = json.loads(match.group(1))

    if seed_ids is None:
        seed_ids = DEFAULT_REPRESENTATIVE_UNIT_IDS

    try:
        units_dir_exists = UNITS_DIR.exists()
    except PermissionError:
        units_dir_exists = False
    if not units_dir_exists:
        return list(seed_ids)

    units_by_id = dict(list_units())
    candidates = [(uid, units_by_id[uid]) for uid in seed_ids if uid in units_by_id]
    out: list[str] = []
    for uid, unit in candidates:
        model = unit_model(unit)
        if model not in REPRESENTATIVE_MODELS:
            continue
        if unit_quant(unit) not in ALLOWED_QUANTS[model]:
            continue
        out.append(uid)
    return out


def body(unit_ids: list[str], trigger: str) -> dict:
    return {"unit_ids": unit_ids, "host_map": HOST_MAP, "trigger": trigger}


def login(base_url: str, username: str, password: str) -> str:
    data = parse.urlencode({"username": username, "password": password}).encode()
    req = request.Request(f"{base_url}/admin/login", data=data, method="POST")
    opener = request.build_opener(request.HTTPRedirectHandler())
    try:
        resp = opener.open(req, timeout=30)
    except error.HTTPError as exc:
        resp = exc
    cookies = resp.headers.get_all("Set-Cookie", []) if resp.headers else []
    for cookie in cookies:
        if cookie.startswith("inferstation_admin_session="):
            return cookie.split(";", 1)[0].split("=", 1)[1]
    raise SystemExit("login did not return inferstation_admin_session")


def post_json(base_url: str, path: str, cookie: str, payload: dict) -> tuple[int, str]:
    data = json.dumps(payload).encode()
    req = request.Request(
        f"{base_url}{path}",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Cookie": f"inferstation_admin_session={cookie}"},
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except error.HTTPError as exc:
        return exc.code, exc.read().decode()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("preview", "dispatch"), default="preview")
    parser.add_argument("--trigger", default="nightly")
    parser.add_argument("--dispatcher-url", default=os.environ.get("INFERSTATION_DISPATCHER_URL", ""))
    parser.add_argument("--username", default=os.environ.get("INFERSTATION_ADMIN_USER", "admin"))
    parser.add_argument("--password", default=os.environ.get("INFERSTATION_ADMIN_PASS", "admin"))
    args = parser.parse_args()

    ids = representative_unit_ids()
    payload = body(ids, args.trigger)
    print(f"daily representative units: {len(ids)}")
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    if args.mode == "preview":
        return 0

    if not args.dispatcher_url:
        raise SystemExit("--dispatcher-url or INFERSTATION_DISPATCHER_URL is required for dispatch")
    cookie = login(args.dispatcher_url.rstrip("/"), args.username, args.password)
    status, text = post_json(args.dispatcher_url.rstrip("/"), "/admin/api/run", cookie, payload)
    print(f"dispatch status={status}")
    print(text)
    return 0 if status == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
