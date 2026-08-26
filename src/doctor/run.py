"""CLI entry point.  python -m doctor.run --merchant quickmart --seed 20260824

This is the command the dashboard's provenance bar tells a panellist to copy.
It must therefore reproduce a run exactly, which it does: fixed seed, pinned
NPCI period, temperature 0, and an on-disk LLM cache.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from chitragupta.mandate import SignedMandate  # noqa: E402
from chitragupta.rails.mock_rail import Calibration  # noqa: E402

from doctor.baseline import Baseline  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.graph import run_diagnosis  # noqa: E402

SYNTH = ROOT / "data" / "synthetic"
MANDATES = ROOT / "data" / "mandates"


def load_merchant(name: str) -> GeneratedMerchant:
    p = SYNTH / ("merchant_%s.json" % name)
    if not p.exists():
        raise SystemExit(
            "%s not found -- run: python scripts/generate_batch.py --demo" % p
        )
    return GeneratedMerchant.model_validate_json(p.read_text(encoding="utf-8"))


def load_mandate(name: str) -> SignedMandate:
    p = MANDATES / ("%s_mandate.json" % name)
    if not p.exists():
        raise SystemExit(
            "%s not found -- run: python -m chitragupta.mandate --generate "
            "--merchant %s" % (p, name)
        )
    return SignedMandate.model_validate_json(p.read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--merchant", default="quickmart")
    ap.add_argument("--seed", type=int, default=20260824)
    ap.add_argument("--run-id", default=None)
    ap.add_argument(
        "--calibration",
        default="central",
        choices=[c.value for c in Calibration],
        help="which retry-success calibration to project rupees with",
    )
    ap.add_argument("--json", action="store_true", help="print the full report")
    args = ap.parse_args()

    m = load_merchant(args.merchant)
    mandate = load_mandate(args.merchant)
    rec = run_diagnosis(
        m.profile,
        m.transactions,
        mandate,
        baseline=Baseline(),
        seed=args.seed,
        run_id=args.run_id,
        calibration=Calibration(args.calibration),
    )

    if args.json:
        print(json.dumps(rec.report, indent=2))
        return 0

    r = rec.report
    meas, proj, d = r["measured"], r["projected"], r["decomposition"]
    print("run %s  merchant %s  %d ms  commit %s"
          % (rec.run_id, rec.merchant_name, rec.duration_ms, rec.commit))
    print("  llm: %d calls, %.0f%% cached, Rs %.2f%s"
          % (rec.llm_calls, 100 * rec.cache_hit_rate, rec.llm_cost_inr,
             "   [STUBS -- no API key, results are placeholders]"
             if rec.used_stubs else ""))
    print("")

    # The track's bar asks for money recovered across a batch, so that leads.
    # The honesty about what kind of number it is follows immediately -- it
    # qualifies the figure rather than replacing it.
    g = r["gate"]["decisions"]
    print("  RECOVERY  (batch of %d payments, %d failed)"
          % (meas["transactions"], meas["failures"]))
    print("    executed        %d actions under mandate" % g["allow"])
    print("    recovered       Rs %.2f          [PROJECTED, %s calibration]"
          % (proj["recovered_this_run_paise"] / 100, r["run"]["calibration"]))
    rr = proj["recoverable"]
    print("    still on table  Rs %.2f - %.2f  [PROJECTED range, 3 calibrations]"
          % (rr["low_paise"] / 100, rr["high_paise"] / 100))
    print("    unrecoverable   Rs %.2f across %d payments -- see exceptions"
          % (proj["unrecoverable_paise"] / 100, proj["unrecoverable_count"]))
    print("    escalation      %d auto / %d to merchant / %d denied by mandate"
          % (g["allow"], g["step_up"], g["deny"]))
    print("    audit           %d ledger entries, chain %s, %d mandate violations"
          % (meas["ledger_entries"],
             "VERIFIED" if meas["chain_verified"] else "BROKEN",
             meas["mandate_violations"]))
    print("")
    print("  WHY  (what the recovery was aimed at)")
    print("    observed   %.2f%%  (95%% CI %.2f - %.2f)   [MEASURED]"
          % (meas["observed_success_pct"], *meas["observed_success_ci_pct"]))
    print("    achievable %.2f%%   gap %.2f pts            [PROJECTED]"
          % (proj["cohort_achievable_pct"], proj["gap_pts"]))
    print("    gap value  Rs %.2f / month                [PROJECTED]"
          % (proj["gap_value_paise"] / 100))
    print("")
    for f in d["factors"]:
        flag = ""
        if not f["identified"]:
            flag = "  NOT IDENTIFIED"
        elif f["inside_error_bar"]:
            flag = "  inside its own error bar"
        bar = (" +/- %.2f" % f["mae"]) if f["mae"] else ""
        print("    %-12s %+6.2f%s pts%s" % (f["factor"], f["points"], bar, flag))
    print("    %-12s %+6.2f pts   (unexplained)" % ("residual", d["residual_pts"]))
    print("    %-12s %+6.2f pts   (process gap, computed directly)"
          % ("process gap", d["process_gap_pts"]))
    print("")
    print("  %s" % r["plan"]["headline"])
    for w in r["plan"]["withheld"]:
        print("    withheld: %s -- %s" % (w["factor"], w["reason"]))
    print("")
    print("  saved to data/runs/%s.json" % rec.run_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
