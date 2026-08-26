"""Inject-and-recover: how often is the attribution right, and by how much?

Run:  python evals/run_validation_sweep.py

For every merchant in data/synthetic/validation_sweep/ we already know the
exact answer, because generator.py computed the Shapley decomposition
analytically over the true generating distribution. This script runs the
actual engine over the sampled batch and compares.

Emits, all to evals/results/:
    attribution_mae_by_factor.json   per-factor MAE, bias, coverage -- this
                                     file is loaded at RUNTIME by plan.py and
                                     by the frontend's error bars, so its
                                     shape is a contract, not just a report
    correlation_degradation.json     error as a function of injected rho:
                                     the empirical price of the independence
                                     assumption in shapley.py
    batch_size_power.json            error as a function of batch size
    process_gap_recovery.json        NO_SOFT_DECLINE_RETRY, scored against the
                                     direct formula rather than a Shapley value
    failure_cases.md                 the merchants it got wrong, with reasons

No number printed here is a target. Whatever comes out, goes in.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.cohort import build_cohort  # noqa: E402
from doctor.features import FACTORS  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.shapley import ShapleyDecomposer, naive_attribution, observed_rate  # noqa: E402
from doctor.stats import mean, median, percentile, wilson_halfwidth_pts  # noqa: E402

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
RESULTS = ROOT / "evals" / "results"

#: The band the coverage statistic asks about, in points.
COVERAGE_BAND = 0.5


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
    baseline = Baseline()
    print("loaded %d merchants" % len(merchants))

    rows = []
    for m in merchants:
        cohort = build_cohort(m.profile.mcc, baseline)
        dec = ShapleyDecomposer(baseline, cohort).decompose(m.transactions)
        naive = naive_attribution(m.transactions, baseline, cohort)
        gt = m.ground_truth
        n = len(m.transactions)
        succ = sum(1 for t in m.transactions if t.succeeded)

        est = dec.by_factor()
        true = gt.true_attribution
        # Primary cause: which factor actually carries the most, vs which each
        # method says carries the most. Only meaningful when something was
        # actually injected.
        true_primary = max(true, key=lambda k: true[k]) if any(
            abs(v) > 1e-9 for v in true.values()
        ) else None
        rows.append(
            {
                "merchant_id": m.profile.merchant_id,
                "mcc": m.profile.mcc,
                "n": n,
                "rho_nominal": gt.rho_nominal,
                "rho_realised": gt.rho_realised,
                "injected": gt.injected_causes,
                "errors": {f: est[f] - true[f] for f in FACTORS},
                "true": true,
                "est": est,
                "naive": naive,
                "true_primary": true_primary,
                "shapley_primary": dec.primary_cause(),
                "naive_primary": max(naive, key=lambda k: naive[k]) if naive else None,
                "residual_pts": dec.residual_pts,
                "v_n": dec.coalition_values["+".join(FACTORS)],
                "gap_pts": dec.gap_pts,
                "clamp_rate": dec.clamp_rate,
                "degenerate": dec.degenerate_factors,
                "reliable": dec.reliable,
                "wilson_halfwidth_pts": wilson_halfwidth_pts(succ, n),
                "true_process_gap": gt.true_process_gap_pts,
                "est_process_gap": dec.process_gap_pts,
            }
        )

    # --- per-factor error ------------------------------------------------
    by_factor: dict[str, dict] = {}
    for f in FACTORS:
        errs = [r["errors"][f] for r in rows]
        abs_errs = [abs(e) for e in errs]
        by_factor[f] = {
            "mae": round(mean(abs_errs), 4),
            "bias": round(mean(errs), 4),
            "median_abs_err": round(median(abs_errs), 4),
            "p90_abs_err": round(percentile(abs_errs, 0.90), 4),
            "coverage_0p5": round(
                sum(1 for e in abs_errs if e <= COVERAGE_BAND) / len(abs_errs), 4
            ),
            "n": len(errs),
        }
    (RESULTS / "attribution_mae_by_factor.json").write_text(
        json.dumps(by_factor, indent=2), encoding="utf-8", newline="\n"
    )

    # --- degradation vs correlation --------------------------------------
    by_rho: dict[str, list] = defaultdict(list)
    for r in rows:
        by_rho["%.1f" % r["rho_nominal"]].append(r)
    corr = {}
    for rho, group in sorted(by_rho.items()):
        all_errs = [abs(r["errors"][f]) for r in group for f in FACTORS]
        corr[rho] = {
            "n_merchants": len(group),
            "mean_realised_rho": round(mean([r["rho_realised"] for r in group]), 4),
            "mae_all_factors": round(mean(all_errs), 4),
            "p90_abs_err": round(percentile(all_errs, 0.90), 4),
            "primary_cause_accuracy": _primary_accuracy(group, "shapley_primary"),
        }
    (RESULTS / "correlation_degradation.json").write_text(
        json.dumps(corr, indent=2), encoding="utf-8", newline="\n"
    )

    # --- degradation vs batch size ---------------------------------------
    by_n: dict[str, list] = defaultdict(list)
    for r in rows:
        by_n[str(r["n"])].append(r)
    power = {}
    for n_txns, group in sorted(by_n.items(), key=lambda kv: int(kv[0])):
        all_errs = [abs(r["errors"][f]) for r in group for f in FACTORS]
        power[n_txns] = {
            "n_merchants": len(group),
            "mae_all_factors": round(mean(all_errs), 4),
            "mean_wilson_halfwidth_pts": round(
                mean([r["wilson_halfwidth_pts"] for r in group]), 4
            ),
            "primary_cause_accuracy": _primary_accuracy(group, "shapley_primary"),
        }
    (RESULTS / "batch_size_power.json").write_text(
        json.dumps(power, indent=2), encoding="utf-8", newline="\n"
    )

    # --- process gap ------------------------------------------------------
    pg = [
        (r["true_process_gap"], r["est_process_gap"])
        for r in rows
        if "no_soft_decline_retry" in r["injected"]
    ]
    pg_all = [(r["true_process_gap"], r["est_process_gap"]) for r in rows]
    (RESULTS / "process_gap_recovery.json").write_text(
        json.dumps(
            {
                "note": (
                    "NO_SOFT_DECLINE_RETRY is not a Shapley factor. It is "
                    "computed directly (see shapley.process_gap) and scored "
                    "here against that formula, in its own file, so the "
                    "per-factor MAE table stays clean."
                ),
                "injected_merchants": {
                    "n": len(pg),
                    "mae": round(mean([abs(a - b) for a, b in pg]), 4),
                    "mean_true_pts": round(mean([a for a, _ in pg]), 4),
                },
                "all_merchants": {
                    "n": len(pg_all),
                    "mae": round(mean([abs(a - b) for a, b in pg_all]), 4),
                },
            },
            indent=2,
        ),
        encoding="utf-8", newline="\n",
    )

    # --- naive vs shapley -------------------------------------------------
    scored = [r for r in rows if r["true_primary"]]
    n_dis = sum(1 for r in scored if r["shapley_primary"] != r["naive_primary"])

    # Coherence: do the parts add up to the whole? This turned out to be the
    # ONLY dimension on which Shapley beats naive attribution, and it is the
    # dimension this project actually needs, because every headline figure is
    # a rupee amount derived from a magnitude rather than a ranking.
    coherent = [r for r in rows if abs(r["v_n"]) > 0.2]
    sh_ratio = [sum(r["est"].values()) / r["v_n"] for r in coherent]
    nv_ratio = [sum(r["naive"].values()) / r["v_n"] for r in coherent]
    nvs = {
        "n_scored": len(scored),
        "coherence": {
            "note": (
                "sum(attribution) / v(N). 1.0 means the factor values account "
                "for exactly the movement the decomposition explains. Shapley "
                "is 1.0 by the efficiency axiom; naive attribution double-"
                "counts shared credit and cannot be converted to rupees."
            ),
            "n": len(coherent),
            "shapley_mean_ratio": round(mean(sh_ratio), 4),
            "shapley_max_abs_dev": round(max(abs(x - 1) for x in sh_ratio), 6),
            "naive_mean_ratio": round(mean(nv_ratio), 4),
            "naive_min_ratio": round(min(nv_ratio), 4),
            "naive_max_ratio": round(max(nv_ratio), 4),
            "naive_overstates_pct": round(
                100.0 * sum(1 for x in nv_ratio if x > 1.02) / len(nv_ratio), 1
            ),
        },
        "shapley_primary_accuracy": _primary_accuracy(scored, "shapley_primary"),
        "naive_primary_accuracy": _primary_accuracy(scored, "naive_primary"),
        "disagreement_rate": round(n_dis / len(scored), 4) if scored else 0.0,
        "when_they_disagree": _disagreement_breakdown(scored),
    }
    (RESULTS / "naive_vs_shapley.json").write_text(
        json.dumps(nvs, indent=2), encoding="utf-8", newline="\n"
    )

    _write_failure_cases(rows)
    _print_summary(by_factor, corr, power, nvs, rows)
    return 0


def _primary_accuracy(rows, key: str) -> float:
    scored = [r for r in rows if r["true_primary"]]
    if not scored:
        return 0.0
    hits = sum(1 for r in scored if r[key] == r["true_primary"])
    return round(hits / len(scored), 4)


def _disagreement_breakdown(rows) -> dict:
    dis = [r for r in rows if r["shapley_primary"] != r["naive_primary"]]
    shap_right = sum(1 for r in dis if r["shapley_primary"] == r["true_primary"])
    naive_right = sum(1 for r in dis if r["naive_primary"] == r["true_primary"])
    return {
        "n": len(dis),
        "shapley_correct": shap_right,
        "naive_correct": naive_right,
        "both_wrong": len(dis) - shap_right - naive_right,
    }


def _write_failure_cases(rows) -> None:
    """The unglamorous table. Every merchant the engine got wrong, and why."""
    bad = [
        r
        for r in rows
        if r["true_primary"] and r["shapley_primary"] != r["true_primary"]
    ]
    bad.sort(key=lambda r: -max(abs(v) for v in r["errors"].values()))
    lines = [
        "# Failure cases",
        "",
        "Merchants where the Shapley attribution named the wrong primary "
        "cause, worst first. Generated by `evals/run_validation_sweep.py`; "
        "do not edit by hand.",
        "",
        "%d of %d scored merchants (%.1f%%)."
        % (
            len(bad),
            len([r for r in rows if r["true_primary"]]),
            100.0 * len(bad) / max(len([r for r in rows if r["true_primary"]]), 1),
        ),
        "",
        "| merchant | n | rho | injected | true primary | said | worst err "
        "| clamp | degenerate | structural reason |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in bad:
        worst = max(r["errors"], key=lambda f: abs(r["errors"][f]))
        lines.append(
            "| %s | %d | %.1f | %s | %s | %s | %s %+.2f | %.2f | %s | %s |"
            % (
                r["merchant_id"],
                r["n"],
                r["rho_nominal"],
                ", ".join(r["injected"]) or "none",
                r["true_primary"],
                r["shapley_primary"],
                worst,
                r["errors"][worst],
                r["clamp_rate"],
                ",".join(r["degenerate"]) or "-",
                _reason(r),
            )
        )
    lines += [
        "",
        "## Structural reasons",
        "",
        "* **underpowered batch** -- the Wilson half-width on the observed "
        "success rate exceeds half the gap, so the split across four factors "
        "is noise wearing a ranking.",
        "* **correlated factors** -- rho > 0 means the injected causes "
        "co-occur, and marginal reweighting cannot separate them. This is the "
        "independence assumption in shapley.py being wrong, on purpose, so it "
        "can be measured.",
        "* **degenerate factor** -- the merchant has effectively one value for "
        "that factor, so there is nothing to reweight toward and the "
        "attribution is unidentified rather than merely noisy.",
        "* **near-tie** -- two factors carry almost the same true value, so "
        "picking the larger is close to a coin flip and the ranking metric is "
        "harsher than the underlying error warrants.",
    ]
    (RESULTS / "failure_cases.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _reason(r) -> str:
    reasons = []
    if r["degenerate"]:
        reasons.append("degenerate factor (%s)" % ",".join(r["degenerate"]))
    if r["wilson_halfwidth_pts"] > 0.5 * abs(r["gap_pts"]):
        reasons.append("underpowered batch")
    if r["rho_nominal"] >= 0.4:
        reasons.append("correlated factors")
    true_sorted = sorted(r["true"].values(), reverse=True)
    if len(true_sorted) > 1 and abs(true_sorted[0] - true_sorted[1]) < 0.3:
        reasons.append("near-tie")
    return "; ".join(reasons) or "unexplained -- worth a look"


def _print_summary(by_factor, corr, power, nvs, rows) -> None:
    print("\n--- attribution error by factor -------------------------------")
    print("%-12s %7s %8s %8s %10s" % ("factor", "MAE", "bias", "p90", "cov +/-0.5"))
    for f, s in by_factor.items():
        print(
            "%-12s %7.3f %8.3f %8.3f %9.1f%%"
            % (f, s["mae"], s["bias"], s["p90_abs_err"], 100 * s["coverage_0p5"])
        )

    print("\n--- degradation vs injected correlation ------------------------")
    print("%-6s %8s %10s %10s %10s" % ("rho", "n", "realised", "MAE", "primary acc"))
    for rho, s in corr.items():
        print(
            "%-6s %8d %10.3f %10.3f %9.1f%%"
            % (rho, s["n_merchants"], s["mean_realised_rho"], s["mae_all_factors"],
               100 * s["primary_cause_accuracy"])
        )

    print("\n--- degradation vs batch size ----------------------------------")
    print("%-8s %8s %10s %14s %10s" % ("n_txns", "merch", "MAE", "wilson +/-pts", "primary acc"))
    for n_txns, s in power.items():
        print(
            "%-8s %8d %10.3f %14.2f %9.1f%%"
            % (n_txns, s["n_merchants"], s["mae_all_factors"],
               s["mean_wilson_halfwidth_pts"], 100 * s["primary_cause_accuracy"])
        )

    print("\n--- naive vs shapley -------------------------------------------")
    print("  scored merchants     %d" % nvs["n_scored"])
    print("  shapley primary acc  %.1f%%" % (100 * nvs["shapley_primary_accuracy"]))
    print("  naive primary acc    %.1f%%" % (100 * nvs["naive_primary_accuracy"]))
    print("  disagreement rate    %.1f%%" % (100 * nvs["disagreement_rate"]))
    d = nvs["when_they_disagree"]
    print(
        "  when they disagree:  shapley right %d, naive right %d, both wrong %d"
        % (d["shapley_correct"], d["naive_correct"], d["both_wrong"])
    )
    c = nvs["coherence"]
    print("")
    print("  -- do the parts add up to the whole? sum(phi)/v(N) --")
    print("  shapley   mean %.4f  (max deviation %.2e)"
          % (c["shapley_mean_ratio"], c["shapley_max_abs_dev"]))
    print("  naive     mean %.4f  range %.2f .. %.2f"
          % (c["naive_mean_ratio"], c["naive_min_ratio"], c["naive_max_ratio"]))
    print("  naive overstates the total on %.0f%% of merchants"
          % c["naive_overstates_pct"])

    unreliable = sum(1 for r in rows if not r["reliable"])
    print("\n  flagged unreliable   %d / %d" % (unreliable, len(rows)))
    print("  mean clamp rate      %.3f" % mean([r["clamp_rate"] for r in rows]))
    print("  mean |residual|      %.3f pts" % mean([abs(r["residual_pts"]) for r in rows]))
    print("\nwrote evals/results/{attribution_mae_by_factor,correlation_degradation,")
    print("      batch_size_power,process_gap_recovery,naive_vs_shapley}.json")
    print("      evals/results/failure_cases.md")


if __name__ == "__main__":
    raise SystemExit(main())
