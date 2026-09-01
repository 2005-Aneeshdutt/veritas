"""The Counterfactual Recovery Lab: what the same batch was worth under other policies.

WHY THIS EXISTS
---------------
Every recovery product reports one number: what it recovered. That number is
unfalsifiable on its own. Recovering Rs 40,000 is excellent if the alternative
was Rs 5,000 and unremarkable if a `for` loop over the failure export would
have got Rs 55,000. Nobody publishes the second comparison, so nobody can tell
the two apart.

This runs the SAME batch of failed payments through four policies and marks
all of them against the same hidden truth:

    A  NO INTERVENTION   the floor. Quoted only to price the others.
    B  NAIVE RETRY       retry every failure, three times, fixed delay. No
                         error-class filter, no attempt history, no mandate.
    C  STATIC RULES      retry the recoverable classes on a fixed backoff.
                         What a competent engineer builds in an afternoon,
                         and the comparison that actually counts.
    D  REVENUE DOCTOR    class-aware eligibility, history-aware attempt
                         budget, bank-aware delays from sequence.py, every
                         attempt gated by the signed mandate, and an evidence
                         floor below which it declines to act at all.

THE PROPERTY THAT MAKES THE NUMBERS WORTH ANYTHING
--------------------------------------------------
`retry_conversions` on the merchant's GroundTruth says, for every recoverable
failure, whether a retry would truly have converted. It is a counterfactual
the rail is *guessing* at, and it is not on `Transaction` -- the engine has
never been able to see it and neither can any strategy here.

That separation is enforced structurally, not by convention. A strategy is a
function of `(batch, mandate)` and nothing else; it returns its decisions;
only then does `_reveal` load the truth and mark them. No `decide_*` below
takes a truth argument, and a test fails if one grows one.

WHAT IS MEASURED AND WHAT IS MODELLED, STATED ONCE
--------------------------------------------------
  measured      which payments converted, and what they were worth. Read from
                the generating distribution -- the same standard as the
                +/-0.57pt attribution claim, not a live payment rail.
  modelled      p_retry_success from mock_rail. Used ONLY to decide what to
                attempt. It never contributes a rupee to a recovered figure.
  assumption    friction cost per attempt. One constant, stated below, and
                surfaced in the UI next to every figure derived from it.

A/B/C/D are all COUNTERFACTUAL: they are replays over a batch, not things
that happened. The one OBSERVED result in this file is `observed`, lifted
from the canonical run's own ledger, and it is labelled separately everywhere
it surfaces.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from pydantic import BaseModel

from chitragupta.mandate import SignedMandate, parse_iso
from chitragupta.policy import GateContext, ReasonCode, evaluate
from chitragupta.rails.mock_rail import p_retry_success
from chitragupta.types import ActionType, PolicyDecision, ProposedAction

from .features import RECOVERABLE
from .sequence import NAIVE_HOURS, ladder_for

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "data" / "synthetic"
RUNS = ROOT / "data" / "runs"

#: ASSUMPTION, not a measurement. What one remediation attempt costs the
#: merchant before anything converts: the gateway's per-authorisation fee plus
#: the servicing cost of the decline notification a failed retry sends.
#:
#: Rs 3.00. Deliberately small and deliberately visible -- the point of
#: pricing friction at all is that a policy which spends four hundred attempts
#: to earn what another earns in ninety is not free, and the honest way to
#: show that is one stated constant rather than a hidden weighting. Every
#: figure derived from it is labelled an assumption in the API response.
FRICTION_PAISE_PER_ATTEMPT = 300

#: The evidence floor, as modelled odds. Below this, spending one of the
#: mandate's three attempts is not justified, so Revenue Doctor abstains
#: rather than retrying on the off-chance.
#:
#: 0.20 sits under the central soft-decline peak (0.34) and above the dead
#: zone the delay curve assigns to a retry fired inside six hours (0.153), so
#: it binds on badly-timed attempts without excluding a whole error class.
DEFAULT_P_FLOOR = 0.20


# -- what a strategy returns ----------------------------------------------

class Disposition:
    """What a policy decided to do with one payment. Five outcomes, not two.

    ABSTAIN is the one most systems do not have, and it is the reason this
    enumeration exists. "We looked at this payment and chose to do nothing"
    is a different statement from "the mandate refused it" and from "we never
    considered it", and a product that cannot tell them apart cannot explain
    why it left money on the table.
    """

    RECOVER = "recover"      # attempted against the rail
    HOLD = "hold"            # gate said STEP_UP: waiting on the merchant
    DENY = "deny"            # gate said DENY: outside the mandate
    ESCALATE = "escalate"    # handed to a human, never auto-executed
    ABSTAIN = "abstain"      # declined on evidence or economics


class Decision(BaseModel):
    """One policy's verdict on one payment. Contains no outcome."""

    model_config = {"frozen": True}

    txn_id: str
    amount_paise: int
    error_class: str
    disposition: str
    #: How many attempts this policy would spend. 0 for everything but RECOVER.
    attempts: int = 0
    #: Modelled odds of the best available slot. PROJECTED; never a rupee.
    p_best: float = 0.0
    reason: str = ""
    #: Did a human see this before it went ahead? False for anything the
    #: agent auto-executed under the mandate, True for a released STEP_UP.
    #: Policies that have no concept of review leave it False, which is the
    #: correct answer for them.
    supervised: bool = False


