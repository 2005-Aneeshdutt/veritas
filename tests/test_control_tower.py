"""Control Tower: the queue, the states, and the boundary a UI cannot cross.

The tests that matter most here are the negative ones. Control Tower puts
approve buttons in front of a person for the first time in this product, and
the whole safety argument rests on two claims:

  * a DENY cannot become an ALLOW at any level of authority
  * approving runs the EXISTING execution path, so its idempotency and
    stopping rules are the ones already in force

Both are asserted against the server, not against the UI. A disabled button is
a courtesy; a refused request is a rule.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from chitragupta.ledger import Ledger
from doctor import control_tower as ct
from doctor.run import load_mandate

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "data" / "runs"
MERCHANT = "cloudsync"


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Reviews and events go to tmp; the committed runs are restored after.

    A test that leaves a human decision in the canonical run would change the
    demo and break the reconciliation suite, so the run files are snapshotted
    and put back.
    """
    monkeypatch.setattr(ct, "REVIEWS", tmp_path / "reviews")
    from doctor import events as ev

    store_dir = tmp_path / "events"
    store_dir.mkdir()
    monkeypatch.setattr(ev, "STORE", store_dir)
    monkeypatch.setattr(ev.store, "_path", lambda s: store_dir / ("%s.jsonl" % s))
    ev.store._memo = {}

    snapshot = {p: p.read_bytes() for p in RUNS.glob("run_*.json")}
    ct._CACHE.clear()
    yield
    for p, raw in snapshot.items():
        p.write_bytes(raw)
    ct._CACHE.clear()
    shutil.rmtree(tmp_path / "reviews", ignore_errors=True)


@pytest.fixture
def decisions():
    return ct.build_for(MERCHANT, load_mandate(MERCHANT))


@pytest.fixture
def by_state(decisions):
    out: dict[str, list] = {}
    for d in decisions:
        out.setdefault(d.state, []).append(d)
    return out


# -- 1. the queue is built from real state --------------------------------

def test_every_failed_payment_becomes_exactly_one_decision(decisions):
    raw = json.loads(
        (ROOT / "data" / "synthetic" / ("merchant_%s.json" % MERCHANT))
        .read_text(encoding="utf-8")
    )
    failures = [t for t in raw["transactions"] if not t["succeeded"]]
    assert len(decisions) == len(failures)
    assert len({d.decision_id for d in decisions}) == len(decisions)


def test_the_queue_is_deterministic():
    a = [d.decision_id for d in ct.build_for(MERCHANT, load_mandate(MERCHANT))]
    ct._CACHE.clear()
    b = [d.decision_id for d in ct.build_for(MERCHANT, load_mandate(MERCHANT))]
    assert a == b


def test_building_the_queue_writes_nothing():
    """Opening the page must not touch a single file.

    Asserts the property directly rather than inferring it from mtimes. The
    mtime version was correct and fragile: any other process touching the run
    files -- a browser audit doing a demo reset, say -- failed it for a reason
    that had nothing to do with the code under test. Forbidding the write is
    both stricter and immune to that.

    Patched and restored by hand rather than through monkeypatch, because
    monkeypatch undoes itself AFTER fixture teardown and the autouse fixture
    above restores the run snapshot -- so the guard was still armed when the
    restore tried to write, and the test errored in teardown having already
    passed.
    """
    real_text, real_bytes, real_open = (
        Path.write_text, Path.write_bytes, Path.open
    )

    def forbidden(*a, **k):
        raise AssertionError("build_queue wrote to disk")

    def guarded_open(self, mode="r", *a, **k):
        if any(c in mode for c in "wxa+"):
            forbidden()
        return real_open(self, mode, *a, **k)

    Path.write_text, Path.write_bytes, Path.open = (
        forbidden, forbidden, guarded_open
    )
    try:
        q = ct.build_queue(filt="all", limit=5)
    finally:
        Path.write_text, Path.write_bytes, Path.open = (
            real_text, real_bytes, real_open
        )
    assert q.total > 0


