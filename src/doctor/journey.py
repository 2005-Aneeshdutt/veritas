"""One payment, from the failure to whatever finally happened to it.

Every other view in this product aggregates. That is the right shape for the
claims -- a gap of 3.24 points, Rs 4,22,340 attributable to the platform --
and it is the wrong shape for the question people actually ask when they stop
believing an aggregate, which is always the same question: show me one.

So this assembles a single payment's whole file:

    it failed  ->  this is what the code means and whose it is
               ->  this is what the agent proposed and why
               ->  these are the checks the kernel ran, in order
               ->  this is what it decided, and what was written down
               ->  and this is what would truly have happened

The last line is the one that needs care. Whether a retry would have converted
is ground truth held by the generator, and the engine NEVER sees it -- the
decision was made and recorded before this module went looking. It is
presented as the counterfactual it is, after the decision, clearly marked,
because a page that showed it alongside the evidence would be showing a system
that cheats.

Nothing here recomputes a decision. Every field is read from what was already
written down, so the page cannot disagree with the ledger it is describing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .fault import OWNER_LABEL, UNKNOWN, owner_of

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data" / "runs"
SYNTH = ROOT / "data" / "synthetic"
LABELS = ROOT / "evals" / "error_labels.json"


class Beat(BaseModel):
    """One thing that happened, in order."""

    key: str
    at: str | None = None
    title: str
    detail: str = ""
    #: "fact" | "good" | "held" | "bad" -- how the row should read, not a
    #: judgement the page is free to invent.
    tone: str = "fact"
    #: Small key/value pairs shown under the beat.
    facts: list[dict[str, str]] = []


class Journey(BaseModel):
    found: bool
    txn_id: str
    run_id: str
    merchant_id: str
    merchant_name: str
    #: The payment as it arrived.
    amount_paise: int = 0
    bank: str = ""
    method: str = ""
    hour: int | None = None
    error_code: str | None = None
    error_class: str | None = None
    #: What Razorpay publishes about that code.
    code_explanation: str = ""
    code_next_steps: str = ""
    fault_owner: str = UNKNOWN
    fault_label: str = ""
    beats: list[Beat] = []
    #: Where it ended up. Read off the last ledger entry, not decided here.
    final_outcome: str = ""
    final_reason: str = ""
    recovered_paise: int = 0
    #: The counterfactual, revealed after the fact. None when unknown.
    would_have_converted: bool | None = None
    truth_note: str = ""
    detail: str = ""


def _taxonomy() -> dict[str, dict]:
    try:
        d = json.loads(LABELS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {r["code"]: r for r in d.get("labels", []) if r.get("code")}


def _merchant_file(merchant_id: str) -> dict:
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _rs(paise: int) -> str:
    return "Rs %s" % format(int(paise) // 100, ",d")


#: How each recorded outcome should read. Taken from the ledger's own
#: vocabulary so a new outcome shows up as itself rather than being quietly
#: bucketed into the nearest existing one.
_TONE = {
    "executed": "good",
    "merchant_action": "held",
    "denied": "bad",
    "escalated": "held",
    "exception": "bad",
}


def build(run_id: str, txn_id: str) -> Journey:
    """Assemble one payment's file from what was already written down."""
    path = RUNS / (run_id + ".json")
    if not path.exists():
        return Journey(
            found=False, txn_id=txn_id, run_id=run_id, merchant_id="",
            merchant_name="", detail="no such run: %s" % run_id,
        )
    rec = json.loads(path.read_text(encoding="utf-8"))
    mid = rec.get("merchant_id", "")
    name = rec.get("merchant_name") or mid

    entries = [
        e for e in rec.get("report", {}).get("ledger", []) if e.get("txn_id") == txn_id
    ]
    merchant = _merchant_file(mid)
    txn = next(
        (t for t in merchant.get("transactions", []) if t.get("txn_id") == txn_id),
        None,
    )

    if txn is None and not entries:
        return Journey(
            found=False, txn_id=txn_id, run_id=run_id, merchant_id=mid,
            merchant_name=name,
            detail=(
                "No payment with that id in this run. It may belong to another "
                "merchant -- ids are scoped per merchant."
            ),
        )

    tax = _taxonomy()
    code = (txn or {}).get("error_code")
    row = tax.get(code or "", {})
    owner = owner_of(row.get("next_steps"))

    beats: list[Beat] = []

    # 1. it failed
    if txn is not None:
        beats.append(
            Beat(
                key="failed",
                title="The payment failed",
                detail=(
                    "%s on %s via %s at %02d:00."
                    % (
                        _rs(txn.get("amount_paise", 0)),
                        txn.get("bank", "an unknown bank"),
                        str(txn.get("method", "?")).replace("_", " "),
                        int(txn.get("hour") or 0),
                    )
                ),
                tone="bad",
                facts=[
                    {"k": "amount", "v": _rs(txn.get("amount_paise", 0))},
                    {"k": "bank", "v": txn.get("bank", "?")},
                    {"k": "method", "v": str(txn.get("method", "?"))},
                    {"k": "error code", "v": code or "none recorded"},
                ],
            )
        )

    # 2. what the code means, and whose it is
    if code:
        beats.append(
            Beat(
                key="classified",
                title="The code was classified",
                detail=(
                    (row.get("explanation") or "").strip()
                    or "Outside Razorpay's published list, so it is carried as "
                    "unclassified rather than guessed at."
                ),
                facts=[
                    {"k": "class", "v": (txn or {}).get("error_class") or "unclassified"},
                    {"k": "whose move", "v": OWNER_LABEL.get(owner, owner)},
                ]
                + (
                    [{"k": "Razorpay says", "v": (row.get("next_steps") or "").strip()}]
                    if row.get("next_steps")
                    else []
                ),
            )
        )

    # 3..n. every decision recorded against this payment
    for e in entries:
        action = e.get("proposed_action") or {}
        outcome = e.get("outcome", "")
        beats.append(
            Beat(
                key="proposed_%s" % e.get("sequence"),
                at=e.get("timestamp"),
                title="The agent proposed: %s"
                % str(action.get("action_type", "?")).replace("_", " "),
                detail=(action.get("reason") or "").strip(),
                facts=[
                    {"k": "at stake", "v": _rs(action.get("amount_paise") or 0)},
                    {
                        "k": "needs the merchant",
                        "v": "yes" if action.get("requires_merchant_approval") else "no",
                    },
                ],
            )
        )
        beats.append(
            Beat(
                key="gated_%s" % e.get("sequence"),
                at=e.get("timestamp"),
                title="The mandate kernel decided: %s"
                % str(e.get("gate_decision", "?")).replace("_", " "),
                detail=_reason_text(e.get("gate_reason", "")),
                tone=_TONE.get(outcome, "fact"),
                facts=[
                    {"k": "reason code", "v": e.get("gate_reason", "?")},
                    {"k": "outcome", "v": outcome},
                    {"k": "ledger entry", "v": "#%s" % e.get("sequence")},
                    {"k": "hash", "v": (e.get("entry_hash") or "")[:16]},
                ],
            )
        )

    # what a person did about it afterwards, if anything
    for group in rec.get("applied", []) or []:
        if txn_id in (group.get("executed_ids") or []):
            beats.append(
                Beat(
                    key="approved",
                    at=group.get("at"),
                    title="A person approved it, and it ran",
                    detail="Part of '%s'." % group.get("title", ""),
                    tone="good",
                )
            )
        elif txn_id in (group.get("awaiting_confirmation") or []):
            beats.append(
                Beat(
                    key="waiting",
                    at=group.get("at"),
                    title="Still waiting on a person",
                    detail="Held inside '%s'." % group.get("title", ""),
                    tone="held",
                )
            )
    if txn_id in (rec.get("rejected_txns") or []):
        beats.append(
            Beat(
                key="rejected",
                title="A person rejected it",
                detail="Nothing was sent for this payment.",
                tone="bad",
            )
        )

    last = entries[-1] if entries else {}
    outcome = last.get("outcome", "")
    recovered = 0
    if outcome == "executed":
        recovered = int((last.get("proposed_action") or {}).get("amount_paise") or 0)

    # the counterfactual, and only now
    truth = (
        merchant.get("ground_truth", {}).get("retry_conversions", {}) or {}
    ).get(txn_id)
    note = ""
    if truth is None:
        note = (
            "No counterfactual on file for this payment, so there is nothing "
            "to mark the decision against."
        )
    else:
        note = (
            "Held by the generator and never shown to the engine. The decision "
            "above was made and written to the ledger before this was read."
        )
        beats.append(
            Beat(
                key="truth",
                title=(
                    "It would have converted on retry"
                    if truth
                    else "It would not have converted, whatever we did"
                ),
                detail=note,
                tone="good" if truth else "fact",
            )
        )

    return Journey(
        found=True,
        txn_id=txn_id,
        run_id=run_id,
        merchant_id=mid,
        merchant_name=name,
        amount_paise=int((txn or {}).get("amount_paise") or 0),
        bank=(txn or {}).get("bank", ""),
        method=str((txn or {}).get("method", "")),
        hour=(txn or {}).get("hour"),
        error_code=code,
        error_class=(txn or {}).get("error_class"),
        code_explanation=(row.get("explanation") or "").strip(),
        code_next_steps=(row.get("next_steps") or "").strip(),
        fault_owner=owner,
        fault_label=OWNER_LABEL.get(owner, owner),
        beats=beats,
        final_outcome=outcome,
        final_reason=last.get("gate_reason", ""),
        recovered_paise=recovered,
        would_have_converted=truth,
        truth_note=note,
    )


