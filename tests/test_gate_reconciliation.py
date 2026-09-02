"""Gate counts after an approval: the ledger is current truth, not the snapshot.

THE DEFECT THESE TESTS PIN DOWN
-------------------------------
`report.gate.decisions` records what the gate decided AT DIAGNOSIS. The ledger
keeps growing after that -- every approval, every Control Tower review, every
executed recovery appends -- and no execution path updates the snapshot,
because the snapshot is a record of a moment rather than a running total.

`reconcile.py` used to assert the two were EQUAL. That held exactly until
somebody pressed Apply: one approval on run_beec9668 took step_up from 51 to
68 and Evidence began reporting a failed invariant on a run where nothing was
wrong. The money still partitioned. The chain still verified. The page whose
whole job is to be believable was crying wolf, which is worse than saying
nothing.

WHAT REPLACED IT, AND WHY IT IS NOT WEAKER
------------------------------------------
The counts reported as current are recomputed from the ledger. The snapshot is
held to the only thing actually true of it: the ledger is append-only, so a
decision recorded at diagnosis can never afterwards be ABSENT. Fewer entries
than the diagnosis recorded means entries were deleted -- which is the
corruption this file exists to catch, and `test_deleting_entries_is_still_caught`
proves the check still catches it.

Nothing about money, policy or the chain changed. Those are asserted unchanged
throughout.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from chitragupta.ledger import Ledger
from doctor.apply import apply_group
from doctor.reconcile import reconcile, reconcile_run_id
from doctor.run import load_mandate

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "data" / "runs"
RUN_ID = "run_beec9668"
MERCHANT = "cloudsync"
PATH = RUNS / (RUN_ID + ".json")


@pytest.fixture(autouse=True)
def _pristine():
    """Every test starts from the committed run and leaves it byte-identical."""
    raw = PATH.read_bytes()
    yield
    PATH.write_bytes(raw)


def _rec() -> dict:
    return json.loads(PATH.read_text(encoding="utf-8"))


def _approve(group_index: int, actor: str = "merchant"):
    return apply_group(RUN_ID, group_index, load_mandate(MERCHANT),
                       confirmed=True, actor=actor)


def _assert_invariants_hold(r, where: str):
    """The three properties an approval must never break."""
    bad = [(c.label, c.claimed, c.recomputed) for c in r.checks if not c.ok]
    assert r.ok, "%s: reconciliation failed: %s" % (where, bad)
    assert sum(b.paise for b in r.buckets) == r.at_risk_paise, \
        "%s: money partition does not close" % where
    assert sum(b.payments for b in r.buckets) == r.at_risk_payments, \
        "%s: payment partition does not close" % where
    assert r.chain_verified, "%s: hash chain broken" % where


# ── 1. the diagnosis snapshot, before anything is approved ───────────────

def test_a_fresh_run_has_snapshot_and_ledger_in_agreement():
    r = reconcile_run_id(RUN_ID)
    _assert_invariants_hold(r, "fresh run")
    for d in ("allow", "step_up", "deny"):
        assert r.gate_decisions_at_diagnosis.get(d, 0) ==             r.gate_decisions_now.get(d, 0), (
                "before any approval the two must agree on %s: %s vs %s"
                % (d, r.gate_decisions_at_diagnosis, r.gate_decisions_now))
    assert r.gate_decisions_at_diagnosis["allow"] > 0


def test_no_execution_leaves_everything_untouched():
    before = reconcile_run_id(RUN_ID)
    after = reconcile_run_id(RUN_ID)
    assert before.model_dump() == after.model_dump()
    assert PATH.read_bytes() == PATH.read_bytes()


# ── 2. one approval: the ledger grows, the invariants hold ───────────────

def test_an_approval_grows_the_ledger_without_breaking_reconciliation():
    """The exact scenario that used to report a false failure."""
    before = reconcile_run_id(RUN_ID)
    n_before = len(_rec()["report"]["ledger"])

    res = _approve(0)
    assert res.ledger_added > 0, "the approval appended nothing to audit"

    after = reconcile_run_id(RUN_ID)
    n_after = len(_rec()["report"]["ledger"])

    assert n_after > n_before, "the ledger did not grow"
    _assert_invariants_hold(after, "after one approval")

    # the snapshot is unchanged -- history is not rewritten
    assert after.gate_decisions_at_diagnosis == \
        before.gate_decisions_at_diagnosis
    # and current truth has moved past it
    assert sum(after.gate_decisions_now.values()) == n_after


def test_the_reported_current_counts_are_the_ledgers_own():
    _approve(0)
    rec = _rec()
    from collections import Counter

    ledger_says = Counter(e["gate_decision"] for e in rec["report"]["ledger"])
    r = reconcile(rec)
    assert r.gate_decisions_now == {k: v for k, v in ledger_says.items()}


def test_the_two_figures_are_reported_separately_and_never_conflated():
    _approve(0)
    r = reconcile_run_id(RUN_ID)
    assert r.gate_decisions_at_diagnosis != r.gate_decisions_now, (
        "this fixture should have diverged after an approval")
    # both are present, so a reader is never shown one and told it is the other
    assert r.gate_decisions_at_diagnosis and r.gate_decisions_now


# ── 3. more than one approval ────────────────────────────────────────────

def test_multiple_approvals_keep_the_invariants():
    _approve(0, actor="merchant")
    mid = reconcile_run_id(RUN_ID)
    _assert_invariants_hold(mid, "after first approval")

    _approve(1, actor="platform")
    end = reconcile_run_id(RUN_ID)
    _assert_invariants_hold(end, "after second approval")

    assert sum(end.gate_decisions_now.values()) > \
        sum(mid.gate_decisions_now.values()), "the second approval added nothing"
    assert end.gate_decisions_at_diagnosis == mid.gate_decisions_at_diagnosis


def test_a_duplicate_approval_neither_executes_nor_breaks_reconciliation():
    first = _approve(0)
    assert first.ledger_added > 0

    n_after_first = len(_rec()["report"]["ledger"])
    second = _approve(0)
    n_after_second = len(_rec()["report"]["ledger"])

    assert second.already_applied is True, "a group was applied twice"
    assert n_after_second == n_after_first, "a duplicate approval appended"
    _assert_invariants_hold(reconcile_run_id(RUN_ID), "after duplicate approval")


# ── 4. the outcomes that are not an execution ────────────────────────────

def test_a_run_with_denials_reconciles():
    """DENY entries exist on this run and must be counted, not skipped."""
    r = reconcile_run_id(RUN_ID)
    assert r.gate_decisions_now.get("deny", 0) > 0, "no denials to check"
    refused = next(b for b in r.buckets if b.key == "refused")
    assert refused.payments > 0
    _assert_invariants_hold(r, "run with denials")


def test_a_run_with_holds_reconciles():
    r = reconcile_run_id(RUN_ID)
    assert r.gate_decisions_now.get("step_up", 0) > 0, "no holds to check"
    held = next(b for b in r.buckets if b.key == "held")
    assert held.payments > 0
    _assert_invariants_hold(r, "run with holds")


def test_holds_released_by_an_approval_move_out_of_the_held_bucket():
    """Money must not be double-counted as the ledger grows."""
    before = reconcile_run_id(RUN_ID)
    held_before = next(b for b in before.buckets if b.key == "held").paise

    _approve(0)
    after = reconcile_run_id(RUN_ID)
    held_after = next(b for b in after.buckets if b.key == "held").paise

    assert held_after <= held_before, "held money grew after being released"
    _assert_invariants_hold(after, "after releasing holds")


# ── 5. the check is not weaker: real corruption is still caught ──────────

def test_deleting_entries_is_still_caught():
    """The whole point of relaxing equality to <=.

    The ledger is append-only, so the snapshot can never exceed it. If it
    does, entries were removed -- and that must still fail.
    """
    rec = _rec()
    assert reconcile(rec).ok

    step_ups = [e for e in rec["report"]["ledger"]
                if e["gate_decision"] == "step_up"]
    assert step_ups, "no step_up entries to remove"
    rec["report"]["ledger"] = [
        e for e in rec["report"]["ledger"] if e["gate_decision"] != "step_up"
    ]

    bad = reconcile(rec)
    assert not bad.ok, "deleting every step_up entry was not caught"
    failed = {c.key for c in bad.checks if not c.ok}
    assert "gate_step_up" in failed, (
        "the gate check did not catch the deletion: %s" % failed)


def test_an_entry_with_no_gate_decision_cannot_exist():
    """Two locks, and the outer one turns out to be the schema.

    `gate_total` was added as a check that every ledger entry carries a
    decision. Trying to build the violating case showed it is unreachable
    through `reconcile`: `LedgerEntry.gate_decision` is a PolicyDecision and
    `Ledger.from_entries` validates before anything is counted, so a null
    never gets that far.

    That is a better guarantee than the check, so this asserts the schema
    rather than a scenario that cannot occur. `gate_total` stays as cheap
    defence in depth for any future path that counts entries without loading
    them through the model.
    """
    from pydantic import ValidationError

    rec = _rec()
    assert reconcile(rec).ok

    broken = [dict(e) for e in rec["report"]["ledger"]]
    broken[0]["gate_decision"] = None
    with pytest.raises(ValidationError):
        Ledger.from_entries(broken)

    # and the counting logic would have caught it too, given the chance
    from collections import Counter

    current = Counter(e.get("gate_decision") for e in broken)
    decided = sum(n for k, n in current.items() if k)
    assert decided < len(broken), (
        "an undecided entry must not count toward the total")


def test_a_tampered_entry_still_breaks_the_chain():
    """Unchanged by this fix, asserted because it is load-bearing."""
    rec = _rec()
    assert reconcile(rec).chain_verified
    rec["report"]["ledger"][3]["outcome"] = "executed"
    assert not reconcile(rec).chain_verified


def test_a_corrupted_headline_is_still_caught():
    rec = _rec()
    rec["report"]["measured"]["ledger_entries"] = 999_999
    bad = reconcile(rec)
    assert not bad.ok
    assert any(c.key == "ledger_len" and not c.ok for c in bad.checks)


# ── 6. nothing financial moved ───────────────────────────────────────────

def test_the_fix_changed_no_money_and_no_policy():
    """Every figure the product reports is the same as before the change."""
    r = reconcile_run_id(RUN_ID)
    rec = _rec()

    rv = rec["report"]["measured"]["recovery_vs_truth"]
    recovered = next(b for b in r.buckets if b.key == "recovered")
    assert recovered.paise == rv["measured_paise"]

    # the diagnosis snapshot is untouched on disk
    assert rec["report"]["gate"]["decisions"] == \
        {"allow": 14, "step_up": 51, "deny": 16}

    # and the chain is the committed one
    assert Ledger.from_entries(rec["report"]["ledger"]).verify().ok


@pytest.mark.parametrize("run_id", sorted(p.stem for p in RUNS.glob("run_*.json")))
def test_every_committed_run_still_reconciles(run_id):
    r = reconcile_run_id(run_id)
    bad = [(c.label, c.claimed, c.recomputed) for c in r.checks if not c.ok]
    assert r.ok, "%s: %s" % (run_id, bad)
    # Absent and zero mean the same thing: run_cfcbe0d7 records `deny: 0`
    # while its ledger simply has no deny entries.
    for d in ("allow", "step_up", "deny"):
        assert r.gate_decisions_at_diagnosis.get(d, 0) ==             r.gate_decisions_now.get(d, 0), (
                "%s is committed unapproved, so %s must agree: %s vs %s"
                % (run_id, d, r.gate_decisions_at_diagnosis,
                   r.gate_decisions_now))
