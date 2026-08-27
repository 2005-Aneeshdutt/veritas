"""What the agent actually recovered, measured rather than modelled.

Every rupee this project reports has been labelled PROJECTED, because the
figure comes out of `mock_rail.py` and that rail models the odds a retry
converts. The label was correct and it was also the last thing standing
between this and the track's actual bar: "show MEASURED money recovered
across a batch".

Each generated merchant now carries, as ground truth, whether every
recoverable failure would truly have converted on a retry. So for the exact
payments this agent chose to retry, the true outcome is known -- which makes
the recovered figure a measurement with an error, not an assumption.

WHY THIS RUNS AFTER THE DIAGNOSIS, NOT INSIDE IT
`run_diagnosis` receives a profile and a list of transactions. It never
receives the ground truth, and that is the property the whole validation
argument rests on. Threading the counterfactual into the engine so it could
score itself would destroy exactly what makes the score worth anything. So
this loads the merchant's truth separately, afterwards, and scores a decision
that was already made.

WHAT "MEASURED" MEANS HERE
The same thing it means everywhere else in this project: measured against a
known generating distribution, not against a live payment rail. That is the
identical standard behind the +/-0.57 point attribution claim. It is stated
plainly rather than blurred into implying production data, because a merchant
reading "measured" should know exactly which of those two it is.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "data" / "synthetic"


class RecoveryScore(BaseModel):
    """The agent's executed retries, marked against ground truth."""

    scored: bool
    #: Retries the agent actually sent.
    attempted: int
    #: Of those, how many the truth says would convert.
    truly_converted: int
    #: What those conversions are worth. MEASURED.
    measured_paise: int
    #: What the rail said it would recover. PROJECTED.
    projected_paise: int
    #: projected / measured. Above 1.0 the rail is optimistic.
    ratio: float | None = None
    #: Attempts spent on payments that were never going to convert.
    wasted_attempts: int = 0
    detail: str = ""


def _ground_truth(merchant_id: str) -> dict[str, bool]:
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    if not p.exists():
        return {}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return d.get("ground_truth", {}).get("retry_conversions", {}) or {}


def score_recovery(rec: dict) -> RecoveryScore:
    """Mark this run's executed retries against what would truly have happened."""
    truth = _ground_truth(rec.get("merchant_id", ""))
    if not truth:
        return RecoveryScore(
            scored=False, attempted=0, truly_converted=0,
            measured_paise=0, projected_paise=0,
            detail=(
                "No ground truth on file for this merchant, so recovery here "
                "is projected only. Reported rather than assumed."
            ),
        )

    projected = rec["report"]["projected"].get("recovered_this_run_paise", 0)

    attempted = 0
    converted = 0
    measured = 0
    for e in rec["report"].get("ledger", []):
        # Only retries the kernel allowed AND the rail actually ran. A denied
        # action recovered nothing and was never sent, so counting it either
        # way would be wrong.
        if e.get("outcome") not in ("executed", "exception"):
            continue
        action = e.get("proposed_action") or {}
        if action.get("action_type") != "retry_soft_decline":
            continue
        txn_id = e.get("txn_id")
        if txn_id not in truth:
            continue
        attempted += 1
        if truth[txn_id]:
            converted += 1
            measured += int(action.get("amount_paise") or 0)

    if attempted == 0:
        return RecoveryScore(
            scored=False, attempted=0, truly_converted=0,
            measured_paise=0, projected_paise=projected,
            detail="This run executed no retries, so there is nothing to mark.",
        )

    ratio = (projected / measured) if measured else None
    return RecoveryScore(
        scored=True,
        attempted=attempted,
        truly_converted=converted,
        measured_paise=measured,
        projected_paise=projected,
        ratio=round(ratio, 3) if ratio is not None else None,
        wasted_attempts=attempted - converted,
        detail=(
            "Of %d payments this agent retried, %d would truly have converted, "
            "worth Rs %s. The rail forecast Rs %s -- %s. Measured against the "
            "generating distribution, the same standard as the attribution "
            "error, not against a live rail."
            % (
                attempted, converted,
                format(measured // 100, ",d"),
                format(projected // 100, ",d"),
                "%.2fx optimistic" % ratio if ratio and ratio > 1
                else "%.2fx conservative" % (1 / ratio) if ratio else "no comparison",
            )
        ),
    )