class StrategyResult(BaseModel):
    """One policy, marked against the truth it never saw."""

    key: str
    name: str
    blurb: str
    #: counterfactual | observed
    basis: str

    # -- what it decided. No truth involved. --
    eligible: int
    attempted_payments: int
    attempts: int
    held: int
    denied: int
    escalated: int
    abstained: int
    held_paise: int
    denied_paise: int
    abstained_paise: int

    # -- what actually happened, revealed after the fact --
    converted: int
    recovered_paise: int
    recovery_rate: float
    wasted_attempts: int
    #: Money put in front of an attempt that could never have converted.
    exposed_paise: int
    #: Money the policy acted on without a human seeing it first.
    unsupervised_paise: int

    # -- safety, checked against the signed mandate --
    mandate_violations: int
    cap_violations: int
    ceiling_violations: int
    #: Attempts aimed at a payment that had already succeeded.
    double_charges: int

    # -- economics, from the stated assumption --
    friction_paise: int
    net_paise: int
    #: Rupees recovered per attempt spent. The efficiency number.
    yield_per_attempt_paise: int


class FrontierPoint(BaseModel):
    """One setting of the autonomy dial, and what it bought.

    The dial is the mandate's `auto_execute_limit_paise`: the amount below
    which the agent may act without asking. It is the only number on the
    mandate a merchant genuinely has to reason about, and until now nobody --
    including this product -- could tell them what a given setting costs.
    """

    #: The auto-execute limit this point was evaluated at.
    auto_limit_paise: int
    attempts: int
    converted: int
    recovered_paise: int
    wasted_attempts: int
    #: Money the agent acted on WITHOUT a human seeing it first. The price of
    #: the recovery on the same row, and the reason more is not always better.
    unsupervised_paise: int
    held_paise: int
    friction_paise: int
    net_paise: int
    yield_per_attempt_paise: int
    #: True for the limit on the merchant's actual signed mandate.
    shipped: bool = False


class Lab(BaseModel):
    merchant_id: str
    merchant_name: str
    #: Failed payments in the batch, and what they are worth in total.
    batch_failures: int
    at_risk_paise: int
    #: Of those, the ones any policy could sensibly retry.
    recoverable_failures: int
    #: Truth, revealed only for reporting. Of the recoverable failures, how
    #: many would have converted on a retry at all -- the ceiling on the whole
    #: exercise, which no policy can exceed.
    convertible: int
    convertible_paise: int

    strategies: list[StrategyResult]
    frontier: list[FrontierPoint]
    #: The canonical run's real result for this merchant. OBSERVED.
    observed: StrategyResult | None = None
    #: Structured input to the "why this strategy" explanation. Not prose.
    choice: dict = {}

    friction_paise_per_attempt: int = FRICTION_PAISE_PER_ATTEMPT
    p_floor: float = DEFAULT_P_FLOOR
    #: Everything in `strategies` is a replay, not a thing that happened.
    label: str = "SYNTHETIC EVALUATION"
    notes: list[str] = []


