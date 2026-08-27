"""The toolset the diagnosing agent may call.

Four properties make this safe rather than open-ended, and all four are
enforced in code rather than requested in a prompt. If any of them can be
talked around, the loop stops being bounded.

The tool bugs pinned here were both real and both silent, which is the
dangerous kind: `factor_breakdown("hour")` compared a raw hour against the
decomposition's bands, matched nothing, and returned an empty breakdown as a
SUCCESS -- so the model read "no evidence here" when the truth was "you asked
wrong".
"""

import pytest

from doctor.baseline import Baseline
from doctor.run import load_merchant
from doctor.tools import MAX_CALLS, TOOLS, ToolContext, call, describe_tools


@pytest.fixture(scope="module")
def ctx():
    from doctor.cohort import build_cohort
    from doctor.shapley import ShapleyDecomposer, merchant_marginals

    b = Baseline()
    m = load_merchant("cloudsync")
    cohort = build_cohort(m.profile.mcc, b)
    dec = ShapleyDecomposer(b, cohort).decompose(m.transactions)
    return ToolContext(
        marginals=merchant_marginals(m.transactions),
        decomposition=dec,
        baseline=b,
        transactions=list(m.transactions),
    )


# ───────────────────────────────────────────────────────── containment

def test_a_tool_outside_the_registry_is_refused(ctx):
    got = call(ctx, "delete_everything", {})
    assert got.ok is False
    assert "no such tool" in got.error


def test_the_refusal_names_what_is_available(ctx):
    """A model that cannot see the menu guesses, and guessing burns budget."""
    got = call(ctx, "nonsense", {})
    for name in TOOLS:
        assert name in got.error


def test_a_missing_argument_is_refused_not_defaulted(ctx):
    got = call(ctx, "failure_examples", {"factor": "bank"})
    assert got.ok is False
    assert "value" in got.error


def test_a_tool_that_raises_does_not_take_the_run_down(ctx):
    bad = ToolContext(
        marginals={"bank": {"x": 1.0}},
        decomposition=ctx.decomposition,
        baseline=ctx.baseline,
        transactions=[object()],  # no .factor_value, no .succeeded
    )
    got = call(bad, "factor_breakdown", {"factor": "bank"})
    assert got.ok is False
    assert got.error


def test_every_registered_tool_is_read_only():
    """Nothing here may write, send, retry or spend. State changes go through
    the policy kernel, which never consults a model."""
    import inspect

    banned = ("write_text", "open(", "requests.", "urlopen", "execute", "send(")
    for name, spec in TOOLS.items():
        src = inspect.getsource(spec["fn"])
        for b in banned:
            assert b not in src, "%s touches %s" % (name, b)


def test_the_budget_is_small_enough_to_terminate():
    assert 1 <= MAX_CALLS <= 10


# ─────────────────────────────────────────────────────── honest answers

def test_a_factor_breakdown_uses_the_decompositions_own_terms(ctx):
    """The silent bug. `hour` is an int on the transaction and a band in the
    decomposition; comparing the raw attribute matched nothing and reported
    the empty result as a success."""
    got = call(ctx, "factor_breakdown", {"factor": "hour"})
    assert got.ok is True
    assert got.result["breakdown"], "hour must not come back empty"
    values = {r["value"] for r in got.result["breakdown"]}
    assert values & {"night", "morning", "afternoon", "evening"}


def test_an_empty_breakdown_is_an_error_not_a_success(ctx):
    got = call(ctx, "factor_breakdown", {"factor": "not_a_factor"})
    assert got.ok is False


def test_a_wrong_value_says_which_values_exist(ctx):
    """Otherwise the model reads 'no rows' as 'this factor is clean'."""
    got = call(ctx, "failure_examples", {"factor": "hour", "value": "peak_fail"})
    assert got.ok is False
    assert got.result.get("values_that_exist")
    assert "not that the factor is clean" in got.result["note"]


def test_a_hallucinated_bank_comes_back_with_the_real_ones(ctx):
    got = call(ctx, "bank_vs_npci", {"bank": "Definitely Not A Bank Ltd"})
    assert got.ok is False
    assert got.result.get("banks_they_do_use")


def test_attribution_is_returned_beside_its_own_error(ctx):
    got = call(ctx, "attribution_with_error", {"factor": "hour"})
    assert got.ok is True
    assert "measured_error_pts" in got.result
    assert "reading" in got.result


def test_process_gap_is_explained_rather_than_silently_missing(ctx):
    """It is computed directly, not decomposed, so it has no Shapley value."""
    got = call(ctx, "attribution_with_error", {"factor": "process_gap"})
    assert got.ok is False
    assert "not decomposed" in got.result["note"]


# ──────────────────────────────────────────────────────────── budget

def test_a_repeated_call_does_not_spend_the_budget_twice(ctx):
    first = call(ctx, "factor_breakdown", {"factor": "bank"})
    second = call(ctx, "factor_breakdown", {"factor": "bank"}, already=[first])
    assert second.ok is False, "a repeat did no new work and must say so"
    assert "already asked" in second.error
    assert second.result == first.result


def test_a_different_argument_is_not_treated_as_a_repeat(ctx):
    first = call(ctx, "factor_breakdown", {"factor": "bank"})
    second = call(ctx, "factor_breakdown", {"factor": "method"}, already=[first])
    assert second.ok is True


def test_the_prompt_description_covers_every_tool():
    described = describe_tools()
    for name, spec in TOOLS.items():
        assert name in described
        for arg in spec["args"]:
            assert arg in described
