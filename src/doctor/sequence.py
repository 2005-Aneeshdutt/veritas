"""When to retry, not just whether.

Everything else in this project decides WHETHER a payment should be retried.
Nothing decided WHEN -- `apply.py` and `graph.py` both passed a hardcoded 36
hours to the rail, for every failure, regardless of why it failed. That threw
away the one thing the rail actually models well.

The rail's own curve says the two error classes want opposite treatment:

    technical     retry within 4 hours. The incident clears, the customer has
                  not given up yet, and waiting is pure loss.
    soft decline  wait at least a day. Retrying six hours after someone was
                  short of money is asking the same question of the same empty
                  account -- the curve puts that at 0.45 against 1.0 for the
                  24-72h window, because what changes is the customer's
                  balance, not the bank.

Every dunning tool ships a fixed cooldown -- "retry in 30 minutes, three
times". For an insufficient-funds decline that is close to the worst schedule
available: three attempts fired into the same empty account inside an hour and
a half, burning the attempt cap before the salary that would have converted
them ever lands.

So this plans the whole ladder up front, attempt by attempt, and every slot it
picks has to survive the constraints that already exist: the 7-day recovery
window, the 4-hour bank hold, and the mandate's attempt cap. A schedule that
proposes an attempt the kernel would refuse is not a schedule.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from chitragupta.policy import BANK_DEGRADED_HOLD, RECOVERY_WINDOW
from chitragupta.rails.mock_rail import Calibration, p_retry_success

#: Candidate offsets in hours, per error class, in the order they are tried.
#:
#: Read straight off the rail's delay curve rather than invented separately --
#: if that curve is ever re-fitted these should move with it, and a test holds
#: them to it.
_LADDER: dict[str, tuple[float, ...]] = {
    # An incident clears in hours; go early and go again.
    "technical": (2.0, 8.0, 24.0),
    # An issuer whose failures skew technical is having an incident even when
    # this particular code says soft -- so wait less than a funding problem
    # needs, but more than an outage does.
    "soft_decline_incident": (6.0, 24.0, 48.0),
    # A genuine funding problem: skip the dead zone under 6h and keep EVERY
    # attempt inside the 24-72h plateau.
    #
    # This used to end at 84h, which is past the plateau and scores 0.7 where
    # the others score 1.0 -- so the third attempt was worth less than simply
    # repeating the first, and the ladder came out marginally WORSE than the
    # flat schedule it was meant to beat. A test now holds all three slots
    # inside the plateau.
    "soft_decline": (30.0, 48.0, 68.0),
}

#: Above this share of a bank's failures being technical, treat its soft
#: declines as incident-shaped rather than funding-shaped.
INCIDENT_TECH_SHARE = 0.35

#: How much better than the naive fixed schedule a slot has to be before it is
#: worth reporting as an improvement. Below this it is noise in a modelled
#: curve, not a finding.
_MATERIAL_UPLIFT = 0.02

#: What the system used to do, kept so the improvement can be quoted honestly
#: rather than asserted.
NAIVE_HOURS = 36.0


class Attempt(BaseModel):
    """One scheduled attempt, and why it sits where it does."""

    n: int
    hours_after_failure: float
    at: str
    #: Modelled odds this attempt converts, at this delay. PROJECTED.
    p_success: float
    reason: str


class Schedule(BaseModel):
    txn_id: str
    error_class: str
    attempts: list[Attempt]
    #: Odds at least one attempt in the ladder converts. PROJECTED.
    cumulative_p: float
    #: The SAME NUMBER of attempts on the old fixed-36h schedule.
    #:
    #: Apples to apples deliberately. Comparing a three-attempt ladder against
    #: one naive attempt would show a spectacular gain that is really just the
    #: gain from retrying three times, which the old code did too.
    naive_p: float
    uplift: float
    headline: str


def _cumulative(ps: list[float]) -> float:
    """Odds at least one attempt lands, if attempts were independent.

    They are not -- a customer who is short of money at 26h is more likely to
    still be short at 48h -- so this is an UPPER bound and is labelled as one
    wherever it surfaces. Modelling the dependence would need retry data this
    project does not have, and inventing a correlation to look rigorous would
    be worse than saying so.
    """
    miss = 1.0
    for p in ps:
        miss *= 1.0 - p
    return 1.0 - miss


def ladder_for(error_class: str, technical_share: float | None = None) -> tuple[float, ...]:
    """Which ladder this payment gets.

    Keyed on the error class AND the bank's measured technical share, because
    a class label alone misses the case that matters most: a soft decline on
    an issuer whose failures are mostly technical is usually that issuer
    having a bad hour, not a customer with an empty account.

    This mirrors `policy_t` in evals/run_baseline_ladder.py deliberately. That
    eval has been crediting the system with per-payment sequencing since it
    was written, while the shipped code passed a flat 36 hours for everything
    -- so the ladder was measuring a policy the product did not implement.
    Same logic in both places now, and a test holds them together.
    """
    if error_class == "technical":
        return _LADDER["technical"]
    if technical_share is not None and technical_share > INCIDENT_TECH_SHARE:
        return _LADDER["soft_decline_incident"]
    return _LADDER["soft_decline"]


def plan_retries(
    txn_id: str,
    error_class: str,
    failed_at: datetime,
    *,
    now: datetime | None = None,
    attempts_used: int = 0,
    max_attempts: int = 3,
    bank_held_at: datetime | None = None,
    technical_share: float | None = None,
    calibration: Calibration = Calibration.CENTRAL,
) -> Schedule:
    """Lay out the remaining attempts for one failed payment."""
    now = now or datetime.now(timezone.utc)
    remaining = max(0, max_attempts - attempts_used)
    ladder = ladder_for(error_class, technical_share)

    attempts: list[Attempt] = []
    for offset in ladder:
        if len(attempts) >= remaining:
            break

        at = failed_at + timedelta(hours=offset)

        if bank_held_at is not None and at - bank_held_at < BANK_DEGRADED_HOLD:
            # Slide to the far side of the hold rather than dropping the
            # attempt: the bank being briefly unwell is a reason to wait, not
            # a reason to give up on the payment.
            at = bank_held_at + BANK_DEGRADED_HOLD
            offset = (at - failed_at).total_seconds() / 3600.0
        if at < now:
            # The slot has already passed. Go as soon as allowed instead of
            # pretending to schedule something in the past.
            at = now
            offset = (at - failed_at).total_seconds() / 3600.0

        # Checked LAST, and deliberately.
        #
        # Sliding past a bank hold or forward to now can push a slot out of
        # the recovery window, so testing the original offset would let a slid
        # attempt escape the check and be proposed for a payment the kernel
        # would then deny for being too old. A schedule that proposes an
        # attempt the kernel would refuse is not a schedule.
        if at - failed_at > RECOVERY_WINDOW:
            continue

        p = p_retry_success(error_class, offset, calibration)
        attempts.append(
            Attempt(
                n=len(attempts) + 1,
                hours_after_failure=round(offset, 1),
                at=at.isoformat(),
                p_success=round(p, 4),
                reason=_why(error_class, offset),
            )
        )

    cum = _cumulative([a.p_success for a in attempts])
    # The old behaviour, given the same budget: every attempt at a flat 36h.
    naive = _cumulative(
        [p_retry_success(error_class, NAIVE_HOURS, calibration)] * len(attempts)
    )
    return Schedule(
        txn_id=txn_id,
        error_class=error_class,
        attempts=attempts,
        cumulative_p=round(cum, 4),
        naive_p=round(naive, 4),
        uplift=round(cum - naive, 4),
        headline=_headline(error_class, attempts, cum, naive),
    )


def first_slot_hours(
    error_class: str, attempt: int = 1, technical_share: float | None = None
) -> float:
    """The delay this sequencer picks for one attempt on this error class.

    Exposed so `graph.py` and `apply.py` can execute at the time the schedule
    chose instead of the flat 36 hours they both used to pass. Threading a
    timestamp through the kernel's ProposedAction would mean putting a domain
    concept into the policy type, which is not where it belongs.
    """
    ladder = ladder_for(error_class, technical_share)
    if not ladder:
        return NAIVE_HOURS
    return ladder[min(max(attempt, 1) - 1, len(ladder) - 1)]


def _why(error_class: str, hours: float) -> str:
    if error_class == "technical":
        if hours <= 4:
            return "inside the window where the incident is still clearing"
        if hours <= 24:
            return "late, but the customer has probably not given up yet"
        return "last look before the odds fall away"
    if hours < 24:
        return "this issuer's failures skew technical -- treated as an incident"
    if hours < 6:
        return "too soon -- the account is still empty"
    if hours <= 72:
        return "the plateau: long enough for the balance to have changed"
    return "past the plateau; intent goes stale"


def _headline(error_class: str, attempts: list[Attempt], cum: float, naive: float) -> str:
    if not attempts:
        return "No attempts left inside the mandate's cap."
    slots = ", ".join("+%gh" % a.hours_after_failure for a in attempts)
    if cum - naive < _MATERIAL_UPLIFT:
        return (
            "Scheduled %s. Barely better than %d attempt%s at a flat %gh -- the "
            "old fixed delay already sat in this class's good window, so the "
            "sequencing earns little here. Reported rather than dressed up."
            % (slots, len(attempts), "" if len(attempts) == 1 else "s", NAIVE_HOURS)
        )
    return (
        "Scheduled %s. Against the same %d attempts at a flat %gh, modelled "
        "odds go %.0f%% -> %.0f%%. Both are upper bounds: a customer short of "
        "money once is likelier to be short again, and neither figure accounts "
        "for that."
        % (slots, len(attempts), NAIVE_HOURS, 100 * naive, 100 * cum)
    )
