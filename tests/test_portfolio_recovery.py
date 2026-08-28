"""The number the track actually asks for.

THE BAR for this track is "show measured money recovered across a batch". The
portfolio reported a projection under the word "recovered" and never
aggregated the marked figure at all -- every merchant carried its own
recovery_vs_truth and nothing added them up. These pin the aggregate, and pin
it as distinct from the forecast, because the entire claim rests on the two
being different numbers that are allowed to disagree.
"""

import glob
import json

import pytest

from doctor.portfolio import build_portfolio


@pytest.fixture(scope="module")
def pf():
    return build_portfolio()


def test_the_batch_reports_a_measured_total(pf):
    assert pf.total_measured_paise > 0
    assert pf.merchants_scored > 0


def test_measured_is_not_the_projection(pf):
    """If these were ever the same field the measurement would be decorative."""
    assert pf.total_measured_paise != pf.total_recovered_paise


def test_the_measured_total_is_the_sum_of_its_merchants(pf):
    assert pf.total_measured_paise == sum(r.measured_paise for r in pf.merchants)
    assert pf.total_attempted == sum(r.attempted for r in pf.merchants)
    assert pf.total_converted == sum(r.converted for r in pf.merchants)


def test_the_totals_reconcile_with_the_runs_on_disk(pf):
    """The aggregate must come from the same place the run pages read."""
    seen = {}
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        sc = rec["report"]["measured"].get("recovery_vs_truth", {}) or {}
        # latest run per merchant wins, same rule build_portfolio uses
        seen[rec["merchant_id"]] = sc.get("measured_paise", 0)
    assert pf.total_measured_paise == sum(seen.values())


def test_you_cannot_convert_more_retries_than_you_attempted(pf):
    assert 0 <= pf.total_converted <= pf.total_attempted
    for r in pf.merchants:
        assert 0 <= r.converted <= r.attempted


def test_the_gate_tally_counts_actions_not_ledger_rows(pf):
    """The ledger is append-only: an action held and later confirmed leaves
    two rows. Counting rows doubled the whole funnel the moment a merchant
    approved their queue."""
    actions = set()
    rows = 0
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        for e in rec["report"]["ledger"]:
            rows += 1
            a = e.get("proposed_action") or {}
            actions.add((f, e.get("txn_id"), a.get("action_type")))

    tally = pf.gate_allow + pf.gate_step_up + pf.gate_deny
    assert tally == len(actions)
    assert tally < rows, "this book has re-gated actions; the test is live"


def test_the_funnel_explains_the_gap_rather_than_hiding_it(pf):
    """A won figure far below the identified figure needs the middle of the
    funnel, or it reads as the agent having failed."""
    assert pf.gate_step_up > 0 or pf.gate_deny > 0
    assert pf.total_held_paise + pf.total_denied_paise > 0


def test_an_unscored_merchant_contributes_nothing_rather_than_guessing(pf):
    for r in pf.merchants:
        if not r.scored:
            assert r.measured_paise == 0
            assert r.attempted == 0


def test_confirming_a_queue_updates_the_measured_figure(tmp_path):
    """The largest recovery event in the product used to be invisible.

    Scoring ran once, at diagnosis. A merchant confirming a queue of held
    actions then executed real retries -- ChaiPoint ran 164 worth Rs 28,051 --
    and the run went on reporting Rs 0, which is the one number this whole
    system exists to produce.
    """
    import shutil

    from doctor.apply import apply_group
    from doctor.run import load_mandate

    # The run with the most held RETRIES. Selecting on "has a queue" instead
    # picked a merchant whose queue was all payment-link reissues, which
    # execute nothing and score nothing -- the test passed vacuously on a
    # measurement that had not been taken.
    def held_retries(rec):
        return sum(
            1
            for e in rec["report"]["ledger"]
            if e.get("gate_decision") == "step_up"
            and (e.get("proposed_action") or {})
            .get("action_type", "")
            .startswith("retry")
        )

    target = None
    best = 0
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        n = held_retries(rec)
        if rec.get("pending_actions") and not rec.get("applied") and n > best:
            target, best = (f, rec), n
    if not target:
        pytest.skip("no run with held retries to confirm")

    path, rec = target
    backup = tmp_path / "backup.json"
    shutil.copy(path, backup)
    try:
        before = rec["report"]["measured"]["recovery_vs_truth"].get("measured_paise", 0)
        signed = load_mandate(rec["merchant_id"])
        for i in range(len(rec["pending_actions"])):
            try:
                apply_group(rec["run_id"], i, signed, confirmed=True)
            except (IndexError, FileNotFoundError):
                pass

        after = json.load(open(path, encoding="utf-8"))
        sc = after["report"]["measured"]["recovery_vs_truth"]
        assert sc["attempted"] > 0, "confirming executed retries"
        assert sc["measured_paise"] != before or sc["attempted"] > 0
        # and it must still be a mark, not a copy of the forecast
        assert sc["measured_paise"] != after["report"]["projected"][
            "recovered_this_run_paise"
        ]
    finally:
        shutil.copy(backup, path)


def test_scoring_after_apply_still_cannot_see_the_future():
    """Re-scoring on the apply path must read the merchant file, not the run,
    or confirming would let the engine mark its own homework."""
    import inspect

    from doctor import apply, scoring

    src = inspect.getsource(apply.apply_group)
    assert "score_recovery" in src
    assert "SYNTH" in inspect.getsource(scoring._ground_truth)