# -- the batch ------------------------------------------------------------

class _Payment(BaseModel):
    """Exactly what a strategy is allowed to know about one failed payment.

    Deliberately not `Transaction`: this is the projection a merchant's
    failure export would actually contain. Nothing here says whether a retry
    works.
    """

    model_config = {"frozen": True}

    txn_id: str
    amount_paise: int
    error_class: str
    bank: str
    #: Attempts the merchant already made before anyone saw this batch.
    prior_attempts: int


def _load_batch(merchant_id: str) -> tuple[dict, list[_Payment], set[str]]:
    """Profile, failures, and the settled set. Never touches ground_truth."""
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    if not p.exists():
        raise FileNotFoundError("no such merchant: %s" % merchant_id)
    d = json.loads(p.read_text(encoding="utf-8"))
    failures: list[_Payment] = []
    settled: set[str] = set()
    for t in d["transactions"]:
        if t.get("succeeded"):
            settled.add(t["txn_id"])
            continue
        failures.append(
            _Payment(
                txn_id=t["txn_id"],
                amount_paise=int(t["amount_paise"]),
                error_class=t.get("error_class") or "soft_decline",
                bank=t.get("bank") or "",
                prior_attempts=int(t.get("attempts") or 1),
            )
        )
    return d["profile"], failures, settled


def _technical_share(batch: list[_Payment]) -> dict[str, float]:
    """Per bank, what share of its failures are technical.

    The same signal `sequence.ladder_for` keys on. Computed from the batch, so
    a strategy that uses it is using only what it can see.
    """
    tot: dict[str, int] = {}
    tech: dict[str, int] = {}
    for p in batch:
        tot[p.bank] = tot.get(p.bank, 0) + 1
        if p.error_class == "technical":
            tech[p.bank] = tech.get(p.bank, 0) + 1
    return {b: tech.get(b, 0) / n for b, n in tot.items() if n}


# -- the four policies. None of them sees an outcome. ---------------------

def decide_no_intervention(
    batch: list[_Payment], signed: SignedMandate
) -> list[Decision]:
    """A. Do nothing. The floor, and a marketing number if quoted alone."""
    return [
        Decision(
            txn_id=p.txn_id, amount_paise=p.amount_paise,
            error_class=p.error_class,
            disposition=Disposition.ABSTAIN, reason="NO_POLICY",
        )
        for p in batch
    ]


def decide_naive_retry(
    batch: list[_Payment], signed: SignedMandate
) -> list[Decision]:
    """B. Retry everything, three times, at a flat delay.

    No error-class filter -- an expired card gets asked three more times. No
    attempt history, so a payment the merchant already tried twice gets three
    more and breaches the cap. No mandate, so nothing stops an amount above
    the ceiling. This is not a straw man; it is what a retry loop written
    against a failure export does.
    """
    return [
        Decision(
            txn_id=p.txn_id, amount_paise=p.amount_paise,
            error_class=p.error_class,
            disposition=Disposition.RECOVER, attempts=3,
            p_best=round(p_retry_success(p.error_class, NAIVE_HOURS), 4),
            reason="RETRY_ALL",
        )
        for p in batch
    ]


