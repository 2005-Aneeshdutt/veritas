"""Deterministic outcome simulation for remediation actions.

READ THIS BEFORE QUOTING ANY RUPEE FIGURE THAT COMES OUT OF HERE.

The retry success model is an ASSUMPTION, not a measurement. A soft decline
that succeeds on retry mostly succeeds because the customer topped up their
account in the meantime -- which has very little to do with the bank's
aggregate decline rate. So this deliberately does NOT use `1 - bank_BD%`,
which would look rigorous while being wrong.

Every rupee produced here is PROJECTED. The submission labels it as such in
the UI, in the README and out loud. To keep that honest, the model ships
THREE calibrations rather than one, and the reported recovery figure is a
range across them, not a point estimate. Relative comparisons between policies
(§10C's T vs B3) survive calibration error far better than absolute totals do,
which is why the headline is a ratio.

Determinism: outcomes are a hash of (txn_id, attempt, calibration), never a
random draw at run time. The same batch replays identically forever.
"""

from __future__ import annotations

import hashlib
from enum import Enum

from pydantic import BaseModel

from ..types import ActionType, ProposedAction


class Calibration(str, Enum):
    """Three defensible readings of how often a retry works."""

    CONSERVATIVE = "conservative"
    CENTRAL = "central"
    OPTIMISTIC = "optimistic"


#: p(retry succeeds) for a SOFT decline, by calibration, at the ideal delay.
#: Anchored loosely on published dunning-recovery ranges, which cluster wide;
#: the spread between these three is the honest expression of that uncertainty.
_SOFT_PEAK: dict[Calibration, float] = {
    Calibration.CONSERVATIVE: 0.22,
    Calibration.CENTRAL: 0.34,
    Calibration.OPTIMISTIC: 0.46,
}

#: Technical declines are a different animal: the payment failed because
#: something was down, so retrying after the incident clears works far more
#: often than waiting for a customer to find money.
_TECHNICAL_PEAK: dict[Calibration, float] = {
    Calibration.CONSERVATIVE: 0.55,
    Calibration.CENTRAL: 0.68,
    Calibration.OPTIMISTIC: 0.78,
}


def _delay_multiplier(hours_since_failure: float, error_class: str) -> float:
    """How the odds move with time waited.

    Soft declines improve with delay -- salary lands, the customer tops up --
    peaking around 48h and decaying after that as intent goes stale.
    Technical declines are the opposite: retry soon, because the incident
    clears in hours and the customer has not yet given up.
    """
    h = max(hours_since_failure, 0.0)
    if error_class == "technical":
        if h <= 4:
            return 1.0
        if h <= 24:
            return 0.8
        return 0.5
    # soft decline
    if h < 6:
        return 0.45  # too soon; nothing has changed for the customer
    if h < 24:
        return 0.75
    if h <= 72:
        return 1.0  # the sweet spot
    if h <= 120:
        return 0.7
    return 0.4


def p_retry_success(
    error_class: str,
    hours_since_failure: float,
    calibration: Calibration = Calibration.CENTRAL,
) -> float:
    """The assumed probability a retry converts. PROJECTED, never measured."""
    if error_class == "technical":
        peak = _TECHNICAL_PEAK[calibration]
    elif error_class == "soft_decline":
        peak = _SOFT_PEAK[calibration]
    else:
        # Hard declines and auth failures do not become successes by being
        # asked again. An expired card is expired.
        return 0.0
    return max(0.0, min(1.0, peak * _delay_multiplier(hours_since_failure, error_class)))


class RailOutcome(BaseModel):
    model_config = {"frozen": True}

    txn_id: str
    action_type: ActionType
    succeeded: bool
    amount_recovered_paise: int
    p_success_used: float
    calibration: Calibration
    detail: str


def _draw(txn_id: str, attempt: int, calibration: Calibration) -> float:
    """A stable pseudo-uniform in [0,1) from the transaction identity.

    Deterministic by construction: no RNG state, no ordering dependence, so
    running one merchant or two hundred gives the same per-payment outcome.
    """
    key = "%s|%d|%s" % (txn_id, attempt, calibration.value)
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def execute(
    action: ProposedAction,
    *,
    error_class: str,
    hours_since_failure: float,
    attempt: int = 1,
    calibration: Calibration = Calibration.CENTRAL,
) -> RailOutcome:
    """Simulate one remediation. Only auto-executable actions can recover money."""
    if action.action_type not in (
        ActionType.RETRY_SOFT_DECLINE,
        ActionType.REISSUE_PAYMENT_LINK,
        ActionType.RESCHEDULE_BILLING_WINDOW,
    ):
        return RailOutcome(
            txn_id=action.txn_id,
            action_type=action.action_type,
            succeeded=False,
            amount_recovered_paise=0,
            p_success_used=0.0,
            calibration=calibration,
            detail="not an auto-executable action; no rail call made",
        )

    p = p_retry_success(error_class, hours_since_failure, calibration)
    # Rescheduling a billing window is a preventive change, not a retry of the
    # existing payment, so it is credited against the NEXT cycle rather than
    # recovering this transaction. Modelled as a partial credit.
    if action.action_type == ActionType.RESCHEDULE_BILLING_WINDOW:
        p *= 0.6

    ok = _draw(action.txn_id, attempt, calibration) < p
    return RailOutcome(
        txn_id=action.txn_id,
        action_type=action.action_type,
        succeeded=ok,
        amount_recovered_paise=action.amount_paise if ok else 0,
        p_success_used=p,
        calibration=calibration,
        detail="p=%.3f class=%s delay=%.1fh attempt=%d"
        % (p, error_class, hours_since_failure, attempt),
    )
