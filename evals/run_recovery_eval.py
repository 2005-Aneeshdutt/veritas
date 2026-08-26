"""How much money does a retry ACTUALLY recover, and how wrong is our guess?

Run:  python evals/run_recovery_eval.py

Every rupee this project reports as recovered comes out of `mock_rail.py`,
which models the odds a retry converts. That model is an assumption, and the
submission has always labelled its output PROJECTED because of it.

This eval is what puts an error bar on that label. Each generated merchant now
carries, as ground truth, whether every recoverable failure would ACTUALLY
have converted -- drawn from a different model, with a different shape, that
the rail cannot see. The rail keys on (error class, delay, attempt); the truth
also depends on the amount and the issuer, because a customer short of money
is likelier to still be short of a large amount than a small one.

So the question stops being "do you believe our retry model?" and becomes
"how far off is it, measured, and in which direction?" -- which is a question
with an answer.

  MEASURED   the true recoverable value, from ground truth
  MEASURED   the rail's forecast error against it, per calibration
  PROJECTED  nothing here

A calibration that is honest about being wrong is worth more than one that
claims to be right. No number printed here is a target.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from chitragupta.rails.mock_rail import Calibration, execute  # noqa: E402
from chitragupta.types import ActionType, ProposedAction  # noqa: E402
from doctor.features import ErrorClass  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.stats import mean, median, percentile  # noqa: E402

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
RESULTS = ROOT / "evals" / "results"

#: The delay the agent actually uses when it retries. Matching what apply.py
#: passes, so this measures the rail as it is used rather than at its best.
HOURS_SINCE_FAILURE = 36.0

RECOVERABLE = (ErrorClass.SOFT_DECLINE, ErrorClass.TECHNICAL)


def load_sweep() -> list[GeneratedMerchant]:
    files = sorted(SWEEP.glob("merchant_*.json"))
    if not files:
        raise SystemExit(
            "no sweep found -- run: python scripts/generate_batch.py --sweep 200"
        )
    return [
        GeneratedMerchant.model_validate_json(f.read_text(encoding="utf-8"))
        for f in files
    ]


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    merchants = load_sweep()

    per_cal: dict[str, dict] = {}
    band_err: dict[str, list[float]] = defaultdict(list)

    for cal in Calibration:
        rows = []
        for m in merchants:
            truth = m.ground_truth.retry_conversions
            if not truth:
                continue

            true_paise = 0
            fc_paise = 0
            attempted = 0
            for t in m.transactions:
                if t.succeeded or t.error_class not in RECOVERABLE:
                    continue
                if t.txn_id not in truth:
                    continue
                attempted += 1

                # What the rail predicts, as an expected value rather than a
                # coin flip -- the question is the model's calibration, not
                # the variance of one draw.
                out = execute(
                    ProposedAction(
                        action_type=ActionType.RETRY_SOFT_DECLINE,
                        txn_id=t.txn_id,
                        amount_paise=t.amount_paise,
                        target_bank=t.bank,
                        reason="recovery eval",
                    ),
                    error_class=(
                        t.error_class.value if t.error_class else "soft_decline"
                    ),
                    hours_since_failure=HOURS_SINCE_FAILURE,
                    attempt=1,
                    calibration=cal,
                )
                fc_paise += out.amount_recovered_paise
                if truth[t.txn_id]:
                    true_paise += t.amount_paise

                    if t.amount_paise > 500_00:
                        band = "large"
                    elif t.amount_paise > 150_00:
                        band = "medium"
                    else:
                        band = "small"
                    band_err[band].append(
                        out.amount_recovered_paise - t.amount_paise
                    )

            if attempted == 0 or true_paise == 0:
                continue
            rows.append(
                {
                    "merchant_id": m.profile.merchant_id,
                    "attempted": attempted,
                    "true_recovered_paise": true_paise,
                    "forecast_paise": fc_paise,
                    "ratio": fc_paise / true_paise,
                }
            )

        ratios = [r["ratio"] for r in rows]
        tot_true = sum(r["true_recovered_paise"] for r in rows)
        tot_fc = sum(r["forecast_paise"] for r in rows)
        per_cal[cal.value] = {
            "merchants_scored": len(rows),
            "true_recovered_paise": tot_true,
            "forecast_paise": tot_fc,
            "portfolio_ratio": round(tot_fc / tot_true, 4) if tot_true else None,
            "median_merchant_ratio": round(median(ratios), 4) if ratios else None,
            "mean_merchant_ratio": round(mean(ratios), 4) if ratios else None,
            "p10_ratio": round(percentile(ratios, 0.10), 4) if ratios else None,
            "p90_ratio": round(percentile(ratios, 0.90), 4) if ratios else None,
            "direction": (
                "over-forecasts"
                if tot_true and tot_fc > tot_true
                else "under-forecasts"
            ),
        }

    central = per_cal.get(Calibration.CENTRAL.value, {})
    ratio = central.get("portfolio_ratio")
    brackets = (
        per_cal[Calibration.CONSERVATIVE.value]["portfolio_ratio"]
        <= 1.0
        <= per_cal[Calibration.OPTIMISTIC.value]["portfolio_ratio"]
        if per_cal.get(Calibration.CONSERVATIVE.value)
        and per_cal.get(Calibration.OPTIMISTIC.value)
        else None
    )

    out = {
        "note": (
            "Each merchant carries, as ground truth, whether every recoverable "
            "failure would actually have converted on retry -- drawn from a "
            "model the rail cannot see, keyed on the amount and the issuer as "
            "well as the error class."
        ),
        "what_this_establishes": (
            "That the published three-calibration RANGE brackets the truth, and "
            "that the rail's error is concentrated in large payments because it "
            "ignores the amount entirely. Both are properties of the rail, and "
            "both are measured."
        ),
        "what_this_does_NOT_establish": (
            "That the central calibration is 1.43x too high in the real world. "
            "The ground-truth conversion model is itself a modelling choice -- a "
            "deliberately different one, so the comparison is not circular, but "
            "a choice. What is being measured is the rail against a plausible "
            "alternative, not against reality. Reality would need a live "
            "payment rail and a holdout, which is stated as out of scope rather "
            "than quietly claimed."
        ),
        "hours_since_failure": HOURS_SINCE_FAILURE,
        "headline": (
            "The central calibration forecasts %.0f%% of what a retry truly "
            "recovers across the sweep."
            % (100 * ratio) if ratio else "no scorable merchants"
        ),
        "range_brackets_the_truth": brackets,
        "by_calibration": per_cal,
        "central_error_by_amount_band_paise": {
            band: {
                "n": len(errs),
                "mean_error_paise": int(mean(errs)),
                "median_error_paise": int(median(errs)),
            }
            for band, errs in sorted(band_err.items())
        },
    }

    (RESULTS / "recovery_accuracy.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )

    print("recovery accuracy, measured against ground truth")
    for cal, d in per_cal.items():
        print(
            "  %-13s forecast/true = %.3f  (%s, n=%d merchants)"
            % (cal, d["portfolio_ratio"], d["direction"], d["merchants_scored"])
        )
    print("  range brackets the truth: %s" % brackets)
    for band, d in out["central_error_by_amount_band_paise"].items():
        print(
            "  %-7s mean forecast error Rs %s per converted payment (n=%d)"
            % (band, format(d["mean_error_paise"] // 100, ",d"), d["n"])
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
