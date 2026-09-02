"""What needs a person, and why — a queue over decisions that already exist.

WHAT THIS IS NOT
----------------
It is not a policy engine. `chitragupta/policy.py` remains the only thing that
decides whether an action is permitted, and this module calls it rather than
reimplementing any part of it. A DENY here is the kernel's DENY, and no
control on any screen can turn it into an ALLOW -- enforced server-side in
`review()`, not merely greyed out in the UI, because a disabled button is a
suggestion and a rejected request is a rule.

It is not a second audit system. A human decision is written into the SAME
hash chain as everything else, using the fields that are already inside the
hash: `actor` records who, and `proposed_action.reason` records the structured
override reason. Nothing about `LedgerEntry` changes, so every committed chain
still verifies.

It is not another agent. No model is called anywhere in this file.

WHAT IT ADDS
------------
Exactly one thing that did not exist: the judgement that a permitted action
can still be one a person should look at.

`policy.evaluate` answers "is this allowed?". That is a question about
authority, and it is correctly blind to how good the evidence is. So an action
can clear the mandate on a diagnosis whose attribution sits inside its own
error bar, on an underpowered batch, on an error code the classifier was
unsure about -- permitted, and not obviously a good idea.

Control Tower asks the second question: **given that it is allowed, is it
justified?** Where the evidence does not support acting alone, the answer is
HUMAN REVIEW rather than a confident AUTO-ALLOW. That is abstention, and it is
the point of the feature:

    Automate what can be justified. Escalate what cannot.

EVERY SIGNAL IS REAL
--------------------
Nothing here is invented. Evidence quality is built from four measurements the
pipeline already produces:

  * the classifier's own confidence on this payment's error code, and whether
    it came from the published taxonomy or from a model
  * whether the primary factor's attribution clears its OWN measured error
    (the same ratio `plan.py` gates on)
  * whether the decomposition is reliable and the batch adequately powered
  * whether the factor is identified at all, or degenerate

Where a field genuinely does not exist, it is `None` and renders as
"unavailable" -- never as a plausible number.
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

from .channels import ChannelDecision, decide as decide_channel
from .mode import stamp as mode_stamp

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "data" / "synthetic"
RUNS = ROOT / "data" / "runs"
REVIEWS = ROOT / "data" / "reviews"

#: The five states. NOT a parallel policy -- a view over the kernel's verdict
#: crossed with whether the evidence justifies acting without a person.
State = Literal["auto_allow", "hold", "deny", "escalate", "human_review"]

#: Above this ratio of attribution to its own measured error, the signal
#: clears its noise floor by a factor of two and the engine is allowed to act
#: alone. Deliberately the SAME constant `plan.py` gates auto-execution on --
#: two different thresholds for "strong enough to act on" is how a product
#: ends up disagreeing with itself.
AUTO_RATIO = 2.0

#: Below this, the classifier was not sure enough about the error code for the
#: rest of the chain to mean much. The graph already routes anything under
#: 0.85 to human_review at classification time; this is the same line.
CLASSIFIER_FLOOR = 0.85

#: Structured override reasons. Free text alone is not auditable -- six months
#: later "looked wrong" tells you nothing, and a reason code tells you which
#: control to fix.
OVERRIDE_REASONS = {
    "insufficient_evidence": "The evidence did not support the recommendation.",
    "customer_context": "Something about this customer the system cannot see.",
    "merchant_exception": "The merchant asked for different handling.",
    "policy_exception": "An operational exception, recorded as one.",
    "operational_issue": "A system or process problem, not a payment problem.",
    "other": "Something else -- an explanation is required.",
}


class Evidence(BaseModel):
    """How good the case for acting is. Every field measured, none invented."""

    #: 0-1. None when the error code is not in the classification table.
    classifier_confidence: float | None = None
    #: taxonomy | llm | None
    classifier_source: str | None = None
    #: attribution / its own MAE, for the run's primary factor. None when the
    #: factor has no measured error on file.
    attribution_ratio: float | None = None
    attribution_pts: float | None = None
    attribution_mae: float | None = None
    #: Straight from the decomposition. Facts about the batch, not opinions.
    decomposition_reliable: bool | None = None
    batch_underpowered: bool | None = None
    factor_identified: bool | None = None

    #: strong | adequate | weak | unavailable
    grade: str = "unavailable"
    #: Which of the checks above failed, in words a person can act on.
    gaps: list[str] = []

    def sufficient(self) -> bool:
        """Is this enough to act on without a person looking?"""
        return self.grade in ("strong", "adequate")


class Outcome(BaseModel):
    """What actually happened, if anything has. Never predicted."""

    state: str = "not_executed"
    executed_action: str | None = None
    recovered_paise: int = 0
    confirmed_by_event: str | None = None
    ledger_entry_hash: str | None = None


class Review(BaseModel):
    """A human decision on one queue item. Written into the hash chain."""

    decision_id: str
    at: str
    actor: str
    ai_recommendation: str
    policy_result: str
    human_decision: str
    reason_code: str
    note: str = ""
    final_decision: str
    #: The chain entry this produced, so the audit is one hop away.
    ledger_entry_hash: str | None = None
    executed: bool = False


class Decision(BaseModel):
    """One thing that may need a person, with everything needed to judge it."""

    decision_id: str
    merchant_id: str
    merchant_name: str
    payment_id: str
    run_id: str | None = None

    revenue_at_stake_paise: int
    error_class: str
    error_code: str | None = None
    bank: str | None = None
    prior_attempts: int = 0

    # -- what the system recommends (channels.py, deterministic) ------------
    recommended_action: str
    recommended_channel: str
    recommendation_reason: str
    #: ASSUMPTION-derived, from channels.CHANNEL_PICKUP. Labelled as such.
    expected_recovery_paise: int = 0
    expected_recovery_basis: str = "assumption"

    # -- what the kernel says (policy.py, authoritative) -------------------
    policy_result: str
    policy_rule: str
    mandate_scope: list[str] = []
    auto_execute_limit_paise: int = 0
    max_amount_paise: int = 0

    # -- why (the run's own diagnosis; never regenerated here) -------------
    root_cause: str | None = None
    diagnosis_summary: str | None = None
    attribution_pts: float | None = None
    attribution_mae: float | None = None

    # -- how good the case is ----------------------------------------------
    evidence: Evidence
    #: 0-1, or None. Derived from measured signals; see `_confidence`.
    confidence: float | None = None
    uncertainty: str = "unavailable"

    # -- the verdict this module adds --------------------------------------
    state: State
    state_reason: str
    priority: str
    priority_score: float
    priority_reasons: list[str] = []
    human_review_required: bool = False
    #: Is a PERSON what this is blocked on? False for a settled auto-allow, a
    #: failure no channel converts, and an issuer held on a clock. Those are
    #: ineligible for automation without being anybody's task.
    requires_attention: bool = True
    #: Why not, when not. Shown rather than hidden.
    not_actionable_reason: str | None = None
    #: What a person is allowed to do here. Enforced in review(), not just UI.
    permitted_human_actions: list[str] = []
    override_blocked_reason: str | None = None

    # -- the counterfactual, if the lab has one for this merchant ----------
    counterfactual: dict | None = None

    # -- what has happened so far -------------------------------------------
    outcome: Outcome = Outcome()
    reviews: list[Review] = []

    created_at: str
    #: Requests already raised for the missing evidence.
    evidence_requests: list[dict] = []


class Queue(BaseModel):
    decisions: list[Decision]
    #: Every failed payment that was evaluated.
    total: int
    #: Of those, how many the system cannot act on alone. Most of them, and
    #: that is the honest shape of the problem rather than a failure.
    not_eligible_for_autonomous: int = 0
    #: Of THOSE, how many a person is actually blocked on. The rest are
    #: blocked on the world or on a clock.
    needing_attention: int
    counts_by_state: dict[str, int]
    counts_by_filter: dict[str, int]
    mode: str = ""
    mode_label: str = ""
    note: str = ""


# -- reading the state the rest of the product already produced -----------

def _merchant(merchant_id: str) -> dict:
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _run_for(merchant_id: str) -> tuple[dict | None, Path | None]:
    for f in sorted(RUNS.glob("run_*.json")):
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if r.get("merchant_id") == merchant_id:
            return r, f
    return None, None


def _primary_factor(run: dict) -> dict | None:
    """The factor the diagnosis actually named, with its own measured error."""
    dec = run.get("report", {}).get("decomposition", {})
    hyps = run.get("report", {}).get("diagnosis", {}).get("hypotheses") or []
    if not hyps:
        return None
    top = max(hyps, key=lambda h: abs(float(h.get("attribution_pts") or 0)))
    for f in dec.get("factors", []):
        if f.get("factor") == top.get("factor"):
            return {**f, "root_cause_label": top.get("root_cause_label")}
    return {
        "factor": top.get("factor"),
        "points": top.get("attribution_pts"),
        "mae": None,
        "identified": None,
        "root_cause_label": top.get("root_cause_label"),
    }


def _evidence(run: dict | None, error_code: str | None) -> Evidence:
    """Grade the case for acting. Four measured signals, no judgement calls."""
    ev = Evidence()
    if run is None:
        ev.gaps.append("no diagnosis run on file for this merchant")
        return ev

    rep = run.get("report", {})
    dec = rep.get("decomposition", {})

    cls = (rep.get("classifications") or {}).get(error_code or "")
    if cls:
        ev.classifier_confidence = float(cls.get("confidence") or 0)
        ev.classifier_source = cls.get("source")

    pf = _primary_factor(run)
    if pf:
        ev.attribution_pts = pf.get("points")
        ev.attribution_mae = pf.get("mae")
        ev.factor_identified = pf.get("identified")
        if pf.get("mae"):
            ev.attribution_ratio = round(
                abs(float(pf["points"])) / float(pf["mae"]), 3
            )

    ev.decomposition_reliable = dec.get("reliable")
    ev.batch_underpowered = dec.get("underpowered")

    # -- grade it. Any hard gap drops it to weak. --
    gaps: list[str] = []
    if ev.classifier_confidence is None:
        gaps.append("this error code is not in the classification table")
    elif ev.classifier_confidence < CLASSIFIER_FLOOR:
        gaps.append(
            "the classifier was only %.0f%% sure of this error code"
            % (100 * ev.classifier_confidence)
        )
    if ev.attribution_ratio is None:
        gaps.append("no measured error bar on file for the primary factor")
    elif ev.attribution_ratio < AUTO_RATIO:
        gaps.append(
            "the primary cause is %.1fx its own error bar, under the %.0fx "
            "needed to act alone" % (ev.attribution_ratio, AUTO_RATIO)
        )
    if ev.decomposition_reliable is False:
        gaps.append("the decomposition did not hold up on this batch")
    if ev.batch_underpowered:
        gaps.append("the batch is too small to resolve a gap this size")
    if ev.factor_identified is False:
        gaps.append("the primary factor is not identified -- nothing to reweight")

    ev.gaps = gaps
    if not gaps:
        ev.grade = "strong"
    elif len(gaps) == 1 and ev.attribution_ratio is not None and (
        ev.attribution_ratio >= 1.0
    ):
        # One soft gap on a signal that still clears its own noise floor.
        ev.grade = "adequate"
    elif ev.classifier_confidence is None and ev.attribution_ratio is None:
        ev.grade = "unavailable"
    else:
        ev.grade = "weak"
    return ev


def _confidence(ev: Evidence) -> float | None:
    """One number for the card, derived from the measurements above.

    Deliberately NOT a model output and not a probability of success. It is
    the weaker of two ratios the pipeline already computes, scaled to 0-1: how
    sure the classifier was, and how far the attribution clears its own error
    bar. Both are on file; this multiplies nothing it did not measure.

    Returns None -- rendered as "unavailable" -- in two cases, and the second
    one is a bug this caught in its first run.

    TechBazaar's top factor clears its error bar 2.6x, and its classifier was
    100% sure of the error code, so the card said CONFIDENCE 1.00 next to
    EVIDENCE WEAK. Both halves were individually correct and the pair was
    nonsense: that factor is DEGENERATE -- the merchant has effectively one
    value for it, so there is nothing to reweight toward and the ratio is not
    measuring anything. An unidentified factor or an underpowered batch does
    not lower the confidence, it invalidates the thing confidence was computed
    from. So there is no number, and the card says so.
    """
    if ev.factor_identified is False or ev.batch_underpowered:
        return None
    if ev.decomposition_reliable is False:
        return None
    parts: list[float] = []
    if ev.classifier_confidence is not None:
        parts.append(min(1.0, ev.classifier_confidence))
    if ev.attribution_ratio is not None:
        parts.append(min(1.0, ev.attribution_ratio / AUTO_RATIO))
    if not parts:
        return None
    return round(min(parts), 3)


def _uncertainty(ev: Evidence, conf: float | None) -> str:
    if conf is None:
        return "unavailable"
    if ev.grade == "strong":
        return "low"
    if ev.grade == "adequate":
        return "material"
    return "high"


# -- the one judgement this module makes ----------------------------------

def _mandate_block(ch: ChannelDecision) -> str | None:
    """The MANDATE reason a channel was unavailable, if that is what blocked it.

    Needed because the channel layer is deliberately good at its job: it
    refuses to propose actions the kernel would deny, so the kernel is never
    asked and `policy_result` comes back "n/a". Every above-ceiling payment
    then showed as a vague ESCALATE.

    That loses the single most actionable fact about those payments -- that a
    signed limit is what stands in the way, and raising and re-signing it is
    the fix. The reason code is already recorded on the option; this reads it
    rather than re-deciding anything.
    """
    for o in ch.options:
        if o.channel == "retry" and str(o.reason).startswith("DENY_"):
            return str(o.reason)
    return None


def _state(
    policy: str, channel: str, ev: Evidence, ch: ChannelDecision | None = None
) -> tuple[State, str, bool]:
    """Map the kernel's verdict plus the evidence onto a queue state.

    The kernel is authoritative and is never contradicted. What is added is
    the case where an action is PERMITTED and still should not happen
    unattended, which no part of the existing product could express.
    """
    if policy == "deny":
        return "deny", (
            "The signed mandate refuses this. Nothing on this screen can "
            "change that -- the agent has never held the signing key."
        ), False

    if channel in ("escalate", "no_action"):
        blocked = _mandate_block(ch) if ch else None
        if blocked:
            return "deny", (
                "Refused by the signed mandate (%s). No channel is available "
                "because the limit binds every one of them, so nothing was "
                "put to the kernel. Raise the limit and re-sign, or collect "
                "this one by hand." % blocked
            ), False
        if ch is not None and ch.downtime_hold:
            return "hold", (
                "The issuer is degraded. Retrying into it would only burn an "
                "attempt. Resumes when: %s." % ch.resume_condition
            ), False
        return "escalate", (
            "No channel is both permitted and available, so there is nothing "
            "to automate. A person decides what happens next."
        ), True

    if not ev.sufficient():
        return "human_review", (
            "The mandate permits this, but the evidence does not justify "
            "doing it unattended: %s." % ("; ".join(ev.gaps[:2]) or "the case is thin")
        ), True

    if policy == "step_up":
        return "hold", (
            "Above the auto-execute limit. Permitted in kind, waiting on a "
            "person to confirm the amount."
        ), True

    return "auto_allow", (
        "Permitted by the mandate and the evidence clears its own error bar. "
        "No person needed."
    ), False


def _attention(state: State, ch: ChannelDecision | None) -> tuple[bool, str | None]:
    """Is a PERSON what this is blocked on?

    "Not eligible for autonomous action" and "needs an operator" are different
    populations, and conflating them made the queue 1,623 items long -- which
    is a database, not a work queue.

    The distinction is not a new threshold and not new policy. It reads what
    `channels.py` already concluded:

      * a failure no channel converts (an expired card, a failed
        authentication) is blocked on the WORLD. It is correctly ineligible
        for automation, and no operator decision changes it either
      * an issuer held for degradation is blocked on a CLOCK. It resumes on
        its own when the condition clears, which is what `resume_condition`
        says
      * everything else -- a step-up waiting on a click, a refusal waiting on
        a re-signed mandate, an abstention waiting on evidence or a judgement
        -- is blocked on a PERSON

    Nothing is hidden: the ineligible population is counted and reported on
    the same line as the attention population, and any filter still reaches
    it.
    """
    if state == "auto_allow":
        return False, "permitted and justified -- no person needed"

    if ch is not None:
        if ch.chosen == "no_action" and not ch.downtime_hold:
            return False, (
                "no channel converts this class of failure, so there is "
                "nothing for an operator to decide either"
            )
        if ch.downtime_hold:
            return False, (
                "waiting on an issuer, not on a person. Resumes when: %s"
                % ch.resume_condition
            )

    return True, None


def _permitted_actions(state: State) -> tuple[list[str], str | None]:
    """What a person may do here. The enforcement list, not a UI hint.

    ESCALATE is available even on a DENY, because handing a refusal to a
    human is not an override -- it is the correct thing to do with one.
    """
    if state == "deny":
        return ["escalate"], (
            "The policy kernel denied this action. Approving it is not "
            "available at any level of authority: the mandate is signed and "
            "this system cannot widen it. Raise the ceiling and re-sign, or "
            "collect this one by hand."
        )
    return ["approve", "hold", "deny", "escalate"], None


# -- priority -------------------------------------------------------------

def _priority(
    d_amount: int, ev: Evidence, state: State, expected: int, attempts: int
) -> tuple[str, float, list[str]]:
    """A deterministic, explainable score. No model, no learned weights.

    Every term is a real quantity and each one that fires contributes a
    sentence, so the card can say WHY it is near the top rather than showing a
    number nobody can check.
    """
    score = 0.0
    why: list[str] = []

    # money, log-scaled so one large payment does not swamp the queue
    rupees = d_amount / 100
    if rupees > 0:
        import math

        money = min(40.0, 8.0 * math.log10(1 + rupees))
        score += money
        if rupees >= 15_000:
            why.append("high value (%s at stake)" % _rs(d_amount))

    # a person is blocked on it
    if state == "human_review":
        score += 25
        why.append("waiting on a human decision")
    elif state == "escalate":
        score += 18
        why.append("escalated -- no automated path")
    elif state == "deny":
        # A refusal used to score 4, below a routine hold's 12, which buried
        # the highest-value denied payment on the book at rank 30 under
        # smaller holds. That was wrong: a hold needs a click, but a mandate
        # refusal has a concrete remedy -- raise the ceiling and re-sign, or
        # collect by hand -- and the bigger the payment the more that decision
        # is worth making. It ranks above a hold now.
        score += 14
        why.append("refused by the mandate -- the limit is what stands in the way")
    elif state == "hold":
        score += 12
        why.append("held for confirmation")

    # uncertainty is what makes a permitted action worth reading
    if ev.grade == "weak":
        score += 15
        why.append("material uncertainty in the evidence")
    elif ev.grade == "unavailable":
        score += 12
        why.append("no evidence on file to judge it by")

    # what is actually recoverable, so a big unrecoverable payment does not
    # outrank a smaller one that could be won
    if expected > 0:
        import math

        score += min(15.0, 4.0 * math.log10(1 + expected / 100))
        why.append("%s recoverable on the stated assumptions" % _rs(expected))

    # time sensitivity: attempts already spent means the window is closing
    if attempts >= 2:
        score += 8
        why.append("%d of 3 attempts already spent" % attempts)

    band = "high" if score >= 55 else "medium" if score >= 35 else "low"
    return band, round(score, 2), why


def _rs(paise: int) -> str:
    return "Rs %s" % format((paise or 0) // 100, ",d")


# -- building the queue ---------------------------------------------------

_CACHE: dict[str, tuple[float, list[Decision]]] = {}


def _cache_key(merchant_id: str) -> tuple[str, float]:
    _run, path = _run_for(merchant_id)
    mt = path.stat().st_mtime if path else 0.0
    rp = REVIEWS / ("%s.json" % merchant_id)
    if rp.exists():
        mt = max(mt, rp.stat().st_mtime)
    return merchant_id, mt


def build_for(merchant_id: str, signed: SignedMandate) -> list[Decision]:
    """Every failed payment for one merchant, as a reviewable decision.

    Calls `channels.decide` and `policy.evaluate` -- the real ones. Nothing
    about what is permitted is decided here.
    """
    key, mt = _cache_key(merchant_id)
    hit = _CACHE.get(key)
    if hit and hit[0] == mt:
        return hit[1]

    m = _merchant(merchant_id)
    if not m:
        return []
    run, _ = _run_for(merchant_id)
    run_id = run.get("run_id") if run else None
    name = m.get("profile", {}).get("name", merchant_id)

    from .recovery import _bank_health

    health = _bank_health(merchant_id)
    pf = _primary_factor(run) if run else None
    summary = (
        (run.get("report", {}).get("diagnosis", {}) or {}).get("summary")
        if run else None
    )
    reviews = _load_reviews(merchant_id)
    outcomes = _outcomes_for(merchant_id, run)

    now = datetime.now(timezone.utc)
    mandate = signed.mandate
    out: list[Decision] = []

    for t in m.get("transactions", []):
        if t.get("succeeded"):
            continue
        txn_id = t["txn_id"]
        amount = int(t["amount_paise"])
        ecls = t.get("error_class") or "soft_decline"
        attempts = int(t.get("attempts") or 1)

        ch: ChannelDecision = decide_channel(
            txn_id=txn_id, merchant_id=merchant_id, amount_paise=amount,
            error_class=ecls, bank=t.get("bank") or "",
            prior_attempts=attempts, signed=signed, bank_health=health,
        )

        # The kernel. Authoritative, and called rather than reproduced.
        action_for = {
            "retry": ActionType.RETRY_SOFT_DECLINE,
            "payment_link": ActionType.REISSUE_PAYMENT_LINK,
            "email": ActionType.REISSUE_PAYMENT_LINK,
            "voice": ActionType.REISSUE_PAYMENT_LINK,
        }.get(ch.chosen)

        if action_for is None:
            policy_result, policy_rule = "n/a", ch.reason[:80]
        else:
            gate = evaluate(
                ProposedAction(
                    action_type=action_for, txn_id=txn_id,
                    amount_paise=amount, target_bank=t.get("bank") or None,
                    reason="control tower: %s" % ch.chosen,
                ),
                signed,
                GateContext(now=now, attempts_by_txn={txn_id: attempts}),
            )
            policy_result, policy_rule = gate.decision.value, gate.reason_code

        ev = _evidence(run, t.get("error_code"))
        conf = _confidence(ev)
        state, state_reason, needs_human = _state(
            policy_result, ch.chosen, ev, ch
        )
        permitted, blocked = _permitted_actions(state)
        attention, not_actionable = _attention(state, ch)
        expected = ch.expected_recovery_paise
        band, score, why = _priority(amount, ev, state, expected, attempts)

        out.append(Decision(
            decision_id="ct_%s" % txn_id,
            merchant_id=merchant_id, merchant_name=name,
            payment_id=txn_id, run_id=run_id,
            revenue_at_stake_paise=amount,
            error_class=ecls, error_code=t.get("error_code"),
            bank=t.get("bank"), prior_attempts=attempts,
            recommended_action=ch.chosen,
            recommended_channel=ch.chosen,
            recommendation_reason=ch.reason,
            expected_recovery_paise=expected,
            expected_recovery_basis=ch.basis,
            policy_result=policy_result, policy_rule=policy_rule,
            mandate_scope=[a.value for a in mandate.permitted_actions],
            auto_execute_limit_paise=mandate.auto_execute_limit_paise,
            max_amount_paise=mandate.max_amount_paise,
            root_cause=(pf or {}).get("root_cause_label"),
            diagnosis_summary=summary,
            attribution_pts=(pf or {}).get("points"),
            attribution_mae=(pf or {}).get("mae"),
            evidence=ev, confidence=conf,
            uncertainty=_uncertainty(ev, conf),
            state=state, state_reason=state_reason,
            priority=band, priority_score=score, priority_reasons=why,
            human_review_required=needs_human,
            requires_attention=attention,
            not_actionable_reason=not_actionable,
            permitted_human_actions=permitted,
            override_blocked_reason=blocked,
            # Filled in lazily by the detail endpoint. The queue never
            # renders it and run_lab over eight merchants was almost all
            # of the build time.
            counterfactual=None,
            outcome=outcomes.get(txn_id, Outcome()),
            reviews=[r for r in reviews if r.decision_id == "ct_%s" % txn_id],
            created_at=now.isoformat(),
            evidence_requests=_load_requests(merchant_id).get(txn_id, []),
        ))

    out.sort(key=lambda d: -d.priority_score)
    _CACHE[key] = (mt, out)
    return out


def _lab_for(merchant_id: str) -> dict | None:
    """The counterfactual the Recovery Lab already computes. Never recomputed."""
    try:
        from .counterfactual import run_lab

        lab = run_lab(merchant_id)
    except (FileNotFoundError, SystemExit):
        return None
    by = {s.key: s for s in lab.strategies}
    rd, none_ = by.get("revenue_doctor"), by.get("no_intervention")
    if rd is None or none_ is None:
        return None
    return {
        "available": True,
        "label": lab.label,
        "without_intervention_paise": none_.recovered_paise,
        "with_intervention_paise": rd.recovered_paise,
        "delta_paise": rd.recovered_paise - none_.recovered_paise,
        "naive_recovered_paise": by["naive_retry"].recovered_paise
        if "naive_retry" in by else None,
        "naive_mandate_violations": by["naive_retry"].mandate_violations
        if "naive_retry" in by else None,
        "attempts": rd.attempts,
        "note": (
            "Batch-level, from the Recovery Lab: what this policy returned "
            "across the whole batch against doing nothing. Not a per-payment "
            "forecast."
        ),
    }


def _outcomes_for(merchant_id: str, run: dict | None) -> dict[str, Outcome]:
    """What has already happened to each payment, from the ledger and events."""
    out: dict[str, Outcome] = {}
    if run:
        for e in run.get("report", {}).get("ledger", []):
            tid = e.get("txn_id")
            if not tid:
                continue
            pa = e.get("proposed_action") or {}
            out[tid] = Outcome(
                state=e.get("outcome") or "not_executed",
                executed_action=pa.get("action_type"),
                ledger_entry_hash=e.get("entry_hash"),
            )
    from .recovery import settle_from_events

    for tid, o in list(out.items()):
        paise, event_id, state = settle_from_events(tid)
        if paise:
            o.recovered_paise = paise
            o.confirmed_by_event = event_id
            o.state = state
    return out


# -- human decisions, written into the existing chain ---------------------

def _load_reviews(merchant_id: str) -> list[Review]:
    p = REVIEWS / ("%s.json" % merchant_id)
    if not p.exists():
        return []
    try:
        return [Review.model_validate(r) for r in json.loads(p.read_text("utf-8"))]
    except (json.JSONDecodeError, OSError, ValueError):
        return []


def _save_review(merchant_id: str, rv: Review) -> None:
    REVIEWS.mkdir(parents=True, exist_ok=True)
    p = REVIEWS / ("%s.json" % merchant_id)
    have = _load_reviews(merchant_id)
    have.append(rv)
    p.write_text(
        json.dumps([json.loads(r.model_dump_json()) for r in have], indent=2),
        encoding="utf-8", newline="\n",
    )


class ReviewRefused(PermissionError):
    """The requested human action is not available on this decision."""


def review(
    merchant_id: str,
    decision_id: str,
    *,
    human_decision: str,
    reason_code: str,
    note: str = "",
    actor: str = "platform",
    signed: SignedMandate | None = None,
) -> Review:
    """Record a human decision, and execute it if it was an approval.

    THE ENFORCEMENT POINT. The UI disables controls it should not offer, but
    a disabled button is a suggestion; this is the rule. An approve on a
    DENIED decision is refused here, whatever the client sends.
    """
    from .run import load_mandate

    signed = signed or load_mandate(merchant_id)
    decisions = build_for(merchant_id, signed)
    d = next((x for x in decisions if x.decision_id == decision_id), None)
    if d is None:
        raise FileNotFoundError("no such decision: %s" % decision_id)

    if human_decision not in d.permitted_human_actions:
        raise ReviewRefused(
            "%r is not available on this decision. %s"
            % (human_decision, d.override_blocked_reason
               or "Permitted: %s" % ", ".join(d.permitted_human_actions))
        )
    if reason_code not in OVERRIDE_REASONS:
        raise ValueError(
            "reason_code must be one of: %s" % ", ".join(sorted(OVERRIDE_REASONS))
        )
    if reason_code == "other" and not note.strip():
        raise ValueError(
            "reason_code 'other' requires an explanation -- 'other' with no "
            "note is not an auditable reason"
        )

    # -- what actually happens ------------------------------------------
    executed = False
    ledger_hash: str | None = None
    final = human_decision

    if human_decision == "approve":
        from .recovery import execute_recovery

        # The EXISTING execution path, with its own idempotency and stopping
        # rules. Nothing about retries, links or voice is reimplemented here.
        att = execute_recovery(
            merchant_id, d.payment_id, signed,
            confirmed=True, actor=actor,
        )
        executed = att.executed
        ledger_hash = att.ledger_entry_hash
        if att.idempotent_skip:
            final = "already_executed"
    else:
        # A refusal, a hold or an escalation is still a decision, and it goes
        # into the same chain as an approval so the record is symmetrical.
        ledger_hash = _append_review_entry(
            merchant_id, d, human_decision, reason_code, note, actor
        )

    rv = Review(
        decision_id=decision_id,
        at=datetime.now(timezone.utc).isoformat(),
        actor=actor,
        ai_recommendation=d.recommended_action,
        policy_result=d.policy_result,
        human_decision=human_decision,
        reason_code=reason_code,
        note=note.strip(),
        final_decision=final,
        ledger_entry_hash=ledger_hash,
        executed=executed,
    )
    _save_review(merchant_id, rv)
    _CACHE.clear()
    return rv


def _append_review_entry(
    merchant_id: str, d: Decision, human_decision: str,
    reason_code: str, note: str, actor: str,
) -> str | None:
    """Write a non-approval decision into the SAME hash chain.

    No new ledger, no new entry type, no schema change -- every committed
    chain still verifies. The structured reason travels in
    `proposed_action.reason`, which is inside the hash, so it is as
    tamper-evident as the gate decision beside it.
    """
    run, path = _run_for(merchant_id)
    if run is None or path is None:
        return None

    led = Ledger.from_entries(run["report"].get("ledger", []))
    action = ProposedAction(
        action_type=ActionType.FLAG_FOR_INVESTIGATION,
        txn_id=d.payment_id,
        amount_paise=d.revenue_at_stake_paise,
        target_bank=d.bank or None,
        reason=(
            "control tower review: AI recommended %s, policy said %s, "
            "human chose %s (%s)%s"
            % (
                d.recommended_action, d.policy_result, human_decision,
                reason_code, ": %s" % note.strip() if note.strip() else "",
            )
        ),
    )
    led.append(
        txn_id=d.payment_id,
        proposed_action=action,
        # The kernel's verdict is recorded unchanged. A human holding or
        # escalating does not rewrite what the policy said.
        gate_decision=PolicyDecision(d.policy_result)
        if d.policy_result in ("allow", "step_up", "deny")
        else PolicyDecision.ALLOW,
        gate_reason=d.policy_rule,
        outcome="escalated" if human_decision in ("escalate", "deny")
        else "merchant_action",
        actor=actor,  # type: ignore[arg-type]
    )
    run["report"]["ledger"] = [e.model_dump(mode="json") for e in led.entries]
    run["report"]["measured"]["ledger_entries"] = len(led)
    run["report"]["measured"]["chain_verified"] = led.verify().ok
    path.write_text(json.dumps(run, indent=2), encoding="utf-8", newline="\n")
    return led.entries[-1].entry_hash


# -- missing evidence, made actionable ------------------------------------

#: Each gap maps to something this system can genuinely go and get. Nothing
#: here asks a model to fill a hole in the evidence.
EVIDENCE_ACTIONS: dict[str, dict] = {
    "classifier": {
        "label": "Classify this error code from the published taxonomy",
        "how": "Upload the NPCI/Razorpay error table on the Data page, or "
               "re-run the diagnosis so the classifier sees this code again.",
        "route": "/data",
    },
    "attribution": {
        "label": "Strengthen the attribution",
        "how": "Re-run the diagnosis on a larger batch. The batch-size power "
               "curve on the Validation page shows what this merchant's "
               "volume can resolve.",
        "route": "/run",
    },
    "power": {
        "label": "Get more payments",
        "how": "This batch is too small to resolve a gap this size. Upload a "
               "longer period on the Data page.",
        "route": "/data",
    },
    "merchant": {
        "label": "Ask the merchant what changed",
        "how": "The merchant's own account is a real input -- the claims "
               "reader turns a sentence into a typed claim the arithmetic "
               "then adjudicates.",
        "route": "/run",
    },
}


def evidence_requests_for(d: Decision) -> list[dict]:
    """Which real evidence would move this decision, given what is missing."""
    want: list[dict] = []
    ev = d.evidence
    if ev.classifier_confidence is None or (
        ev.classifier_confidence < CLASSIFIER_FLOOR
    ):
        want.append({"key": "classifier", **EVIDENCE_ACTIONS["classifier"]})
    if ev.attribution_ratio is None or ev.attribution_ratio < AUTO_RATIO:
        want.append({"key": "attribution", **EVIDENCE_ACTIONS["attribution"]})
    if ev.batch_underpowered:
        want.append({"key": "power", **EVIDENCE_ACTIONS["power"]})
    if ev.gaps:
        want.append({"key": "merchant", **EVIDENCE_ACTIONS["merchant"]})
    return want


def _load_requests(merchant_id: str) -> dict[str, list[dict]]:
    p = REVIEWS / ("%s_requests.json" % merchant_id)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def request_evidence(merchant_id: str, decision_id: str, key: str) -> dict:
    """Raise an evidence request. Records what was asked for, and when.

    It does NOT invent the evidence. The request sits open until the
    underlying data actually changes, at which point `reevaluate` produces a
    new decision from the new state.
    """
    if key not in EVIDENCE_ACTIONS:
        raise ValueError("no such evidence request: %s" % key)
    txn_id = decision_id.replace("ct_", "", 1)
    REVIEWS.mkdir(parents=True, exist_ok=True)
    p = REVIEWS / ("%s_requests.json" % merchant_id)
    have = _load_requests(merchant_id)
    entry = {
        "key": key,
        **EVIDENCE_ACTIONS[key],
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
    }
    have.setdefault(txn_id, [])
    if any(r["key"] == key for r in have[txn_id]):
        return {"already_open": True, "request": entry}
    have[txn_id].append(entry)
    p.write_text(json.dumps(have, indent=2), encoding="utf-8", newline="\n")
    _CACHE.clear()
    return {"already_open": False, "request": entry}


def reevaluate(merchant_id: str, decision_id: str) -> Decision:
    """Re-derive one decision from whatever the state is NOW.

    Cheap and honest: it drops the cache and rebuilds from the same sources.
    If nothing underneath has changed, the decision does not change either --
    which is the correct outcome and is asserted by a test.
    """
    from .run import load_mandate

    _CACHE.clear()
    decisions = build_for(merchant_id, load_mandate(merchant_id))
    d = next((x for x in decisions if x.decision_id == decision_id), None)
    if d is None:
        raise FileNotFoundError("no such decision: %s" % decision_id)
    return d


# -- the queue ------------------------------------------------------------

#: `attention` is the primary one and the page's default: what a person is
#: actually blocked on. The rest reach the full population, which is never
#: hidden -- only un-defaulted.
FILTERS = ("attention", "urgent", "high_value", "uncertain", "policy", "all")

#: Kept for the states a person can act on. `requires_attention` is the
#: finer-grained answer and the one the queue uses; this remains because
#: several tests and the state legend are written against it.
ATTENTION_STATES = ("human_review", "escalate", "hold", "deny")


def _matches(d: Decision, f: str) -> bool:
    if f == "all":
        return True
    if f == "attention":
        return d.requires_attention
    if f == "urgent":
        return d.priority == "high" and d.requires_attention
    if f == "high_value":
        return d.revenue_at_stake_paise >= 1_500_000
    if f == "uncertain":
        return d.evidence.grade in ("weak", "unavailable")
    if f == "policy":
        return d.state in ("deny", "hold")
    return d.state == f


def build_queue(
    *, merchant_id: str | None = None, filt: str = "all", limit: int = 40
) -> Queue:
    """The attention queue across the book, or one merchant."""
    from .run import load_mandate

    ids = [merchant_id] if merchant_id else [
        p.stem.replace("merchant_", "") for p in sorted(SYNTH.glob("merchant_*.json"))
    ]

    everything: list[Decision] = []
    for mid in ids:
        try:
            everything.extend(build_for(mid, load_mandate(mid)))
        except (SystemExit, FileNotFoundError):
            continue

    by_state: dict[str, int] = {}
    for d in everything:
        by_state[d.state] = by_state.get(d.state, 0) + 1

    by_filter = {f: sum(1 for d in everything if _matches(d, f)) for f in FILTERS}
    ineligible = [d for d in everything if d.state != "auto_allow"]
    attention = [d for d in everything if d.requires_attention]
    shown = [d for d in everything if _matches(d, filt)]
    shown.sort(key=lambda d: -d.priority_score)

    return Queue(
        decisions=shown[:limit],
        total=len(everything),
        not_eligible_for_autonomous=len(ineligible),
        needing_attention=len(attention),
        counts_by_state=by_state,
        counts_by_filter=by_filter,
        note=(
            "Generated from the same batches, the same diagnosis runs and the "
            "same policy kernel the rest of the product uses. No decision "
            "here was invented for the queue, and none is hidden: the "
            "ineligible population is counted on the same line and the All "
            "filter reaches every one of them."
        ),
        **mode_stamp(),
    )