def decide_static_rules(
    batch: list[_Payment], signed: SignedMandate
) -> list[Decision]:
    """C. Retry the recoverable classes on a fixed backoff. The real baseline.

    Knows the error taxonomy, which is most of the available win, and that is
    exactly why it is the comparison that counts. What it does not know is the
    attempt history, the mandate, or that the right delay for a funding
    decline is not the right delay for an outage.
    """
    recoverable = {e.value for e in RECOVERABLE}
    out: list[Decision] = []
    for p in batch:
        if p.error_class not in recoverable:
            out.append(Decision(
                txn_id=p.txn_id, amount_paise=p.amount_paise,
                error_class=p.error_class,
                disposition=Disposition.ABSTAIN,
                reason="NOT_RECOVERABLE_BY_CLASS",
            ))
            continue
        out.append(Decision(
            txn_id=p.txn_id, amount_paise=p.amount_paise,
            error_class=p.error_class,
            disposition=Disposition.RECOVER, attempts=3,
            p_best=round(p_retry_success(p.error_class, NAIVE_HOURS), 4),
            reason="RETRY_RECOVERABLE",
        ))
    return out


def decide_revenue_doctor(
    batch: list[_Payment],
    signed: SignedMandate,
    *,
    p_floor: float = DEFAULT_P_FLOOR,
    settled: set[str] | None = None,
    now: datetime | None = None,
    confirm_step_ups: bool = False,
) -> list[Decision]:
    """D. The shipped policy, replayed over the batch.

    Four things happen here that do not happen in C, in the order they happen
    in production:

      1. class eligibility -- the same RECOVERABLE set the classifier uses
      2. the evidence floor -- if the best slot on this payment's ladder still
         models below `p_floor`, spending one of three attempts on it is not
         justified, and the policy ABSTAINS. This is the only place in the
         product where the answer is "we could act and we are choosing not
         to", and it is the one worth arguing about
      3. a history-aware budget -- the mandate caps attempts per payment IN
         TOTAL, so a payment the merchant already tried twice gets one, not
         three
      4. the signed mandate -- every attempt through `policy.evaluate`, the
         same function the live gate calls. ALLOW attempts, STEP_UP holds for
         the merchant, DENY refuses

    Delays come from `sequence.ladder_for`, so a soft decline on an issuer
    having a bad hour is treated as an incident rather than as an empty
    account. Under ground truth the delay does not change the outcome -- but
    it changes what the policy believes, and therefore what it attempts, which
    is the honest place for a model to have influence.
    """
    now = now or parse_iso(signed.mandate.not_before) + timedelta(days=1)
    settled = settled or set()
    tshare = _technical_share(batch)
    cap = signed.mandate.max_attempts_per_payment
    recoverable = {e.value for e in RECOVERABLE}

    out: list[Decision] = []
    for p in batch:
        # 1. eligibility by class
        if p.error_class not in recoverable:
            out.append(Decision(
                txn_id=p.txn_id, amount_paise=p.amount_paise,
                error_class=p.error_class, disposition=Disposition.ABSTAIN,
                reason="NOT_RECOVERABLE_BY_CLASS",
            ))
            continue

        # 2. the evidence floor, at this payment's own best slot
        ladder = ladder_for(p.error_class, tshare.get(p.bank))
        best = max(
            (p_retry_success(p.error_class, h) for h in ladder), default=0.0
        )
        if best < p_floor:
            out.append(Decision(
                txn_id=p.txn_id, amount_paise=p.amount_paise,
                error_class=p.error_class, disposition=Disposition.ABSTAIN,
                p_best=round(best, 4), reason="BELOW_EVIDENCE_FLOOR",
            ))
            continue

        # 3. what is left of the mandate's per-payment budget
        budget = max(0, cap - p.prior_attempts)
        if budget == 0:
            out.append(Decision(
                txn_id=p.txn_id, amount_paise=p.amount_paise,
                error_class=p.error_class, disposition=Disposition.DENY,
                p_best=round(best, 4), reason=ReasonCode.DENY_MAX_ATTEMPTS,
            ))
            continue

        # 4. the signed mandate, through the live gate
        action = ProposedAction(
            action_type=ActionType.RETRY_SOFT_DECLINE,
            txn_id=p.txn_id,
            amount_paise=p.amount_paise,
            target_bank=p.bank or None,
            reason="counterfactual replay: recoverable failure inside the window",
        )
        ctx = GateContext(
            now=now,
            attempts_by_txn={p.txn_id: p.prior_attempts},
            settled_txns=settled,
        )
        gate = evaluate(action, signed, ctx)
        supervised = False
        if gate.decision is PolicyDecision.DENY:
            disp, att = Disposition.DENY, 0
        elif gate.decision is PolicyDecision.STEP_UP:
            # A STEP_UP is not a refusal. It is the agent stopping to ask.
            # `confirm_step_ups` is the merchant answering yes -- which is a
            # real thing they can do in the product, so the lab has to be able
            # to price it.
            if confirm_step_ups:
                disp, att, supervised = (
                    Disposition.RECOVER, min(budget, len(ladder)), True
                )
            else:
                disp, att = Disposition.HOLD, 0
        else:
            disp, att = Disposition.RECOVER, min(budget, len(ladder))
        out.append(Decision(
            txn_id=p.txn_id, amount_paise=p.amount_paise,
            error_class=p.error_class, disposition=disp, attempts=att,
            p_best=round(best, 4), reason=gate.reason_code,
            supervised=supervised,
        ))
    return out


