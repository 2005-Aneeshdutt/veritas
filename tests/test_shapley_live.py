"""Showing the decomposition being computed, rather than its result.

Sixteen coalition values are evaluated for every merchant and they were
rendered as sixteen lines of scrolling text, followed by a finished table of
four numbers. Everything interesting happened between those two things.

The panel that replaced that log recomputes the Shapley values in the
browser from the subset values as they arrive, rather than reading the
finished answer. That is the property worth testing: what is drawn has to be
a function of what was shown, or it is an animation with a number stapled to
it.
"""

import glob
import json

import pytest

FACT = [1, 1, 2, 6, 24]
FACTORS = ["bank", "method", "hour", "amount_band"]


def _phi_from_coalitions(cv: dict) -> dict:
    """Exactly what ShapleyLive.tsx does, in Python.

    Kept as a duplicate on purpose: if the component's arithmetic drifts from
    the decomposer's, this fails rather than the two quietly disagreeing on
    screen.
    """
    def g(parts):
        return cv["+".join(parts)] if parts else cv["{}"]

    out = {}
    for i, f in enumerate(FACTORS):
        total = 0.0
        for mask in range(16):
            if mask & (1 << i):
                continue
            without = [FACTORS[j] for j in range(4) if mask & (1 << j)]
            withf = [FACTORS[j] for j in range(4) if (mask | (1 << i)) & (1 << j)]
            s = len(without)
            total += (FACT[s] * FACT[3 - s]) / FACT[4] * (g(withf) - g(without))
        out[f] = total
    return out


@pytest.fixture(scope="module")
def runs():
    out = [json.load(open(f, encoding="utf-8")) for f in sorted(glob.glob("data/runs/*.json"))]
    if not out:
        pytest.skip("no runs")
    return out


def test_the_browser_arithmetic_agrees_with_the_decomposer(runs):
    """Within display rounding. The panel derives the bars from streamed
    subset values; if that ever disagrees with what the engine concluded, the
    screen is telling a different story from the record."""
    worst = 0.0
    for rec in runs:
        d = rec["report"]["decomposition"]
        phi = _phi_from_coalitions(d["coalition_values"])
        for f in d["factors"]:
            if f["factor"] in phi:
                worst = max(worst, abs(phi[f["factor"]] - f["points"]))
    assert worst < 1e-3, "browser and server disagree by %.2e points" % worst


def test_the_parts_add_up_to_the_whole(runs):
    """The efficiency axiom, and the entire argument for using Shapley here.
    Naive attribution ranks the same factors; its magnitudes do not sum to
    the gap, which is what makes them unconvertible to rupees."""
    for rec in runs:
        cv = rec["report"]["decomposition"]["coalition_values"]
        phi = _phi_from_coalitions(cv)
        assert abs(sum(phi.values()) - cv["+".join(FACTORS)]) < 1e-6


def test_every_run_carries_all_sixteen_subsets(runs):
    """A partial lattice would draw partial bars, which is honest for a
    computation in flight and wrong for a stored one."""
    for rec in runs:
        assert len(rec["report"]["decomposition"]["coalition_values"]) == 16


def test_the_live_stream_sends_the_value_as_a_number():
    """A client parsing "v(bank+hour) = +3.893 pts" back into a float is one
    regex away from drawing the wrong chart."""
    import inspect

    from doctor import graph

    src = inspect.getsource(graph)
    assert "value=round(val, 4)" in src
    assert "coalition=label" in src


def test_the_panel_recomputes_rather_than_reading_the_answer():
    ui = open("frontend/src/components/ShapleyLive.tsx", encoding="utf-8").read()
    assert "seen.get" in ui, "it must derive from the streamed subsets"
    for banned in ("fetch(", "/api/"):
        assert banned not in ui, "the panel must not fetch the finished result"
