"""Every aggregate the UI shows has to close against the records under it.

These are the tests that stop the dashboard drifting away from the ledger.
They are deliberately unforgiving: a bucket that double-counts a payment, a
gate total that no longer matches the entries it was derived from, or a
measured recovery figure that cannot be recomputed from the ledger is a
failure, not a rounding difference.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from doctor.reconcile import drilldown, reconcile, reconcile_run_id

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "data" / "runs"

RUN_IDS = sorted(p.stem for p in RUNS.glob("run_*.json"))
CANONICAL = "run_beec9668"


def _rec(run_id: str) -> dict:
    return json.loads((RUNS / (run_id + ".json")).read_text(encoding="utf-8"))


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_every_committed_run_reconciles(run_id):
    """The invariant, on every run on the book. Fails loudly and by name."""
    r = reconcile_run_id(run_id)
    broken = [
        "%s: claims %s, recomputes to %s" % (c.label, c.claimed, c.recomputed)
        for c in r.checks
        if not c.ok
    ]
    assert not broken, "%s does not reconcile:\n  %s" % (run_id, "\n  ".join(broken))


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_the_money_partition_closes(run_id):
    """at risk = recovered + attempted + held + refused + escalated + untouched."""
    r = reconcile_run_id(run_id)
    assert sum(b.paise for b in r.buckets) == r.at_risk_paise
    assert sum(b.payments for b in r.buckets) == r.at_risk_payments


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_no_payment_lands_in_two_buckets(run_id):
    """The partition is over payments, so the drilldowns must be disjoint."""
    rec = _rec(run_id)
    seen: dict[str, str] = {}
    for b in ("recovered", "attempted", "held", "refused", "escalated", "untouched"):
        for row in drilldown(rec, b):
            tid = row["txn_id"]
            assert tid not in seen, "%s is in both %s and %s" % (tid, seen[tid], b)
            seen[tid] = b


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_each_bucket_drilldown_matches_its_own_total(run_id):
    """Click the number, get exactly the rows that make it."""
    rec = _rec(run_id)
    r = reconcile(rec)
    for b in r.buckets:
        rows = drilldown(rec, b.key)
        assert len(rows) == b.payments, "%s: %d rows for %d payments" % (
            b.key, len(rows), b.payments
        )
        assert sum(x["amount_paise"] for x in rows) == b.paise


def test_recovered_rows_carry_the_audit_entry_that_recorded_them():
    """The chain AGGREGATE -> PAYMENT -> DECISION -> POLICY -> OUTCOME -> AUDIT."""
    rows = drilldown(_rec(CANONICAL), "recovered")
    assert rows
    for r in rows:
        assert r["txn_id"]
        assert r["action_type"] == "retry_soft_decline"
        assert r["gate_decision"] == "allow"
        assert r["gate_reason"]
        assert r["outcome"] in ("executed", "exception")
        assert r["entry_hash"] and len(r["entry_hash"]) == 64
        assert r["sequence"] is not None
        assert r["converted"] is True


def test_refused_rows_name_the_rule_that_refused_them():
    rows = drilldown(_rec(CANONICAL), "refused")
    assert rows
    assert all(r["gate_decision"] == "deny" for r in rows)
    assert all(str(r["gate_reason"]).startswith("DENY_") for r in rows)


def test_untouched_rows_have_no_action_and_no_audit_entry():
    """The honest bucket: failures nothing was proposed for."""
    rows = drilldown(_rec(CANONICAL), "untouched")
    assert rows
    for r in rows:
        assert r["action_type"] is None
        assert r["entry_hash"] is None
        assert r["gate_reason"] == "NO_ACTION_PROPOSED"


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_reconciliation_fails_loudly_when_a_total_is_wrong(run_id):
    """The check has to be capable of failing, or it proves nothing.

    A headline is corrupted in memory and the reconciliation must catch it.
    Nothing is written; the run file on disk is untouched.
    """
    rec = _rec(run_id)
    assert reconcile(rec).ok
    rec["report"]["measured"]["ledger_entries"] = 999_999
    bad = reconcile(rec)
    assert not bad.ok
    assert any(c.key == "ledger_len" and not c.ok for c in bad.checks)


def test_a_tampered_ledger_entry_breaks_the_chain_check():
    """Reconciliation is downstream of the hash chain, and says so."""
    rec = _rec(CANONICAL)
    assert reconcile(rec).chain_verified
    rec["report"]["ledger"][3]["outcome"] = "executed"
    assert not reconcile(rec).chain_verified


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_gate_totals_come_from_the_ledger(run_id):
    """The counts on the report are a view of the entries, not a parallel tally."""
    r = reconcile_run_id(run_id)
    for key in ("gate_allow", "gate_step_up", "gate_deny"):
        c = next(x for x in r.checks if x.key == key)
        assert c.ok and c.claimed == c.recomputed
