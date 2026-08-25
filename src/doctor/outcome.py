"""Did the fix work? Grading the agent's own forecast against what happened.

Everything up to here ends at "we recommended this and executed it". That is
where most systems stop, and it is why nobody can tell you whether their
recommendations are any good.

This closes the loop. Apply a fix, let a month pass, re-run the diagnosis, and
compare what actually moved against what was predicted. The output is not
"success rate improved" -- it is:

    predicted +3.99 points, measured +3.17, forecast 0.82 points optimistic

which is the agent grading itself on the only thing that matters. It is the
same discipline as the error bars, applied one level up: the attribution error
says how well the engine explains the past, this says how well it predicts the
consequences of acting.

HOW THE "NEXT MONTH" IS PRODUCED, STATED PLAINLY. There is no future data, so
the counterfactual is simulated: the same merchant is regenerated with the
same seed and the same causes, with the fixed cause removed or reduced. That
makes the OUTCOME synthetic in the same way the batch is. What it is NOT is
circular -- the forecast comes from the decomposition, the outcome comes from
the generator, and neither is derived from the other. The residual between
them is a real property of the estimator.
"""

from __future__ import annotations

from pydantic import BaseModel

from .baseline import Baseline
from .cohort import build_cohort
from .features import CAUSE_TO_FACTOR
from .generator import generate_merchant
from .plan import load_mae
from .shapley import ShapleyDecomposer, observed_rate

#: How much of a cause a fix is assumed to remove. Not 1.0: moving a billing
#: window does not eliminate every night-time payment, and claiming it does
#: would make every forecast look better than it should.
FIX_EFFECTIVENESS = {
    "midnight_billing_penalty": 0.80,
    "bank_concentration": 0.55,
    "amount_band_risk": 0.45,
    "method_mix_mismatch": 0.60,
    "no_soft_decline_retry": 1.00,
}


class Outcome(BaseModel):
    merchant_id: str
    merchant_name: str
    cause_fixed: str
    factor: str | None

    #: What the decomposition said this cause was worth, before the fix.
    predicted_pts: float
    #: This engine's own measured error on that factor, from the sweep.
    predicted_error_pts: float | None

    before_pct: float
    after_pct: float
    measured_pts: float

    #: predicted - measured. Positive means the forecast was optimistic.
    forecast_error_pts: float
    within_error_bar: bool
    verdict: str

    #: Money, at the merchant's own volume. Projected like every rupee here.
    predicted_value_paise: int
    measured_value_paise: int


def _target_pts(m) -> dict[str, float]:
    return dict(m.ground_truth.requested_pts)


def measure_outcome(
    merchant_id: str,
    name: str,
    mcc: str,
    n_txns: int,
    seed: int,
    causes: list[str],
    target_pts: dict[str, float],
    cause_fixed: str,
    *,
    baseline: Baseline | None = None,
) -> Outcome:
    """Regenerate this merchant with the fix applied, and grade the forecast."""
    baseline = baseline or Baseline()
    mae = load_mae()
    cohort = build_cohort(mcc, baseline)

    before = generate_merchant(
        merchant_id=merchant_id, name=name, mcc=mcc, n_txns=n_txns,
        seed=seed, causes=causes, target_pts=target_pts, baseline=baseline,
    )
    dec_before = ShapleyDecomposer(baseline, cohort).decompose(
        before.transactions, mae_by_factor=mae
    )

    factor = CAUSE_TO_FACTOR.get(cause_fixed)
    eff = FIX_EFFECTIVENESS.get(cause_fixed, 0.5)

    # What the diagnosis claimed this cause was worth. The process gap is
    # computed directly rather than decomposed, so it is read from its own
    # field rather than from the Shapley values.
    if cause_fixed == "no_soft_decline_retry":
        predicted = dec_before.process_gap_pts * eff
        pred_err = None
    else:
        row = next((a for a in dec_before.attributions if a.factor == factor), None)
        predicted = (row.points if row else 0.0) * eff
        pred_err = row.mae if row else None

    # The fix: the same merchant, same seed, with that cause reduced.
    after_causes = [c for c in causes if c != cause_fixed]
    after_targets = {
        k: v * (1 - eff) if k == cause_fixed else v for k, v in target_pts.items()
    }
    if cause_fixed in target_pts and after_targets[cause_fixed] > 0.05:
        after_causes = list(causes)
    else:
        after_targets.pop(cause_fixed, None)

    after = generate_merchant(
        merchant_id=merchant_id, name=name, mcc=mcc, n_txns=n_txns,
        seed=seed, causes=after_causes, target_pts=after_targets,
        baseline=baseline,
        retry_rate_when_healthy=1.0 if cause_fixed == "no_soft_decline_retry" else 0.75,
    )

    before_pct = observed_rate(before.transactions) * 100
    after_pct = observed_rate(after.transactions) * 100
    measured = after_pct - before_pct
    err = predicted - measured

    within = pred_err is not None and abs(err) <= pred_err
    if abs(err) < 0.25:
        verdict = "forecast held"
    elif err > 0:
        verdict = "forecast was optimistic"
    else:
        verdict = "fix beat the forecast"

    gmv = before.profile.monthly_gmv_paise
    return Outcome(
        merchant_id=merchant_id,
        merchant_name=name,
        cause_fixed=cause_fixed,
        factor=factor,
        predicted_pts=round(predicted, 3),
        predicted_error_pts=pred_err,
        before_pct=round(before_pct, 3),
        after_pct=round(after_pct, 3),
        measured_pts=round(measured, 3),
        forecast_error_pts=round(err, 3),
        within_error_bar=within,
        verdict=verdict,
        predicted_value_paise=int(gmv * predicted / 100),
        measured_value_paise=int(gmv * measured / 100),
    )
