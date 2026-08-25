"""What 32 months of real NPCI data say, that nobody has published.

Run:  python evals/run_npci_finding.py

Every other number in this project comes from data I generated. This one comes
from reality: NPCI's published top-50 remitter and beneficiary tables,
2023-01 to 2025-08, 1,600 bank-months per side.

Four questions, all answerable from the committed CSVs:

  1. Are technical declines CORRELATED ACROSS BANKS within a month? If banks
     fail together, the cause is shared infrastructure rather than any one
     bank's estate -- and a merchant's "SBI problem" may be an everyone
     problem. This is the join that makes the ecosystem argument concrete.

  2. Which banks are getting BETTER or WORSE over three years, and by how
     much? Merchants pick payment partners on today's number.

  3. Is a bank's failure mix (technical vs business) STABLE, or does it swing?
     A bank whose TD share jumps is having an incident; one with steady BD is
     just serving customers with less money.

  4. Does the ecosystem as a whole show seasonality?

Writes evals/results/npci_finding.json and docs/npci_finding.md.
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
DOCS = ROOT / "docs"


def load(table: str) -> list[dict]:
    rows = []
    with (NPCI / (table + ".csv")).open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                rows.append(
                    {
                        "period": r["period"],
                        "bank": r["bank"],
                        "key": normalise_bank(r["bank"]),
                        "volume": float(r["total_volume_mn"] or 0),
                        "approved": float(r["approved_pct"]),
                        "bd": float(r["bd_pct"]),
                        "td": float(r["td_pct"]),
                    }
                )
            except (ValueError, KeyError):
                continue
    return rows


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = mean(xs), mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return num / (dx * dy) if dx > 0 and dy > 0 else 0.0


def q1_cross_bank_correlation(rows: list[dict]) -> dict:
    """Do banks' technical declines move together month to month?

    For each pair of banks present in >= 18 common months, correlate their
    monthly TD%. A high median pairwise correlation means the technical
    declines are a SHARED phenomenon -- NPCI-side or a common dependency --
    rather than each bank's own estate failing independently.
    """
    by_bank: dict[str, dict[str, float]] = defaultdict(dict)
    names: dict[str, str] = {}
    for r in rows:
        by_bank[r["key"]][r["period"]] = r["td"]
        names.setdefault(r["key"], r["bank"])

    # Only banks with a long, dense history.
    banks = [b for b, s in by_bank.items() if len(s) >= 24]
    pairs = []
    for i, a in enumerate(banks):
        for b in banks[i + 1 :]:
            common = sorted(set(by_bank[a]) & set(by_bank[b]))
            if len(common) < 18:
                continue
            r = pearson([by_bank[a][p] for p in common],
                        [by_bank[b][p] for p in common])
            pairs.append({"a": names[a], "b": names[b], "n_months": len(common), "r": r})

    rs = [p["r"] for p in pairs]
    pairs.sort(key=lambda p: -p["r"])
    return {
        "banks_compared": len(banks),
        "pairs": len(pairs),
        "median_pairwise_r": round(median(rs), 4),
        "mean_pairwise_r": round(mean(rs), 4),
        "share_positive": round(sum(1 for r in rs if r > 0) / len(rs), 4) if rs else 0.0,
        "share_above_0p5": round(sum(1 for r in rs if r > 0.5) / len(rs), 4) if rs else 0.0,
        "most_correlated": pairs[:8],
    }


def q2_trends(rows: list[dict]) -> dict:
    """Three-year movement in total failure rate, first 6 months vs last 6."""
    by_bank: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    names: dict[str, str] = {}
    for r in rows:
        by_bank[r["key"]].append((r["period"], r["bd"] + r["td"], r["volume"]))
        names.setdefault(r["key"], r["bank"])

    out = []
    for key, series in by_bank.items():
        series.sort()
        if len(series) < 24:
            continue
        early = [f for _, f, _ in series[:6]]
        late = [f for _, f, _ in series[-6:]]
        out.append(
            {
                "bank": names[key],
                "months": len(series),
                "early_fail_pct": round(mean(early), 3),
                "late_fail_pct": round(mean(late), 3),
                "change_pts": round(mean(late) - mean(early), 3),
                "mean_volume_mn": round(mean([v for _, _, v in series]), 1),
            }
        )
    out.sort(key=lambda d: d["change_pts"])
    return {
        "n_banks": len(out),
        "improved_most": out[:6],
        "worsened_most": out[-6:][::-1],
        "median_change_pts": round(median([d["change_pts"] for d in out]), 3),
        "share_improved": round(
            sum(1 for d in out if d["change_pts"] < 0) / len(out), 4
        ) if out else 0.0,
    }


def q3_failure_mix_stability(rows: list[dict]) -> dict:
    """Is the technical share of a bank's failures stable, or does it swing?"""
    by_bank: dict[str, list[float]] = defaultdict(list)
    names: dict[str, str] = {}
    for r in rows:
        total = r["bd"] + r["td"]
        if total > 0:
            by_bank[r["key"]].append(r["td"] / total)
            names.setdefault(r["key"], r["bank"])
    out = []
    for key, shares in by_bank.items():
        if len(shares) < 24:
            continue
        m = mean(shares)
        sd = math.sqrt(mean([(s - m) ** 2 for s in shares]))
        out.append(
            {
                "bank": names[key],
                "mean_technical_share": round(m, 4),
                "sd": round(sd, 4),
                "min": round(min(shares), 4),
                "max": round(max(shares), 4),
                "swing": round(max(shares) - min(shares), 4),
            }
        )
    out.sort(key=lambda d: -d["swing"])
    return {
        "n_banks": len(out),
        "median_technical_share": round(median([d["mean_technical_share"] for d in out]), 4),
        "most_volatile": out[:6],
        "most_stable": out[-6:][::-1],
    }


