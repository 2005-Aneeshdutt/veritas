"""The typed-action contract.

These tests exist because the security property in ARCHITECTURE.md rests on a
claim about types: the model's output is a *validated struct drawn from a
closed enum*, so a compromised model cannot smuggle a URL, a credential, or an
action that does not exist. That claim is only true if the validation actually
rejects those things, which is what this file checks.
"""

import pytest
from pydantic import ValidationError

from chitragupta.types import (
    AUTO_EXECUTABLE,
    ActionType,
    GateResult,
    PolicyDecision,
    ProposedAction,
)


def action(**kw) -> ProposedAction:
    base = dict(
        action_type=ActionType.RETRY_SOFT_DECLINE,
        txn_id="pay_1",
        amount_paise=15000,
        reason="soft decline, retry after funding window",
    )
    base.update(kw)
    return ProposedAction(**base)


# --- the closed enum ------------------------------------------------------


def test_action_type_is_closed():
    """A model cannot invent an action by naming one."""
    with pytest.raises(ValidationError):
        action(action_type="drain_merchant_account")
    with pytest.raises(ValidationError):
        action(action_type="https://evil.example/withdraw")


def test_every_action_type_is_classified_as_auto_or_not():
    """No action may be silently un-categorised -- the gate branches on it."""
    for t in ActionType:
        assert isinstance(t in AUTO_EXECUTABLE, bool)
    # The auto set is a strict subset: escalation and merchant actions are not
    # things the agent may do alone.
    assert AUTO_EXECUTABLE < set(ActionType)
    assert ActionType.FLAG_FOR_INVESTIGATION not in AUTO_EXECUTABLE
    assert ActionType.ENABLE_MULTI_BANK_ROUTING not in AUTO_EXECUTABLE


def test_auto_executable_contains_exactly_the_three_agent_actions():
    assert AUTO_EXECUTABLE == {
        ActionType.RESCHEDULE_BILLING_WINDOW,
        ActionType.RETRY_SOFT_DECLINE,
        ActionType.REISSUE_PAYMENT_LINK,
    }


# --- money ----------------------------------------------------------------


def test_amount_must_be_non_negative_integer_paise():
    with pytest.raises(ValidationError):
        action(amount_paise=-1)


def test_float_rupees_never_survive_as_float():
    """Money is integer paise everywhere. A float that is not a whole number
    of paise must not be silently truncated into a wrong amount."""
    with pytest.raises(ValidationError):
        action(amount_paise=150.75)


def test_whole_float_is_accepted_as_the_integer_it_equals():
    assert action(amount_paise=15000.0).amount_paise == 15000


# --- required substance ---------------------------------------------------


def test_txn_id_cannot_be_empty():
    with pytest.raises(ValidationError):
        action(txn_id="")


def test_reason_cannot_be_blank_or_whitespace():
    # A gate decision with no stated reason is unauditable.
    with pytest.raises(ValidationError):
        action(reason="")
    with pytest.raises(ValidationError):
        action(reason="   ")


def test_reason_is_stripped():
    assert action(reason="  needs retry  ").reason == "needs retry"


# --- immutability ---------------------------------------------------------


def test_proposed_action_is_frozen():
    """Nothing may mutate an action after the gate has judged it, or the
    ledger would record a decision about a different action than the one that
    ran."""
    a = action()
    with pytest.raises(ValidationError):
        a.amount_paise = 999_999_99


def test_gate_result_is_frozen():
    g = GateResult(
        decision=PolicyDecision.ALLOW,
        reason_code="OK_WITHIN_MANDATE",
        proposed_action=action(),
    )
    with pytest.raises(ValidationError):
        g.decision = PolicyDecision.DENY


# --- serialisation contract ----------------------------------------------


def test_enums_serialise_by_value_for_the_ledger_and_the_ui():
    a = action()
    dumped = a.model_dump(mode="json")
    assert dumped["action_type"] == "retry_soft_decline"
    assert ProposedAction.model_validate(dumped) == a


def test_optional_fields_default_to_none_not_missing():
    a = action()
    assert a.target_bank is None
    assert a.scheduled_time is None
    assert a.requires_merchant_approval is False


def test_policy_decision_values_are_stable():
    # The frontend renders these strings; changing them silently breaks it.
    assert [d.value for d in PolicyDecision] == ["allow", "step_up", "deny"]
