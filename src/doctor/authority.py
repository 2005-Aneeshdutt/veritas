"""What the merchant's own authority is costing them.

The mandate is the best idea in this project and, until now, a dead end for
the person who signed it. The audit page proudly reports that 91 actions were
DENIED and 661 are waiting on a click -- and the merchant has no way to tell
whether that was the right trade. They picked Rs 300 and Rs 2,000 out of the
air, because nobody knows how to set an agent's permissions.

That is the unsolved problem in agentic payments right now. AP2, Visa's
Trusted Agent Protocol and Mastercard Agent Pay all specify how to EXPRESS an
agent's authority. None of them helps you CHOOSE it. So the ledger, which was
a receipt, becomes the input to the next decision: here is what your limits
blocked, here is what raising them would have permitted, here is the exposure
that comes with it, and here is a revised mandate you can sign or ignore.

THREE THINGS THIS DELIBERATELY DOES NOT DO

  * it does not widen anything. It proposes an unsigned draft. The agent has
    never held the signing key and still does not; only the merchant can turn
    this into authority, which is the entire security property
  * it does not recommend a change when the numbers do not support one.
    "Your limits look right" is a real outcome with its own copy, and it
    fires for one of the eight merchants on this book -- the other seven
    signed mandates that genuinely are too tight, which is what you would
    expect of numbers nobody had a method for choosing
  * it does not quote a recovery figure without its measured error. The rail
    that prices a retry is optimistic by a factor this repo measures
    (recovery_accuracy.json), and a proposal that hides that would be selling
    rather than advising
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from pydantic import BaseModel

from chitragupta.mandate import Mandate, SignedMandate
from chitragupta.rails.mock_rail import Calibration, p_retry_success

from .sequence import first_slot_hours

ROOT = Path(__file__).resolve().parents[2]
RECOVERY_EVAL = ROOT / "evals" / "results" / "recovery_accuracy.json"

#: Headroom above the largest blocked action, so a revised ceiling is not
#: instantly binding again on next month's slightly larger payment.
HEADROOM = 1.10

#: What a limit has to be costing before it is worth re-signing a mandate,
#: as a share of what this merchant could recover at all.
#:
#: Relative, and that matters. An absolute floor made every merchant on the
#: book get a recommendation -- Rs 6,285 blocked reads as real money until you
#: notice the same merchant has Rs 73,000 on the table and the limit is not
#: what is standing in the way. A tool that always advises raising your limits
#: is selling, not advising, and nobody should believe the one time it matters.
MATERIAL_SHARE = 0.15

#: A floor as well, so a tiny merchant is not told to re-sign over pennies.
MATERIAL_FLOOR_PAISE = 10_000_00

#: How much of the agent's permitted work should run without a click before
#: the auto-execute limit stops being worth complaining about.
#:
#: Chosen, not derived, and it is the one number here a merchant might
#: reasonably set differently -- so the proposal says what it targeted.
TARGET_UNATTENDED = 0.70

#: How bad it has to get before saying anything. Deliberately well clear of
#: the target: raising a limit is a real authority change, and nagging a
#: merchant who is merely a little under an arbitrary goal is how a tool
#: teaches people to dismiss it. Above this, most of what the agent was
#: allowed to do stopped to wait for a human, which is worth a sentence.
COMPLAIN_ABOVE = 0.60

#: Below this there are not enough held actions for the share to mean much.
MIN_HELD = 20

#: How much of the merchant's clicking a raise has to actually remove before
#: it is worth proposing. Without this the review told a merchant to re-sign
#: their mandate to free three actions, which is noise dressed as advice.
MIN_RELIEF_PTS = 0.10


class BlockedGroup(BaseModel):
    """Actions one limit turned away, and what they were worth."""

    reason: str
    count: int
    total_paise: int
    largest_paise: int
    smallest_paise: int


class Proposal(BaseModel):
    """A revised limit, what it would unlock, and what it would expose."""

    field: str
    current_paise: int
    proposed_paise: int
    unlocks_count: int
    unlocks_paise: int
    #: Modelled recovery from what it unlocks, as a range. PROJECTED.
    recovery_low_paise: int
    recovery_high_paise: int
    #: How far the rail sits from a known truth, measured across the sweep.
    calibration_note: str
    exposure: str
    rationale: str


class AuthorityReview(BaseModel):
    merchant_id: str
    blocked: list[BlockedGroup]
    blocked_total_paise: int
    held_count: int
    held_total_paise: int
    proposals: list[Proposal]
    #: True when the limits are already about right.
    no_change_needed: bool
    headline: str


def _calibration() -> tuple[float | None, str]:
    """How optimistic the retry model is, measured rather than assumed."""
    try:
        d = json.loads(RECOVERY_EVAL.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None, "No calibration measurement on file."
    ratio = (d.get("by_calibration", {}).get("central", {}) or {}).get(
        "portfolio_ratio"
    )
    if not ratio:
        return None, "No calibration measurement on file."
    return ratio, (
        "Measured against a known retry outcome across %d merchants, this "
        "model forecasts %.0f%% of what a retry truly recovers -- so read the "
        "figure above as the optimistic end."
        % (
            d["by_calibration"]["central"].get("merchants_scored", 0),
            100 * ratio,
        )
    )


def _recovery_range(actions: list[dict]) -> tuple[int, int]:
    """What the unlocked actions might recover, low to high calibration."""
    out = []
    for cal in (Calibration.CONSERVATIVE, Calibration.OPTIMISTIC):
        total = 0.0
        for a in actions:
            ecls = a.get("error_class") or "soft_decline"
            p = p_retry_success(ecls, first_slot_hours(ecls), cal)
            total += p * a["amount_paise"]
        out.append(int(total))
    return min(out), max(out)


def review(rec: dict, signed: SignedMandate) -> AuthorityReview:
    """Read the ledger back and ask what the limits cost."""
    m = signed.mandate
    ledger = rec.get("report", {}).get("ledger", [])

    # Error class per payment, so the recovery estimate uses the right curve.
    ecls = {
        t["txn_id"]: t.get("error_class")
        for t in rec.get("report", {})
        .get("exceptions", {})
        .get("unrecoverable_transactions", [])
    }

    # One row per ACTION, not per ledger entry. The ledger is append-only, so
    # an action the gate ruled on twice leaves two rows behind -- and every
    # money figure in this review doubled the moment a merchant approved their
    # queue, while the copy went on telling them 446 actions were waiting for
    # an approval they had already given.
    final: dict[tuple, dict] = {}
    for e in ledger:
        pa = e.get("proposed_action") or {}
        final[(e.get("txn_id"), pa.get("action_type"))] = e

    denied: dict[str, list[dict]] = {}
    held: list[dict] = []
    for e in final.values():
        a = dict(e.get("proposed_action") or {})
        a["error_class"] = ecls.get(e.get("txn_id"))
        if e.get("gate_decision") == "deny":
            denied.setdefault(e.get("gate_reason", "DENIED"), []).append(a)
        elif e.get("gate_decision") == "step_up":
            a["gate_reason"] = e.get("gate_reason", "")
            held.append(a)

    blocked = [
        BlockedGroup(
            reason=reason,
            count=len(rows),
            total_paise=sum(r["amount_paise"] for r in rows),
            largest_paise=max(r["amount_paise"] for r in rows),
            smallest_paise=min(r["amount_paise"] for r in rows),
        )
        for reason, rows in sorted(
            denied.items(), key=lambda kv: -sum(r["amount_paise"] for r in kv[1])
        )
    ]
    blocked_total = sum(g.total_paise for g in blocked)
    ratio, cal_note = _calibration()

    proposals: list[Proposal] = []

    # --- the hard ceiling ------------------------------------------------
    ceiling_blocked = [
        a for r, rows in denied.items() if "CEILING" in r for a in rows
    ]
    # What the merchant could recover at all, as the yardstick for whether a
    # limit is really what is holding them back.
    opportunity = (
        rec.get("report", {}).get("projected", {}).get("recoverable", {}) or {}
    ).get("high_paise", 0)
    ceiling_total = sum(a["amount_paise"] for a in ceiling_blocked)
    material = ceiling_total >= max(
        MATERIAL_FLOOR_PAISE, opportunity * MATERIAL_SHARE
    )

    if ceiling_blocked and material:
        largest = max(a["amount_paise"] for a in ceiling_blocked)
        proposed = int(largest * HEADROOM)
        lo, hi = _recovery_range(ceiling_blocked)
        proposals.append(
            Proposal(
                field="max_amount_paise",
                current_paise=m.max_amount_paise,
                proposed_paise=proposed,
                unlocks_count=len(ceiling_blocked),
                unlocks_paise=sum(a["amount_paise"] for a in ceiling_blocked),
                recovery_low_paise=lo,
                recovery_high_paise=hi,
                calibration_note=cal_note,
                exposure=(
                    "%d more payments become retryable, none above Rs %s, and "
                    "all still inside your %d-attempt cap and 7-day window."
                    % (
                        len(ceiling_blocked),
                        format(proposed // 100, ",d"),
                        m.max_attempts_per_payment,
                    )
                ),
                rationale=(
                    "Every denial this month was this one limit. The largest "
                    "blocked payment was Rs %s; the proposal sits %d%% above "
                    "it so the same ceiling does not bind again next month."
                    % (format(largest // 100, ",d"), int((HEADROOM - 1) * 100))
                ),
            )
        )

    # --- the auto-execute limit ------------------------------------------
    #
    # Not about money the agent cannot touch -- it is about how much of the
    # merchant's own time the limit is spending.
    #
    # Two earlier cuts of this were wrong in the same direction, both flattering
    # to the feature. The first compared the median held amount against the
    # limit and called it "almost nothing clears it", which is nearly true by
    # construction: a held action is BY DEFINITION one that did not clear. The
    # second fixed that but assumed every hold above the limit was a hold
    # CAUSED by the limit -- and the gate says otherwise. requires_merchant
    # _approval short-circuits before the amount is ever compared, so a payment
    # link reissue waits for a human at any limit. Counting those as unlockable
    # would promise a merchant time back that no limit change can give them.
    by_amount = [a for a in held if a["gate_reason"] == "STEP_UP_ABOVE_AUTO_LIMIT"]
    by_design = [a for a in held if a["gate_reason"] != "STEP_UP_ABOVE_AUTO_LIMIT"]

    allowed = sum(1 for e in final.values() if e.get("gate_decision") == "allow")
    permitted = allowed + len(held)
    click_share = len(held) / permitted if permitted else 0.0

    releasable = sorted(by_amount, key=lambda a: a["amount_paise"])

    if len(held) >= MIN_HELD and click_share > COMPLAIN_ABOVE and releasable:
        # The smallest raise that gets unattended work to the target -- or, if
        # the design-held actions put the target out of reach, everything the
        # limit is actually holding back.
        # Ceil, not int. Truncating leaves the target permanently just out of
        # reach -- 45 of 65 is 69.2% against a 70% goal -- so the proposal
        # would always attach a caveat saying it fell short of its own aim.
        want = math.ceil(TARGET_UNATTENDED * permitted) - allowed
        need = max(1, min(want, len(releasable)))
        covered = releasable[:need]
        proposed = covered[-1]["amount_paise"]
        after = (allowed + len(covered)) / permitted
        relief = after - allowed / permitted

        reach = (
            ""
            if after >= TARGET_UNATTENDED or not by_design
            else (
                " That still leaves %d waiting, because they are %s -- those "
                "need you at any limit, so no change here would free them."
                % (len(by_design), _plain(by_design))
            )
        )

        # A raise that frees three actions is noise dressed as advice, and it
        # spends the one thing this feature needs: a merchant's willingness to
        # believe the next recommendation.
        if relief >= MIN_RELIEF_PTS:
            lo, hi = _recovery_range(covered)

            # The two proposals are shown together and signed together, so
            # this one may not describe the ceiling as untouched when the one
            # above it moves. A merchant reading a draft whose halves
            # contradict each other has no reason to trust either.
            raised = next(
                (p for p in proposals if p.field == "max_amount_paise"), None
            )
            ceiling_note = (
                "Your hard ceiling is untouched, so anything above Rs %s "
                "stays denied" % format(m.max_amount_paise // 100, ",d")
                if raised is None
                else "Anything above your ceiling -- Rs %s, if you accept the "
                "change above, and Rs %s if you do not -- stays denied"
                % (
                    format(raised.proposed_paise // 100, ",d"),
                    format(m.max_amount_paise // 100, ",d"),
                )
            )
            proposals.append(
                Proposal(
                    field="auto_execute_limit_paise",
                    current_paise=m.auto_execute_limit_paise,
                    proposed_paise=proposed,
                    unlocks_count=len(covered),
                    unlocks_paise=sum(a["amount_paise"] for a in covered),
                    recovery_low_paise=lo,
                    recovery_high_paise=hi,
                    calibration_note=cal_note,
                    exposure=(
                        "%d actions would run unattended instead of waiting "
                        "for you, none above Rs %s. %s, and the %d-attempt "
                        "cap still applies."
                        % (
                            len(covered),
                            format(proposed // 100, ",d"),
                            ceiling_note,
                            m.max_attempts_per_payment,
                        )
                    ),
                    rationale=(
                        "%d of the %d actions the agent was permitted to take "
                        "-- %.0f%% -- stopped to wait for your approval, and "
                        "%d of those purely because of the Rs %s limit. "
                        "Raising it to Rs %s gets %.0f%% of the work running "
                        "unattended.%s"
                        % (
                            len(held),
                            permitted,
                            100 * click_share,
                            len(by_amount),
                            format(m.auto_execute_limit_paise // 100, ",d"),
                            format(proposed // 100, ",d"),
                            100 * after,
                            reach,
                        )
                    ),
                )
            )

    return AuthorityReview(
        merchant_id=rec.get("merchant_id", ""),
        blocked=blocked,
        blocked_total_paise=blocked_total,
        held_count=len(held),
        held_total_paise=sum(a["amount_paise"] for a in held),
        proposals=proposals,
        no_change_needed=not proposals,
        headline=_headline(blocked, blocked_total, len(held), proposals),
    )


def _plain(actions: list[dict]) -> str:
    """Name what a group of held actions actually is, in the merchant's words."""
    kinds = {a.get("action_type", "") for a in actions}
    if kinds == {"reissue_payment_link"}:
        return "payment-link reissues, which always ask you first"
    return "actions the planner marked as needing your sign-off"


