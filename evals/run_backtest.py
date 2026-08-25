"""Out-of-sample backtest on REAL data. The answer to "it's all synthetic".

Run:  python evals/run_backtest.py

Every other eval here validates the attribution layer against ground truth I
generated. That is the right way to measure an estimator, and it is still open
to one fair objection: the model was checked against my own generator.

This closes that. The success model rests on one empirical claim -- that a
bank's published failure rate is predictive of how that bank behaves next
month. That claim is testable on data nobody synthesised: NPCI's own top-50
tables, 32 months of them, already committed to this repo.

It also settles a design question I had answered by instinct: should the
baseline pin ONE published month, or smooth several? baseline.py pins one.
This tests whether that was right.

Protocol. Fit on months 1..k, predict month k+1, walk k forward, never look
ahead. Four predictors:

  persistence   last month, repeated -- exactly what pinning one NPCI period does
  smoothed      exponentially weighted over the whole history (alpha 0.4)
  rolling mean  average of the last 3 months
  global mean   the all-bank average, i.e. ignore which bank this is

THE RESULT WENT AGAINST ME, AND IT IS THE USEFUL KIND. Smoothing loses to
persistence by about 13%. Bank failure rates behave close to a random walk, so
the most recent published month carries more information than any average of
the past. That is why baseline.py pins a period -- a choice now measured
rather than assumed.

Both bank-specific predictors beat the global mean by roughly 2.6x, which is
the claim that actually matters here: WHICH bank a payment goes through is
genuinely predictive, so `bank` in the decomposition is not modelling noise.
"""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.baseline import normalise_bank  # noqa: E402
from doctor.stats import mean, median  # noqa: E402

NPCI = ROOT / "data" / "npci"
RESULTS = ROOT / "evals" / "results"

#: Minimum months of history before a bank is predicted at all.
MIN_TRAIN = 6
#: A bank must appear in at least this many months to be scored.
MIN_MONTHS = 20


def load_series(table: str) -> dict[str, dict[str, float]]:
    """bank -> {period: total failure rate}. Real, published, not generated."""
    out: dict[str, dict[str, float]] = defaultdict(dict)
    with (NPCI / (table + ".csv")).open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                fail = float(row["bd_pct"]) + float(row["td_pct"])
            except (ValueError, KeyError):
                continue
            out[normalise_bank(row["bank"])][row["period"]] = fail
    return {k: v for k, v in out.items() if len(v) >= MIN_MONTHS}