def test_no_field_is_invented_when_it_is_unavailable():
    """A missing measurement is None, never a plausible-looking default."""
    ev = ct._evidence(None, "some_code")
    assert ev.classifier_confidence is None
    assert ev.attribution_ratio is None
    assert ev.grade == "unavailable"
    assert ct._confidence(ev) is None


# -- 2. all five states, and what each means ------------------------------

def test_all_five_states_are_reachable_across_the_book():
    q = ct.build_queue(filt="all", limit=1)
    seen = set(q.counts_by_state)
    assert {"auto_allow", "hold", "deny", "escalate"} <= seen
    # human_review needs a merchant whose evidence is genuinely weak.
    assert ct.build_queue(merchant_id="techbazaar", filt="all", limit=1
                          ).counts_by_state.get("human_review", 0) > 0


def test_auto_allow_requires_both_permission_and_evidence(by_state):
    for d in by_state.get("auto_allow", []):
        assert d.policy_result == "allow"
        assert d.evidence.sufficient()
        assert d.human_review_required is False


def test_human_review_is_abstention_not_refusal():
    """The state that did not exist before: permitted, and still not justified.

    This is the feature. The mandate allows the action; the evidence does not
    support taking it unattended, so it goes to a person instead of being
    auto-executed with a confident-looking number on it.
    """
    ds = ct.build_for("techbazaar", load_mandate("techbazaar"))
    hr = [d for d in ds if d.state == "human_review"]
    assert hr, "expected at least one abstention on this merchant"
    for d in hr:
        assert d.policy_result in ("allow", "step_up"), "policy permitted it"
        assert not d.evidence.sufficient(), "and the evidence did not carry it"
        assert d.human_review_required is True
        assert d.evidence.gaps, "an abstention has to say what is missing"


def test_deny_names_the_rule_that_refused_it(by_state):
    for d in by_state.get("deny", []):
        assert "DENY_" in d.state_reason or d.policy_result == "deny"
        assert d.human_review_required is False


def test_hold_is_waiting_on_a_person_not_a_refusal(by_state):
    for d in by_state.get("hold", []):
        assert d.policy_result == "step_up" or d.state_reason.startswith("The issuer")


# -- 3. THE boundary: a DENY cannot be approved ---------------------------

def test_a_denied_decision_offers_only_escalation(by_state):
    denied = by_state.get("deny", [])
    assert denied, "expected at least one mandate-refused payment"
    for d in denied:
        assert d.permitted_human_actions == ["escalate"]
        assert d.override_blocked_reason
        assert "not available at any level of authority" in d.override_blocked_reason


def test_approving_a_denied_decision_is_refused_by_the_server(by_state):
    """The single most important test in this file.

    The UI disables the button. This asserts the server refuses the request
    anyway, because a client is not a security boundary.
    """
    d = by_state["deny"][0]
    with pytest.raises(ct.ReviewRefused):
        ct.review(
            MERCHANT, d.decision_id,
            human_decision="approve", reason_code="policy_exception",
        )


@pytest.mark.parametrize("action", ["approve", "hold", "deny"])
def test_no_action_but_escalate_is_accepted_on_a_deny(by_state, action):
    d = by_state["deny"][0]
    with pytest.raises(ct.ReviewRefused):
        ct.review(
            MERCHANT, d.decision_id,
            human_decision=action, reason_code="operational_issue",
        )


def test_escalating_a_denial_is_allowed_because_it_is_not_an_override(by_state):
    d = by_state["deny"][0]
    rv = ct.review(
        MERCHANT, d.decision_id,
        human_decision="escalate", reason_code="policy_exception",
    )
    assert rv.human_decision == "escalate"
    assert rv.policy_result == d.policy_result, "the kernel's verdict is unchanged"


# -- 4. an override needs a reason ----------------------------------------

