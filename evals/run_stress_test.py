"""Where does it break? Hostile inputs, deliberately.

Run:  python evals/run_stress_test.py

§9 step 10. Everything else in evals/ measures the engine on data drawn from
the same process it was designed for. This measures it on data designed to
break it, because "it works on my benchmark" is not a claim about robustness.

Six attacks, each isolating one assumption:

  1. entangled_factors     rho pushed to 1.0 -- the independence assumption
                           in shapley.py violated as hard as possible
  2. heavy_tailed_amounts  a few payments carrying most of the value, so the
                           importance weights have something real to clamp
  3. degenerate_factors    a merchant on ONE bank -- the overlap assumption
                           broken outright
  4. label_noise           15% of error classes corrupted, as a mislabelling
                           gateway would do
  5. missing_fields        error codes stripped from a third of failures
  6. tiny_batch            n=25, far below the resolvable threshold

For each: does it CRASH, does it produce a WRONG answer confidently, or does
it correctly refuse? The third is the only acceptable outcome when the input
is genuinely unanswerable, and it is what the exception machinery exists for.

A system that degrades loudly is worth more than one that degrades quietly.
"""

from __future__ import annotations

import json
import random
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.cohort import build_cohort  # noqa: E402
from doctor.features import FACTORS, ErrorClass  # noqa: E402
from doctor.generator import generate_merchant  # noqa: E402
from doctor.plan import load_mae  # noqa: E402
from doctor.shapley import ShapleyDecomposer  # noqa: E402
from doctor.stats import is_underpowered, mean, wilson_halfwidth_pts  # noqa: E402

RESULTS = ROOT / "evals" / "results"
SEED = 20260824
N_PER_CASE = 12


