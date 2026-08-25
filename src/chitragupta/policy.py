"""The deterministic policy gate.

No LLM is consulted here, and that is the whole point. The planner (which is
an LLM) proposes; this module disposes, using only the signed mandate, the
attempt history, and the clock. Every decision carries a machine-readable
reason code so the audit page can show *why*, not just *what*.

Stopping rules from the brief, all enforced here rather than left to the model:
  1. max 3 remediation attempts per payment  (from the mandate)
  2. escalation order: auto-retry -> merchant-action flag -> human handoff
  3. bank-degraded holds: max 4 hours before re-evaluation
  4. total recovery window: 7 days from original failure
  5. per-action amount ceiling (from the mandate)
  6. mandate expiry is absolute
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .mandate import SignedMandate, parse_iso
from .types import AUTO_EXECUTABLE, ActionType, GateResult, PolicyDecision, ProposedAction

#: Stopping rule 4 -- nothing is remediated more than 7 days after it failed.
RECOVERY_WINDOW = timedelta(days=7)
#: Stopping rule 3 -- a hold placed because a bank is degraded expires here.
BANK_DEGRADED_HOLD = timedelta(hours=4)


class ReasonCode:
    """Stable identifiers. The UI renders these; do not reword them casually."""

    OK_WITHIN_MANDATE = "OK_WITHIN_MANDATE"
    OK_MERCHANT_ACTION = "OK_MERCHANT_ACTION"
    OK_ESCALATION = "OK_ESCALATION"
    STEP_UP_ABOVE_AUTO_LIMIT = "STEP_UP_ABOVE_AUTO_LIMIT"
    STEP_UP_MERCHANT_APPROVAL_REQUESTED = "STEP_UP_MERCHANT_APPROVAL_REQUESTED"
    DENY_SIGNATURE_INVALID = "DENY_SIGNATURE_INVALID"
    DENY_MANDATE_EXPIRED = "DENY_MANDATE_EXPIRED"
    DENY_MANDATE_NOT_YET_VALID = "DENY_MANDATE_NOT_YET_VALID"
    DENY_ACTION_NOT_PERMITTED = "DENY_ACTION_NOT_PERMITTED"
    DENY_AMOUNT_ABOVE_CEILING = "DENY_AMOUNT_ABOVE_CEILING"
    DENY_MAX_ATTEMPTS = "DENY_MAX_ATTEMPTS"
    DENY_OUTSIDE_RECOVERY_WINDOW = "DENY_OUTSIDE_RECOVERY_WINDOW"
    DENY_BANK_DEGRADED_HOLD = "DENY_BANK_DEGRADED_HOLD"


class GateContext:
    """Everything the gate is allowed to know. Deliberately small."""

    def __init__(
        self,
        *,
        now: datetime,
        attempts_by_txn: dict[str, int] | None = None,
        original_failure_at: dict[str, datetime] | None = None,
        degraded_banks: dict[str, datetime] | None = None,
    ) -> None:
        self.now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
        self.attempts_by_txn = attempts_by_txn or {}
        self.original_failure_at = original_failure_at or {}
        #: bank -> instant the degradation hold was placed
        self.degraded_banks = degraded_banks or {}


def evaluate(
    action: ProposedAction, signed: SignedMandate, ctx: GateContext
) -> GateResult:
    """Return ALLOW / STEP_UP / DENY with a reason code. Pure and total."""

    def result(decision: PolicyDecision, code: str) -> GateResult:
        return GateResult(decision=decision, reason_code=code, proposed_action=action)

    # --- authenticity first: an unverifiable mandate grants nothing --------
    if not signed.verify():
        return result(PolicyDecision.DENY, ReasonCode.DENY_SIGNATURE_INVALID)

    m = signed.mandate

    # --- rule 6: expiry is absolute --------------------------------------
    if ctx.now < parse_iso(m.not_before):
        return result(PolicyDecision.DENY, ReasonCode.DENY_MANDATE_NOT_YET_VALID)
    if ctx.now > parse_iso(m.not_after):
        return result(PolicyDecision.DENY, ReasonCode.DENY_MANDATE_EXPIRED)

    # --- scope ------------------------------------------------------------
    if action.action_type not in set(m.permitted_actions):
        return result(PolicyDecision.DENY, ReasonCode.DENY_ACTION_NOT_PERMITTED)

    # --- rule 5: hard ceiling --------------------------------------------
    if action.amount_paise > m.max_amount_paise:
        return result(PolicyDecision.DENY, ReasonCode.DENY_AMOUNT_ABOVE_CEILING)

    # --- rule 1: attempts per payment ------------------------------------
    # Only auto-executable actions consume an attempt. Flagging something for
    # investigation is not a remediation attempt, and denying it would strand
    # exactly the payments that most need a human to look at them.
    is_auto = action.action_type in AUTO_EXECUTABLE
    if is_auto and ctx.attempts_by_txn.get(action.txn_id, 0) >= m.max_attempts_per_payment:
        return result(PolicyDecision.DENY, ReasonCode.DENY_MAX_ATTEMPTS)

    # --- rule 4: recovery window -----------------------------------------
    failed_at = ctx.original_failure_at.get(action.txn_id)
    if is_auto and failed_at is not None:
        if failed_at.tzinfo is None:
            failed_at = failed_at.replace(tzinfo=timezone.utc)
        if ctx.now - failed_at > RECOVERY_WINDOW:
            return result(PolicyDecision.DENY, ReasonCode.DENY_OUTSIDE_RECOVERY_WINDOW)

    # --- rule 3: bank-degraded hold --------------------------------------
    # While a bank is held, retrying into it just burns an attempt. The hold
    # lapses after 4 hours and the action becomes available again.
    if is_auto and action.target_bank:
        held_at = ctx.degraded_banks.get(action.target_bank)
        if held_at is not None:
            if held_at.tzinfo is None:
                held_at = held_at.replace(tzinfo=timezone.utc)
            if ctx.now - held_at < BANK_DEGRADED_HOLD:
                return result(PolicyDecision.DENY, ReasonCode.DENY_BANK_DEGRADED_HOLD)

    # --- rule 2: escalation ladder ---------------------------------------
    # Non-auto actions are permitted but are never executed by the agent.
    if action.action_type == ActionType.FLAG_FOR_INVESTIGATION:
        return result(PolicyDecision.ALLOW, ReasonCode.OK_ESCALATION)
    if not is_auto:
        return result(PolicyDecision.STEP_UP, ReasonCode.OK_MERCHANT_ACTION)

    # An auto action that the planner itself marked as needing sign-off.
    if action.requires_merchant_approval:
        return result(
            PolicyDecision.STEP_UP, ReasonCode.STEP_UP_MERCHANT_APPROVAL_REQUESTED
        )

    # --- amount band: permitted in kind, but large enough to confirm ------
    if action.amount_paise > m.auto_execute_limit_paise:
        return result(PolicyDecision.STEP_UP, ReasonCode.STEP_UP_ABOVE_AUTO_LIMIT)

    return result(PolicyDecision.ALLOW, ReasonCode.OK_WITHIN_MANDATE)
