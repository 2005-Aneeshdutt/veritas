from datetime import datetime, timedelta, timezone

import pytest

from chitragupta.mandate import Mandate, generate_keypair, sign_mandate
from chitragupta.policy import GateContext, ReasonCode, evaluate
from chitragupta.types import ActionType, PolicyDecision, ProposedAction

NOW = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def signed():
    priv, pub = generate_keypair()
    m = Mandate(
        mandate_id="m1",
        merchant_id="quickmart",
        permitted_actions=[
            ActionType.RETRY_SOFT_DECLINE,
            ActionType.RESCHEDULE_BILLING_WINDOW,
            ActionType.ENABLE_MULTI_BANK_ROUTING,
            ActionType.FLAG_FOR_INVESTIGATION,
        ],
        max_amount_paise=5_000_00,
        auto_execute_limit_paise=500_00,
        max_attempts_per_payment=3,
        not_before="2026-01-01T00:00:00Z",
        not_after="2026-12-31T23:59:59Z",
        public_key_hex=pub,
    )
    return sign_mandate(m, priv)


def act(**kw):
    base = dict(
        action_type=ActionType.RETRY_SOFT_DECLINE,
        txn_id="pay_1",
        amount_paise=15000,
        reason="soft decline",
    )
    base.update(kw)
    return ProposedAction(**base)


def test_mandate_verifies_and_action_within_limits_is_allowed(signed):
    assert signed.verify()
    r = evaluate(act(), signed, GateContext(now=NOW))
    assert r.decision is PolicyDecision.ALLOW
    assert r.reason_code == ReasonCode.OK_WITHIN_MANDATE


def test_tampered_mandate_denies_everything(signed):
    # Widening your own mandate requires the merchant's private key.
    forged = signed.model_copy(
        update={"mandate": signed.mandate.model_copy(update={"max_amount_paise": 10**9})}
    )
    assert not forged.verify()
    r = evaluate(act(), forged, GateContext(now=NOW))
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_SIGNATURE_INVALID


def test_action_outside_scope_is_denied(signed):
    r = evaluate(
        act(action_type=ActionType.REISSUE_PAYMENT_LINK), signed, GateContext(now=NOW)
    )
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_ACTION_NOT_PERMITTED


def test_amount_above_ceiling_is_denied_not_stepped_up(signed):
    r = evaluate(act(amount_paise=6_000_00), signed, GateContext(now=NOW))
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_AMOUNT_ABOVE_CEILING


def test_amount_between_auto_limit_and_ceiling_steps_up(signed):
    r = evaluate(act(amount_paise=1_000_00), signed, GateContext(now=NOW))
    assert r.decision is PolicyDecision.STEP_UP
    assert r.reason_code == ReasonCode.STEP_UP_ABOVE_AUTO_LIMIT


def test_expired_mandate_denies_everything(signed):
    r = evaluate(
        act(), signed, GateContext(now=datetime(2027, 1, 1, tzinfo=timezone.utc))
    )
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_MANDATE_EXPIRED


def test_mandate_not_yet_valid_denies(signed):
    r = evaluate(
        act(), signed, GateContext(now=datetime(2025, 6, 1, tzinfo=timezone.utc))
    )
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_MANDATE_NOT_YET_VALID


def test_fourth_attempt_on_a_payment_is_denied(signed):
    ctx = GateContext(now=NOW, attempts_by_txn={"pay_1": 3})
    r = evaluate(act(), signed, ctx)
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_MAX_ATTEMPTS


def test_third_attempt_is_still_allowed(signed):
    ctx = GateContext(now=NOW, attempts_by_txn={"pay_1": 2})
    assert evaluate(act(), signed, ctx).decision is PolicyDecision.ALLOW


def test_investigation_is_not_blocked_by_the_attempt_cap(signed):
    # Exhausting retries is precisely when a human should look at it.
    ctx = GateContext(now=NOW, attempts_by_txn={"pay_1": 99})
    r = evaluate(act(action_type=ActionType.FLAG_FOR_INVESTIGATION), signed, ctx)
    assert r.decision is PolicyDecision.ALLOW
    assert r.reason_code == ReasonCode.OK_ESCALATION


def test_payment_older_than_the_recovery_window_is_denied(signed):
    ctx = GateContext(
        now=NOW, original_failure_at={"pay_1": NOW - timedelta(days=8)}
    )
    r = evaluate(act(), signed, ctx)
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_OUTSIDE_RECOVERY_WINDOW


def test_payment_inside_the_recovery_window_is_allowed(signed):
    ctx = GateContext(
        now=NOW, original_failure_at={"pay_1": NOW - timedelta(days=6, hours=23)}
    )
    assert evaluate(act(), signed, ctx).decision is PolicyDecision.ALLOW


def test_degraded_bank_hold_blocks_then_lapses(signed):
    held = GateContext(now=NOW, degraded_banks={"SBIN": NOW - timedelta(hours=1)})
    r = evaluate(act(target_bank="SBIN"), signed, held)
    assert r.decision is PolicyDecision.DENY
    assert r.reason_code == ReasonCode.DENY_BANK_DEGRADED_HOLD

    lapsed = GateContext(now=NOW, degraded_banks={"SBIN": NOW - timedelta(hours=5)})
    assert evaluate(act(target_bank="SBIN"), signed, lapsed).decision is PolicyDecision.ALLOW


def test_merchant_actions_are_never_auto_executed(signed):
    r = evaluate(
        act(action_type=ActionType.ENABLE_MULTI_BANK_ROUTING, amount_paise=0),
        signed,
        GateContext(now=NOW),
    )
    assert r.decision is PolicyDecision.STEP_UP
    assert r.reason_code == ReasonCode.OK_MERCHANT_ACTION


def test_planner_requested_approval_is_honoured(signed):
    r = evaluate(act(requires_merchant_approval=True), signed, GateContext(now=NOW))
    assert r.decision is PolicyDecision.STEP_UP
    assert r.reason_code == ReasonCode.STEP_UP_MERCHANT_APPROVAL_REQUESTED


def test_gate_is_deterministic(signed):
    ctx = GateContext(now=NOW)
    decisions = {evaluate(act(), signed, ctx).decision for _ in range(20)}
    assert len(decisions) == 1
