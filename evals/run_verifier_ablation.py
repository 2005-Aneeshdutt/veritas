"""Does the verifier actually help? Measured, not assumed.

Run:  python evals/run_verifier_ablation.py [--limit 60]

The root-cause eval decomposed its own 60% accuracy and found the bottleneck
was the model rather than the attribution: shown a decomposition, it followed
what it was shown only 63% of the time. verify.py is the fix. This is the
ablation that says whether the fix worked.

Same merchants, same prompts, same seed. The only difference is whether the
deterministic verifier runs and re-asks once on a violation.

WHAT ACTUALLY HAPPENED, measured twice on two different merchant sets:

    merchant set    accuracy off -> on   fixed / broken   violations
    original        60.0% -> 61.7%       8 / 7            29 -> 0
    after regen     65.0% -> 70.0%       9 / 6            28 -> 1

The accuracy point estimate is much larger the second time. But 9 fixed against
6 broken is a net of three merchants out of sixty, the confidence intervals
overlap heavily either way, and an effect that moves from +1.7 to +5.0 between
two runs of the same experiment is not an effect I am willing to claim.

What is NOT ambiguous is the other column. Violations collapse in both runs.

So the conclusion is the same both times:

    The verifier makes the output CONSISTENT. Whether it also makes it more
    ACCURATE is not established by this data.

Those are different properties, and conflating them is the easy mistake. The
model was contradicting its own evidence even on merchants it got right, so
removing the contradiction does not necessarily fix the reasoning.

It is worth shipping regardless, for a reason unrelated to accuracy: 8 of the
caught violations were figures the model invented that appear nowhere in the
data it was given. Every one would otherwise have reached a merchant-facing
email. That is a safety property, and it holds whether or not the label at the
end changes.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.cohort import build_cohort  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.hypothesise import Hypothesiser  # noqa: E402
from doctor.llm import LLMClient  # noqa: E402
from doctor.plan import load_mae  # noqa: E402
from doctor.shapley import ShapleyDecomposer, merchant_marginals  # noqa: E402
from doctor.stats import wilson_interval  # noqa: E402
from doctor.verify import verify  # noqa: E402

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
RESULTS = ROOT / "evals" / "results"

FACTOR_TO_CAUSE = {
    "hour": "midnight_billing_penalty",
    "bank": "bank_concentration",
    "amount_band": "amount_band_risk",
    "method": "method_mix_mismatch",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60)
    args = ap.parse_args()

    client = LLMClient()
    if not client.has_key and not list(client.cache_dir.glob("*.json")):
        raise SystemExit(
            "No API key and an empty llm_cache/. This eval will not score stubs."
        )
    print("provider: %s" % client.describe())

    files = sorted(SWEEP.glob("merchant_*.json"))[: args.limit]
    if not files:
        raise SystemExit("run: python scripts/generate_batch.py --sweep 200")

    baseline = Baseline()
    mae = load_mae()
    off = Hypothesiser(client, baseline, verify_output=False)
    on = Hypothesiser(client, baseline, verify_output=True)

    rows = []
    for i, f in enumerate(files):
        m = GeneratedMerchant.model_validate_json(f.read_text(encoding="utf-8"))
        cohort = build_cohort(m.profile.mcc, baseline)
        dec = ShapleyDecomposer(baseline, cohort).decompose(
            m.transactions, mae_by_factor=mae
        )
        marg = merchant_marginals(m.transactions)
        gt = m.ground_truth
        truth = gt.primary_cause if gt.injected_causes else "none_of_the_above"

        d_off, _ = off.run(m.profile, dec, marg)
        # What the verifier WOULD have flagged on the unverified answer.
        from doctor.hypothesise import build_context, _prompt

        top_banks = sorted(marg["bank"].items(), key=lambda kv: -kv[1])
        prompt = _prompt(
            build_context(m.profile, dec, baseline, top_banks),
            marg["hour"], marg["method"], marg["amount_band"],
        )
        flagged = verify(d_off, prompt, dec)

        d_on, _ = on.run(m.profile, dec, marg)
        after = on.last_verification

        rows.append(
            {
                "merchant": m.profile.merchant_id,
                "truth": truth,
                "off": d_off.primary_label.value,
                "on": d_on.primary_label.value,
                "off_correct": d_off.primary_label.value == truth,
                "on_correct": d_on.primary_label.value == truth,
                "violations_before": [v.rule for v in flagged.violations],
                "violations_after": [v.rule for v in (after.violations if after else [])],
                "repaired": bool(after and after.attempts > 1),
            }
        )
        if (i + 1) % 10 == 0:
            print("  %d/%d" % (i + 1, len(files)))

    n = len(rows)
    off_hits = sum(r["off_correct"] for r in rows)
    on_hits = sum(r["on_correct"] for r in rows)
    o_acc, o_lo, o_hi = wilson_interval(off_hits, n)
    v_acc, v_lo, v_hi = wilson_interval(on_hits, n)

    before = Counter(v for r in rows for v in r["violations_before"])
    after = Counter(v for r in rows for v in r["violations_after"])
    dirty_before = sum(1 for r in rows if r["violations_before"])
    dirty_after = sum(1 for r in rows if r["violations_after"])

    fixed = [r for r in rows if not r["off_correct"] and r["on_correct"]]
    broke = [r for r in rows if r["off_correct"] and not r["on_correct"]]

    out = {
        "note": (
            "Same merchants, same prompts, same seed; the only difference is "
            "whether the deterministic verifier runs. HEADLINE: the verifier "
            "makes the output CONSISTENT; whether it also makes it more "
            "ACCURATE is not established. Violations collapse decisively in "
            "both runs of this experiment, but the accuracy delta moved from "
            "+1.7 to +5.0 points between two merchant sets, with heavily "
            "overlapping intervals and nearly as many merchants broken as "
            "fixed. An effect that unstable is not one to claim. Worth "
            "shipping regardless: the caught violations include figures the "
            "model invented outright, each of which would otherwise have "
            "reached a merchant-facing email."
        ),
        "conclusion": (
            "consistency improved decisively; the accuracy effect is not "
            "established. Reported as two separate properties, not one."
        ),
        "n": n,
        "without_verifier": {
            "accuracy": round(o_acc, 4),
            "ci95": [round(o_lo, 4), round(o_hi, 4)],
            "merchants_with_violations": dirty_before,
            "violations_by_rule": dict(before),
        },
        "with_verifier": {
            "accuracy": round(v_acc, 4),
            "ci95": [round(v_lo, 4), round(v_hi, 4)],
            "merchants_with_violations": dirty_after,
            "violations_by_rule": dict(after),
            "repaired": sum(1 for r in rows if r["repaired"]),
        },
        "delta_pts": round((v_acc - o_acc) * 100, 2),
        "fixed_by_verifier": [r["merchant"] for r in fixed],
        "broken_by_verifier": [r["merchant"] for r in broke],
        "rules": {
            "R1_ungrounded_number": "cited a figure not present in the context",
            "R2_primary_label_mismatch": "named a cause other than the largest identified one",
            "R3_acted_on_unidentified_factor": "proposed an action on a factor the overlap check rejected",
            "R4_auto_executed_inside_error_bar": "auto-executed an attribution smaller than its own error",
            "R5_duplicate_factor": "claimed the same factor twice",
        },
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "verifier_ablation.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )

    print("\n%-22s %10s %10s" % ("", "verifier off", "verifier on"))
    print("%-22s %9.1f%% %10.1f%%" % ("root-cause accuracy", 100 * o_acc, 100 * v_acc))
    print("%-22s %10d %10d" % ("merchants w/ violations", dirty_before, dirty_after))
    print("%-22s %10s %10d" % ("repaired on retry", "-", out["with_verifier"]["repaired"]))
    print("\ndelta: %+.2f points" % out["delta_pts"])
    print("  fixed by the verifier : %d" % len(fixed))
    print("  broken by the verifier: %d" % len(broke))
    print("\nviolations caught, by rule:")
    for rule, c in before.most_common():
        print("  %-38s %3d  ->  %d after repair" % (rule, c, after.get(rule, 0)))
    print("\nwrote evals/results/verifier_ablation.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
