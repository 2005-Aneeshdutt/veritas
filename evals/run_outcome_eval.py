"""How good are the agent's forecasts, once the fix has actually landed?

Run:  python evals/run_outcome_eval.py

The attribution error says how well the engine explains the past. This says
how well it predicts the consequence of acting on that explanation -- which is
the number a merchant actually cares about, and the one almost nobody reports.

For every demo merchant and every cause it carries: apply the fix, regenerate,
and compare the movement against what the decomposition predicted. Reported
per cause, because a system that forecasts billing-window fixes well and bank
fixes badly should say so rather than quoting one average.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.outcome import measure_outcome  # noqa: E402
from doctor.stats import mean  # noqa: E402

RESULTS = ROOT / "evals" / "results"
SYNTH = ROOT / "data" / "synthetic"

sys.path.insert(0, str(ROOT / "scripts"))
from generate_batch import DEMO  # noqa: E402


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    baseline = Baseline()
    seed = 20260824

    rows = []
    for spec in DEMO:
        causes = spec["causes"]
        if not causes:
            continue
        for cause in causes:
            o = measure_outcome(
                merchant_id=spec["merchant_id"],
                name=spec["name"],
                mcc=spec["mcc"],
                n_txns=spec["n_txns"],
                seed=seed,
                causes=causes,
                target_pts=spec.get("target_pts", {}),
                cause_fixed=cause,
                baseline=baseline,
            )
            rows.append(o)
            print(
                "  %-18s %-26s predicted %+5.2f  measured %+5.2f  error %+5.2f  %s"
                % (o.merchant_name[:18], cause[:26], o.predicted_pts,
                   o.measured_pts, o.forecast_error_pts, o.verdict)
            )

    by_cause: dict[str, list] = defaultdict(list)
    for o in rows:
        by_cause[o.cause_fixed].append(o)


    per_cause = {
        c: {
            "n": len(v),
            "mean_predicted_pts": round(mean([x.predicted_pts for x in v]), 3),
            "mean_measured_pts": round(mean([x.measured_pts for x in v]), 3),
            "mean_forecast_error_pts": round(mean([x.forecast_error_pts for x in v]), 3),
            "mae_pts": round(mean([abs(x.forecast_error_pts) for x in v]), 3),
        }
        for c, v in sorted(by_cause.items())
    }

    # no_soft_decline_retry CANNOT be validated this way, and reporting it in
    # the headline would be reporting a broken test as a bad forecast. The
    # generator models `retried` as a flag on a failed payment; it never
    # converts a failure into a success. So removing the retry gap cannot move
    # the observed success rate BY CONSTRUCTION, and the -0.06 measured below
    # is an artefact of the harness rather than evidence about the forecast.
    #
    # Fixing it properly means modelling retry conversion in the generator,
    # which would decouple the sampled batch from the analytic ground truth
    # the whole validation rests on. Excluded and explained instead.
    UNVALIDATABLE = {"no_soft_decline_retry"}
    scored = [o for o in rows if o.cause_fixed not in UNVALIDATABLE]
    excluded = [o for o in rows if o.cause_fixed in UNVALIDATABLE]

    errs = [o.forecast_error_pts for o in scored]
    optimistic = sum(1 for e in errs if e > 0.25)
    pessimistic = sum(1 for e in errs if e < -0.25)

    out = {
        "note": (
            "Forecast accuracy AFTER the fix lands, not attribution accuracy "
            "before it. The counterfactual month is simulated by regenerating "
            "the same merchant with the same seed and the fixed cause removed, "
            "so the outcome is synthetic in the same way the batch is -- but "
            "it is not circular: the forecast comes from the decomposition and "
            "the outcome comes from the generator, and neither is derived from "
            "the other."
        ),
        "fix_effectiveness_assumed": (
            "A fix is assumed to remove 45-100% of its cause depending on the "
            "cause, never all of it. Moving a billing window does not eliminate "
            "every night-time payment, and assuming it does would flatter every "
            "forecast."
        ),
        "excluded_from_headline": {
            "causes": sorted(UNVALIDATABLE),
            "n": len(excluded),
            "why": (
                "The generator models `retried` as a flag on a failed payment "
                "and never converts a failure into a success, so removing the "
                "retry gap cannot move the observed success rate by "
                "construction. The measured movement is an artefact of the "
                "harness, not evidence about the forecast. Fixing it properly "
                "means modelling retry conversion, which would decouple the "
                "sampled batch from the analytic ground truth the rest of the "
                "validation depends on."
            ),
            "measured": [json.loads(o.model_dump_json()) for o in excluded],
        },
        "n_fixes": len(scored),
        "overall": {
            "mean_forecast_error_pts": round(mean(errs), 3),
            "mae_pts": round(mean([abs(e) for e in errs]), 3),
            "optimistic": optimistic,
            "pessimistic": pessimistic,
            "held": len(scored) - optimistic - pessimistic,
            "within_own_error_bar": sum(1 for o in scored if o.within_error_bar),
        },
        "by_cause": per_cause,
        "fixes": [json.loads(o.model_dump_json()) for o in rows],
    }
    (RESULTS / "outcome_accuracy.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )

    ov = out["overall"]
    print("")
    print("%d fixes scored, %d excluded (see below)" % (len(scored), len(excluded)))
    print("  mean forecast error  %+.2f pts  (positive = optimistic)"
          % ov["mean_forecast_error_pts"])
    print("  mean absolute error   %.2f pts" % ov["mae_pts"])
    print("  optimistic %d / held %d / pessimistic %d"
          % (ov["optimistic"], ov["held"], ov["pessimistic"]))
    print("  within the engine's own error bar: %d/%d"
          % (ov["within_own_error_bar"], len(scored)))
    print("")
    print("excluded: %s" % ", ".join(sorted(UNVALIDATABLE)))

    print("  the generator models retry as a flag, never as a conversion, so")
    print("  removing this gap cannot move the observed rate by construction.")
    print("  That is a broken test, not a bad forecast, and it is reported as one.")

    print("\nby cause")
    print("  %-28s %3s %11s %10s %9s" % ("cause", "n", "predicted", "measured", "MAE"))
    for c, v in per_cause.items():
        print("  %-28s %3d %+10.2f %+9.2f %9.2f"
              % (c[:28], v["n"], v["mean_predicted_pts"],
                 v["mean_measured_pts"], v["mae_pts"]))
    print("\nwrote evals/results/outcome_accuracy.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
