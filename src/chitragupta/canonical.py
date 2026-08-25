"""Canonical JSON serialisation and hashing.

Both the mandate signature and the ledger hash chain are only as trustworthy
as the byte string they are computed over. Two dicts that are equal as data
must produce identical bytes, or a signature verifies on one machine and fails
on another. So: sorted keys, no insignificant whitespace, UTF-8, and no
non-finite floats (JSON has no NaN, and Python's json module will happily emit
an unparseable `NaN` token if you let it).
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from pydantic import BaseModel


def _plain(obj: Any) -> Any:
    """Reduce pydantic models and enums to JSON-native structures."""
    if isinstance(obj, BaseModel):
        return _plain(obj.model_dump(mode="json"))
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    if isinstance(obj, float):
        if not math.isfinite(obj):
            raise ValueError("non-finite float %r cannot be canonicalised" % obj)
        return obj
    return obj


def canonical_json(obj: Any) -> bytes:
    """Deterministic UTF-8 bytes for any JSON-able object or pydantic model."""
    return json.dumps(
        _plain(obj),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_hex(obj: Any) -> str:
    """SHA-256 of the canonical encoding, as lowercase hex."""
    return hashlib.sha256(canonical_json(obj)).hexdigest()