def _headline(blocked, blocked_total: int, held: int, proposals) -> str:
    if not proposals:
        if not blocked_total:
            return (
                "Nothing was denied this month and your limits are not "
                "getting in the way."
            )
        return (
            "Your limits look about right. Rs %s was denied, which is small "
            "against what is actually recoverable here -- the ceiling is not "
            "what is standing between you and that money."
            % format(blocked_total // 100, ",d")
        )
    if not blocked_total:
        return (
            "Nothing was denied. %d actions are queued for your approval, and "
            "raising your auto-execute limit would clear the ones that are "
            "waiting on the amount rather than on you." % held
        )
    return "Your mandate blocked Rs %s this month across %d actions." % (
        format(blocked_total // 100, ",d"),
        sum(g.count for g in blocked),
    )


def draft(signed: SignedMandate, proposals: list[Proposal]) -> Mandate:
    """The revised mandate, UNSIGNED.

    Returned as a draft on purpose. Signing needs the merchant's private key,
    which this process has never held and must never hold -- an agent that
    could sign its own authority would make the whole kernel decorative.
    """
    m = signed.mandate
    changes = {p.field: p.proposed_paise for p in proposals}
    merged = {**m.model_dump(mode="json"), **changes}

    # An auto-execute limit above the hard ceiling is nonsense -- it would
    # claim the agent may spend unattended what it is not permitted to spend
    # at all. The two proposals are computed independently, so nothing else
    # stops them landing that way round.
    merged["auto_execute_limit_paise"] = min(
        merged["auto_execute_limit_paise"], merged["max_amount_paise"]
    )
    merged["mandate_id"] = m.mandate_id + "-rev"
    return Mandate(**merged)
