"""Turn hypotheses into typed actions, gated by the engine's own measured error.

This module is where the project's central claim stops being rhetoric.

`evals/results/attribution_mae_by_factor.json` is not a slide. It is loaded
here at runtime, and the ratio of an attribution to its OWN measured error
decides what the agent is allowed to do about it:

    attribution > 2x MAE          auto_execute permitted
    1x MAE <= attribution <= 2x   downgraded to merchant_action
    attribution < 1x MAE          forced to investigation, never acted on

Plus two hard vetoes that come from the decomposition rather than the LLM:
a factor the overlap check marked NOT IDENTIFIED can never be auto-executed,
and neither can anything from an underpowered batch.

The LLM proposes; this file disposes; policy.py then re-checks everything
against the signed mandate. The model never holds a credential and never emits
anything but a validated struct, so a fully prompt-injected model still cannot
exceed the mandate.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Sequence

from pydantic import BaseModel

from chitragupta.types import ActionType, ProposedAction

from .features import RECOVERABLE, Transaction
from .hypothesise import Diagnosis, Hypothesis, RootCauseLabel
from .shapley import Decomposition

ROOT = Path(__file__).resolve().parents[2]
MAE_PATH = ROOT / "evals" / "results" / "attribution_mae_by_factor.json"

#: Ratios from §9.11. Above AUTO the signal clears its own noise floor by a
#: factor of two; below WITHHOLD it does not clear it at all.
AUTO_RATIO = 2.0
WITHHOLD_RATIO = 1.0

ActionTier = Literal["auto_execute", "merchant_action", "investigation"]

#: Which typed action each root cause maps to. The LLM chooses the label; this
#: table chooses the action, so the model cannot invent an action type.
LABEL_TO_ACTION: dict[RootCauseLabel, ActionType] = {
    RootCauseLabel.MIDNIGHT_BILLING_PENALTY: ActionType.RESCHEDULE_BILLING_WINDOW,
    RootCauseLabel.NO_SOFT_DECLINE_RETRY: ActionType.RETRY_SOFT_DECLINE,
    RootCauseLabel.BANK_CONCENTRATION: ActionType.ENABLE_MULTI_BANK_ROUTING,
    RootCauseLabel.METHOD_MIX_MISMATCH: ActionType.UPDATE_PAYMENT_METHOD,
    RootCauseLabel.AMOUNT_BAND_RISK: ActionType.ENABLE_MULTI_BANK_ROUTING,
    RootCauseLabel.NONE_OF_THE_ABOVE: ActionType.FLAG_FOR_INVESTIGATION,
}


def load_mae(path: Path = MAE_PATH) -> dict[str, float]:
    """Per-factor MAE from the validation sweep. Empty if it has not run."""
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: float(v["mae"]) for k, v in data.items() if "mae" in v}


class Withholding(BaseModel):
    """A fix that was proposed and then deliberately not acted on."""

    model_config = {"frozen": True}

    factor: str
    label: str
    attribution_pts: float
    mae: float | None
    downgraded_from: ActionTier
    downgraded_to: ActionTier
    reason: str


class Plan(BaseModel):
    model_config = {"frozen": True}

    actions: list[ProposedAction]
    withheld: list[Withholding]
    #: Rendered on the dashboard, verbatim.
    headline: str


def _tier_for(
    h: Hypothesis, dec: Decomposition, mae_by_factor: dict[str, float]
) -> tuple[ActionTier, Withholding | None]:
    """Apply the uncertainty gate. Returns the allowed tier and why."""
    proposed: ActionTier = h.action_type
    factor = h.factor
    mae = mae_by_factor.get(factor)

    # Hard veto 1: the overlap check says this factor is not estimable.
    if factor in dec.degenerate_factors:
        return "investigation", Withholding(
            factor=factor,
            label=h.root_cause_label.value,
            attribution_pts=h.attribution_pts,
            mae=mae,
            downgraded_from=proposed,
            downgraded_to="investigation",
            reason=(
                "factor not identified -- the merchant has effectively one "
                "value here, so there is nothing to reweight toward and the "
                "attribution is unmeasurable rather than small"
            ),
        )

    # Hard veto 2: the reweighting itself did not hold up.
    if not dec.reliable and proposed == "auto_execute":
        return "merchant_action", Withholding(
            factor=factor,
            label=h.root_cause_label.value,
            attribution_pts=h.attribution_pts,
            mae=mae,
            downgraded_from=proposed,
            downgraded_to="merchant_action",
            reason=(
                "importance weights clamped on %.0f%% of transactions; this "
                "merchant sits too far from the cohort profile for the "
                "reweighting to be trusted with an automatic action"
                % (dec.clamp_rate * 100)
            ),
        )

    # The process gap is computed directly and has no Shapley MAE, so it is
    # not subject to the error-bar gate. It is measured, not estimated.
    if mae is None or factor == "process_gap":
        return proposed, None

    ratio = abs(h.attribution_pts) / mae if mae > 0 else float("inf")

    if ratio < WITHHOLD_RATIO:
        return "investigation", Withholding(
            factor=factor,
            label=h.root_cause_label.value,
            attribution_pts=h.attribution_pts,
            mae=mae,
            downgraded_from=proposed,
            downgraded_to="investigation",
            reason=(
                "attribution %.2f pts is inside its own measured error of "
                "+/-%.2f pts -- the engine cannot tell this from zero"
                % (h.attribution_pts, mae)
            ),
        )
    if ratio < AUTO_RATIO and proposed == "auto_execute":
        return "merchant_action", Withholding(
            factor=factor,
            label=h.root_cause_label.value,
            attribution_pts=h.attribution_pts,
            mae=mae,
            downgraded_from=proposed,
            downgraded_to="merchant_action",
            reason=(
                "attribution %.2f pts is only %.1fx its measured error of "
                "+/-%.2f -- strong enough to raise with the merchant, not "
                "strong enough to act on unattended" % (h.attribution_pts, ratio, mae)
            ),
        )
    return proposed, None


def build_plan(
    diagnosis: Diagnosis,
    dec: Decomposition,
    txns: Sequence[Transaction],
    *,
    mae_by_factor: dict[str, float] | None = None,
    # Retry every recoverable failure, not just the largest few. Capping at a
    # small number and sorting by value biases the batch toward high-ticket
    # payments, which are exactly the ones the mandate's auto-execute limit
    # will step up -- so a small cap silently produced a run with no
    # auto-executed retries at all.
    max_retries: int = 200,
) -> Plan:
    mae_by_factor = mae_by_factor if mae_by_factor is not None else load_mae()
    actions: list[ProposedAction] = []
    withheld: list[Withholding] = []

    unretried = [
        t
        for t in txns
        if not t.succeeded and t.error_class in RECOVERABLE and not t.retried
    ]
    # Deterministic order: biggest money first, then id, so two runs of the
    # same batch produce the same ledger.
    unretried.sort(key=lambda t: (-t.amount_paise, t.txn_id))

    for h in diagnosis.hypotheses:
        tier, w = _tier_for(h, dec, mae_by_factor)
        if w:
            withheld.append(w)
        if tier == "investigation":
            actions.append(
                ProposedAction(
                    action_type=ActionType.FLAG_FOR_INVESTIGATION,
                    txn_id="merchant:%s" % (txns[0].merchant_id if txns else "unknown"),
                    amount_paise=0,
                    reason="%s: %s" % (h.factor, w.reason if w else h.recommended_action),
                    requires_merchant_approval=False,
                )
            )
            continue

        action_type = LABEL_TO_ACTION.get(
            h.root_cause_label, ActionType.FLAG_FOR_INVESTIGATION
        )

        if action_type == ActionType.RETRY_SOFT_DECLINE:
            for t in unretried[:max_retries]:
                actions.append(
                    ProposedAction(
                        action_type=action_type,
                        txn_id=t.txn_id,
                        amount_paise=t.amount_paise,
                        target_bank=t.bank,
                        reason="%s (%s), unretried" % (h.recommended_action, t.error_code),
                        requires_merchant_approval=(tier == "merchant_action"),
                    )
                )
        else:
            actions.append(
                ProposedAction(
                    action_type=action_type,
                    txn_id="merchant:%s" % (txns[0].merchant_id if txns else "unknown"),
                    amount_paise=0,
                    reason=h.recommended_action,
                    requires_merchant_approval=(tier == "merchant_action"),
                )
            )

    # The process gap is MEASURED directly from the batch -- we can see which
    # recoverable failures were never retried. So the retry list is built
    # deterministically rather than depending on the model to notice it. The
    # LLM's job here is explanation, not detection; leaving money on the table
    # because a model did not mention it would be a bad trade.
    already_retrying = any(
        a.action_type is ActionType.RETRY_SOFT_DECLINE for a in actions
    )
    if unretried and not already_retrying:
        for t in unretried[:max_retries]:
            actions.append(
                ProposedAction(
                    action_type=ActionType.RETRY_SOFT_DECLINE,
                    txn_id=t.txn_id,
                    amount_paise=t.amount_paise,
                    target_bank=t.bank,
                    reason=(
                        "recoverable failure (%s) left unretried; process gap "
                        "measured at %.2f pts" % (t.error_code, dec.process_gap_pts)
                    ),
                    requires_merchant_approval=False,
                )
            )

    n_withheld = len(withheld)
    n_proposed = len(diagnosis.hypotheses)
    if n_withheld:
        headline = (
            "%d fixes proposed, %d withheld because the attribution is inside "
            "its own error bar." % (n_proposed, n_withheld)
        )
    else:
        headline = "%d fixes proposed, all clear of their measured error bars." % n_proposed

    return Plan(actions=actions, withheld=withheld, headline=headline)
