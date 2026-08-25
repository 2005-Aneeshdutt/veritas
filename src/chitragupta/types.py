"""Typed remediation actions.

The security property this file exists to support: the LLM never emits a URL,
an API call, or a credential. It emits a `ProposedAction` -- a validated struct
drawn from a closed enum -- which a deterministic policy kernel then accepts or
rejects. Even a fully prompt-injected model cannot exceed the mandate, because
it never held the credentials and its output is parsed, not executed.

Money is integer paise everywhere. No float rupees cross a module boundary.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator


class ActionType(str, Enum):
    """Every remediation the agent is capable of proposing.

    Grouped by who has to act. `auto` actions can be executed by the agent
    under a valid mandate; `merchant` actions require the merchant to do
    something the agent cannot do on their behalf; `escalation` hands off.
    """

    # auto-executable
    RESCHEDULE_BILLING_WINDOW = "reschedule_billing_window"
    RETRY_SOFT_DECLINE = "retry_soft_decline"
    REISSUE_PAYMENT_LINK = "reissue_payment_link"
    # merchant action
    ENABLE_MULTI_BANK_ROUTING = "enable_multi_bank_routing"
    UPDATE_PAYMENT_METHOD = "update_payment_method"
    RENEW_MANDATE = "renew_mandate"
    # escalation
    FLAG_FOR_INVESTIGATION = "flag_for_investigation"


#: Actions the agent may execute itself. Anything outside this set is either a
#: merchant action or an escalation, and the policy kernel enforces that.
AUTO_EXECUTABLE: frozenset[ActionType] = frozenset(
    {
        ActionType.RESCHEDULE_BILLING_WINDOW,
        ActionType.RETRY_SOFT_DECLINE,
        ActionType.REISSUE_PAYMENT_LINK,
    }
)


class ProposedAction(BaseModel):
    """What the planner emits. Never executed directly -- always gated first."""

    model_config = {"frozen": True}

    action_type: ActionType
    txn_id: str = Field(min_length=1)
    amount_paise: int = Field(ge=0)
    target_bank: str | None = None
    scheduled_time: str | None = None  # ISO 8601
    reason: str = Field(min_length=1)
    requires_merchant_approval: bool = False

    @field_validator("reason")
    @classmethod
    def _reason_is_substantive(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("reason must not be blank")
        return v.strip()


class PolicyDecision(str, Enum):
    ALLOW = "allow"
    STEP_UP = "step_up"  # permitted in kind, but needs merchant confirmation
    DENY = "deny"  # exceeds the mandate


class GateResult(BaseModel):
    model_config = {"frozen": True}

    decision: PolicyDecision
    reason_code: str
    proposed_action: ProposedAction
