"""What would change my mind? Three sensitivities, measured.

Run:  python evals/run_s_star_sensitivity.py

§5.4 says s_star is an INPUT, not a discovery, and that this is the first
question a good panellist asks. Measuring it turned up something better than
the expected answer, so this script reports three distinct sensitivities
rather than one.

PART A -- the level of s_star.
    The attributions are EXACTLY invariant to it, and that is structural, not
    luck. The value function is

        v(S) = [weighted mean of p_success under the cohort PROFILE] - s_obs

    which contains the cohort's factor mix but never its headline rate. So
    shifting s_star moves the gap and the residual and nothing else. The
    ranking of causes -- the thing a merchant acts on -- cannot move. Part A
    asserts this rather than merely observing it, so a regression would fail
    the run.

PART B -- the cohort PROFILE. This is the assumption that actually bites: if
    the national bank mix or the assumed method mix is wrong, the reweighting
    target is wrong and the attributions move. Measured by blending the cohort
    marginals toward uniform.

PART C -- the assumed priors. priors.py is honest that the method, hour and
    amount coefficients are assumed rather than measured, and each carries a
    plausible range. Part C sweeps every assumed prior across its own stated
    range simultaneously, which is the harshest version of the question.

Emits evals/results/s_star_sensitivity.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.cohort import build_cohort  # noqa: E402
from doctor.features import FACTORS  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.shapley import ShapleyDecomposer  # noqa: E402
from doctor.stats import mean  # noqa: E402

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
SYNTH = ROOT / "data" / "synthetic"
RESULTS = ROOT / "evals" / "results"

SHIFTS = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0]
BLENDS = [0.0, 0.1, 0.25, 0.5]
PRIOR_SCALES = [-1.0, -0.5, 0.0, 0.5, 1.0]


def blend_to_uniform(cohort, alpha: float):
    """Move the cohort profile alpha of the way toward a uniform mix."""
    if alpha <= 0:
        return cohort
    marg = {}
    for f, dist in cohort.marginals.items():
        k = len(dist)
        marg[f] = {v: (1 - alpha) * p + alpha / k for v, p in dist.items()}
    return cohort.model_copy(update={"marginals": marg})


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    baseline = Baseline()

    files = sorted(SWEEP.glob("merchant_*.json"))[:80]
    if not files:
        raise SystemExit("run: python scripts/generate_batch.py --sweep 200")
    merchants = [
        GeneratedMerchant.model_validate_json(f.read_text(encoding="utf-8"))
        for f in files
    ]

    # ---------------- PART A: the level of s_star -------------------------
    part_a = {}
    max_attr_move = 0.0
    for shift in SHIFTS:
        gaps, residuals, moves = [], [], []
        flips = 0
        for m in merchants:
            base = ShapleyDecomposer(
                baseline, build_cohort(m.profile.mcc, baseline)
            ).decompose(m.transactions)
            alt = ShapleyDecomposer(
                baseline, build_cohort(m.profile.mcc, baseline, s_star_shift_pts=shift)
            ).decompose(m.transactions)
            b, a = base.by_factor(), alt.by_factor()
            moves += [abs(a[f] - b[f]) for f in FACTORS]
            gaps.append(alt.gap_pts - base.gap_pts)
            residuals.append(alt.residual_pts - base.residual_pts)
            flips += int(base.primary_cause() != alt.primary_cause())
        max_attr_move = max(max_attr_move, max(moves) if moves else 0.0)
        part_a["%+.1f" % shift] = {
            "mean_gap_change_pts": round(mean(gaps), 4),
            "mean_residual_change_pts": round(mean(residuals), 4),
            "max_attribution_move_pts": round(max(moves) if moves else 0.0, 8),
            "primary_cause_flips": flips,
        }

    # Structural, so assert it. A regression here is a real bug.
    assert max_attr_move < 1e-9, (
        "attributions moved with s_star (max %.3e) -- the value function must "
        "have picked up a dependence on the cohort's headline rate" % max_attr_move
    )

    # ---------------- PART B: the cohort PROFILE --------------------------
    part_b = {}
    for alpha in BLENDS:
        moves, flips, n = [], 0, 0
        for m in merchants:
            cohort = build_cohort(m.profile.mcc, baseline)
            base = ShapleyDecomposer(baseline, cohort).decompose(m.transactions)
            alt = ShapleyDecomposer(
                baseline, blend_to_uniform(cohort, alpha)
            ).decompose(m.transactions)
            b, a = base.by_factor(), alt.by_factor()
            moves += [abs(a[f] - b[f]) for f in FACTORS]
            flips += int(base.primary_cause() != alt.primary_cause())
            n += 1
        part_b["%.2f" % alpha] = {
            "n_merchants": n,
            "mean_abs_attribution_move_pts": round(mean(moves), 4),
            "primary_cause_flips": flips,
            "primary_cause_flip_rate": round(flips / n, 4) if n else 0.0,
        }

    # ---------------- PART C: the assumed priors --------------------------
    part_c = {}
    for scale in PRIOR_SCALES:
        alt_baseline = Baseline(prior_scale=scale) if scale else baseline
        moves, flips, n, gaps = [], 0, 0, []
        for m in merchants:
            base = ShapleyDecomposer(
                baseline, build_cohort(m.profile.mcc, baseline)
            ).decompose(m.transactions)
            alt = ShapleyDecomposer(
                alt_baseline, build_cohort(m.profile.mcc, alt_baseline)
            ).decompose(m.transactions)
            b, a = base.by_factor(), alt.by_factor()
            moves += [abs(a[f] - b[f]) for f in FACTORS]
            gaps.append(alt.gap_pts - base.gap_pts)
            flips += int(base.primary_cause() != alt.primary_cause())
            n += 1
        part_c["%+.1f" % scale] = {
            "n_merchants": n,
            "mean_abs_attribution_move_pts": round(mean(moves), 4),
            "mean_gap_change_pts": round(mean(gaps), 4),
            "primary_cause_flips": flips,
            "primary_cause_flip_rate": round(flips / n, 4) if n else 0.0,
        }

    # ---------------- demo curves for the dashboard slider ----------------
    demos = {}
    for name in ("quickmart", "cloudsync", "techbazaar"):
        p = SYNTH / ("merchant_%s.json" % name)
        if not p.exists():
            continue
        m = GeneratedMerchant.model_validate_json(p.read_text(encoding="utf-8"))
        curve = []
        for shift in SHIFTS:
            d = ShapleyDecomposer(
                baseline, build_cohort(m.profile.mcc, baseline, s_star_shift_pts=shift)
            ).decompose(m.transactions)
            curve.append(
                {
                    "shift_pts": shift,
                    "s_star_pct": round(d.s_star * 100, 3),
                    "gap_pts": round(d.gap_pts, 3),
                    "gap_value_paise": int(
                        (d.gap_pts / 100.0) * m.profile.monthly_gmv_paise
                    ),
                    "attributions": {k: round(v, 3) for k, v in d.by_factor().items()},
                    "residual_pts": round(d.residual_pts, 3),
                    "primary_cause": d.primary_cause(),
                }
            )
        demos[name] = curve

    out = {
        "part_a_s_star_level": {
            "note": (
                "The attributions are EXACTLY invariant to the level of "
                "s_star, and this is structural: v(S) contains the cohort's "
                "factor PROFILE but never its headline rate. Shifting s_star "
                "moves the gap and the residual, and therefore the rupee "
                "figure, but cannot reorder the causes. The script asserts "
                "this rather than observing it."
            ),
            "max_attribution_move_pts_across_all_shifts": round(max_attr_move, 12),
            "by_shift": part_a,
        },
        "part_b_cohort_profile": {
            "note": (
                "The assumption that actually bites. If the cohort's bank or "
                "method mix is wrong, the reweighting target is wrong. "
                "Measured by blending the cohort marginals toward uniform."
            ),
            "by_blend_alpha": part_b,
        },
        "part_c_assumed_priors": {
            "note": (
                "priors.py states that the method, hour and amount "
                "coefficients are assumed, each with a plausible range. This "
                "sweeps ALL of them across their own stated ranges at once, "
                "which is the harshest form of the question. -1.0 is the low "
                "end of every range, +1.0 the high end."
            ),
            "by_prior_scale": part_c,
        },
        "demo_merchants": demos,
    }
    (RESULTS / "s_star_sensitivity.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8"
    )

    print("PART A -- level of s_star (%d merchants)" % len(merchants))
    print("%-8s %14s %16s %18s" % ("shift", "gap change", "residual change", "attr move"))
    for k, s in part_a.items():
        print("%-8s %13.3f %15.3f %17.1e"
              % (k, s["mean_gap_change_pts"], s["mean_residual_change_pts"],
                 s["max_attribution_move_pts"]))
    print("  -> attributions are exactly invariant (asserted, max %.1e)" % max_attr_move)

    print("\nPART B -- cohort profile blended toward uniform")
    print("%-8s %20s %14s" % ("alpha", "mean attr move", "primary flip"))
    for k, s in part_b.items():
        print("%-8s %19.3f %13.1f%%"
              % (k, s["mean_abs_attribution_move_pts"], 100 * s["primary_cause_flip_rate"]))

    print("\nPART C -- all assumed priors swept across their stated ranges")
    print("%-8s %20s %14s %14s" % ("scale", "mean attr move", "gap change", "primary flip"))
    for k, s in part_c.items():
        print("%-8s %19.3f %13.3f %13.1f%%"
              % (k, s["mean_abs_attribution_move_pts"], s["mean_gap_change_pts"],
                 100 * s["primary_cause_flip_rate"]))
    print("\nwrote evals/results/s_star_sensitivity.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
