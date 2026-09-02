"""Which recovery channel, if any — decided deterministically, before anyone calls.

THE ARGUMENT
------------
A retry costs a gateway fee. A payment link costs the customer a decision. A
phone call costs the customer their afternoon and the merchant their goodwill.
These are not interchangeable, and a system that reaches for the loudest one
because it converts best is not a recovery system, it is a nuisance.

So the channel is chosen here, by rule, from structured facts:

    attempt budget left · error class · amount · issuer health ·
    contactability · the signed mandate · the stopping rules

and the order is deliberate: **the cheapest channel that can plausibly work
wins.** A payment that can still be retried silently is retried silently. The
customer is only contacted when the machine has run out of ways to fix it
without them, and is only *called* when a quieter contact has already failed
or the amount justifies it.

WHERE THE VOICE AGENT SITS
--------------------------
Nowhere near this decision. `voice.py` executes a bounded script after this
module and the policy kernel have both said yes. It cannot choose to call,
choose to call again, offer anything, or retry a payment. It is a channel,
not an intelligence, and the separation is structural: it receives a
`ChannelDecision` and has no route back into one.

WHAT IS MODELLED AND WHAT IS MEASURED — READ THIS BEFORE QUOTING A NUMBER
------------------------------------------------------------------------
The retry curve in `mock_rail.py` is an assumption with a counterfactual
behind it: `retry_conversions` says whether each payment would truly have
converted, so a retry policy can be SCORED.

`CHANNEL_PICKUP` below has no such backing. There is no ground truth in this
dataset for "did the customer answer the phone", and there is no honest way
to manufacture one. So:

  * every channel's expected recovery is capped by whether the payment was
    convertible at all, which IS ground truth
  * the per-channel multiplier on top of that is a stated assumption, printed
    next to every figure derived from it
  * the counterfactual page marks retry policies against truth and refuses to
    do the same for the contact channels, because it cannot

That asymmetry is reported rather than smoothed over. It is the difference
between a number you can argue with and a number that was made up.
"""

from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel

from chitragupta.mandate import SignedMandate
from chitragupta.policy import ReasonCode
from chitragupta.rails.mock_rail import p_retry_success
from chitragupta.types import ActionType

from .features import RECOVERABLE
from .sequence import ladder_for

Channel = Literal[
    "no_action", "retry", "email", "payment_link", "voice", "escalate"
]

#: ASSUMPTION, not a measurement. Given a payment that WOULD have converted,
#: the share of customers who complete via each channel.
#:
#: These are the softest numbers in the repository and they are stated in one
#: place so they can be argued with, replaced, or deleted. Reasoning, not
#: research:
#:
#:   retry         1.00  the customer does nothing; the rail's own curve
#:                       already carries the uncertainty, so no second haircut
#:   payment_link  0.55  the customer has to open a link and re-enter a
#:                       payment method. Roughly half of an already-willing
#:                       cohort is a deliberately unflattering guess
#:   email         0.35  a link, but buried in an inbox and competing with
#:                       everything else in it
#:   voice         0.70  a live human-shaped prompt converts better than an
#:                       email and worse than a silent retry, because the
#:                       customer still has to act afterwards
#:
#: Nothing in this dataset can validate any of them. Printed as an assumption
#: everywhere they surface.
CHANNEL_PICKUP: dict[Channel, float] = {
    "retry": 1.00,
    "payment_link": 0.55,
    "email": 0.35,
    "voice": 0.70,
    "no_action": 0.0,
    "escalate": 0.0,
}

#: ASSUMPTION. What one intervention costs the merchant, in paise, before
#: anything converts. Ordered the way the real world orders them: machine
#: time is cheap, a person's attention is not.
CHANNEL_COST_PAISE: dict[Channel, int] = {
    "retry": 300,           # gateway auth fee + the decline notification
    "email": 100,           # send cost, near zero; the cost is attention
    "payment_link": 400,    # link creation plus the send
    "voice": 4_500,         # telephony plus the minute of somebody's day
    "no_action": 0,
    "escalate": 0,
}

