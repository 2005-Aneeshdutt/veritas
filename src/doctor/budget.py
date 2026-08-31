"""What the model steps cost, and what the cache stops them costing again.

Two questions sit behind this, and only one of them is about a demo.

The demo question is why every run here reports zero rupees. It is not that
the model steps are free -- they were paid for once and committed, and a page
that showed a bare zero would be quietly claiming otherwise.

The real question is the one a payments platform asks before deploying
anything with a model in it: what does this cost per merchant, and what does
that become across a book of a million? That number is only meaningful if it
is the *billable* cost -- what the tokens would cost at list price -- not what
this particular run happened to spend because someone else had already
bought the answer.

So spent and saved are kept apart everywhere in here and never netted. A
single figure would let a cached run read as free, which is the one reading
that is definitely wrong.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from .llm import PRICE_USD_PER_MTOK, USD_TO_INR

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "llm_cache"
RUNS = ROOT / "data" / "runs"


class ModelUse(BaseModel):
    model: str
    calls: int
    tokens_in: int
    tokens_out: int
    cost_inr: float


class Budget(BaseModel):
    #: Every answer that has been bought once and committed.
    cached_calls: int
    cached_tokens_in: int
    cached_tokens_out: int
    #: What buying them again would cost at list price.
    cache_worth_inr: float
    by_model: list[ModelUse]

    #: Across the runs currently on disk.
    runs: int
    run_calls: int
    run_tokens: int
    run_spent_inr: float
    run_saved_inr: float
    cache_hit_rate: float

    #: The figure a platform actually needs.
    cost_per_merchant_inr: float
    cost_per_million_inr: float

    #: True when this book ran without buying a single token.
    ran_free: bool


def _price(model: str, tin: int, tout: int) -> float:
    p = PRICE_USD_PER_MTOK.get(model)
    if not p:
        return 0.0
    return (tin * p["in"] + tout * p["out"]) / 1_000_000 * USD_TO_INR


def cache_ledger() -> tuple[int, int, int, float, list[ModelUse]]:
    """Read the committed cache and price it.

    Every entry is one model answer somebody paid for, with the token counts
    the provider reported. Summing them says what this repository would cost
    to reproduce from an empty cache — which is the honest answer to "how
    much did the AI in this cost".
    """
    agg: dict[str, list[int]] = {}
    if CACHE.exists():
        for f in CACHE.glob("*.json"):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            a = agg.setdefault(d.get("model", "unknown"), [0, 0, 0])
            a[0] += 1
            a[1] += int(d.get("tokens_in") or 0)
            a[2] += int(d.get("tokens_out") or 0)

    rows = [
        ModelUse(
            model=m,
            calls=c,
            tokens_in=i,
            tokens_out=o,
            cost_inr=round(_price(m, i, o), 2),
        )
        for m, (c, i, o) in sorted(agg.items(), key=lambda kv: -kv[1][0])
    ]
    return (
        sum(r.calls for r in rows),
        sum(r.tokens_in for r in rows),
        sum(r.tokens_out for r in rows),
        round(sum(r.cost_inr for r in rows), 2),
        rows,
    )


def build_budget() -> Budget:
    calls, tin, tout, worth, rows = cache_ledger()

    runs = 0
    rc = rt = 0
    spent = saved = 0.0
    hits = 0.0
    for p in RUNS.glob("run_*.json"):
        try:
            r = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if r.get("used_stubs"):
            continue
        runs += 1
        rc += r.get("llm_calls", 0)
        rt += (
            r.get("tokens_in", 0)
            + r.get("tokens_out", 0)
            + r.get("tokens_in_saved", 0)
            + r.get("tokens_out_saved", 0)
        )
        spent += r.get("llm_cost_inr", 0.0)
        saved += r.get("llm_cost_inr_saved", 0.0)
        hits += r.get("cache_hit_rate", 0.0)

    # Per merchant, priced as if nothing were cached -- which is what it
    # costs the second merchant, and the millionth.
    billable = spent + saved
    per_merchant = billable / runs if runs else 0.0

    return Budget(
        cached_calls=calls,
        cached_tokens_in=tin,
        cached_tokens_out=tout,
        cache_worth_inr=worth,
        by_model=rows,
        runs=runs,
        run_calls=rc,
        run_tokens=rt,
        run_spent_inr=round(spent, 4),
        run_saved_inr=round(saved, 4),
        cache_hit_rate=round(hits / runs, 4) if runs else 0.0,
        cost_per_merchant_inr=round(per_merchant, 4),
        cost_per_million_inr=round(per_merchant * 1_000_000, 2),
        ran_free=spent == 0.0 and rc > 0,
    )
