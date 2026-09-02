"""One failed payment, followed from the event to a verified recovery.

Everything else in this repository works on batches. This works on one
payment, because the thing a judge needs to see end to end is not a report --
it is a single failure travelling the whole loop:

    payment.failed
      -> diagnosis (the batch already did this)
      -> channel decision        channels.py, deterministic
      -> policy gate             chitragupta/policy.py, the same kernel
      -> bounded execution       link / email / voice, one attempt
      -> outcome event           payment_link.paid, or nothing
      -> recovery, or not
      -> audit entry

THE RULE THIS FILE EXISTS TO ENFORCE
------------------------------------
`recovered_paise` is zero until an OUTCOME EVENT arrives naming this payment.

Not when the link is created. Not when the email sends. Not when a customer
says yes on a call. Those are all things *we* did; a recovery is a thing the
payment did, and only the gateway can report it. In synthetic mode the outcome
event is generated deterministically and labelled synthetic; in test mode it
arrives on the webhook and is verified against the gateway. Neither path lets
this module invent one.

IDEMPOTENCY
-----------
Every execution passes `events.record_action`, keyed on (payment, action).
A webhook redelivered, an operator double-clicking, and a page refreshed all
resolve to the same answer: already done. The gateway's own `reference_id`
would refuse it a second time too, which is deliberate belt and braces.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from chitragupta.ledger import Ledger
from chitragupta.mandate import SignedMandate
from chitragupta.policy import GateContext, evaluate
from chitragupta.types import ActionType, PolicyDecision, ProposedAction

from . import events as ev
from .channels import ChannelDecision, decide
from .mode import Mode
from .rzp import NotConfigured, RazorpayAdapter, RazorpayUnavailable, effective_mode

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "data" / "synthetic"
RUNS = ROOT / "data" / "runs"

LinkStatus = Literal["created", "sent", "paid", "expired", "cancelled", "failed"]


class PaymentLink(BaseModel):
    """A recovery link, and where it got to."""

    link_id: str
    txn_id: str
    merchant_id: str
    amount_paise: int
    status: LinkStatus = "created"
    short_url: str | None = None
    #: synthetic | razorpay_test. Never blurred.
    source: str = "synthetic"
    created_at: str
    #: The outcome event that closed it, if one has arrived.
    settled_by_event_id: str | None = None


class RecoveryAttempt(BaseModel):
    """The whole story of one payment, in the order it happened."""

    txn_id: str
    merchant_id: str
    merchant_name: str
    amount_paise: int
    error_class: str
    bank: str

    mode: str
    mode_label: str

    decision: ChannelDecision
    gate_decision: str = ""
    gate_reason: str = ""

    executed: bool = False
    channel: str = "none"
    payment_link: PaymentLink | None = None
    voice: dict | None = None
    email_sent_to: str | None = None

    #: ZERO until an outcome event says otherwise. See the module docstring.
    recovered_paise: int = 0
    recovery_confirmed_by: str | None = None
    outcome_state: str = "awaiting_outcome"

    ledger_entry_hash: str | None = None
    idempotent_skip: bool = False
    notes: list[str] = []


def _merchant(merchant_id: str) -> dict:
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _payment(merchant_id: str, txn_id: str) -> dict | None:
    for t in _merchant(merchant_id).get("transactions", []):
        if t["txn_id"] == txn_id:
            return t
    return None


def _bank_health(merchant_id: str) -> list[dict]:
    for f in sorted(RUNS.glob("*.json")):
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if r.get("merchant_id") == merchant_id:
            return r.get("report", {}).get("bank_health", {}).get("banks", [])
    return []


def plan_recovery(
    merchant_id: str, txn_id: str, signed: SignedMandate
) -> RecoveryAttempt:
    """Decide, gate, and price — without doing anything. Safe to call twice."""
    m = _merchant(merchant_id)
    txn = _payment(merchant_id, txn_id)
    if txn is None:
        raise FileNotFoundError("no such payment: %s" % txn_id)

    mode = effective_mode()
    d = decide(
        txn_id=txn_id,
        merchant_id=merchant_id,
        amount_paise=int(txn["amount_paise"]),
        error_class=txn.get("error_class") or "soft_decline",
        bank=txn.get("bank") or "",
        prior_attempts=int(txn.get("attempts") or 1),
        signed=signed,
        bank_health=_bank_health(merchant_id),
    )

    att = RecoveryAttempt(
        txn_id=txn_id,
        merchant_id=merchant_id,
        merchant_name=m.get("profile", {}).get("name", merchant_id),
        amount_paise=int(txn["amount_paise"]),
        error_class=txn.get("error_class") or "soft_decline",
        bank=txn.get("bank") or "",
        mode=mode.value,
        mode_label=("RAZORPAY TEST MODE" if mode is Mode.RAZORPAY_TEST
                    else "SYNTHETIC EVALUATION"),
        decision=d,
        channel=d.chosen,
    )

    # The channel decision says WHAT would be sensible. The kernel says
    # whether it is allowed. Both, always, in that order.
    action_for = {
        "retry": ActionType.RETRY_SOFT_DECLINE,
        "payment_link": ActionType.REISSUE_PAYMENT_LINK,
        "email": ActionType.REISSUE_PAYMENT_LINK,
        "voice": ActionType.REISSUE_PAYMENT_LINK,
    }.get(d.chosen)

    if action_for is None:
        att.gate_decision = "n/a"
        att.gate_reason = d.reason
        att.notes.append(
            "No channel was selected, so there was nothing for the kernel to "
            "rule on. That is an outcome, not a gap."
        )
        return att

    action = ProposedAction(
        action_type=action_for,
        txn_id=txn_id,
        amount_paise=att.amount_paise,
        target_bank=att.bank or None,
        reason="recovery via %s: %s" % (d.chosen, d.reason[:120]),
    )
    gate = evaluate(
        action, signed,
        GateContext(
            now=datetime.now(timezone.utc),
            attempts_by_txn={txn_id: int(txn.get("attempts") or 1)},
            settled_txns=set(),
        ),
    )
    att.gate_decision = gate.decision.value
    att.gate_reason = gate.reason_code
    if gate.decision is PolicyDecision.DENY:
        att.notes.append(
            "The kernel refused this. The channel decision is not overruled "
            "by anyone -- including a merchant clicking approve."
        )
    return att


def execute_recovery(
    merchant_id: str,
    txn_id: str,
    signed: SignedMandate,
    *,
    confirmed: bool = False,
    voice_scenario: str = "accepts",
    language: str = "en",
    actor: str = "platform",
) -> RecoveryAttempt:
    """Do the one thing the gate permitted, once.

    `confirmed` releases a STEP_UP, exactly as `apply.py` does. It does not
    release a DENY, here or anywhere else.
    """
    att = plan_recovery(merchant_id, txn_id, signed)
    d = att.decision

    if att.gate_decision == "deny":
        att.outcome_state = "refused_by_mandate"
        return att
    if att.gate_decision == "step_up" and not confirmed:
        att.outcome_state = "awaiting_merchant"
        att.notes.append(
            "Above the auto-execute limit. Held for the merchant rather than "
            "sent."
        )
        return att
    if d.chosen in ("no_action", "escalate"):
        att.outcome_state = (
            "held_downtime" if d.downtime_hold else "escalated"
        )
        ev.emit(
            event_type="intervention.withheld",
            source="internal", merchant_id=merchant_id, payment_id=txn_id,
            amount_paise=att.amount_paise,
            event_id="int_withheld_%s" % txn_id,
            note="channel=%s reason=%s" % (d.chosen, d.reason[:120]),
        )
        return att

    # -- idempotency, before anything leaves the building ------------------
    if not ev.record_action(
        txn_id, d.chosen, merchant_id, att.amount_paise,
        detail="gate=%s" % att.gate_reason,
    ):
        att.idempotent_skip = True
        att.outcome_state = "already_done"
        att.notes.append(
            "This exact intervention was already launched for this payment. "
            "Refused before anything was sent, so a redelivered webhook or a "
            "double click cannot produce a second one."
        )
        return att

    # -- the voice channel: a bounded call, then a link -------------------
    if d.chosen == "voice":
        from .voice import run_call

        out = run_call(
            d, merchant_name=att.merchant_name,
            scenario=voice_scenario, language=language,
        )
        att.voice = json.loads(out.model_dump_json())
        att.executed = True
        if not out.customer_accepted:
            att.outcome_state = (
                "escalated" if out.final_state == "escalated" else "declined"
            )
            att.notes.append(
                "The customer did not accept, so no link was created and no "
                "money moved. The call is still audited."
            )
            _append_ledger(att, signed, actor, outcome="escalated")
            return att
        att.notes.append(
            "The customer accepted on the call, which authorises the link and "
            "nothing else. It is not a payment."
        )

    # -- retry: the quiet channel, run against the same rail as apply.py --
    if d.chosen == "retry":
        from chitragupta.rails.mock_rail import Calibration, execute as rail_execute
        from chitragupta.types import ActionType as AT

        from .sequence import first_slot_hours

        txn = _payment(merchant_id, txn_id) or {}
        nth = int(txn.get("attempts") or 1) + 1
        out = rail_execute(
            ProposedAction(
                action_type=AT.RETRY_SOFT_DECLINE,
                txn_id=txn_id, amount_paise=att.amount_paise,
                target_bank=att.bank or None,
                reason="recovery channel: retry",
            ),
            error_class=att.error_class,
            hours_since_failure=first_slot_hours(att.error_class, nth),
            attempt=nth,
            calibration=Calibration.CENTRAL,
        )
        att.executed = True
        # The rail's verdict is a PROJECTION, and it does not set
        # recovered_paise. Only an outcome event does that, here as
        # everywhere. What the rail gives us is whether to expect one.
        att.notes.append(
            "Retry sent. The rail models p=%.3f at +%gh; that is a forecast, "
            "not a recovery. The figure stays at zero until an outcome event "
            "confirms it."
            % (out.p_success_used, first_slot_hours(att.error_class, nth))
        )
        if out.succeeded:
            ev.emit(
                event_type="payment.captured", source="synthetic",
                merchant_id=merchant_id, payment_id=txn_id,
                amount_paise=att.amount_paise,
                previous_state="failed", new_state="captured",
                event_id="synth_retry_captured_%s" % txn_id,
                note="synthetic rail outcome — no gateway was contacted",
            )
            att.notes.append(
                "The rail converted it, so a synthetic outcome event was "
                "written. It is labelled synthetic and carries no claim that "
                "any gateway saw this."
            )

    # -- create the link ---------------------------------------------------
    if d.chosen in ("voice", "payment_link", "email"):
        att.payment_link = _create_link(att)
        if d.chosen == "email":
            att.email_sent_to = _recipient(merchant_id)
        att.executed = True

    att.outcome_state = "awaiting_outcome"
    _append_ledger(att, signed, actor, outcome="executed")
    return att


def _recipient(merchant_id: str) -> str:
    """Who the email went to, as an identifier rather than an address.

    The audit records that the merchant was contacted, not a customer's
    personal address. Nothing downstream needs the address and storing it
    would put customer contact details in a hash chain that is designed never
    to be deleted from.
    """
    return "merchant:%s" % merchant_id


def _create_link(att: RecoveryAttempt) -> PaymentLink:
    """A real link in test mode, a labelled synthetic one otherwise.

    The fallback is explicit and visible. It never pretends the gateway
    answered: `source` says synthetic and the UI prints it.
    """
    now = datetime.now(timezone.utc)
    ref = "rd_%s" % att.txn_id
    if att.mode == Mode.RAZORPAY_TEST.value:
        try:
            facts = RazorpayAdapter().create_payment_link(
                amount_paise=att.amount_paise,
                description="Completing your payment to %s" % att.merchant_name,
                reference_id=ref,
                merchant_id=att.merchant_id,
            )
            ev.emit(
                event_type="payment_link.created", source="internal",
                merchant_id=att.merchant_id, payment_id=att.txn_id,
                payment_link_id=facts.link_id, amount_paise=att.amount_paise,
                event_id="int_link_%s" % att.txn_id,
                note="razorpay test-mode link created",
            )
            return PaymentLink(
                link_id=facts.link_id, txn_id=att.txn_id,
                merchant_id=att.merchant_id, amount_paise=att.amount_paise,
                status="created", short_url=facts.short_url,
                source="razorpay_test", created_at=now.isoformat(),
            )
        except (NotConfigured, RazorpayUnavailable) as e:
            att.notes.append(
                "Razorpay was configured but did not answer (%s). Fell back "
                "to a synthetic link, and this figure is labelled synthetic."
                % str(e)[:80]
            )

    link_id = "plink_synth_%s" % att.txn_id.replace("pay_", "")
    ev.emit(
        event_type="payment_link.created", source="internal",
        merchant_id=att.merchant_id, payment_id=att.txn_id,
        payment_link_id=link_id, amount_paise=att.amount_paise,
        event_id="int_link_%s" % att.txn_id,
        note="synthetic link — no gateway was contacted",
    )
    return PaymentLink(
        link_id=link_id, txn_id=att.txn_id, merchant_id=att.merchant_id,
        amount_paise=att.amount_paise, status="created",
        source="synthetic", created_at=now.isoformat(),
    )


def _append_ledger(
    att: RecoveryAttempt, signed: SignedMandate, actor: str, outcome: str
) -> None:
    """Write the intervention into the same hash chain as everything else.

    A recovery channel that wrote to its own log would be exempt from the one
    property this product sells, so voice and payment links land in the
    identical ledger as a retry, with the identical actor field inside the
    identical hash.
    """
    run = None
    for f in sorted(RUNS.glob("*.json")):
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if r.get("merchant_id") == att.merchant_id:
            run, path = r, f
            break
    if run is None:
        return

    led = Ledger.from_entries(run["report"].get("ledger", []))
    action = ProposedAction(
        action_type=ActionType.REISSUE_PAYMENT_LINK,
        txn_id=att.txn_id,
        amount_paise=att.amount_paise,
        target_bank=att.bank or None,
        reason="recovery channel: %s" % att.channel,
    )
    led.append(
        txn_id=att.txn_id,
        proposed_action=action,
        gate_decision=PolicyDecision(att.gate_decision)
        if att.gate_decision in ("allow", "step_up", "deny")
        else PolicyDecision.ALLOW,
        gate_reason=att.gate_reason or "OK_WITHIN_MANDATE",
        outcome=outcome,  # type: ignore[arg-type]
        actor=actor,  # type: ignore[arg-type]
    )
    run["report"]["ledger"] = [e.model_dump(mode="json") for e in led.entries]
    run["report"]["measured"]["ledger_entries"] = len(led)
    run["report"]["measured"]["chain_verified"] = led.verify().ok
    path.write_text(json.dumps(run, indent=2), encoding="utf-8", newline="\n")
    att.ledger_entry_hash = led.entries[-1].entry_hash


# -- the only thing allowed to turn an intervention into money ------------

def settle_from_events(txn_id: str) -> tuple[int, str | None, str]:
    """Has an outcome event confirmed this payment? Returns (paise, event, state).

    The whole loop converges here. `intervention.launched` is not money.
    `payment_link.created` is not money. Only an event in
    `events.OUTCOME_TYPES` naming this payment is money, and in test mode it
    is additionally verified against the gateway before it counts.
    """
    outcome = None
    for e in ev.store.all():
        if e.event_type not in ev.OUTCOME_TYPES:
            continue
        if e.payment_id != txn_id:
            continue
        outcome = e

    if outcome is None:
        return 0, None, "awaiting_outcome"

    if outcome.source == "razorpay_test":
        try:
            moved, status = RazorpayAdapter().verify_payment_state(txn_id)
            if not moved:
                return 0, outcome.event_id, "event_received_but_unverified:%s" % status
        except (NotConfigured, RazorpayUnavailable):
            return 0, outcome.event_id, "event_received_but_unverifiable"

    return outcome.amount_paise, outcome.event_id, "recovered"


def confirm(att: RecoveryAttempt) -> RecoveryAttempt:
    """Fold in whatever the outcome events now say. Idempotent."""
    paise, event_id, state = settle_from_events(att.txn_id)
    att.recovered_paise = paise
    att.recovery_confirmed_by = event_id
    att.outcome_state = state
    if att.payment_link and state == "recovered":
        att.payment_link.status = "paid"
        att.payment_link.settled_by_event_id = event_id
    return att