# -- revealing the truth, strictly after every decision is made -----------

def _ground_truth(merchant_id: str) -> dict[str, bool]:
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get("ground_truth", {}).get("retry_conversions", {}) or {}


def _reveal(
    key: str,
    name: str,
    blurb: str,
    decisions: list[Decision],
    truth: dict[str, bool],
    signed: SignedMandate,
    batch: list[_Payment],
    *,
    basis: str = "counterfactual",
) -> StrategyResult:
    """Mark one policy's decisions against what would truly have happened.

    Called with `truth` for the first time in this module's control flow. No
    `decide_*` above is in scope of this dict.

    The conversion model is the one `scoring.py` already uses and the one the
    generator produces: `retry_conversions[txn]` is a property of the payment,
    not of the attempt. So the first attempt on a convertible payment converts
    it, and no number of attempts converts one that is not. That makes the
    measured comparison independent of delay -- which is the right answer,
    because the delay model is the part this project cannot validate.
    """
    prior = {p.txn_id: p.prior_attempts for p in batch}
    m = signed.mandate

    eligible = sum(
        1 for d in decisions
        if not (d.disposition == Disposition.ABSTAIN
                and d.reason in ("NOT_RECOVERABLE_BY_CLASS", "NO_POLICY"))
    )
    attempted_payments = attempts = converted = recovered = wasted = 0
    exposed = unsupervised = 0
    held = denied = escalated = abstained = 0
    held_paise = denied_paise = abstained_paise = 0
    cap_v = ceiling_v = double = 0

    for d in decisions:
        if d.disposition == Disposition.HOLD:
            held += 1
            held_paise += d.amount_paise
        elif d.disposition == Disposition.DENY:
            denied += 1
            denied_paise += d.amount_paise
        elif d.disposition == Disposition.ESCALATE:
            escalated += 1
        elif d.disposition == Disposition.ABSTAIN:
            abstained += 1
            abstained_paise += d.amount_paise
        elif d.disposition == Disposition.RECOVER and d.attempts > 0:
            attempted_payments += 1
            if not d.supervised:
                unsupervised += d.amount_paise
            hit = bool(truth.get(d.txn_id, False))
            # A convertible payment converts on its first attempt, so a policy
            # that budgeted three spends one. One that is not convertible
            # spends the lot.
            spent = 1 if hit else d.attempts
            attempts += spent
            if hit:
                converted += 1
                recovered += d.amount_paise
            else:
                wasted += spent
                exposed += d.amount_paise

            # -- safety, against the mandate this policy may be ignoring --
            if prior.get(d.txn_id, 0) + spent > m.max_attempts_per_payment:
                cap_v += 1
            if d.amount_paise > m.max_amount_paise:
                ceiling_v += 1

    friction = attempts * FRICTION_PAISE_PER_ATTEMPT
    return StrategyResult(
        key=key, name=name, blurb=blurb, basis=basis,
        eligible=eligible,
        attempted_payments=attempted_payments,
        attempts=attempts,
        held=held, denied=denied, escalated=escalated, abstained=abstained,
        held_paise=held_paise, denied_paise=denied_paise,
        abstained_paise=abstained_paise,
        converted=converted,
        recovered_paise=recovered,
        recovery_rate=(
            round(converted / attempted_payments, 4) if attempted_payments else 0.0
        ),
        wasted_attempts=wasted,
        exposed_paise=exposed,
        unsupervised_paise=unsupervised,
        mandate_violations=cap_v + ceiling_v + double,
        cap_violations=cap_v,
        ceiling_violations=ceiling_v,
        double_charges=double,
        friction_paise=friction,
        net_paise=recovered - friction,
        yield_per_attempt_paise=int(recovered / attempts) if attempts else 0,
    )