def test_an_unknown_reason_code_is_rejected(by_state):
    d = by_state["hold"][0]
    with pytest.raises(ValueError):
        ct.review(MERCHANT, d.decision_id, human_decision="hold",
                  reason_code="because_i_said_so")


def test_other_without_an_explanation_is_rejected(by_state):
    """'other' with no note is not an auditable reason."""
    d = by_state["hold"][0]
    for note in ("", "   ", "\n"):
        with pytest.raises(ValueError):
            ct.review(MERCHANT, d.decision_id, human_decision="hold",
                      reason_code="other", note=note)


def test_other_with_an_explanation_is_accepted(by_state):
    d = by_state["hold"][0]
    rv = ct.review(MERCHANT, d.decision_id, human_decision="hold",
                   reason_code="other", note="merchant is mid-migration")
    assert rv.reason_code == "other"
    assert rv.note == "merchant is mid-migration"


# -- 5. the audit lands in the EXISTING chain -----------------------------

def test_a_human_decision_is_written_into_the_same_hash_chain(by_state):
    run = json.loads((RUNS / "run_beec9668.json").read_text(encoding="utf-8"))
    before = len(run["report"]["ledger"])

    d = by_state["hold"][0]
    rv = ct.review(MERCHANT, d.decision_id, human_decision="hold",
                   reason_code="insufficient_evidence", note="waiting")

    after_run = json.loads((RUNS / "run_beec9668.json").read_text(encoding="utf-8"))
    entries = after_run["report"]["ledger"]
    assert len(entries) == before + 1
    assert rv.ledger_entry_hash == entries[-1]["entry_hash"]
    assert Ledger.from_entries(entries).verify().ok, "the chain must still verify"


def test_the_override_reason_is_inside_the_hash(by_state):
    """No second audit system: the reason travels in a field already hashed."""
    d = by_state["hold"][0]
    ct.review(MERCHANT, d.decision_id, human_decision="escalate",
              reason_code="customer_context", note="chased by phone")

    entries = json.loads(
        (RUNS / "run_beec9668.json").read_text(encoding="utf-8")
    )["report"]["ledger"]
    last = entries[-1]
    reason = last["proposed_action"]["reason"]
    assert "control tower review" in reason
    assert "customer_context" in reason
    assert "chased by phone" in reason

    # And it is genuinely covered by the hash: change it, and the chain breaks.
    tampered = [dict(e) for e in entries]
    tampered[-1]["proposed_action"] = dict(
        tampered[-1]["proposed_action"], reason="something else entirely"
    )
    assert not Ledger.from_entries(tampered).verify().ok


def test_the_review_records_the_whole_chain_of_decision(by_state):
    d = by_state["hold"][0]
    rv = ct.review(MERCHANT, d.decision_id, human_decision="deny",
                   reason_code="merchant_exception")
    assert rv.ai_recommendation == d.recommended_action
    assert rv.policy_result == d.policy_result
    assert rv.human_decision == "deny"
    assert rv.final_decision == "deny"
    assert rv.actor == "platform"
    assert rv.at


def test_the_actor_is_recorded_and_must_be_a_real_one(by_state):
    d = by_state["hold"][0]
    rv = ct.review(MERCHANT, d.decision_id, human_decision="hold",
                   reason_code="operational_issue", actor="merchant")
    entries = json.loads(
        (RUNS / "run_beec9668.json").read_text(encoding="utf-8")
    )["report"]["ledger"]
    assert entries[-1]["actor"] == "merchant"
    assert rv.actor == "merchant"


# -- 6. approving uses the existing execution path ------------------------

def test_approving_executes_through_the_existing_recovery_path(by_state):
    d = next(
        x for x in by_state["auto_allow"] if x.recommended_action == "retry"
    )
    rv = ct.review(MERCHANT, d.decision_id, human_decision="approve",
                   reason_code="customer_context")
    assert rv.human_decision == "approve"
    # The existing path either executed or refused it; either way this module
    # did not invent a second retry implementation.
    assert rv.executed or rv.final_decision == "already_executed"


