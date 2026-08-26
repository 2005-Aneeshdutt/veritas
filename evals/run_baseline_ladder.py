"""Recovered how much -- compared to what?

Run:  python evals/run_baseline_ladder.py

A recovery figure with no baseline is not a result, it is a number. So the
same batches run through five policies:

  B0  do nothing                          the floor. A marketing number only,
                                          and labelled as such.
  B1  retry once, immediately             the naive fix
  B2  fixed exponential backoff, 3 tries  the industry default
  B3  error-code-aware, recoverable       what a good engineer actually builds
      classes only, sensible delays       -- THIS is the comparison that counts
  T   Revenue Doctor                      bank-aware, timing-aware, and bound
                                          by the mandate's attempt cap

The headline is **T vs B3**, never T vs B0. Beating "do nothing" proves
nothing and a panel knows it.

THE COMPLIANCE ASYMMETRY, WHICH IS THE ACTUAL FINDING
-----------------------------------------------------
Stopping rule 1 caps a payment at 3 attempts IN TOTAL, counting the retries
the merchant already made before the agent ever saw the batch. B1, B2 and B3
do not track that history -- which is exactly what makes them baselines. They
can therefore recover more by breaching the cap.

So this reports `cap_violations` alongside recovery. A policy that recovers
more money by exceeding the mandate has not beaten the agent; it has done
something the agent is forbidden to do. Both numbers are shown, and neither is
hidden behind the other.

Every policy is scored under all three rail calibrations and the comparison is
reported as a RATIO, because calibration error largely cancels in a ratio
while it fully corrupts an absolute total.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from chitragupta.rails.mock_rail import Calibration, p_retry_success  # noqa: E402

from doctor.baseline import Baseline  # noqa: E402
from doctor.cohort import build_cohort  # noqa: E402
from doctor.features import RECOVERABLE, Transaction  # noqa: E402
from doctor.generator import GeneratedMerchant  # noqa: E402
from doctor.plan import load_mae  # noqa: E402
from doctor.shapley import ShapleyDecomposer  # noqa: E402

SWEEP = ROOT / "data" / "synthetic" / "validation_sweep"
RESULTS = ROOT / "evals" / "results"

#: Stopping rule 1 from the mandate: no payment may be attempted more than
#: this many times in total, counting the merchant's own prior attempts.
MAX_ATTEMPTS = 3


def _run_attempts(
    txn: Transaction,
    delays: list[float],
    cal: Calibration,
    *,
    respect_history: bool = False,
) -> tuple[int, int, int]:
    """Sequential attempts until success.

    Returns (expected paise recovered, attempts made, attempts over the cap).

    Expectation rather than a coin flip: across 200 merchants a sampled
    outcome would add variance that has nothing to do with the policies being
    compared, and comparing policies is the entire point.

    `respect_history=True` counts the merchant's prior attempts against the
    cap and spends only what is left. A policy without it is not merely less
    efficient -- it breaches stopping rule 1 -- so the breach is counted
    rather than silently rewarded with a bigger recovery number.
    """
    if txn.error_class is None:
        return 0, 0, 0

    budget = (
        max(MAX_ATTEMPTS - txn.attempts, 0) if respect_history else MAX_ATTEMPTS
    )

    remaining = 1.0
    recovered = 0.0
    attempts = 0
    violations = 0
    for i, d in enumerate(delays[:MAX_ATTEMPTS]):
        if attempts >= budget:
            break
        if not respect_history and (txn.attempts + i) >= MAX_ATTEMPTS:
            violations += 1
        p = p_retry_success(txn.error_class.value, d, cal)
        attempts += 1
        recovered += remaining * p * txn.amount_paise
        remaining *= 1 - p
        if remaining < 1e-6:
            break
    return int(recovered), attempts, violations


def policy_b0(txns, cal, dec):
    """Do nothing. The floor, and a marketing number only."""
    return 0, 0, 0, 0


def policy_b1(txns, cal, dec):
    """Retry once, immediately, everything that failed."""
    rec = att = wasted = viol = 0
    for t in txns:
        if t.succeeded:
            continue
        r, a, v = _run_attempts(t, [0.5], cal)
        rec += r
        att += a
        viol += v
        if t.error_class not in RECOVERABLE:
            wasted += a
    return rec, att, wasted, viol


def policy_b2(txns, cal, dec):
    """Fixed exponential backoff, three attempts, everything that failed."""
    rec = att = wasted = viol = 0
    for t in txns:
        if t.succeeded:
            continue
        r, a, v = _run_attempts(t, [1.0, 6.0, 24.0], cal)
        rec += r
        att += a
        viol += v
        if t.error_class not in RECOVERABLE:
            wasted += a
    return rec, att, wasted, viol


def policy_b3(txns, cal, dec):
    """Error-code aware: only recoverable classes, sensible per-class delays.

    Soft declines wait for the customer to be funded; technical declines retry
    soon because the incident clears. This is a genuinely good policy and it is
    what the headline compares against. It does NOT track prior attempts --
    that omission is what makes it a baseline.
    """
    rec = att = viol = 0
    for t in txns:
        if t.succeeded or t.error_class not in RECOVERABLE:
            continue
        delays = (
            [2.0, 8.0, 24.0]
            if t.error_class.value == "technical"
            else [36.0, 60.0, 84.0]
        )
        r, a, v = _run_attempts(t, delays, cal)
        rec += r
        att += a
        viol += v
    return rec, att, 0, viol


def policy_t(txns, cal, dec, _baseline=None):
    """Revenue Doctor: B3 plus two things it knows and B3 does not.

    1. Prior attempts count against the mandate's cap, so T spends only the
       remaining budget. An earlier version of this function skipped
       already-retried payments entirely; the ladder caught it giving away
       real money, which is exactly what a baseline comparison is for. T now
       works those payments -- it simply will not breach stopping rule 1 to
       win a comparison.
    2. The delay is chosen per payment from the failure class AND the bank's
       MEASURED technical share. A bank whose failures skew technical is
       having an incident, so retry sooner; one whose failures are business
       declines needs the customer funded, so wait longer.
    """
    baseline = _baseline or Baseline()
    rec = att = 0
    for t in txns:
        if t.succeeded or t.error_class not in RECOVERABLE:
            continue
        st = baseline.bank_stats(t.bank)
        tech_share = st.technical_share if st else 0.25
        if t.error_class.value == "technical":
            delays = [2.0, 8.0, 24.0]
        elif tech_share > 0.35:
            delays = [6.0, 24.0, 48.0]
        else:
            delays = [36.0, 60.0, 84.0]
        r, a, _ = _run_attempts(t, delays, cal, respect_history=True)
        rec += r
        att += a
    return rec, att, 0, 0


POLICIES = [
    ("B0_do_nothing", policy_b0),
    ("B1_retry_once", policy_b1),
    ("B2_backoff_3x", policy_b2),
    ("B3_error_code_aware", policy_b3),
    ("T_revenue_doctor", policy_t),
]


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    files = sorted(SWEEP.glob("merchant_*.json"))
    if not files:
        raise SystemExit("run: python scripts/generate_batch.py --sweep 200")

    baseline = Baseline()
    mae = load_mae()
    merchants = []
    for f in files:
        m = GeneratedMerchant.model_validate_json(f.read_text(encoding="utf-8"))
        cohort = build_cohort(m.profile.mcc, baseline)
        dec = ShapleyDecomposer(baseline, cohort).decompose(
            m.transactions, mae_by_factor=mae
        )
        merchants.append((m, dec))
    print(
        "scoring %d merchants x %d policies x %d calibrations"
        % (len(merchants), len(POLICIES), len(Calibration))
    )

    results: dict[str, dict] = {}
    for name, fn in POLICIES:
        per_cal = {}
        for cal in Calibration:
            rec = att = wasted = viol = 0
            for m, dec in merchants:
                if name == "T_revenue_doctor":
                    r, a, w, v = fn(m.transactions, cal, dec, baseline)
                else:
                    r, a, w, v = fn(m.transactions, cal, dec)
                rec += r
                att += a
                wasted += w
                viol += v
            per_cal[cal.value] = {
                "recovered_paise": rec,
                "attempts": att,
                "wasted_attempts": wasted,
                "cap_violations": viol,
            }
        results[name] = per_cal

    ratios = {}
    for cal in Calibration:
        b3 = results["B3_error_code_aware"][cal.value]
        base_rec = b3["recovered_paise"] or 1
        base_att = b3["attempts"] or 1
        ratios[cal.value] = {
            name: {
                "recovered_vs_b3": round(
                    results[name][cal.value]["recovered_paise"] / base_rec, 4
                ),
                "attempts_vs_b3": round(
                    results[name][cal.value]["attempts"] / base_att, 4
                ),
                "recovered_per_attempt_paise": (
                    round(
                        results[name][cal.value]["recovered_paise"]
                        / results[name][cal.value]["attempts"]
                    )
                    if results[name][cal.value]["attempts"]
                    else 0
                ),
            }
            for name, _ in POLICIES
        }

    cals = [c.value for c in Calibration]
    t_rec = [ratios[c]["T_revenue_doctor"]["recovered_vs_b3"] for c in cals]
    t_att = [ratios[c]["T_revenue_doctor"]["attempts_vs_b3"] for c in cals]
    t_eff = [ratios[c]["T_revenue_doctor"]["recovered_per_attempt_paise"] for c in cals]
    b3_eff = [ratios[c]["B3_error_code_aware"]["recovered_per_attempt_paise"] for c in cals]
    eff_ratio = [a / b for a, b in zip(t_eff, b3_eff) if b]

    central = Calibration.CENTRAL.value
    out = {
        "note": (
            "Headline is T vs B3, never T vs B0. B3 is error-code-aware retry, "
            "what a good engineer builds. B1/B2/B3 do not track the merchant's "
            "prior attempts and therefore breach stopping rule 1 -- the "
            "cap_violations column is how much of their recovery is bought "
            "with attempts the agent is forbidden to make."
        ),
        "max_attempts_per_payment": MAX_ATTEMPTS,
        "n_merchants": len(merchants),
        "absolute_paise_by_calibration": results,
        "ratios_vs_b3": ratios,
        "headline": {
            "t_vs_b3_recovered_ratio_range": [round(min(t_rec), 4), round(max(t_rec), 4)],
            "t_vs_b3_attempts_ratio_range": [round(min(t_att), 4), round(max(t_att), 4)],
            "t_vs_b3_efficiency_ratio_range": [
                round(min(eff_ratio), 4),
                round(max(eff_ratio), 4),
            ],
            "b3_cap_violations": results["B3_error_code_aware"][central]["cap_violations"],
            "t_cap_violations": results["T_revenue_doctor"][central]["cap_violations"],
            "interpretation": (
                "T recovers %.0f-%.0f%% of B3's total using %.0f-%.0f%% of its "
                "attempts, at %.2f-%.2fx the recovery per attempt. B3 reaches "
                "its total partly by exceeding the 3-attempt cap on %d "
                "payments; T breaches it on %d."
                % (
                    100 * min(t_rec), 100 * max(t_rec),
                    100 * min(t_att), 100 * max(t_att),
                    min(eff_ratio), max(eff_ratio),
                    results["B3_error_code_aware"][central]["cap_violations"],
                    results["T_revenue_doctor"][central]["cap_violations"],
                )
            ),
        },
    }
    (RESULTS / "baseline_ladder.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )

    print(
        "\n%-24s %13s %9s %8s %9s %10s"
        % ("policy", "recovered Rs", "attempts", "wasted", "over-cap", "Rs/attempt")
    )
    for name, _ in POLICIES:
        r = results[name][central]
        print(
            "%-24s %13s %9d %8d %9d %10s"
            % (
                name,
                "%.0f" % (r["recovered_paise"] / 100),
                r["attempts"],
                r["wasted_attempts"],
                r["cap_violations"],
                "%.0f" % (ratios[central][name]["recovered_per_attempt_paise"] / 100),
            )
        )
    print("\n(central calibration shown; ratios computed under all three)")
    print("\nHEADLINE: %s" % out["headline"]["interpretation"])
    print("\nwrote evals/results/baseline_ladder.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
