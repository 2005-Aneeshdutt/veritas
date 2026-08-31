"""What the model steps cost, and what the cache stops them costing again.

Every run in this demo reports zero rupees. A single "cost" line would let
that read as "the AI is free", which is the one reading that is definitely
wrong -- the answers were bought once and committed, and a platform running
this nightly would buy them every time.

So the property under test is not an amount. It is that spent and saved are
never allowed to become one number.
"""

import json

import pytest

from doctor.budget import Budget, build_budget, cache_ledger
from doctor.llm import PRICE_USD_PER_MTOK, USD_TO_INR, CallStats, LLMResult


@pytest.fixture(scope="module")
def b():
    return build_budget()


def _res(model="claude-sonnet-4.6", tin=1000, tout=500, cache=False, stub=False):
    return LLMResult(
        text="", parsed=None, model=model, prompt="", system="",
        tokens_in=tin, tokens_out=tout, cache_hit=cache, stub=stub,
    )


# ────────────────────────────────── spent and saved never merge

def test_a_cache_hit_spends_nothing_but_is_still_worth_something():
    s = CallStats()
    s.record(_res(cache=True))
    assert s.cost_inr == 0.0, "a cache hit costs nothing"
    assert s.cost_inr_saved > 0, "but it is not worth nothing"
    assert s.tokens_in == 0 and s.tokens_in_saved == 1000


def test_a_real_call_is_spent_not_saved():
    s = CallStats()
    s.record(_res(cache=False))
    assert s.cost_inr > 0
    assert s.cost_inr_saved == 0.0


def test_a_stub_costs_nothing_and_saves_nothing():
    """A stub is not an answer, so it cannot be credited as one."""
    s = CallStats()
    s.record(_res(stub=True))
    assert s.cost_inr == 0.0 and s.cost_inr_saved == 0.0


def test_tokens_total_counts_both_halves():
    s = CallStats()
    s.record(_res(cache=True))
    s.record(_res(cache=False))
    assert s.tokens_total == 3000


def test_the_two_figures_are_separate_fields_on_the_record():
    from doctor.trace import RunRecord

    f = RunRecord.model_fields
    assert "llm_cost_inr" in f and "llm_cost_inr_saved" in f
    assert "tokens_in" in f and "tokens_in_saved" in f


# ─────────────────────────────────────── the ledger is real

def test_the_cache_ledger_reads_the_committed_cache():
    calls, tin, tout, worth, rows = cache_ledger()
    assert calls > 0, "the repo ships a committed cache"
    assert tin > 0 and tout > 0
    assert worth > 0, "those tokens have a list price"
    assert sum(r.calls for r in rows) == calls


def test_the_ledger_prices_each_model_at_its_own_rate():
    _, _, _, _, rows = cache_ledger()
    for r in rows:
        p = PRICE_USD_PER_MTOK.get(r.model)
        if not p:
            continue
        expect = (
            (r.tokens_in * p["in"] + r.tokens_out * p["out"]) / 1_000_000
        ) * USD_TO_INR
        # The ledger reports rupees to the paise, so compare at that grid
        # rather than at float precision.
        assert r.cost_inr == pytest.approx(round(expect, 2), abs=0.005)


def test_a_cached_book_reports_zero_spent_and_says_why(b):
    assert b.run_spent_inr == 0.0
    assert b.ran_free is True
    assert b.run_saved_inr > 0, "zero spent must come with what was avoided"


def test_cost_per_merchant_is_billable_not_actual(b):
    """The figure a platform needs is what the SECOND merchant costs, not what
    this run happened to spend because someone had already paid."""
    assert b.cost_per_merchant_inr > 0, "a cached run must still price itself"
    assert b.cost_per_million_inr == pytest.approx(
        b.cost_per_merchant_inr * 1_000_000, rel=1e-6
    )


def test_the_runs_on_disk_carry_their_own_token_counts(b):
    import glob

    seen = 0
    for f in glob.glob("data/runs/*.json"):
        r = json.load(open(f, encoding="utf-8"))
        if r.get("used_stubs"):
            continue
        seen += 1
        total = (
            r.get("tokens_in", 0) + r.get("tokens_out", 0)
            + r.get("tokens_in_saved", 0) + r.get("tokens_out_saved", 0)
        )
        assert total > 0, "%s recorded no tokens" % r["merchant_id"]
    assert seen == b.runs


def test_the_budget_is_serialisable(b):
    Budget.model_validate_json(b.model_dump_json())


def test_the_readme_quotes_the_budget_this_code_produces(b):
    """These figures went stale within an hour of being written, because
    warming six answers into the cache changed all three of them and nothing
    complained. Numbers in prose rot silently; this makes them fail loudly.
    """
    import io

    readme = io.open("README.md", encoding="utf-8").read()
    tokens = format(b.cached_tokens_in + b.cached_tokens_out, ",d")
    for label, needle in (
        ("cached answers", "%d answers" % b.cached_calls),
        ("cache tokens", tokens),
        ("cache worth", "%.2f" % b.cache_worth_inr),
        ("cost per merchant", "%.2f per merchant" % b.cost_per_merchant_inr),
        ("book calls", "%d model" % b.run_calls),
        ("book tokens", format(b.run_tokens, ",d")),
        ("avoided", "%.2f" % b.run_saved_inr),
    ):
        assert needle in readme, "README is stale on %s (expected %r)" % (label, needle)
