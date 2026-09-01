"""The book-level view: every merchant at once, ranked by money on the table.

This is the view Razorpay would actually deploy, and it is a different product
from the per-merchant page.

A merchant already has a dashboard. What a payments platform does not have is
an answer to "across our entire book, where is revenue leaking, who should we
call on Monday, and how much is each call worth?" That question is portfolio
shaped, not merchant shaped, and answering it is what turns a diagnostic tool
into revenue operations.

Everything here is derived from runs that already happened, so the page is
cheap and, because those runs are cached and deterministic, identical on every
load. Merchants are triaged into bands so the output is a work queue rather
than a leaderboard -- a ranked list nobody acts on is just a chart.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from chitragupta.rails.mock_rail import Calibration, p_retry_success

from .sequence import first_slot_hours

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data" / "runs"

#: Triage bands. A merchant whose diagnosis is not statistically resolvable is
#: NOT put in a priority band -- telling an account manager to call someone on
#: the strength of noise is worse than saying nothing.
BAND_URGENT = "urgent"
BAND_REVIEW = "review"
BAND_HEALTHY = "healthy"
BAND_INSUFFICIENT = "insufficient_data"


class MerchantRow(BaseModel):
    merchant_id: str
    name: str
    mcc: str
    run_id: str
    transactions: int
    failures: int
    observed_pct: float
    achievable_pct: float
    gap_pts: float
    #: Monthly value of the gap. PROJECTED, like every rupee figure here.
    gap_value_paise: int
    recoverable_low_paise: int
    recoverable_central_paise: int
    recoverable_high_paise: int
    unrecoverable_paise: int
    primary_cause: str
    primary_factor: str
    band: str
    band_reason: str
    fixes_available: int
    fixes_auto: int
    fixes_applied: int
    #: What the rail forecast for the retries this run actually executed.
    recovered_paise: int
    #: What those same retries were truly worth, marked after the fact against
    #: the generating distribution. This is the only figure on the row that is
    #: an outcome rather than a forecast.
    measured_paise: int
    attempted: int
    converted: int
    projected_for_attempted_paise: int
    scored: bool
    underpowered: bool
    unreliable_factors: list[str]


class Portfolio(BaseModel):
    merchants: list[MerchantRow]
    total_gap_value_paise: int
    total_recoverable_central_paise: int
    total_recoverable_low_paise: int
    total_recoverable_high_paise: int
    total_recovered_paise: int
    #: The number the track actually asks for: measured money recovered across
    #: the batch. Kept separate from the projection everywhere, because the
    #: whole point is that they differ and by how much.
    total_measured_paise: int
    total_attempted: int
    total_converted: int
    #: The rail's forecast for the retries that were ACTUALLY attempted, which
    #: is the only forecast the measured figure can fairly be read against.
    #: Not recovered_this_run_paise -- that accumulates across applies and
    #: comparing it to the mark produced a made-up optimism ratio.
    total_projected_for_attempted_paise: int
    merchants_scored: int
    #: What the kernel would not let the agent touch, so the funnel from
    #: "identified" to "won" does not have an unexplained gap in the middle.
    total_held_paise: int
    total_denied_paise: int
    #: The funnel is keyed on what HAPPENED to each action, not on how the
    #: kernel ruled on it. Confirming a step-up appends another step_up row --
    #: the mandate still required approval and the ledger says so honestly --
    #: so a funnel reading gate decisions showed 661 actions still waiting
    #: after a merchant had approved every one of them.
    acted_on: int
    awaiting: int
    refused: int
    escalated: int
    #: What the rail forecasts for the retries sitting in merchants' queues.
    #:
    #: A FORECAST, and it has to be. The measured figure comes from marking
    #: retries that actually ran; quoting a marked number for work nobody has
    #: authorised yet would mean reading the answer key to write the pitch.
    #: So this is the rail's own projection, carrying the rail's known
    #: optimism, and it becomes falsifiable the moment a merchant approves.
    pending_retry_actions: int
    pending_projected_low_paise: int
    pending_projected_central_paise: int
    pending_projected_high_paise: int
    total_transactions: int
    total_failures: int
    #: Face value of every failed payment across the book. The floor of the
    #: money story, and the denominator the funnel is read against.
    #:
    #: Taken from reconcile.py rather than computed a second time here. Two
    #: implementations of "what is at risk" is exactly how a dashboard ends up
    #: disagreeing with its own drilldown.
    total_at_risk_paise: int = 0
    #: band -> count
    bands: dict[str, int]
    #: cause -> {merchants, value_paise}, so the platform can see which problem
    #: is worth building a product against rather than fixing one at a time.
    by_cause: dict[str, dict[str, Any]]
    weighted_observed_pct: float
    weighted_achievable_pct: float


def _latest_run_per_merchant() -> dict[str, dict]:
    """Newest saved run for each merchant. Stub runs are ignored."""
    best: dict[str, tuple[float, dict]] = {}
    for p in RUNS.glob("run_*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if rec.get("used_stubs"):
            continue
        mid = rec.get("merchant_id")
        if not mid:
            continue
        mtime = p.stat().st_mtime
        if mid not in best or mtime > best[mid][0]:
            best[mid] = (mtime, rec)
    return {k: v[1] for k, v in best.items()}


def _triage(gap_pts: float, recoverable_paise: int, dec: dict) -> tuple[str, str]:
    """Which queue this merchant belongs in, and why in one line."""
    # Gap first, THEN power. is_underpowered compares the interval against the
    # gap, so a merchant with almost no gap trips it by construction -- and
    # filing a healthy merchant as "insufficient data" would send an account
    # manager chasing someone who is fine.
    if gap_pts < 0.75:
        return BAND_HEALTHY, "at or near what this category achieves"
    if dec.get("underpowered"):
        return (
            BAND_INSUFFICIENT,
            "too few payments this month to resolve a gap this size — no call yet",
        )
    if recoverable_paise >= 50_000_00 or gap_pts >= 3.0:
        return BAND_URGENT, "material money on the table and a cause we can name"
    return BAND_REVIEW, "a real gap, but smaller than the urgent band"


def _pending_forecast(report: dict, final: dict) -> tuple[int, dict[str, float]]:
    """What the rail expects from the retries still waiting on a person.

    Only retries. A payment-link reissue held for approval recovers money
    through a human paying a link, which this rail does not model and must not
    be credited with.
    """
    error_class = {
        t["txn_id"]: t.get("error_class")
        for t in report.get("exceptions", {}).get("unrecoverable_transactions", [])
    }
    out = {c.value: 0.0 for c in Calibration}
    n = 0
    for e in final.values():
        if e.get("outcome") != "merchant_action":
            continue
        a = e.get("proposed_action") or {}
        if not a.get("action_type", "").startswith("retry"):
            continue
        n += 1
        ecls = error_class.get(e.get("txn_id")) or "soft_decline"
        for c in Calibration:
            out[c.value] += (
                p_retry_success(ecls, first_slot_hours(ecls), c) * a["amount_paise"]
            )
    return n, out


def build_portfolio() -> Portfolio:
    rows: list[MerchantRow] = []
    acted_on = awaiting = refused = escalated = 0
    held_paise = denied_paise = 0
    pending_n = 0
    # Not `pending` -- that name is already a local for this merchant's fix
    # groups further down, and shadowing it silently rebinds a list.
    pending_value: dict[str, float] = {c.value: 0.0 for c in Calibration}
    for rec in _latest_run_per_merchant().values():
        r = rec["report"]
        m, p, d = r["measured"], r["projected"], r["decomposition"]
        sc = m.get("recovery_vs_truth", {}) or {}

        # What became of every action, so the batch can say what it was not
        # permitted to attempt rather than quietly reporting only what it was.
        #
        # Counted per ACTION, not per ledger row. The ledger is append-only, so
        # an action held and later confirmed leaves two rows behind, and
        # counting rows doubled every figure in the funnel the moment a
        # merchant approved their queue. The last word on an action stands.
        final: dict[tuple, dict] = {}
        for e in r.get("ledger", []):
            a = e.get("proposed_action") or {}
            final[(e.get("txn_id"), a.get("action_type"))] = e

        n, fc = _pending_forecast(r, final)
        pending_n += n
        for k, v in fc.items():
            pending_value[k] += v

        for e in final.values():
            o = e.get("outcome")
            amt = (e.get("proposed_action") or {}).get("amount_paise", 0)
            if o in ("executed", "exception"):
                acted_on += 1
            elif o == "merchant_action":
                awaiting += 1
                held_paise += amt
            elif o == "denied":
                refused += 1
                denied_paise += amt
            elif o == "escalated":
                escalated += 1

        # The strongest identified factor. A factor the overlap check rejected
        # is never allowed to be the headline cause.
        identified = [f for f in d["factors"] if f["identified"]]
        top = max(identified, key=lambda f: f["points"], default=None)
        if d["process_gap_pts"] > (top["points"] if top else 0):
            primary_factor, primary_cause = "process_gap", "no_soft_decline_retry"
        elif top and top["points"] > 0:
            primary_factor = top["factor"]
            primary_cause = {
                "bank": "bank_concentration",
                "hour": "midnight_billing_penalty",
                "amount_band": "amount_band_risk",
                "method": "method_mix_mismatch",
            }.get(top["factor"], "none_of_the_above")
        else:
            primary_factor, primary_cause = "none", "none_of_the_above"

        rec_central = p["recoverable"]["central_paise"]
        band, reason = _triage(p["gap_pts"], rec_central, d)
        pending = rec.get("pending_actions") or []

        rows.append(
            MerchantRow(
                merchant_id=rec["merchant_id"],
                name=rec["merchant_name"],
                mcc=rec["mcc"],
                run_id=rec["run_id"],
                transactions=m["transactions"],
                failures=m["failures"],
                observed_pct=m["observed_success_pct"],
                achievable_pct=p["cohort_achievable_pct"],
                gap_pts=p["gap_pts"],
                gap_value_paise=max(p["gap_value_paise"], 0),
                recoverable_low_paise=p["recoverable"]["low_paise"],
                recoverable_central_paise=rec_central,
                recoverable_high_paise=p["recoverable"]["high_paise"],
                unrecoverable_paise=p["unrecoverable_paise"],
                primary_cause=primary_cause,
                primary_factor=primary_factor,
                band=band,
                band_reason=reason,
                fixes_available=len(pending),
                fixes_auto=sum(1 for g in pending if g.get("auto")),
                fixes_applied=len(rec.get("applied") or []),
                recovered_paise=p.get("recovered_this_run_paise", 0),
                measured_paise=sc.get("measured_paise", 0),
                attempted=sc.get("attempted", 0),
                converted=sc.get("truly_converted", 0),
                projected_for_attempted_paise=sc.get("projected_paise", 0),
                scored=bool(sc.get("scored")),
                underpowered=bool(d.get("underpowered")),
                unreliable_factors=d.get("degenerate_factors") or [],
            )
        )

    # Biggest money first, but healthy and insufficient always sink -- the list
    # is a work queue, so what you should do first belongs at the top.
    order = {BAND_URGENT: 0, BAND_REVIEW: 1, BAND_INSUFFICIENT: 2, BAND_HEALTHY: 3}
    rows.sort(key=lambda r: (order[r.band], -r.recoverable_central_paise))

    bands: dict[str, int] = {}
    for r in rows:
        bands[r.band] = bands.get(r.band, 0) + 1

    by_cause: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r.band in (BAND_HEALTHY, BAND_INSUFFICIENT):
            continue
        e = by_cause.setdefault(
            r.primary_cause, {"merchants": 0, "value_paise": 0, "names": []}
        )
        e["merchants"] += 1
        e["value_paise"] += r.recoverable_central_paise
        e["names"].append(r.name)

    total_txn = sum(r.transactions for r in rows) or 1
    w_obs = sum(r.observed_pct * r.transactions for r in rows) / total_txn
    w_ach = sum(r.achievable_pct * r.transactions for r in rows) / total_txn

    from .reconcile import _batch as _failed_payments

    at_risk = sum(
        sum(_failed_payments(r.merchant_id).values()) for r in rows
    )

    return Portfolio(
        merchants=rows,
        total_gap_value_paise=sum(r.gap_value_paise for r in rows),
        total_recoverable_central_paise=sum(r.recoverable_central_paise for r in rows),
        total_recoverable_low_paise=sum(r.recoverable_low_paise for r in rows),
        total_recoverable_high_paise=sum(r.recoverable_high_paise for r in rows),
        total_recovered_paise=sum(r.recovered_paise for r in rows),
        total_measured_paise=sum(r.measured_paise for r in rows),
        total_attempted=sum(r.attempted for r in rows),
        total_converted=sum(r.converted for r in rows),
        total_projected_for_attempted_paise=sum(
            r.projected_for_attempted_paise for r in rows
        ),
        merchants_scored=sum(1 for r in rows if r.scored),
        total_held_paise=held_paise,
        total_denied_paise=denied_paise,
        acted_on=acted_on,
        awaiting=awaiting,
        refused=refused,
        escalated=escalated,
        pending_retry_actions=pending_n,
        pending_projected_low_paise=int(pending_value[Calibration.CONSERVATIVE.value]),
        pending_projected_central_paise=int(pending_value[Calibration.CENTRAL.value]),
        pending_projected_high_paise=int(pending_value[Calibration.OPTIMISTIC.value]),
        total_transactions=sum(r.transactions for r in rows),
        total_failures=sum(r.failures for r in rows),
        total_at_risk_paise=at_risk,
        bands=bands,
        by_cause=dict(
            sorted(by_cause.items(), key=lambda kv: -kv[1]["value_paise"])
        ),
        weighted_observed_pct=round(w_obs, 3),
        weighted_achievable_pct=round(w_ach, 3),
    )


# --------------------------------------------------------------------------
# exports -- the boring plumbing that makes it usable outside the browser
# --------------------------------------------------------------------------


def portfolio_csv(pf: Portfolio) -> str:
    """The work queue as CSV. Opens straight into Sheets or Excel.

    Rupees, not paise, because this file is read by people rather than code.
    """
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "band", "merchant", "mcc", "payments", "failures",
            "observed_pct", "achievable_pct", "gap_pts",
            "gap_value_inr_month", "recoverable_low_inr", "recoverable_inr",
            "recoverable_high_inr", "primary_cause", "fixes_available",
            "fixes_auto", "diagnosis_reliable", "run_id",
        ]
    )
    for r in pf.merchants:
        w.writerow(
            [
                r.band, r.name, r.mcc, r.transactions, r.failures,
                r.observed_pct, r.achievable_pct, round(r.gap_pts, 2),
                r.gap_value_paise // 100, r.recoverable_low_paise // 100,
                r.recoverable_central_paise // 100, r.recoverable_high_paise // 100,
                r.primary_cause, r.fixes_available, r.fixes_auto,
                "no" if (r.underpowered or r.unreliable_factors) else "yes",
                r.run_id,
            ]
        )
    return buf.getvalue()


def ledger_csv(rec: dict) -> str:
    """One run's audit trail as CSV, for compliance review outside the app."""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["sequence", "timestamp", "txn_id", "action", "amount_inr",
         "decision", "reason_code", "outcome", "prev_hash", "entry_hash"]
    )
    for e in rec["report"].get("ledger", []):
        w.writerow(
            [
                e["sequence"], e["timestamp"], e["txn_id"],
                e["proposed_action"]["action_type"],
                e["proposed_action"]["amount_paise"] // 100,
                e["gate_decision"], e["gate_reason"], e["outcome"],
                e["prev_hash"], e["entry_hash"],
            ]
        )
    return buf.getvalue()