def q4_seasonality(rows: list[dict]) -> dict:
    """Volume-weighted ecosystem failure rate per month."""
    by_period: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in rows:
        by_period[r["period"]].append((r["bd"] + r["td"], r["volume"]))
    series = []
    for period in sorted(by_period):
        pairs = by_period[period]
        tv = sum(v for _, v in pairs)
        wavg = sum(f * v for f, v in pairs) / tv if tv else 0.0
        series.append(
            {"period": period, "weighted_fail_pct": round(wavg, 4),
             "total_volume_mn": round(tv, 1), "banks": len(pairs)}
        )
    by_month: dict[str, list[float]] = defaultdict(list)
    for s in series:
        by_month[s["period"][5:7]].append(s["weighted_fail_pct"])
    monthly = {m: round(mean(v), 4) for m, v in sorted(by_month.items())}
    return {
        "series": series,
        "by_calendar_month": monthly,
        "worst_month": max(monthly, key=lambda k: monthly[k]) if monthly else None,
        "best_month": min(monthly, key=lambda k: monthly[k]) if monthly else None,
    }


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    rem = load("remitter_banks")
    ben = load("beneficiary_banks")
    periods = sorted({r["period"] for r in rem})
    print("NPCI remitter rows %d, beneficiary rows %d, %d months (%s..%s)"
          % (len(rem), len(ben), len(periods), periods[0], periods[-1]))

    out = {
        "source": "NPCI UPI ecosystem statistics, pinned Internet Archive capture",
        "periods": periods,
        "remitter_rows": len(rem),
        "beneficiary_rows": len(ben),
        "q1_cross_bank_td_correlation": q1_cross_bank_correlation(rem),
        "q2_three_year_trends": q2_trends(rem),
        "q3_failure_mix_stability": q3_failure_mix_stability(rem),
        "q4_seasonality": q4_seasonality(rem),
    }
    (RESULTS / "npci_finding.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    q1, q2, q3, q4 = (out["q1_cross_bank_td_correlation"], out["q2_three_year_trends"],
                      out["q3_failure_mix_stability"], out["q4_seasonality"])
    print("\nQ1 cross-bank TD correlation")
    print("  %d banks, %d pairs, median r = %.3f, %.0f%% positive, %.0f%% above 0.5"
          % (q1["banks_compared"], q1["pairs"], q1["median_pairwise_r"],
             100 * q1["share_positive"], 100 * q1["share_above_0p5"]))
    for p in q1["most_correlated"][:4]:
        print("    r=%.3f  %s <-> %s" % (p["r"], p["a"][:28], p["b"][:28]))

    print("\nQ2 three-year trend in total failure rate")
    print("  %d banks, median change %+.2f pts, %.0f%% improved"
          % (q2["n_banks"], q2["median_change_pts"], 100 * q2["share_improved"]))
    print("  improved most:")
    for d in q2["improved_most"][:3]:
        print("    %-30s %5.2f -> %5.2f  (%+.2f)"
              % (d["bank"][:30], d["early_fail_pct"], d["late_fail_pct"], d["change_pts"]))
    print("  worsened most:")
    for d in q2["worsened_most"][:3]:
        print("    %-30s %5.2f -> %5.2f  (%+.2f)"
              % (d["bank"][:30], d["early_fail_pct"], d["late_fail_pct"], d["change_pts"]))

    print("\nQ3 failure-mix stability (technical share of failures)")
    print("  median technical share %.3f" % q3["median_technical_share"])
    for d in q3["most_volatile"][:3]:
        print("    %-30s mean %.2f swing %.2f" % (d["bank"][:30], d["mean_technical_share"], d["swing"]))

    print("\nQ4 seasonality (volume-weighted ecosystem failure rate)")
    print("  worst calendar month %s, best %s" % (q4["worst_month"], q4["best_month"]))
    for m, v in q4["by_calendar_month"].items():
        print("    %s  %.3f%%" % (m, v))

    print("\nwrote evals/results/npci_finding.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