def test_approving_twice_does_not_act_twice(by_state):
    """The idempotency already in `events.record_action`, still in force."""
    d = next(
        x for x in by_state["auto_allow"] if x.recommended_action == "retry"
    )
    first = ct.review(MERCHANT, d.decision_id, human_decision="approve",
                      reason_code="customer_context")
    second = ct.review(MERCHANT, d.decision_id, human_decision="approve",
                       reason_code="customer_context")
    assert first.executed
    assert second.final_decision == "already_executed"
    assert second.executed is False


# -- 7. priority is explainable ------------------------------------------

def test_the_queue_is_sorted_by_priority(decisions):
    scores = [d.priority_score for d in decisions]
    assert scores == sorted(scores, reverse=True)


def test_every_prioritised_decision_says_why(decisions):
    for d in decisions[:30]:
        if d.priority in ("high", "medium"):
            assert d.priority_reasons, "%s has no explanation" % d.decision_id


def test_money_and_being_blocked_both_raise_priority():
    ev = ct.Evidence(grade="strong")
    small, _s, _ = ct._priority(50_000, ev, "auto_allow", 0, 1)
    big, _b, _ = ct._priority(2_500_000, ev, "human_review", 800_000, 2)
    assert ct._priority(2_500_000, ev, "human_review", 800_000, 2)[1] > \
        ct._priority(50_000, ev, "auto_allow", 0, 1)[1]
    assert big == "high"
    assert small in ("low", "medium")


def test_uncertainty_alone_raises_priority():
    strong = ct.Evidence(grade="strong")
    weak = ct.Evidence(grade="weak", gaps=["x"])
    assert ct._priority(500_000, weak, "hold", 0, 1)[1] > \
        ct._priority(500_000, strong, "hold", 0, 1)[1]


# -- 8. missing evidence is actionable, never guessed ---------------------

def test_a_weak_decision_offers_only_real_evidence_requests():
    ds = ct.build_for("techbazaar", load_mandate("techbazaar"))
    d = next(x for x in ds if x.state == "human_review")
    want = ct.evidence_requests_for(d)
    assert want
    for r in want:
        assert r["key"] in ct.EVIDENCE_ACTIONS
        assert r["how"] and r["route"]


def test_requesting_evidence_records_it_and_is_idempotent():
    ds = ct.build_for("techbazaar", load_mandate("techbazaar"))
    d = next(x for x in ds if x.state == "human_review")
    first = ct.request_evidence("techbazaar", d.decision_id, "attribution")
    assert first["already_open"] is False
    second = ct.request_evidence("techbazaar", d.decision_id, "attribution")
    assert second["already_open"] is True


def test_an_unknown_evidence_request_is_rejected():
    with pytest.raises(ValueError):
        ct.request_evidence(MERCHANT, "ct_pay_x", "summon_it_from_the_model")


def test_reevaluating_unchanged_data_gives_the_same_decision(by_state):
    d = by_state["hold"][0]
    again = ct.reevaluate(MERCHANT, d.decision_id)
    assert again.state == d.state
    assert again.policy_result == d.policy_result
    assert again.evidence.grade == d.evidence.grade


# -- 9. it never contradicts the kernel -----------------------------------

def test_control_tower_never_softens_a_policy_denial(decisions):
    for d in decisions:
        if d.policy_result == "deny":
            assert d.state == "deny"
            assert "approve" not in d.permitted_human_actions


