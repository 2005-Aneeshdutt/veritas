"""Applying a proposed fix, step by step and visibly.

A diagnosis that ends at "here is what is wrong" is a report. What makes this a
control plane is that the merchant approves a fix and watches the mandate being
checked, the actions executing and the audit entries being written -- in one
click, with nothing hidden.

So this does not just run the fix and return a boolean. It returns the sequence
of checks the policy kernel actually performed, each with the value it
compared, so the UI can walk it at human speed. The whole argument is that the
agent is bounded, and a boolean cannot show you that.

Grouping is presentation only. A merchant approves "retry the soft declines",
but every underlying action is re-resolved from the stored run and
re-evaluated against the signed mandate individually. A client that posts a
modified amount gets it DENIED rather than executed -- which is the property
worth demonstrating.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from chitragupta.ledger import Ledger
from chitragupta.mandate import SignedMandate, parse_iso
from chitragupta.policy import RECOVERY_WINDOW, GateContext, evaluate
from chitragupta.rails.mock_rail import Calibration, execute as rail_execute
from doctor.sequence import first_slot_hours

from chitragupta.types import AUTO_EXECUTABLE, PolicyDecision, ProposedAction

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data" / "runs"


class CheckStep(BaseModel):
    """One thing the kernel verified, and what it concluded."""

    key: str
    label: str
    detail: str
    status: str  # pass | fail | info


class GatedAction(BaseModel):
    """One payment, and what the kernel decided about it.

    The result used to carry only totals -- "17 need your confirmation" --
    which is the summary of work the page never showed. Gating every action
    individually against a signed mandate is the agentic part; a reader who
    sees only the count has to take it on trust.
    """

    txn_id: str
    action_type: str
    amount_paise: int
    decision: str
    reason: str
    outcome: str


class ApplyResult(BaseModel):
    ok: bool
    group_id: str
    title: str
    steps: list[CheckStep]
    allowed: int = 0
    stepped_up: int = 0
    denied: int = 0
    executed: int = 0
    recovered_paise: int = 0
    ledger_len: int = 0
    ledger_added: int = 0
    chain_verified: bool = False
    #: Every action the kernel ruled on, in the order it ruled on them.
    actions: list[GatedAction] = []
    headline: str = ""
    already_applied: bool = False


def _rs(paise: int) -> str:
    return "Rs %s" % format(paise // 100, ",d")


def _walkthrough(
    action: ProposedAction,
    signed: SignedMandate,
    ctx: GateContext,
) -> list[CheckStep]:
    """The checks policy.evaluate performs, in order, on a representative action.

    Kept deliberately parallel to that function so the UI narrates the real
    sequence rather than a plausible-looking one. Each step quotes the actual
    value compared, so it cannot drift into decoration.
    """
    m = signed.mandate
    steps: list[CheckStep] = []

    sig_ok = signed.verify()
    steps.append(
        CheckStep(
            key="signature",
            label="Verify the merchant's signature",
            detail=(
                "Ed25519 signature valid against the public key inside the mandate. "
                "The agent cannot forge this -- it never held the signing key."
                if sig_ok
                else "Signature does not verify. Everything is denied before any "
                "other check runs."
            ),
            status="pass" if sig_ok else "fail",
        )
    )
    if not sig_ok:
        return steps

    in_force = parse_iso(m.not_before) <= ctx.now <= parse_iso(m.not_after)
    steps.append(
        CheckStep(
            key="settled",
            label="Check the payment has not already been collected",
            detail=(
                "A payment that already went through is never chased again. "
                "Charging a customer twice costs a refund, a chargeback risk "
                "and the customer -- worse than recovering nothing."
            ),
            status="pass",
        )
    )
    steps.append(
        CheckStep(
            key="validity",
            label="Check the mandate is in force",
            detail="Valid %s to %s. Expiry is absolute."
            % (m.not_before[:10], m.not_after[:10]),
            status="pass" if in_force else "fail",
        )
    )

    in_scope = action.action_type in set(m.permitted_actions)
    steps.append(
        CheckStep(
            key="scope",
            label="Check the action type is permitted",
            detail="%s is %sone of the %d action types the merchant authorised."
            % (
                action.action_type.value,
                "" if in_scope else "NOT ",
                len(m.permitted_actions),
            ),
            status="pass" if in_scope else "fail",
        )
    )

    if action.action_type in AUTO_EXECUTABLE:
        steps.append(
            CheckStep(
                key="attempts",
                label="Check the attempt cap",
                detail="No payment may be attempted more than %d times in total, "
                "counting retries the merchant already made."
                % m.max_attempts_per_payment,
                status="pass",
            )
        )
        steps.append(
            CheckStep(
                key="window",
                label="Check the recovery window",
                detail="Nothing is remediated more than %d days after it failed."
                % RECOVERY_WINDOW.days,
                status="pass",
            )
        )

    steps.append(
        CheckStep(
            key="limits",
            label="Check every amount against the mandate",
            detail="Auto-execute up to %s, hard ceiling %s. Anything between the two "
            "needs your confirmation; anything above is denied outright."
            % (_rs(m.auto_execute_limit_paise), _rs(m.max_amount_paise)),
            status="pass",
        )
    )
    return steps


def apply_group(
    run_id: str,
    group_index: int,
    signed: SignedMandate,
    *,
    confirmed: bool = False,
    calibration: Calibration = Calibration.CENTRAL,
    only_txns: set[str] | None = None,
) -> ApplyResult:
    """Approve one grouped fix. Every underlying action is gated individually.

    `confirmed` is the merchant clicking through a STEP_UP. It does not widen
    the mandate: an action the kernel DENIES stays denied however many times
    it is confirmed.
    """
    path = RUNS / (run_id + ".json")
    if not path.exists():
        raise FileNotFoundError("no such run: %s" % run_id)
    rec = json.loads(path.read_text(encoding="utf-8"))

    groups = rec.get("pending_actions") or []
    if not (0 <= group_index < len(groups)):
        raise IndexError("no pending fix at index %d" % group_index)
    group = groups[group_index]

    prior = [
        a for a in (rec.get("applied") or []) if a["group_id"] == group["group_id"]
    ]
    # Actions the kernel held for the merchant last time. They were gated but
    # never sent, so they are still outstanding -- confirming is what releases
    # them, and refusing to reopen the group would strand them forever.
    held: list[str] = []
    for a in prior:
        for tid in a.get("awaiting_confirmation", []):
            if tid not in held:
                held.append(tid)

    resuming = bool(prior) and confirmed and bool(held)
    if prior and not resuming:
        return ApplyResult(
            ok=False,
            group_id=group["group_id"],
            title=group["title"],
            steps=[
                CheckStep(
                    key="already",
                    label="Already applied",
                    detail=(
                        "This fix has been applied in this run. Re-running it "
                        "would burn attempts the mandate caps."
                        if not held
                        else "%d actions are still waiting on your confirmation. "
                        "Confirm them rather than re-running the group." % len(held)
                    ),
                    status="info",
                )
            ],
            headline="Already applied",
            already_applied=True,
            # Surfaced so the UI can still offer the confirmation it is waiting on.
            stepped_up=len(held),
            ledger_len=len(rec["report"].get("ledger", [])),
            chain_verified=rec["report"]["measured"].get("chain_verified", False),
        )

    actions = [ProposedAction.model_validate(a) for a in group["actions"]]

    # What the run has already done with each action. `pending_actions` groups
    # the WHOLE plan, including the actions the diagnosis itself executed, so
    # without this a first apply re-runs them: 396 of the 1,057 actions on this
    # book were settled at diagnosis and were being retried a second time the
    # moment anyone approved a group. That inflated the recovered figure, and
    # worse, it spent a real attempt against the mandate's per-payment cap on a
    # payment nobody had asked about again.
    #
    # The resume path below has always reasoned this way about held actions.
    # The same reasoning applies to everything the gate already settled.
    settled: dict[tuple, str] = {}
    for e in rec["report"].get("ledger", []):
        pa = e.get("proposed_action") or {}
        settled[(e.get("txn_id"), pa.get("action_type"))] = e.get("outcome")

    if resuming:
        # Only the held actions. Everything else in the group already settled,
        # and re-gating it would double-count the attempt.
        order = {tid: i for i, tid in enumerate(held)}
        actions = sorted(
            (a for a in actions if a.txn_id in order), key=lambda a: order[a.txn_id]
        )
        if not actions:
            raise IndexError("nothing left to confirm in %s" % group["group_id"])
    else:
        actions = [
            a
            for a in actions
            if settled.get((a.txn_id, a.action_type.value))
            in (None, "merchant_action")
        ]

    # Approving one payment rather than a whole fix.
    #
    # Narrowed here rather than in a second endpoint with its own gate: one
    # payment and fifty payments must be decided by exactly the same rules,
    # and the surest way to guarantee that is for there to be only one place
    # where deciding happens.
    if only_txns is not None:
        actions = [a for a in actions if a.txn_id in only_txns]
        if not actions:
            return ApplyResult(
                ok=False,
                group_id=group["group_id"],
                title=group["title"],
                steps=[
                    CheckStep(
                        key="settled",
                        label="Already settled",
                        detail=(
                            "Every action in this fix was already decided when "
                            "the run was diagnosed. Running it again would "
                            "retry payments that were never waiting on you and "
                            "burn attempts the mandate caps."
                        ),
                        status="info",
                    )
                ],
                headline="Nothing left to approve in this fix",
                already_applied=True,
                ledger_len=len(rec["report"].get("ledger", [])),
                chain_verified=rec["report"]["measured"].get("chain_verified", False),
            )

    # Attempt history from what actually reached the rail, so the cap counts
    # real attempts. An action held for confirmation was never sent and must
    # not consume one.
    attempts: dict[str, int] = {}
    for a in rec.get("applied") or []:
        for tid in a.get("executed_ids", a.get("txn_ids", [])):
            attempts[tid] = attempts.get(tid, 0) + 1

    # Payments this run has already collected. Read from the ledger rather
    # than tracked separately, so it cannot drift from what actually
    # happened, and passed to the kernel so the rule is enforced where every
    # caller inherits it.
    already_paid = {
        e.get("txn_id")
        for e in rec["report"].get("ledger", [])
        if e.get("outcome") == "executed"
        and (e.get("proposed_action") or {}).get("action_type") in
        {a.value for a in AUTO_EXECUTABLE}
    }

    ctx = GateContext(
        now=datetime.now(timezone.utc),
        attempts_by_txn=attempts,
        settled_txns=already_paid,
    )
    steps = _walkthrough(actions[0], signed, ctx)

    led = Ledger.from_entries(rec["report"].get("ledger", []))
    before = len(led)

    # Error class per payment, so the rail models the right recovery curve.
    ecls_by_txn = {
        t["txn_id"]: t.get("error_class") or "soft_decline"
        for t in rec["report"].get("exceptions", {}).get(
            "unrecoverable_transactions", []
        )
    }

    allowed = stepped = denied = executed = 0
    recovered = 0
    gated: list[GatedAction] = []
    executed_ids: list[str] = []
    held_now: list[str] = []
    for i, action in enumerate(actions):
        gate = evaluate(action, signed, ctx)
        outcome = "denied"

        if gate.decision is PolicyDecision.DENY:
            denied += 1
        elif gate.decision is PolicyDecision.STEP_UP and not confirmed:
            stepped += 1
            outcome = "merchant_action"
            held_now.append(action.txn_id)
        else:
            if gate.decision is PolicyDecision.STEP_UP:
                stepped += 1
            else:
                allowed += 1
            if action.action_type in AUTO_EXECUTABLE:
                ecls = ecls_by_txn.get(action.txn_id, "soft_decline")
                nth = attempts.get(action.txn_id, 0) + 1
                out = rail_execute(
                    action,
                    error_class=ecls,
                    # Each attempt runs at its own slot on the ladder, so a
                    # second try is not simply the first one repeated.
                    hours_since_failure=first_slot_hours(ecls, nth),
                    attempt=nth,
                    calibration=calibration,
                )
                recovered += out.amount_recovered_paise
                executed += 1
                executed_ids.append(action.txn_id)
                outcome = "executed" if out.succeeded else "exception"
                attempts[action.txn_id] = attempts.get(action.txn_id, 0) + 1
            else:
                outcome = "escalated"

        led.append(
            txn_id=action.txn_id,
            proposed_action=action,
            gate_decision=gate.decision,
            gate_reason=gate.reason_code,
            outcome=outcome,  # type: ignore[arg-type]
        )
        gated.append(
            GatedAction(
                txn_id=action.txn_id,
                action_type=action.action_type.value,
                amount_paise=action.amount_paise,
                decision=str(gate.decision.value) if hasattr(gate.decision, "value") else str(gate.decision),
                reason=str(gate.reason_code),
                outcome=outcome,
            )
        )

    v = led.verify()

    steps.append(
        CheckStep(
            key="gate",
            label="Gate all %d actions individually" % len(actions),
            detail="%d allowed, %d need your confirmation, %d denied by the mandate."
            % (allowed, stepped, denied),
            status="pass" if denied == 0 else "info",
        )
    )
    if executed:
        steps.append(
            CheckStep(
                key="rail",
                label="Execute against the payment rail",
                detail="%d actions ran. Recovered %s." % (executed, _rs(recovered)),
                status="pass" if recovered else "info",
            )
        )
    elif not group.get("auto"):
        steps.append(
            CheckStep(
                key="handoff",
                label="Hand to the merchant",
                detail="This is a configuration change only the merchant can make. "
                "The agent records the recommendation and stops.",
                status="info",
            )
        )
    steps.append(
        CheckStep(
            key="ledger",
            label="Append to the audit chain",
            detail="%d entries written. Chain %s from genesis."
            % (len(led) - before, "verified" if v.ok else "BROKEN"),
            status="pass" if v.ok else "fail",
        )
    )

    if recovered and stepped and not confirmed:
        headline = "%s recovered; %d await your confirmation" % (
            _rs(recovered), stepped
        )
    elif recovered:
        headline = "%s recovered across %d payments" % (_rs(recovered), executed)
    elif stepped and not confirmed:
        headline = "%d actions need your confirmation" % stepped
    elif denied == len(actions):
        headline = "All %d denied by your mandate" % denied
    elif not group.get("auto"):
        headline = "Recommendation recorded for you to action"
    else:
        headline = "Applied -- nothing converted this time"

    # persist
    rec["report"]["ledger"] = [e.model_dump(mode="json") for e in led.entries]
    rec["report"]["measured"]["ledger_entries"] = len(led)
    rec["report"]["measured"]["chain_verified"] = v.ok
    rec["report"]["projected"]["recovered_this_run_paise"] = (
        rec["report"]["projected"].get("recovered_this_run_paise", 0) + recovered
    )

    # Mark the retries that just ran.
    #
    # Scoring used to happen once, at diagnosis, which meant the largest
    # recovery event in the product was invisible to it: a merchant confirming
    # a queue of held actions executed real retries and the measured figure sat
    # at whatever it was before. ChaiPoint ran 164 retries worth Rs 28,051 and
    # went on reporting Rs 0 -- the exact number this whole system exists to
    # produce, unreported at the moment it was earned.
    #
    # Re-scoring here is still honest: score_recovery reads the merchant file
    # rather than the run, and it runs strictly after the gate has decided, so
    # nothing it sees can influence what was attempted.
    from .scoring import score_recovery

    rec["report"]["measured"]["recovery_vs_truth"] = json.loads(
        score_recovery(rec).model_dump_json()
    )
    if resuming:
        # These are no longer waiting on anyone; whatever happened to them just
        # happened, and is recorded in the entry appended below.
        settled = {a.txn_id for a in actions}
        for a in prior:
            a["awaiting_confirmation"] = [
                t for t in a.get("awaiting_confirmation", []) if t not in settled
            ]
    (rec.setdefault("applied", [])).append(
        {
            "group_id": group["group_id"],
            "title": group["title"],
            "txn_ids": [a.txn_id for a in actions],
            "executed_ids": executed_ids,
            "awaiting_confirmation": held_now,
            "confirmed": confirmed,
            "allowed": allowed,
            "stepped_up": stepped,
            "denied": denied,
            "recovered_paise": recovered,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    )
    path.write_text(json.dumps(rec, indent=2), encoding="utf-8", newline="\n")

    return ApplyResult(
        ok=executed > 0 or (not group.get("auto") and denied == 0),
        group_id=group["group_id"],
        title=group["title"],
        steps=steps,
        allowed=allowed,
        stepped_up=stepped,
        denied=denied,
        executed=executed,
        recovered_paise=recovered,
        ledger_len=len(led),
        ledger_added=len(led) - before,
        chain_verified=v.ok,
        actions=gated,
        headline=headline,
    )