#: A call is only justified above this. Below it the call costs more in
#: goodwill and telephony than the payment is worth recovering, and "we rang
#: a customer about Rs 300" is how a recovery product gets switched off.
VOICE_FLOOR_PAISE = 500_000        # Rs 5,000

#: Above this share of an issuer's traffic failing technically, treat it as
#: infrastructure degradation rather than as customer-side failures. Read off
#: NPCI's own technical-decline column, which is real data.
DOWNTIME_TD_PCT = 1.0


class ChannelOption(BaseModel):
    """One channel, priced. Contains no decision."""

    channel: Channel
    eligible: bool
    #: Why not, when not. A reason code, not prose.
    reason: str
    #: ASSUMPTION-derived. Zero for an ineligible channel.
    expected_recovery_paise: int = 0
    cost_paise: int = 0
    net_paise: int = 0
    #: The pickup assumption used, so the figure can be recomputed by hand.
    pickup_assumed: float = 0.0


class ChannelDecision(BaseModel):
    """What to do about one payment, and everything that was weighed."""

    txn_id: str
    merchant_id: str
    amount_paise: int
    error_class: str
    bank: str

    chosen: Channel
    reason: str
    #: Every channel considered, eligible or not. The refusals are the point.
    options: list[ChannelOption]

    #: Capped by the mandate, not by preference.
    max_contact_attempts: int = 1
    #: True when an issuer is degraded and the right answer is to wait.
    downtime_hold: bool = False
    resume_condition: str = ""

    #: Set only where the payment is convertible AND we are allowed to say so.
    #: Always an assumption for the contact channels; see CHANNEL_PICKUP.
    expected_recovery_paise: int = 0
    basis: str = "assumption"


def contactable(txn_id: str) -> bool:
    """Is there a way to reach this customer?

    GENERATED, and labelled as such wherever it surfaces. The synthetic
    batches carry no contact details -- real ones would -- so this derives a
    stable per-payment flag from the payment id, the same way `mock_rail`
    derives a stable outcome. Roughly 62% of payments come out contactable.

    It is generated data inside an already-generated batch, not a claim about
    a real customer. In RAZORPAY_TEST mode this is replaced by whether the
    payment actually carries a contact or email, which is a fact.
    """
    h = hashlib.sha256(("contact|" + txn_id).encode("utf-8")).digest()
    return (int.from_bytes(h[:4], "big") % 100) < 62


def _degraded(bank: str, bank_health: list[dict] | None) -> tuple[bool, float]:
    """Is this issuer having an incident, per NPCI's own technical-decline rate?

    Not a fabricated downtime feed. `npci_td_pct` is the technical-decline
    share published in the NPCI monthly tables this project already ingests,
    and the policy kernel already has a four-hour hold for exactly this.
    A real `payment.downtime.started` event, when one is ingested, overrides
    this -- see `downtime_from_events`.
    """
    for b in bank_health or []:
        if b.get("bank") == bank:
            td = float(b.get("npci_td_pct") or 0.0)
            return td >= DOWNTIME_TD_PCT, td
    return False, 0.0


def downtime_from_events(bank: str) -> bool:
    """A real, ingested downtime event for this issuer that has not resolved.

    Takes precedence over the NPCI-derived signal because it is a statement
    about right now rather than about last month. Returns False when no such
    event has ever been ingested -- which is the case with no credentials, and
    is why the NPCI signal exists at all.
    """
    from .events import store

    state = False
    for e in store.all():
        if not e.event_type.startswith("payment.downtime"):
            continue
        if e.entity and bank and e.entity.lower() not in bank.lower():
            continue
        if e.event_type == "payment.downtime.resolved":
            state = False
        else:
            state = True
    return state