def test_the_policy_result_is_the_kernels_own_verdict(decisions):
    """Not recomputed here -- the same call, with the same mandate."""
    from chitragupta.policy import GateContext, evaluate
    from chitragupta.types import ActionType, ProposedAction
    from datetime import datetime, timezone

    signed = load_mandate(MERCHANT)
    checked = 0
    for d in decisions:
        if d.recommended_action != "retry":
            continue
        gate = evaluate(
            ProposedAction(
                action_type=ActionType.RETRY_SOFT_DECLINE,
                txn_id=d.payment_id, amount_paise=d.revenue_at_stake_paise,
                target_bank=d.bank or None, reason="test",
            ),
            signed,
            GateContext(
                now=datetime.now(timezone.utc),
                attempts_by_txn={d.payment_id: d.prior_attempts},
            ),
        )
        assert d.policy_result == gate.decision.value
        assert d.policy_rule == gate.reason_code
        checked += 1
        if checked >= 25:
            break
    assert checked, "expected some retry recommendations to check"


# -- 10. the queue view ---------------------------------------------------

def test_filters_partition_sensibly():
    q = ct.build_queue(filt="all", limit=1)
    assert q.counts_by_filter["all"] == q.total
    assert q.counts_by_filter["urgent"] <= q.counts_by_filter["attention"]
    assert q.counts_by_filter["policy"] >= q.counts_by_state.get("hold", 0)


def test_the_three_populations_are_nested_and_add_up():
    """Evaluated >= not-eligible >= needs-a-person, and nothing is hidden.

    Conflating the middle and the last made the queue 1,623 items long, which
    is a database rather than a work queue. They are different questions and
    both answers are on screen.
    """
    q = ct.build_queue(filt="all", limit=1)
    assert q.total >= q.not_eligible_for_autonomous >= q.needing_attention
    # Not eligible is exactly "everything the system will not do alone".
    assert q.not_eligible_for_autonomous == q.total - q.counts_by_state.get(
        "auto_allow", 0
    )
    # And the queue's own filter agrees with the count.
    assert q.counts_by_filter["attention"] == q.needing_attention
    assert q.counts_by_filter["all"] == q.total


def test_an_auto_allow_is_never_in_the_attention_queue(decisions):
    for d in decisions:
        if d.state == "auto_allow":
            assert d.requires_attention is False
            assert d.not_actionable_reason


def test_a_failure_no_channel_converts_is_not_an_operator_task(decisions):
    """The distinction that shrank the queue without hiding anything.

    An expired card is blocked on the world, not on a person. It is correctly
    ineligible for automation AND correctly not anybody's task, and calling it
    an escalation put 764 non-tasks in front of an operator.
    """
    not_actionable = [
        d for d in decisions
        if not d.requires_attention and d.state != "auto_allow"
    ]
    assert not_actionable, "expected some ineligible-but-not-actionable items"
    for d in not_actionable:
        assert d.not_actionable_reason
        assert d.error_class not in ("soft_decline", "technical") or (
            "issuer" in d.not_actionable_reason
        )


def test_everything_a_person_is_blocked_on_is_still_in_the_queue(decisions):
    """The other half: nothing actionable was quietly dropped."""
    for d in decisions:
        if d.state in ("human_review", "hold", "deny"):
            if d.not_actionable_reason and "issuer" in d.not_actionable_reason:
                continue        # waiting on a clock, not a person
            assert d.requires_attention, d.decision_id


def test_the_full_population_is_still_reachable(decisions):
    """Shrinking the queue by hiding the rest would be the same dishonesty."""
    q = ct.build_queue(filt="all", limit=200)
    assert q.counts_by_filter["all"] == q.total
    assert q.counts_by_filter["all"] > q.counts_by_filter["attention"]


def test_the_queue_is_capped(decisions):
    q = ct.build_queue(filt="all", limit=7)
    assert len(q.decisions) == 7
    assert q.total > 7


def test_the_queue_carries_its_mode():
    q = ct.build_queue(filt="all", limit=1)
    assert q.mode in ("synthetic", "razorpay_test")
    assert q.mode_label in ("SYNTHETIC EVALUATION", "RAZORPAY TEST MODE")