def _mutate_heavy_tail(m, rng):
    """Give a handful of payments most of the value."""
    txns = list(m.transactions)
    for i in rng.sample(range(len(txns)), max(1, len(txns) // 25)):
        txns[i] = txns[i].model_copy(update={"amount_paise": 25_000_00})
    return m.model_copy(update={"transactions": txns})


def _mutate_one_bank(m, rng):
    txns = [t.model_copy(update={"bank": "Bank Of India"}) for t in m.transactions]
    return m.model_copy(update={"transactions": txns})


def _mutate_label_noise(m, rng):
    classes = list(ErrorClass)
    txns = []
    for t in m.transactions:
        if not t.succeeded and rng.random() < 0.15:
            t = t.model_copy(update={"error_class": rng.choice(classes)})
        txns.append(t)
    return m.model_copy(update={"transactions": txns})


def _mutate_missing_fields(m, rng):
    txns = []
    for t in m.transactions:
        if not t.succeeded and rng.random() < 0.33:
            t = t.model_copy(update={"error_code": None})
        txns.append(t)
    return m.model_copy(update={"transactions": txns})


def _mutate_tiny(m, rng):
    return m.model_copy(update={"transactions": list(m.transactions)[:25]})


CASES = [
    ("entangled_factors", dict(rho=1.0), None),
    ("heavy_tailed_amounts", dict(rho=0.0), _mutate_heavy_tail),
    ("degenerate_factors", dict(rho=0.0), _mutate_one_bank),
    ("label_noise", dict(rho=0.0), _mutate_label_noise),
    ("missing_fields", dict(rho=0.0), _mutate_missing_fields),
    ("tiny_batch", dict(rho=0.0), _mutate_tiny),
    ("control", dict(rho=0.0), None),
]


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    baseline = Baseline()
    mae = load_mae()
    out: dict[str, dict] = {}

    for case, gen_kw, mutate in CASES:
        rng = random.Random(SEED)
        errs, flagged, crashes, degenerate, underpowered = [], 0, 0, 0, 0
        clamp_rates = []
        detail = []

        for i in range(N_PER_CASE):
            try:
                m = generate_merchant(
                    merchant_id="stress_%s_%02d" % (case, i),
                    name="Stress %s %02d" % (case, i),
                    mcc="5732",
                    n_txns=400,
                    seed=SEED + i,
                    causes=["bank_concentration", "midnight_billing_penalty"],
                    target_pts={
                        "bank_concentration": 3.0,
                        "midnight_billing_penalty": 2.0,
                    },
                    baseline=baseline,
                    **gen_kw,
                )
                if mutate:
                    m = mutate(m, rng)

                cohort = build_cohort(m.profile.mcc, baseline)
                dec = ShapleyDecomposer(baseline, cohort).decompose(
                    m.transactions, mae_by_factor=mae
                )
                true = m.ground_truth.true_attribution
                est = dec.by_factor()
                errs += [abs(est[f] - true[f]) for f in FACTORS]
                clamp_rates.append(dec.clamp_rate)

                succ = sum(1 for t in m.transactions if t.succeeded)
                under = is_underpowered(succ, len(m.transactions), dec.gap_pts)
                underpowered += int(under)
                degenerate += int(bool(dec.degenerate_factors))
                # "Flagged" = the engine told the user something is wrong with
                # this diagnosis, by any of its three mechanisms.
                if not dec.reliable or dec.degenerate_factors or under:
                    flagged += 1
                if i == 0:
                    detail.append(
                        {
                            "clamp_rate": round(dec.clamp_rate, 3),
                            "degenerate": dec.degenerate_factors,
                            "underpowered": under,
                            "residual_pts": round(dec.residual_pts, 3),
                            "wilson_halfwidth_pts": round(
                                wilson_halfwidth_pts(succ, len(m.transactions)), 2
                            ),
                        }
                    )
            except Exception as e:  # a crash is the worst outcome; record it
                crashes += 1
                detail.append({"crash": "%s: %s" % (type(e).__name__, e)[:200]})
                traceback.print_exc(limit=1)

        n = N_PER_CASE
        out[case] = {
            "n_merchants": n,
            "crashes": crashes,
            "mae": round(mean(errs), 4) if errs else None,
            "mean_clamp_rate": round(mean(clamp_rates), 4) if clamp_rates else None,
            "flagged_as_unreliable": flagged,
            "flag_rate": round(flagged / n, 4),
            "degenerate_factor_cases": degenerate,
            "underpowered_cases": underpowered,
            "sample": detail[:1],
        }

    control_mae = out["control"]["mae"] or 1.0
    for case in out:
        m_ = out[case]["mae"]
        out[case]["mae_vs_control"] = round(m_ / control_mae, 3) if m_ else None

    summary = {
        "note": (
            "Hostile inputs. The question is not whether error rises -- it "
            "must -- but whether the engine SAYS SO. A case where MAE climbs "
            "and flag_rate stays at 0 is a silent failure and the worst "
            "outcome short of a crash."
        ),
        "seed": SEED,
        "n_per_case": N_PER_CASE,
        "cases": out,
        "silent_failures": [
            c
            for c, v in out.items()
            if c != "control"
            and (v["mae_vs_control"] or 0) > 1.5
            and v["flag_rate"] == 0.0
        ],
    }
    (RESULTS / "stress_test.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )

    print(
        "%-22s %7s %7s %10s %7s %9s %9s"
        % ("case", "crash", "MAE", "vs ctrl", "clamp", "degenerate", "underpow")
    )
    for case, v in out.items():
        print(
            "%-22s %7d %7s %10s %7s %9d %9d"
            % (
                case,
                v["crashes"],
                "%.3f" % v["mae"] if v["mae"] is not None else "-",
                "%.2fx" % v["mae_vs_control"] if v["mae_vs_control"] else "-",
                "%.2f" % v["mean_clamp_rate"] if v["mean_clamp_rate"] is not None else "-",
                v["degenerate_factor_cases"],
                v["underpowered_cases"],
            )
        )
    print("")
    print("(degenerate / underpow are counts out of %d; both are flags the "
          "user sees)" % N_PER_CASE)
    print("")
    if summary["silent_failures"]:
        print("SILENT FAILURES (error rose, engine said nothing): %s"
              % ", ".join(summary["silent_failures"]))
    else:
        print("No silent failures: every case where error rose materially was "
              "flagged to the user.")
    print("wrote evals/results/stress_test.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