def decide(
    *,
    txn_id: str,
    merchant_id: str,
    amount_paise: int,
    error_class: str,
    bank: str,
    prior_attempts: int,
    signed: SignedMandate,
    convertible: bool | None = None,
    bank_health: list[dict] | None = None,
) -> ChannelDecision:
    """Choose one channel for one payment. Deterministic and total.

    `convertible` is ground truth and is accepted ONLY for pricing the
    options after the fact -- pass None (the default) during a live decision.
    The evaluation harness passes it when it is marking, never when it is
    deciding, and the same separation `counterfactual.py` enforces applies
    here.
    """
    m = signed.mandate
    cap = m.max_attempts_per_payment
    budget = max(0, cap - prior_attempts)
    recoverable = error_class in {e.value for e in RECOVERABLE}
    can_contact = contactable(txn_id)

    # -- the one case where the right answer is to wait ---------------------
    live_downtime = downtime_from_events(bank)
    npci_degraded, td = _degraded(bank, bank_health)
    if live_downtime or npci_degraded:
        return ChannelDecision(
            txn_id=txn_id, merchant_id=merchant_id, amount_paise=amount_paise,
            error_class=error_class, bank=bank,
            chosen="no_action",
            reason="HOLD_INFRASTRUCTURE_DEGRADED",
            downtime_hold=True,
            resume_condition=(
                "a payment.downtime.resolved event for this issuer"
                if live_downtime
                else "issuer technical-decline rate back under %.1f%% "
                     "(currently %.2f%%, from NPCI)" % (DOWNTIME_TD_PCT, td)
            ),
            max_contact_attempts=0,
            options=[
                ChannelOption(
                    channel=c, eligible=False,
                    reason="ISSUER_DEGRADED_RETRY_WOULD_BURN_AN_ATTEMPT",
                )
                for c in ("retry", "email", "payment_link", "voice")
            ],
            basis="deterministic",
        )

    # -- price every channel, then pick by rule ---------------------------
    #
    # The ceiling on ANY channel is whether this payment would ever have
    # converted. When that is unknown (a live decision), the modelled retry
    # odds stand in for it -- which is the same estimate the planner already
    # uses and no new assumption.
    ladder = ladder_for(error_class)
    p_convert = (
        1.0 if convertible is True
        else 0.0 if convertible is False
        else max((p_retry_success(error_class, h) for h in ladder), default=0.0)
    )
    ceiling = int(amount_paise * p_convert) if recoverable else 0

    opts: list[ChannelOption] = []

    def price(channel: Channel, eligible: bool, reason: str) -> ChannelOption:
        pick = CHANNEL_PICKUP[channel] if eligible else 0.0
        exp = int(ceiling * pick)
        cost = CHANNEL_COST_PAISE[channel] if eligible else 0
        o = ChannelOption(
            channel=channel, eligible=eligible, reason=reason,
            expected_recovery_paise=exp, cost_paise=cost,
            net_paise=exp - cost, pickup_assumed=pick,
        )
        opts.append(o)
        return o

    # retry -- the quiet one, and therefore the first one
    #
    # Scope is checked first and it is not a formality. A merchant can sign a
    # mandate that permits asking a customer to pay but not charging their
    # card again -- "do not auto-retry, you may send a link" -- and that is a
    # coherent and rather thoughtful position. This layer missed it, proposed
    # a retry anyway, and the kernel would have denied it as
    # DENY_ACTION_NOT_PERMITTED.
    retry_permitted = ActionType.RETRY_SOFT_DECLINE in set(m.permitted_actions)
    if not retry_permitted:
        price("retry", False, ReasonCode.DENY_ACTION_NOT_PERMITTED)
    elif not recoverable:
        price("retry", False, "NOT_RECOVERABLE_BY_CLASS")
    elif budget == 0:
        price("retry", False, ReasonCode.DENY_MAX_ATTEMPTS)
    elif amount_paise > m.max_amount_paise:
        price("retry", False, ReasonCode.DENY_AMOUNT_ABOVE_CEILING)
    else:
        price("retry", True, "OK_ATTEMPT_BUDGET_REMAINS")

    # the contact channels
    #
    # A subtlety that cost this module a rewrite: REISSUE_PAYMENT_LINK is in
    # AUTO_EXECUTABLE, so the kernel applies the per-payment attempt cap and
    # the hard ceiling to a payment LINK exactly as it does to a retry. A
    # channel layer that ignored that proposed calls and links the kernel
    # then denied on every single one -- the layering was correct and the
    # proposal was structurally impossible, which is a worse failure than an
    # unsafe one because it looks like it works.
    #
    # So the contact channels inherit the same two limits. What is left is
    # the genuinely interesting case: a mandate that permits asking the
    # customer but not charging them.
    link_permitted = ActionType.REISSUE_PAYMENT_LINK in set(m.permitted_actions)
    contact_block = (
        "NOT_RECOVERABLE_BY_CLASS" if not recoverable
        else ReasonCode.DENY_MAX_ATTEMPTS if budget == 0
        else ReasonCode.DENY_AMOUNT_ABOVE_CEILING
        if amount_paise > m.max_amount_paise
        else "NO_CONTACT_ON_FILE" if not can_contact
        else ""
    )
    price("email", not contact_block, contact_block or "OK_CONTACT_ON_FILE")
    price(
        "payment_link",
        not contact_block and link_permitted,
        contact_block
        or ("" if link_permitted else ReasonCode.DENY_ACTION_NOT_PERMITTED)
        or "OK_CONTACT_ON_FILE",
    )
    price(
        "voice",
        not contact_block and amount_paise >= VOICE_FLOOR_PAISE,
        contact_block
        or ("AMOUNT_BELOW_VOICE_FLOOR"
            if amount_paise < VOICE_FLOOR_PAISE else "OK_ABOVE_VOICE_FLOOR"),
    )

    by = {o.channel: o for o in opts}

    # -- the rule. Cheapest workable channel first, always. ----------------
    if by["retry"].eligible:
        chosen, reason = "retry", (
            "The customer does not have to do anything and the mandate still "
            "has %d of %d attempts. Nothing louder is justified yet." % (budget, cap)
        )
    elif not recoverable:
        chosen, reason = "no_action", (
            "This class of failure does not convert on any channel. An "
            "expired card is not fixed by being asked again, politely or "
            "otherwise."
        )
    elif not can_contact:
        chosen, reason = "escalate", (
            "No automatic retry is available (%s) and there is no contact on "
            "file, so no channel is left. A person has to decide what happens "
            "next." % by["retry"].reason
        )
    elif by["voice"].eligible and by["voice"].net_paise > by["payment_link"].net_paise:
        chosen, reason = "voice", (
            "No automatic retry is available (%s), the amount is above the "
            "Rs %s floor, and on the stated pickup assumptions a call nets "
            "more than a link even after its much higher cost. One attempt, "
            "then stop."
            % (by["retry"].reason, format(VOICE_FLOOR_PAISE // 100, ",d"))
        )
    elif by["payment_link"].eligible:
        chosen, reason = "payment_link", (
            "No automatic retry is available (%s), so the customer has to "
            "act. A link is the quietest way to ask." % by["retry"].reason
        )
    elif by["email"].eligible:
        chosen, reason = "email", (
            "A link is not permitted by this mandate, so the customer is told "
            "and left to act."
        )
    else:
        chosen, reason = "escalate", "No channel is both permitted and eligible."

    return ChannelDecision(
        txn_id=txn_id, merchant_id=merchant_id, amount_paise=amount_paise,
        error_class=error_class, bank=bank,
        chosen=chosen, reason=reason, options=opts,
        # One. The mandate caps remediation attempts per payment, and a phone
        # call is a remediation attempt. "We rang you three times" is the
        # behaviour this whole product exists to argue against.
        max_contact_attempts=1 if chosen in ("voice", "payment_link", "email") else 0,
        expected_recovery_paise=by[chosen].expected_recovery_paise
        if chosen in by else 0,
        basis="assumption" if chosen in ("email", "payment_link", "voice")
        else "modelled",
    )
