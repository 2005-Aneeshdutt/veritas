"""Marking the agent's retries against what would truly have happened.

This is what turns "recovered Rs X (projected)" into a measurement. The
property that has to hold is that scoring happens AFTER the decision and from
a separate source -- if the engine could reach the counterfactual, the number
would be worthless.

The other thing pinned here is what counts. A denied action was never sent, so
counting it as either a success or a wasted attempt would misreport the agent.
"""

import json

import pytest

from doctor.scoring import RecoveryScore, score_recovery


def _rec(merchant_id, ledger, projected=0):
    return {
        "merchant_id": merchant_id,
        "report": {
            "ledger": ledger,
            "projected": {"recovered_this_run_paise": projected},
            "measured": {},
        },
    }


def _entry(txn_id, outcome="executed", amount=10_000, action="retry_soft_decline"):
    return {
        "txn_id": txn_id,
        "outcome": outcome,
        "proposed_action": {"action_type": action, "amount_paise": amount},
    }


@pytest.fixture(scope="module")
def real_run():
    """A real merchant, so the ground-truth lookup is exercised for real."""
    import glob

    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        if rec["report"]["measured"].get("ledger_entries", 0) > 20:
            return rec
    pytest.skip("no run with a substantial ledger")


def test_a_merchant_with_no_ground_truth_is_not_scored():
    s = score_recovery(_rec("not_a_merchant", [_entry("pay_1")]))
    assert s.scored is False
    assert s.measured_paise == 0
    assert "projected only" in s.detail


def test_a_run_with_no_retries_says_so():
    s = score_recovery(_rec("quickmart", []))
    assert s.scored is False
    assert "nothing to mark" in s.detail


def test_denied_actions_are_not_counted(real_run):
    """A denied action was never sent. Counting it either way misreports."""
    truth_ids = [
        e["txn_id"]
        for e in real_run["report"]["ledger"]
        if e.get("outcome") in ("executed", "exception")
    ]
    if not truth_ids:
        pytest.skip("this run executed nothing")

    denied = [
        _entry(t, outcome="denied") for t in truth_ids[:5]
    ]
    s = score_recovery(_rec(real_run["merchant_id"], denied))
    assert s.attempted == 0, "a denied action must not count as an attempt"


def test_non_retry_actions_are_not_counted(real_run):
    entries = [
        _entry("pay_x", action="flag_for_investigation"),
        _entry("pay_y", action="enable_multi_bank_routing"),
    ]
    s = score_recovery(_rec(real_run["merchant_id"], entries))
    assert s.attempted == 0


def test_a_real_run_scores_and_the_parts_add_up(real_run):
    s = score_recovery(real_run)
    if not s.scored:
        pytest.skip("this run executed no retries")
    assert s.attempted > 0
    assert 0 <= s.truly_converted <= s.attempted
    assert s.wasted_attempts == s.attempted - s.truly_converted
    assert s.measured_paise >= 0


def test_the_ratio_compares_projection_to_truth(real_run):
    s = score_recovery(real_run)
    if not s.scored or not s.measured_paise:
        pytest.skip("nothing to compare")
    assert s.ratio == pytest.approx(s.projected_paise / s.measured_paise, rel=1e-2)


def test_the_engine_never_receives_the_counterfactual():
    """The property the whole measurement rests on.

    run_diagnosis takes a profile and transactions. If the ground truth were
    reachable from inside it, the score would be self-marking.
    """
    import inspect

    from doctor.graph import run_diagnosis

    sig = inspect.signature(run_diagnosis)
    assert "ground_truth" not in sig.parameters
    assert "retry_conversions" not in sig.parameters

    from doctor.features import Transaction

    assert "retry_conversions" not in Transaction.model_fields


def test_scoring_reads_from_the_merchant_file_not_the_run():
    """Separate source, so the run cannot carry its own answer key."""
    import inspect

    from doctor import scoring

    src = inspect.getsource(scoring._ground_truth)
    assert "SYNTH" in src and "merchant_" in src


def test_the_detail_states_what_measured_means():
    """A merchant reading 'measured' must know it is against the generating
    distribution, not a live rail."""
    import glob

    for f in sorted(glob.glob("data/runs/*.json")):
        s = score_recovery(json.load(open(f, encoding="utf-8")))
        if s.scored:
            assert "generating distribution" in s.detail
            assert "not against a live rail" in s.detail
            return
    pytest.skip("no scored run available")