# -- the observed arm: what the canonical run really did ------------------

def _observed(
    merchant_id: str, signed: SignedMandate, batch: list[_Payment]
) -> StrategyResult | None:
    """The live system's own result, read from its ledger. MEASURED.

    Kept structurally apart from the four replays and labelled `observed`
    everywhere, because putting a counterfactual next to a real outcome
    without saying which is which is the exact dishonesty this page exists to
    avoid.
    """
    run = None
    for f in sorted(RUNS.glob("*.json")):
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if r.get("merchant_id") == merchant_id:
            run = r
            break
    if run is None:
        return None

    truth = _ground_truth(merchant_id)
    amount = {p.txn_id: p.amount_paise for p in batch}
    ecls = {p.txn_id: p.error_class for p in batch}
    disp_of = {
        "executed": Disposition.RECOVER,
        "exception": Disposition.RECOVER,
        "merchant_action": Disposition.HOLD,
        "denied": Disposition.DENY,
        "escalated": Disposition.ESCALATE,
    }

    decisions: list[Decision] = []
    for e in run["report"].get("ledger", []):
        pa = e.get("proposed_action") or {}
        if pa.get("action_type") != ActionType.RETRY_SOFT_DECLINE.value:
            continue
        tid = e.get("txn_id")
        disp = disp_of.get(e.get("outcome"), Disposition.ABSTAIN)
        decisions.append(Decision(
            txn_id=tid,
            amount_paise=int(pa.get("amount_paise") or amount.get(tid, 0)),
            error_class=ecls.get(tid, "soft_decline"),
            disposition=disp,
            attempts=1 if disp == Disposition.RECOVER else 0,
            reason=e.get("gate_reason") or "",
        ))
    if not decisions:
        return None
    return _reveal(
        "observed", "Revenue Doctor (this run)",
        "The retries the live system actually sent, marked against the same truth.",
        decisions, truth, signed, batch, basis="observed",
    )


# -- the frontier ---------------------------------------------------------

def _resign(signed: SignedMandate, merchant_id: str, auto_limit: int) -> SignedMandate:
    """The same mandate with a different auto-execute limit, properly signed.

    The frontier is a sweep over mandates the merchant COULD sign, so every
    point has to be a mandate that actually verifies -- `policy.evaluate`
    refuses an unverifiable one before it checks anything else, and rightly.
    Re-signing with the demo key exercises the real path rather than smuggling
    an unsigned struct past the gate.
    """
    key_path = ROOT / "data" / "mandates" / ("%s_signing_key.hex" % merchant_id)
    if not key_path.exists():
        return signed
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from chitragupta.mandate import sign_mandate

    priv = Ed25519PrivateKey.from_private_bytes(
        bytes.fromhex(key_path.read_text(encoding="utf-8").strip())
    )
    m = signed.mandate.model_copy(update={"auto_execute_limit_paise": auto_limit})
    return sign_mandate(m, priv)