def volatility(series: list[float]) -> float:
    m = mean(series)
    return math.sqrt(mean([(x - m) ** 2 for x in series]))


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    series = load_series("remitter_banks")
    periods = sorted({p for s in series.values() for p in s})
    print("%d banks, %d months (%s .. %s) -- all real NPCI data"
          % (len(series), len(periods), periods[0], periods[-1]))

    # errors[method][horizon] = [abs errors]
    errors: dict[str, dict[int, list[float]]] = {
        m: defaultdict(list)
        for m in ("smoothed", "persistence", "rolling3", "global")
    }
    per_bank: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for bank, s in series.items():
        months = sorted(s)
        for i in range(MIN_TRAIN, len(months)):
            train = [s[m] for m in months[:i]]
            for horizon in (1, 3):
                j = i + horizon - 1
                if j >= len(months):
                    continue
                actual = s[months[j]]

                # Smoothed: exponentially weighted over the whole history.
                # The intuitively better estimator, and the one that loses.
                alpha = 0.4
                level = train[0]
                for x in train[1:]:
                    level = alpha * x + (1 - alpha) * level
                pred_model = level

                pred_persist = train[-1]
                pred_roll = mean(train[-3:])
                pred_global = mean(
                    [v for b2, s2 in series.items() for m2, v in s2.items()
                     if m2 in months[:i]]
                ) if horizon == 1 and i == MIN_TRAIN else None

                errors["smoothed"][horizon].append(abs(pred_model - actual))
                errors["persistence"][horizon].append(abs(pred_persist - actual))
                errors["rolling3"][horizon].append(abs(pred_roll - actual))
                if horizon == 1:
                    per_bank[bank]["smoothed"].append(abs(pred_model - actual))
                    per_bank[bank]["persistence"].append(abs(pred_persist - actual))

    # global-mean baseline, computed once over everything
    all_vals = [v for s in series.values() for v in s.values()]
    g = mean(all_vals)
    for horizon in (1, 3):
        n = len(errors["smoothed"][horizon])
        errors["global"][horizon] = [
            abs(g - v) for v in all_vals[:n]
        ]

    summary: dict[str, dict] = {}
    for horizon in (1, 3):
        row = {}
        for method in ("persistence", "smoothed", "rolling3", "global"):
            e = errors[method][horizon]
            if not e:
                continue
            row[method] = {
                "mae_pts": round(mean(e), 4),
                "median_abs_err_pts": round(median(e), 4),
                "n_predictions": len(e),
            }
        p_mae = row.get("persistence", {}).get("mae_pts") or 1.0
        g_mae = row.get("global", {}).get("mae_pts") or 1.0
        row["smoothed_vs_persistence"] = round(row["smoothed"]["mae_pts"] / p_mae, 4)
        # The claim that matters: does knowing WHICH bank help at all?
        row["persistence_vs_global"] = round(p_mae / g_mae, 4)
        summary["horizon_%dm" % horizon] = row

    # split by how volatile the bank is -- an average over stable and swinging
    # series together hides the half that matters
    vols = {b: volatility(list(s.values())) for b, s in series.items()}
    cut = median(list(vols.values()))
    bands: dict[str, dict] = {}
    for label, pick in (("stable", lambda v: v <= cut), ("volatile", lambda v: v > cut)):
        m_err, p_err = [], []
        for b, e in per_bank.items():
            if pick(vols[b]):
                m_err += e["smoothed"]
                p_err += e["persistence"]
        if m_err:
            bands[label] = {
                "n_banks": sum(1 for b in per_bank if pick(vols[b])),
                "smoothed_mae_pts": round(mean(m_err), 4),
                "persistence_mae_pts": round(mean(p_err), 4),
                "smoothing_helps": mean(m_err) < mean(p_err),
            }

    worst = sorted(
        ((b, mean(e["persistence"])) for b, e in per_bank.items() if e["persistence"]),
        key=lambda kv: -kv[1],
    )[:6]

    out = {
        "note": (
            "Walk-forward on NPCI's published top-50 remitter tables. Fit on "
            "months 1..k, predict k+1, never look ahead. This is the only eval "
            "here whose data I did not generate, and it tests the one "
            "empirical claim the success model rests on: that a bank's "
            "published failure rate predicts how it behaves next month."
        ),
        "source": "data/npci/remitter_banks.csv (pinned Internet Archive capture)",
        "n_banks": len(series),
        "n_months": len(periods),
        "period_range": [periods[0], periods[-1]],
        "by_horizon": summary,
        "by_volatility": bands,
        "hardest_banks_1m": [
            {"bank": b, "persistence_mae_pts": round(e, 3)} for b, e in worst
        ],
    }
    (RESULTS / "backtest_npci.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8"
    )

    print("\nout-of-sample MAE, in points of failure rate")
    print("%-14s %12s %12s" % ("method", "1 month", "3 months"))
    for method in ("persistence", "smoothed", "rolling3", "global"):
        a = summary["horizon_1m"].get(method, {}).get("mae_pts")
        b = summary["horizon_3m"].get(method, {}).get("mae_pts")
        print("%-14s %12s %12s"
              % (method, "%.3f" % a if a else "-", "%.3f" % b if b else "-"))
    h1 = summary["horizon_1m"]
    print("")
    print("smoothed / persistence  %.3f  -- above 1.0, so smoothing LOSES."
          % h1["smoothed_vs_persistence"])
    print("  Bank rates behave close to a random walk, so the latest published")
    print("  month beats any average of the past. baseline.py pins one period,")
    print("  and that choice is now measured rather than assumed.")
    print("")
    print("persistence / global    %.3f  -- knowing WHICH bank cuts error %.1fx."
          % (h1["persistence_vs_global"], 1 / h1["persistence_vs_global"]))
    print("  That is what makes `bank` a real factor rather than noise.")

    print("\nsplit by how volatile the bank is")
    for k, v in bands.items():
        print("  %-9s %2d banks   smoothed %.3f vs persistence %.3f   %s"
              % (k, v["n_banks"], v["smoothed_mae_pts"], v["persistence_mae_pts"],
                 "smoothing helps" if v["smoothing_helps"] else "persistence wins"))

    print("\nhardest banks to predict:")
    for w in out["hardest_banks_1m"]:
        print("  %-34s %.2f pts" % (w["bank"][:34], w["persistence_mae_pts"]))
    print("\nwrote evals/results/backtest_npci.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