#: The reason codes in plain words. Kept here rather than in the UI so the
#: email, the API and the page cannot drift into three different glossaries.
_REASONS: dict[str, str] = {
    "OK_WITHIN_MANDATE": "Inside every limit the merchant signed. The agent may act alone.",
    "OK_ESCALATION": "Not a charge -- flagged for a person to look at. Nothing was moved.",
    "OK_MERCHANT_ACTION": "A change to the merchant's own settings, which only they can make.",
    "STEP_UP_ABOVE_AUTO_LIMIT": "Above the auto-execute limit but under the ceiling, so it waits for a person.",
    "STEP_UP_MERCHANT_APPROVAL_REQUESTED": "The action type itself always needs the merchant, whatever the amount.",
    "DENY_AMOUNT_ABOVE_CEILING": "Over the hard ceiling in the mandate. No one can approve this into happening.",
    "DENY_ALREADY_SETTLED": "This payment has already been collected. Charging it again would cost a refund and the customer.",
    "DENY_ACTION_NOT_PERMITTED": "This action type is not among the ones the merchant authorised.",
    "DENY_MANDATE_EXPIRED": "The mandate was out of force at the moment of the decision.",
    "DENY_SIGNATURE_INVALID": "The mandate's signature did not verify, so nothing past this point ran.",
}


