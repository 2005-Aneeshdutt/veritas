"""Does the model name the right root cause, scored by exact match?

Run:  ANTHROPIC_API_KEY=... python evals/run_root_cause_eval.py [--limit 60]

Scoring free text by checking whether it contains the word "billing" is
gameable, and a panellist will say so. Because the hypothesiser emits
`root_cause_label` from the SAME closed enum the generator injects from, this
is ordinary forced-choice classification against ground truth: exact match, a
confusion matrix, and nothing to argue about.

NONE_OF_THE_ABOVE is scored too, in both directions. The sweep contains
healthy merchants with nothing injected, and a model that never reaches for
"none of the above" on those is overconfident -- which is worth reporting, not
hiding. The rate is in the output either way.

Refuses to score stubs, for the same reason as the classification eval.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
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

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
RESULTS = ROOT / "evals" / "results"

#: Which cause each Shapley factor implies, for the faithfulness metric only.
FACTOR_TO_CAUSE = {
    "hour": "midnight_billing_penalty",
    "bank": "bank_concentration",
    "amount_band": "amount_band_risk",
    "method": "method_mix_mismatch",
}

LABELS = [
    "midnight_billing_penalty",
    "bank_concentration",
    "no_soft_decline_retry",
    "amount_band_risk",
    "method_mix_mismatch",
    "none_of_the_above",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60)
    args = ap.parse_args()

    client = LLMClient()
    if not client.has_key and not list(client.cache_dir.glob("*.json")):
        raise SystemExit(
            "No API key and an empty llm_cache/.\n"
            "This eval will not score stub responses. Set ANTHROPIC_API_KEY or "
            "OPENROUTER_API_KEY once to populate the cache; after that it "
            "reproduces offline."
        )

    print("provider: %s" % client.describe())
    files = sorted(SWEEP.glob("merchant_*.json"))[: args.limit]
    if not files:
        raise SystemExit("run: python scripts/generate_batch.py --sweep 200")

    baseline = Baseline()
    mae = load_mae()
    hyp = Hypothesiser(client, baseline)

    rows = []
    for i, f in enumerate(files):
        m = GeneratedMerchant.model_validate_json(f.read_text(encoding="utf-8"))
        cohort = build_cohort(m.profile.mcc, baseline)
        dec = ShapleyDecomposer(baseline, cohort).decompose(
            m.transactions, mae_by_factor=mae
        )
        marg = merchant_marginals(m.transactions)
        diag, res = hyp.run(m.profile, dec, marg)
        if getattr(res, "stub", False):
            raise SystemExit(
                "Got a stub response -- refusing to score placeholders. "
                "Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY."
            )

        gt = m.ground_truth
        truth = gt.primary_cause if gt.injected_causes else "none_of_the_above"
        pred = diag.primary_label.value

        # Separate the model's error from the attribution's error. The model
        # only sees the ESTIMATED decomposition, so if the estimate has
        # reordered the factors the model cannot recover the true cause -- and
        # marking it wrong for faithfully reading what it was given tells us
        # nothing about the model. `faithful` asks the narrower question: did
        # it name the cause implied by the numbers it actually saw?
        est = dec.by_factor()
        top_factor = max(est, key=lambda k: est[k]) if est else None
        if dec.process_gap_pts > max(est.values(), default=0.0):
            implied = "no_soft_decline_retry"
        else:
            implied = FACTOR_TO_CAUSE.get(top_factor, "none_of_the_above")
        rows.append(
            {
                "merchant": m.profile.merchant_id,
                "injected": gt.injected_causes,
                "true": truth,
                "pred": pred,
                "correct": pred == truth,
                "n_txns": len(m.transactions),
                "rho": gt.rho_nominal,
                "implied_by_estimate": implied,
                "faithful": pred == implied,
                "attribution_was_right": implied == truth,
                "cache_hit": bool(getattr(res, "cache_hit", False)),
                "summary": diag.summary[:160],
            }
        )
        if (i + 1) % 10 == 0:
            print("  %d/%d" % (i + 1, len(files)))

    n = len(rows)
    hits = sum(r["correct"] for r in rows)
    acc, lo, hi = wilson_interval(hits, n)

    confusion = {t: defaultdict(int) for t in LABELS}
    for r in rows:
        confusion[r["true"]][r["pred"]] += 1

    healthy = [r for r in rows if not r["injected"]]
    sick = [r for r in rows if r["injected"]]
    none_on_sick = sum(1 for r in sick if r["pred"] == "none_of_the_above")

    faithful = sum(1 for r in rows if r["faithful"])
    attr_right = sum(1 for r in rows if r["attribution_was_right"])
    f_acc, f_lo, f_hi = wilson_interval(faithful, n)
    a_acc, a_lo, a_hi = wilson_interval(attr_right, n)
    # Where the estimate already pointed at the right cause, did the model
    # follow it? This is the cleanest read on the model alone.
    solvable = [r for r in rows if r["attribution_was_right"]]
    solved = sum(1 for r in solvable if r["correct"])

    out = {
        "error_decomposition": {
            "note": (
                "The model reads the ESTIMATED decomposition, not the truth. "
                "Splitting the error says whether the bottleneck is the model "
                "or the attribution feeding it."
            ),
            "attribution_pointed_at_the_right_cause": round(a_acc, 4),
            "attribution_ci95": [round(a_lo, 4), round(a_hi, 4)],
            "model_faithful_to_what_it_saw": round(f_acc, 4),
            "faithful_ci95": [round(f_lo, 4), round(f_hi, 4)],
            "accuracy_when_attribution_was_right": (
                round(solved / len(solvable), 4) if solvable else None
            ),
            "n_solvable": len(solvable),
        },
        "note": (
            "Exact match on root_cause_label against the injected cause. The "
            "model emits from the same closed enum the generator injects from, "
            "so this is forced-choice classification, not keyword matching."
        ),
        "n": n,
        "accuracy": round(acc, 4),
        "accuracy_ci95": [round(lo, 4), round(hi, 4)],
        "confusion_matrix": {k: dict(v) for k, v in confusion.items()},
        "healthy_merchants": {
            "n": len(healthy),
            "correctly_said_none_of_the_above": sum(
                1 for r in healthy if r["pred"] == "none_of_the_above"
            ),
            "note": (
                "Merchants with nothing injected. A model that never uses "
                "none_of_the_above here is overconfident."
            ),
        },
        "overreach": {
            "said_none_when_a_cause_was_injected": none_on_sick,
            "rate": round(none_on_sick / len(sick), 4) if sick else 0.0,
        },
        "cache_hit_rate": round(client.stats.cache_hit_rate, 4),
        "cost_inr": round(client.stats.cost_inr, 4),
        "errors": [r for r in rows if not r["correct"]][:40],
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "root_cause_accuracy.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )

    print("\nroot-cause accuracy %.1f%%  (95%% CI %.1f - %.1f)  n=%d"
          % (100 * acc, 100 * lo, 100 * hi, n))
    print("healthy merchants: %d, correctly none_of_the_above %d"
          % (len(healthy), out["healthy_merchants"]["correctly_said_none_of_the_above"]))
    print("said none when a cause WAS injected: %d (%.1f%%)"
          % (none_on_sick, 100 * out["overreach"]["rate"]))
    print("cache %.0f%%, cost Rs %.2f"
          % (100 * client.stats.cache_hit_rate, client.stats.cost_inr))
    print("\nconfusion (rows = truth):")
    print("%-26s %s" % ("", " ".join("%-10s" % l[:10] for l in LABELS)))
    for t in LABELS:
        print("%-26s %s" % (t[:26], " ".join("%-10d" % confusion[t][p] for p in LABELS)))
    print("\nwrote evals/results/root_cause_accuracy.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
