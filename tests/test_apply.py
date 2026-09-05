"""Applying a fix that the kernel only partly authorises.

The interesting case is a group containing STEP_UP actions. Those are gated
but deliberately not sent: they wait for the merchant. The first version of
this code recorded the whole group as applied, so the confirmation that was
supposed to release them was refused as a duplicate and the payments were
stranded. These tests pin the behaviour that replaced it.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from chitragupta.mandate import Mandate, generate_keypair, sign_mandate
from chitragupta.types import ActionType
from doctor import apply as apply_mod
from doctor.apply import apply_group

# Under the auto-execute limit -> ALLOW; over it but under the ceiling -> STEP_UP.
SMALL_PAISE = 100_00
LARGE_PAISE = 2_000_00


@pytest.fixture
def signed():
    priv, pub = generate_keypair()
    m = Mandate(
        mandate_id="m1",
        merchant_id="testco",
        permitted_actions=[ActionType.RETRY_SOFT_DECLINE],
        max_amount_paise=5_000_00,
        auto_execute_limit_paise=500_00,
        max_attempts_per_payment=3,
        not_before="2026-01-01T00:00:00Z",
        not_after="2036-12-31T23:59:59Z",
        public_key_hex=pub,
    )
    return sign_mandate(m, priv)


def _action(i, paise):
    return {
        "action_type": "retry_soft_decline",
        "txn_id": "pay_%04d" % i,
        "amount_paise": paise,
        "target_bank": "HDFC Bank Ltd",
        "scheduled_time": None,
        "reason": "unretried soft decline",
        "requires_merchant_approval": False,
    }


@pytest.fixture
def run(tmp_path, monkeypatch):
    """A minimal stored run: two small actions and three large ones."""
    monkeypatch.setattr(apply_mod, "RUNS", tmp_path)
    recent = (datetime.now(timezone.utc) - timedelta(hours=36)).isoformat()
    actions = [_action(i, SMALL_PAISE) for i in range(2)]
    actions += [_action(i, LARGE_PAISE) for i in range(2, 5)]
    rec = {
        "run_id": "run_test",
        "merchant_id": "testco",
        "report": {
            "ledger": [],
            "measured": {"ledger_entries": 0, "chain_verified": True},
            "projected": {"recovered_this_run_paise": 0},
            "exceptions": {"unrecoverable_transactions": []},
        },
        "pending_actions": [
            {
                "group_id": "retry_soft_decline",
                "action_type": "retry_soft_decline",
                "title": "Retry 5 soft declines",
                "why": "recoverable and unretried",
                "count": len(actions),
                "total_paise": sum(a["amount_paise"] for a in actions),
                "auto": True,
                "actions": actions,
                "failed_at": recent,
            }
        ],
        "applied": [],
    }
    p = tmp_path / "run_test.json"
    p.write_text(json.dumps(rec), encoding="utf-8")
    return p


def _stored(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_unconfirmed_runs_the_allowed_and_holds_the_rest(run, signed):
    res = apply_group("run_test", 0, signed, confirmed=False)

    assert res.allowed == 2
    assert res.stepped_up == 3
    assert res.executed == 2, "a held step-up must not reach the rail"
    assert res.ledger_added == 5, "every gated action is still recorded"
    assert res.chain_verified

    held = _stored(run)["applied"][0]["awaiting_confirmation"]
    assert len(held) == 3
    assert set(held) == {"pay_0002", "pay_0003", "pay_0004"}


def test_confirming_releases_exactly_the_held_actions(run, signed):
    first = apply_group("run_test", 0, signed, confirmed=False)
    second = apply_group("run_test", 0, signed, confirmed=True)

    assert not second.already_applied, "the confirmation must not be refused"
    assert second.ledger_added == first.stepped_up == 3
    assert second.executed == 3
    assert second.chain_verified

    rec = _stored(run)
    assert len(rec["report"]["ledger"]) == 8
    assert all(not a["awaiting_confirmation"] for a in rec["applied"])


def test_confirming_does_not_rerun_what_already_executed(run, signed):
    apply_group("run_test", 0, signed, confirmed=False)
    second = apply_group("run_test", 0, signed, confirmed=True)

    touched = {e.txn_id for e in _ledger(run)[5:]}
    assert touched == {"pay_0002", "pay_0003", "pay_0004"}
    assert "pay_0000" not in touched, "an executed action must not be gated twice"
    assert second.allowed == 0


def test_a_held_action_does_not_consume_an_attempt(run, signed):
    """The cap counts attempts that reached the rail, not ones we held."""
    apply_group("run_test", 0, signed, confirmed=False)
    rec = _stored(run)
    assert rec["applied"][0]["executed_ids"] == ["pay_0000", "pay_0001"]

    second = apply_group("run_test", 0, signed, confirmed=True)
    # If holding had burnt an attempt, these would arrive with attempt=2.
    assert second.denied == 0
    assert second.executed == 3


def test_reapplying_with_nothing_outstanding_is_refused(run, signed):
    apply_group("run_test", 0, signed, confirmed=False)
    apply_group("run_test", 0, signed, confirmed=True)
    third = apply_group("run_test", 0, signed, confirmed=True)

    assert third.already_applied
    assert third.ledger_added == 0
    assert len(_stored(run)["report"]["ledger"]) == 8


def test_refusal_still_reports_what_is_waiting(run, signed):
    """An unconfirmed re-apply is refused, but says how many need approval."""
    apply_group("run_test", 0, signed, confirmed=False)
    again = apply_group("run_test", 0, signed, confirmed=False)

    assert again.already_applied
    assert again.stepped_up == 3, "the UI needs this to offer the confirmation"


def test_unknown_group_index_raises(run, signed):
    with pytest.raises(IndexError):
        apply_group("run_test", 7, signed)


def _ledger(path):
    from chitragupta.ledger import LedgerEntry

    return [
        LedgerEntry.model_validate(e)
        for e in _stored(path)["report"]["ledger"]
    ]


def test_applying_a_group_does_not_rerun_what_diagnosis_already_settled(tmp_path):
    """`pending_actions` groups the WHOLE plan, including the actions the
    diagnosis itself executed.

    Without a filter, a first apply re-ran them: 396 of the 1,057 actions on
    this book were settled at diagnosis and were retried a second time the
    moment anyone approved a group. That inflated the recovered figure by the
    whole of the auto-executed run, and spent a real attempt against the
    mandate's per-payment cap on a payment nobody had asked about again.
    """
    import glob
    import json
    import shutil
    from collections import Counter

    from doctor.apply import apply_group
    from doctor.run import load_mandate

    def double_run(rec):
        c = Counter()
        for e in rec["report"]["ledger"]:
            if e.get("outcome") not in ("executed", "exception"):
                continue
            a = e.get("proposed_action") or {}
            if a.get("action_type") != "retry_soft_decline":
                continue
            c[e["txn_id"]] += 1
        return {k: v for k, v in c.items() if v > 1}

    target = None
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        executed = sum(
            1 for e in rec["report"]["ledger"] if e.get("outcome") == "executed"
        )
        if rec.get("pending_actions") and executed > 5 and not rec.get("applied"):
            target = (f, rec)
            break
    if not target:
        pytest.skip("no run with auto-executed actions and a queue")

    path, rec = target
    backup = tmp_path / "b.json"
    shutil.copy(path, backup)
    try:
        assert not double_run(rec), "fixture must start clean"
        signed = load_mandate(rec["merchant_id"])
        for i in range(len(rec["pending_actions"])):
            try:
                apply_group(rec["run_id"], i, signed, confirmed=True)
            except (IndexError, FileNotFoundError, ValueError):
                pass

        after = json.load(open(path, encoding="utf-8"))
        dup = double_run(after)
        assert not dup, "%d payments were retried twice: %s" % (
            len(dup),
            list(dup)[:3],
        )
    finally:
        shutil.copy(backup, path)


def test_a_group_with_nothing_left_reports_rather_than_raising(tmp_path):
    """Confirming a fully settled group must not blow up a book-wide approve."""
    import glob
    import json
    import shutil

    from doctor.apply import apply_group
    from doctor.run import load_mandate

    files = sorted(glob.glob("data/runs/*.json"))
    if not files:
        pytest.skip("no runs")
    path = files[0]
    rec = json.load(open(path, encoding="utf-8"))
    if not rec.get("pending_actions"):
        pytest.skip("no groups")

    backup = tmp_path / "b.json"
    shutil.copy(path, backup)
    try:
        signed = load_mandate(rec["merchant_id"])
        for i in range(len(rec["pending_actions"])):
            try:
                apply_group(rec["run_id"], i, signed, confirmed=True)
            except (IndexError, ValueError):
                pass
        # second pass: everything is settled now
        for i in range(len(rec["pending_actions"])):
            try:
                res = apply_group(rec["run_id"], i, signed, confirmed=True)
                assert res.already_applied or not res.ok
            except IndexError:
                pass  # the resume path raises this by design
    finally:
        shutil.copy(backup, path)


def test_the_result_carries_every_action_it_gated():
    """The walkthrough showed six rules and a count -- "17 need your
    confirmation" -- which asks a reader to take the per-action gating on
    trust. Gating each payment separately against a signed mandate is the
    work; a summary of it is not the same as seeing it."""
    import glob
    import json
    import shutil
    import tempfile
    import os

    from doctor.apply import apply_group
    from doctor.run import load_mandate

    target = None
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        if rec.get("pending_actions") and not rec.get("applied"):
            target = (f, rec)
            break
    if not target:
        pytest.skip("no unapplied queue")

    path, rec = target
    bak = tempfile.mktemp()
    shutil.copy(path, bak)
    try:
        res = apply_group(rec["run_id"], 0, load_mandate(rec["merchant_id"]))
        assert res.actions, "no per-action detail returned"
        assert len(res.actions) == res.allowed + res.stepped_up + res.denied
        for a in res.actions:
            assert a.txn_id and a.reason and a.decision
            assert a.amount_paise >= 0
    finally:
        shutil.copy(bak, path)
        os.remove(bak)


def test_one_payment_can_be_decided_on_its_own(tmp_path):
    """"Confirm all 58" was the only control, which is an all-or-nothing
    choice about other people's money."""
    import glob
    import json
    import shutil

    from doctor.apply import apply_group
    from doctor.run import load_mandate

    target = None
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        if rec.get("pending_actions") and not rec.get("applied"):
            target = (f, rec)
            break
    if not target:
        pytest.skip("no unapplied queue")

    path, rec = target
    bak = tmp_path / "b.json"
    shutil.copy(path, bak)
    try:
        # A payment that is genuinely still waiting. Picking the first one
        # blindly lands on something the diagnosis already settled, which the
        # filter correctly refuses to touch a second time.
        final = {}
        for e in rec["report"]["ledger"]:
            pa = e.get("proposed_action") or {}
            final[(e["txn_id"], pa.get("action_type"))] = e
        waiting = {
            k[0] for k, e in final.items() if e.get("outcome") == "merchant_action"
        }
        idx, one = next(
            (
                (i, a["txn_id"])
                for i, g in enumerate(rec["pending_actions"])
                for a in g["actions"]
                if a["txn_id"] in waiting
            ),
            (None, None),
        )
        if one is None:
            pytest.skip("nothing waiting on this run")

        res = apply_group(
            rec["run_id"], idx, load_mandate(rec["merchant_id"]),
            confirmed=True, only_txns={one},
        )
        assert len(res.actions) == 1, "exactly one payment should be decided"
        assert res.actions[0].txn_id == one
    finally:
        shutil.copy(bak, path)


def test_deciding_one_uses_the_same_gate_as_deciding_fifty():
    """One payment and fifty must be decided by identical rules, and the
    surest way to guarantee that is one place where deciding happens."""
    import inspect

    from doctor import api

    src = inspect.getsource(api.decide_one_action)
    assert "apply_group" in src
    assert "only_txns" in src
