"""Revenue Doctor — diagnosis engine.

Loads .env on import so a key pasted into that file just works, whether the
entry point is the CLI, an eval script, or uvicorn. Deliberately does NOT
override variables already present in the environment: an explicit
`OPENROUTER_API_KEY=... python ...` must win over a stale .env, or debugging
becomes guesswork.

No python-dotenv dependency for ~20 lines of parsing.
"""

from __future__ import annotations

import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path | None = None, override: bool = False) -> int:
    """Read KEY=VALUE lines from .env into os.environ. Returns how many were set."""
    p = path or (_ROOT / ".env")
    if not p.exists():
        return 0
    n = 0
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # An empty value is a placeholder the user has not filled in yet.
        # Setting it would mask a real key exported in the shell.
        if not key or not value:
            continue
        if override or key not in os.environ:
            os.environ[key] = value
            n += 1
    return n


load_dotenv()