def _reason_text(code: str) -> str:
    return _REASONS.get(code, code.replace("_", " ").lower() if code else "")


def candidates(run_id: str, limit: int = 40) -> list[dict[str, Any]]:
    """Payments in this run that have a journey worth reading.

    Ordered so the interesting ones surface first: denied, then held, then
    executed. A list that opened on forty identical successes would make the
    page look like a log.
    """
    path = RUNS / (run_id + ".json")
    if not path.exists():
        return []
    rec = json.loads(path.read_text(encoding="utf-8"))

    rank = {"denied": 0, "merchant_action": 1, "escalated": 2, "executed": 3}
    seen: dict[str, dict] = {}
    for e in rec.get("report", {}).get("ledger", []):
        txn = e.get("txn_id", "")
        if txn.startswith("merchant:"):
            continue  # a settings change, not a payment
        action = e.get("proposed_action") or {}
        row = {
            "txn_id": txn,
            "amount_paise": int(action.get("amount_paise") or 0),
            "action_type": action.get("action_type"),
            "outcome": e.get("outcome"),
            "gate_reason": e.get("gate_reason"),
        }
        # Last word wins: a payment decided twice ended where it ended.
        seen[txn] = row

    rows = sorted(
        seen.values(),
        key=lambda r: (rank.get(r["outcome"], 9), -r["amount_paise"]),
    )
    return rows[: max(1, limit)]
