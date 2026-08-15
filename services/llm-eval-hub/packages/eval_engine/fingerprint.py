from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from typing import Any


def _normalize(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _normalize(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_normalize(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Fingerprint input cannot contain NaN or infinity")
        return value
    if value is None or isinstance(value, str | int | bool):
        return value
    raise TypeError(f"Unsupported fingerprint value: {type(value).__name__}")


def canonical_json(value: Any) -> str:
    return json.dumps(
        _normalize(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def protocol_fingerprint(value: Any) -> str:
    payload = value.as_dict() if hasattr(value, "as_dict") else value
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
