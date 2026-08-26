"""How fast is this at book scale?

Run:  python evals/run_scale_benchmark.py

A demo over 8 merchants does not answer "could Razorpay run this nightly over
millions". This times the deterministic pipeline -- load, cohort, decompose,
process gap, uncertainty gate -- over all 200 sweep merchants and reports
throughput.

The LLM steps are deliberately excluded and reported separately, because they
are the part that does NOT need to run per merchant per night. Classification
is answered from a committed lookup table for every published code; the
hypothesiser only needs to run for merchants that actually have a gap worth
explaining. Timing them into the per-merchant figure would misrepresent how
this would really be deployed.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.cohort import build_cohort  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.plan import load_mae  # noqa: E402
from doctor.shapley import ShapleyDecomposer  # noqa: E402
from doctor.stats import is_underpowered, mean, percentile  # noqa: E402

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
RESULTS = ROOT / "evals" / "results"


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    files = sorted(SWEEP.glob("merchant_*.json"))
    if not files:
        raise SystemExit("run: python scripts/generate_batch.py --sweep 200")

    baseline = Baseline()
    mae = load_mae()

    # Load first so disk time is not counted as compute time.
    merchants = [
        GeneratedMerchant.model_validate_json(f.read_text(encoding="utf-8"))
        for f in files
    ]
    total_txns = sum(len(m.transactions) for m in merchants)
    print("%d merchants, %s payments" % (len(merchants), format(total_txns, ",d")))

    per_merchant: list[float] = []
    actionable = 0
    t0 = time.perf_counter()
    for m in merchants:
        s = time.perf_counter()
        cohort = build_cohort(m.profile.mcc, baseline)
        dec = ShapleyDecomposer(baseline, cohort).decompose(
            m.transactions, mae_by_factor=mae
        )
        succ = sum(1 for t in m.transactions if t.succeeded)
        under = is_underpowered(succ, len(m.transactions), dec.gap_pts)
        if dec.gap_pts > 0.75 and not under:
            actionable += 1
        per_merchant.append((time.perf_counter() - s) * 1000)
    wall = time.perf_counter() - t0

    ms = sorted(per_merchant)
    out = {
        "note": (
            "Deterministic pipeline only: cohort, 16-coalition decomposition, "
            "process gap and the uncertainty gate. LLM steps are excluded "
            "because they do not need to run per merchant per night -- "
            "classification is a committed lookup for every published code, "
            "and the hypothesiser only runs where there is a gap worth "
            "explaining."
        ),
        "n_merchants": len(merchants),
        "n_payments": total_txns,
        "wall_seconds": round(wall, 3),
        "merchants_per_second": round(len(merchants) / wall, 1),
        "payments_per_second": round(total_txns / wall, 0),
        "per_merchant_ms": {
            "mean": round(mean(per_merchant), 2),
            "p50": round(percentile(ms, 0.50), 2),
            "p90": round(percentile(ms, 0.90), 2),
            "p99": round(percentile(ms, 0.99), 2),
            "max": round(ms[-1], 2),
        },
        "actionable_merchants": actionable,
        "projected": {
            "note": "Straight-line extrapolation on one core. Real deployment "
            "would shard by merchant, which is embarrassingly parallel.",
            "one_million_merchants_hours_single_core": round(
                (1_000_000 / (len(merchants) / wall)) / 3600, 2
            ),
            "one_million_merchants_hours_32_cores": round(
                (1_000_000 / (len(merchants) / wall)) / 3600 / 32, 2
            ),
        },
    }
    (RESULTS / "scale_benchmark.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )

    print("\n%.2f s wall for %d merchants" % (wall, len(merchants)))
    print("  %.1f merchants/sec, %s payments/sec"
          % (out["merchants_per_second"], format(int(out["payments_per_second"]), ",d")))
    print("\nper merchant, milliseconds")
    for k in ("mean", "p50", "p90", "p99", "max"):
        print("  %-5s %8.2f" % (k, out["per_merchant_ms"][k]))
    print("\n%d of %d merchants had an actionable gap"
          % (actionable, len(merchants)))
    pr = out["projected"]
    print("\nextrapolated to a million merchants:")
    print("  %.1f hours single-core, %.1f hours on 32 cores"
          % (pr["one_million_merchants_hours_single_core"],
             pr["one_million_merchants_hours_32_cores"]))
    print("\nwrote evals/results/scale_benchmark.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