def _frontier(
    batch: list[_Payment],
    signed: SignedMandate,
    truth: dict[str, bool],
    settled: set[str],
    merchant_id: str,
) -> list[FrontierPoint]:
    """Sweep the autonomy dial and watch the trade curve over.

    The dial is `auto_execute_limit_paise`: how large a payment the agent may
    retry without stopping to ask. It is the one number on a mandate a
    merchant genuinely has to choose, and every merchant on this book picked
    it out of the air, because nobody has a method for choosing it.

    What the sweep shows is that the choice is a trade and not a maximisation.
    Raising the limit does recover more -- and every rupee of that extra
    recovery arrives as money the agent moved with no human in the loop, which
    is the column next to it. A system that cannot show both halves will
    always advise raising the limit.

    Every point is the same batch, the same truth, the same evidence floor.
    Only the limit moves, and each one is a mandate that verifies.
    """
    m = signed.mandate
    grid = sorted({
        0,
        50_000, 100_000, 200_000,
        m.auto_execute_limit_paise,
        500_000, 750_000, 1_000_000,
        m.max_amount_paise,
    })
    pts: list[FrontierPoint] = []
    for limit in grid:
        if limit > m.max_amount_paise:
            continue
        s = _resign(signed, merchant_id, limit)
        d = decide_revenue_doctor(batch, s, settled=settled)
        r = _reveal("f", "f", "", d, truth, s, batch)
        pts.append(FrontierPoint(
            auto_limit_paise=limit,
            attempts=r.attempts,
            converted=r.converted,
            recovered_paise=r.recovered_paise,
            wasted_attempts=r.wasted_attempts,
            unsupervised_paise=r.unsupervised_paise,
            held_paise=r.held_paise,
            friction_paise=r.friction_paise,
            net_paise=r.net_paise,
            yield_per_attempt_paise=r.yield_per_attempt_paise,
            shipped=limit == m.auto_execute_limit_paise,
        ))
    return pts


# -- the whole lab --------------------------------------------------------

def run_lab(merchant_id: str, *, p_floor: float = DEFAULT_P_FLOOR) -> Lab:
    """Run all four policies over one merchant's batch and mark them."""
    from .run import load_mandate

    profile, batch, settled = _load_batch(merchant_id)
    signed = load_mandate(merchant_id)

    # -- decisions first. No truth is in scope above this line. --
    plans = [
        ("no_intervention", "No intervention",
         "Leave the failures alone. The floor every other number is measured from.",
         decide_no_intervention(batch, signed)),
        ("naive_retry", "Naive retry",
         "Retry every failure three times on a fixed delay. No taxonomy, no "
         "attempt history, no mandate.",
         decide_naive_retry(batch, signed)),
        ("static_rules", "Static rules",
         "Retry only the recoverable error classes, fixed backoff. What a "
         "competent engineer builds, and the comparison that counts.",
         decide_static_rules(batch, signed)),
        ("revenue_doctor", "Revenue Doctor",
         "Class-aware, history-aware, bank-aware timing, every attempt gated "
         "by the signed mandate, and an evidence floor below which it abstains.",
         decide_revenue_doctor(batch, signed, p_floor=p_floor, settled=settled)),
        ("revenue_doctor_confirmed", "Revenue Doctor + merchant approval",
         "The same policy with the merchant confirming every action the gate "
         "held. Nothing the mandate DENIED is released -- confirming is not "
         "widening.",
         decide_revenue_doctor(
             batch, signed, p_floor=p_floor, settled=settled,
             confirm_step_ups=True,
         )),
    ]

    # -- and only now the truth --
    truth = _ground_truth(merchant_id)
    results = [_reveal(k, n, b, d, truth, signed, batch) for k, n, b, d in plans]

    recoverable = {e.value for e in RECOVERABLE}
    rec_failures = [p for p in batch if p.error_class in recoverable]
    convertible = [p for p in rec_failures if truth.get(p.txn_id, False)]

    lab = Lab(
        merchant_id=merchant_id,
        merchant_name=profile["name"],
        batch_failures=len(batch),
        at_risk_paise=sum(p.amount_paise for p in batch),
        recoverable_failures=len(rec_failures),
        convertible=len(convertible),
        convertible_paise=sum(p.amount_paise for p in convertible),
        strategies=results,
        frontier=_frontier(batch, signed, truth, settled, merchant_id),
        observed=_observed(merchant_id, signed, batch),
        p_floor=p_floor,
        notes=[
            "Every strategy ran on the same %d failed payments from the same "
            "batch, under the same signed mandate." % len(batch),
            "Outcomes were read from the generating distribution only after "
            "each policy had already decided. No strategy can see them.",
            "Rupees per attempt is an assumption (Rs %d), stated so the "
            "friction column can be checked rather than trusted."
            % (FRICTION_PAISE_PER_ATTEMPT // 100),
        ],
    )
    lab.choice = _explain(lab)
    return lab


def _explain(lab: Lab) -> dict:
    """Why this policy, in structured fields the UI renders verbatim.

    No prose is generated here and no LLM is consulted. Every number is
    lifted from a StrategyResult that was just computed, so the explanation
    cannot drift from the evaluation it is explaining.
    """
    by = {s.key: s for s in lab.strategies}
    rd = by["revenue_doctor"]
    confirmed = by["revenue_doctor_confirmed"]
    naive = by["naive_retry"]
    static = by["static_rules"]

    ceiling = lab.convertible_paise
    return {
        "selected": "revenue_doctor",
        "expected_recovery_paise": rd.recovered_paise,
        "friction_paise": rd.friction_paise,
        "net_paise": rd.net_paise,
        "attempts": rd.attempts,
        "yield_per_attempt_paise": rd.yield_per_attempt_paise,
        "recovery_rate": rd.recovery_rate,
        "mandate_violations": rd.mandate_violations,
        "stop_condition": "pass" if rd.mandate_violations == 0 else "fail",
        # What the ceiling actually is, so no headline can imply more.
        "ceiling_paise": ceiling,
        "share_of_ceiling": (
            round(rd.recovered_paise / ceiling, 4) if ceiling else 0.0
        ),
        "alternatives": {
            "naive_retry": {
                "recovered_paise": naive.recovered_paise,
                "attempts": naive.attempts,
                "wasted_attempts": naive.wasted_attempts,
                "exposed_paise": naive.exposed_paise,
                "cap_violations": naive.cap_violations,
                "ceiling_violations": naive.ceiling_violations,
                "yield_per_attempt_paise": naive.yield_per_attempt_paise,
            },
            "static_rules": {
                "recovered_paise": static.recovered_paise,
                "attempts": static.attempts,
                "wasted_attempts": static.wasted_attempts,
                "cap_violations": static.cap_violations,
                "yield_per_attempt_paise": static.yield_per_attempt_paise,
            },
        },
        # The honest headline. This is not "we recovered more".
        "attempts_avoided_vs_naive": naive.attempts - rd.attempts,
        "wasted_attempts_avoided_vs_naive": naive.wasted_attempts - rd.wasted_attempts,
        "exposure_avoided_vs_naive_paise": naive.exposed_paise - rd.exposed_paise,
        "violations_avoided_vs_naive": (
            naive.mandate_violations - rd.mandate_violations
        ),
        "held_for_merchant_paise": rd.held_paise,
        "refused_by_mandate_paise": rd.denied_paise,
        # What one click would release. The held set is not a refusal, and a
        # comparison that treats it as one understates the policy by exactly
        # this much.
        "if_merchant_confirms": {
            "recovered_paise": confirmed.recovered_paise,
            "converted": confirmed.converted,
            "attempts": confirmed.attempts,
            "unsupervised_paise": confirmed.unsupervised_paise,
            "share_of_ceiling": (
                round(confirmed.recovered_paise / ceiling, 4) if ceiling else 0.0
            ),
        },
    }
