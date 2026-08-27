"""Assemble the diagnosis payload the frontend renders.

RULE 2 is enforced HERE, in the data, not left to the UI to remember. The
payload has two top-level buckets:

    "measured"    computed against ground truth or verified cryptographically
    "projected"   modelled, resting on assumptions stated in priors.py and
                  chitragupta/rails/mock_rail.py

Nothing is allowed in `measured` unless it came from evals/results/ or from
the ledger's own verification. Every rupee figure is projected, without
exception, because every rupee figure passes through the mock rail's assumed
retry-success model. A component that renders a value from `projected` next to
one from `measured` without a label is a bug the structure makes visible.

The rupee figure is also given as a RANGE across the rail's three calibrations
rather than a point estimate, because a single number implies a precision the
model does not have.
"""

from __future__ import annotations

import json
from pathlib import Path

from chitragupta.rails.mock_rail import Calibration, p_retry_success
from chitragupta.types import AUTO_EXECUTABLE, PolicyDecision

from .features import RECOVERABLE
from .fault import attribute
from .stats import is_underpowered, wilson_interval, wilson_halfwidth_pts

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "evals" / "results"


def _load(name: str) -> dict:
    p = RESULTS / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def gap_value_paise(gap_pts: float, monthly_txn_count: int, avg_ticket_paise: int) -> int:
    """Points of success rate -> paise per month. Integer paise throughout."""
    monthly_gmv_paise = monthly_txn_count * avg_ticket_paise
    return int((gap_pts / 100.0) * monthly_gmv_paise)


def recoverable_range_paise(txns, dec) -> dict:
    """What the unretried recoverable failures might be worth.

    Returned as a range across the three rail calibrations. Every number here
    is PROJECTED -- it depends on an assumed retry-success model, and quoting
    one figure would imply a precision we do not have.
    """
    out = {}
    for cal in Calibration:
        total = 0
        for t in txns:
            if t.succeeded or t.error_class not in RECOVERABLE or t.retried:
                continue
            p = p_retry_success(t.error_class.value, 36.0, cal)
            total += int(t.amount_paise * p)
        out[cal.value] = total
    return {
        "low_paise": min(out.values()),
        "central_paise": out[Calibration.CENTRAL.value],
        "high_paise": max(out.values()),
        "by_calibration_paise": out,
    }


def build_report(s) -> dict:
    dec = s.decomposition
    txns = s.transactions
    profile = s.profile
    n = len(txns)
    succ = sum(1 for t in txns if t.succeeded)

    mae = _load("attribution_mae_by_factor.json")
    sweep_n = next((v.get("n") for v in mae.values() if isinstance(v, dict)), 0)
    naive = _load("naive_vs_shapley.json")
    power = _load("batch_size_power.json")
    corr = _load("correlation_degradation.json")
    cls_eval = _load("classification_f1.json")
    rc_eval = _load("root_cause_accuracy.json")

    chain = s.ledger.verify()
    violations = sum(
        1
        for e in s.ledger.entries
        if e.gate_decision is PolicyDecision.ALLOW
        and e.proposed_action.action_type not in AUTO_EXECUTABLE
        and e.outcome == "executed"
    )

    _, lo, hi = wilson_interval(succ, n)
    underpowered = is_underpowered(succ, n, dec.gap_pts)

    recovered_paise = sum(o.amount_recovered_paise for o in s.outcomes)
    recoverable = recoverable_range_paise(txns, dec)
    gap_paise = gap_value_paise(
        dec.gap_pts, profile.monthly_txn_count, profile.avg_ticket_paise
    )

    unrecoverable = [
        t for t in txns
        if not t.succeeded and t.error_class not in RECOVERABLE
    ]

    return {
        "merchant": profile.model_dump(mode="json"),
        "run": {
            "seed": s.seed,
            "npci_period": s.baseline.period,
            "calibration": s.calibration.value,
        },
        # ------------------------------------------------------------------
        # MEASURED -- against ground truth, or cryptographically verified.
        # ------------------------------------------------------------------
        "measured": {
            "observed_success_pct": round(100 * succ / n, 3) if n else 0.0,
            "observed_success_ci_pct": [round(lo * 100, 3), round(hi * 100, 3)],
            "wilson_halfwidth_pts": round(wilson_halfwidth_pts(succ, n), 3),
            "transactions": n,
            "failures": n - succ,
            "attribution_mae_by_factor": mae,
            "validation_merchants": sweep_n,
            "naive_vs_shapley": naive,
            "batch_size_power": power,
            "correlation_degradation": corr,
            "classification": cls_eval or None,
            "root_cause": rc_eval or None,
            "mandate_violations": violations,
            "ledger_entries": len(s.ledger),
            "chain_verified": chain.ok,
            "chain_detail": chain.detail,
            "efficiency_check": {
                "sum_of_attributions_pts": round(dec.explained_pts, 6),
                "v_of_grand_coalition_pts": round(
                    dec.coalition_values.get("bank+method+hour+amount_band", 0.0), 6
                ),
            },
        },
        # ------------------------------------------------------------------
        # PROJECTED -- modelled. Assumptions live in priors.py and mock_rail.py.
        # ------------------------------------------------------------------
        "projected": {
            "cohort_achievable_pct": round(dec.s_star * 100, 3),
            "gap_pts": round(dec.gap_pts, 3),
            "gap_value_paise": gap_paise,
            "monthly_gmv_paise": profile.monthly_gmv_paise,
            "recoverable": recoverable,
            "recovered_this_run_paise": recovered_paise,
            "unrecoverable_paise": sum(t.amount_paise for t in unrecoverable),
            "unrecoverable_count": len(unrecoverable),
            "assumptions": [
                "Bank failure rates are MEASURED from NPCI; method, hour and "
                "amount effects are assumed priors (priors.py).",
                "Retry success is an assumed model, not an observation "
                "(mock_rail.py). Figures are given as a range across three "
                "calibrations.",
                "s_star is an input from cohort data, not a discovery. See the "
                "sensitivity slider.",
            ],
        },
        # ------------------------------------------------------------------
        "decomposition": {
            "s_obs": dec.s_obs,
            "s_star": dec.s_star,
            "gap_pts": dec.gap_pts,
            "residual_pts": dec.residual_pts,
            "process_gap_pts": dec.process_gap_pts,
            "clamp_rate": dec.clamp_rate,
            "reliable": dec.reliable,
            "underpowered": underpowered,
            "degenerate_factors": dec.degenerate_factors,
            "effective_support": dec.effective_support,
            "coalition_values": dec.coalition_values,
            "factors": [
                {
                    "factor": a.factor,
                    "points": round(a.points, 4),
                    "mae": a.mae,
                    "inside_error_bar": a.is_inside_error_bar,
                    "identified": a.factor not in dec.degenerate_factors,
                    "value_paise": gap_value_paise(
                        a.points, profile.monthly_txn_count, profile.avg_ticket_paise
                    ),
                }
                for a in dec.attributions
            ],
        },
        "bank_health": s.bank_health,
        "diagnosis": s.diagnosis.model_dump(mode="json") if s.diagnosis else {},
        "plan": {
            "headline": s.plan.headline if s.plan else "",
            "withheld": [w.model_dump(mode="json") for w in s.plan.withheld] if s.plan else [],
            "actions": len(s.plan.actions) if s.plan else 0,
        },
        "gate": {
            "decisions": _gate_counts(s.gate_results),
            "reason_codes": sorted({g.reason_code for g in s.gate_results}),
        },
        "ledger": [e.model_dump(mode="json") for e in s.ledger.entries],
        "exceptions": {
            # The row list is capped so the payload stays small, but the
            # breakdown must describe every unrecoverable payment -- a bar
            # chart drawn from the first 50 of 113 would be a lie with a
            # legend on it.
            "unrecoverable_by_class": _by_class(unrecoverable),
            # Whose move is it. Computed over EVERY unrecoverable payment, not
            # the capped row sample -- the merchant's own share is the whole
            # point and truncating it would hide most of it.
            "unrecoverable_by_fault": [
                g.model_dump(mode="json") for g in attribute(unrecoverable)
            ],
            "unrecoverable_sample_size": min(50, len(unrecoverable)),
            "unrecoverable_transactions": [
                {
                    "txn_id": t.txn_id,
                    "amount_paise": t.amount_paise,
                    "error_code": t.error_code,
                    "error_class": t.error_class.value if t.error_class else None,
                    "why": _why_unrecoverable(t),
                }
                for t in unrecoverable[:50]
            ],
            "method_failures": _method_failures(dec, underpowered, n),
        },
        "classifications": {
            code: c.model_dump(mode="json") for code, c in s.classifications.items()
        },
        "needs_review": [c.model_dump(mode="json") for c in s.needs_review],
    }


def _gate_counts(gate_results) -> dict:
    out = {"allow": 0, "step_up": 0, "deny": 0}
    for g in gate_results:
        out[g.decision.value] += 1
    return out


def _by_class(txns) -> list[dict]:
    """Count and value every unrecoverable payment, grouped by error class.

    Computed over the whole list rather than the capped sample, so the totals
    on the exceptions page reconcile with the headline figure above them.
    """
    agg: dict[str, dict] = {}
    for t in txns:
        key = t.error_class.value if t.error_class else "unknown"
        row = agg.setdefault(key, {"error_class": key, "count": 0, "total_paise": 0})
        row["count"] += 1
        row["total_paise"] += t.amount_paise
    return sorted(agg.values(), key=lambda r: -r["total_paise"])


def _why_unrecoverable(t) -> str:
    if t.error_class is None:
        return "unclassified failure"
    if t.error_class.value == "hard_decline":
        return "hard decline -- the instrument or configuration is permanently unusable"
    if t.error_class.value == "auth_failure":
        return "authentication failed -- only the customer can complete it"
    return "not recoverable by an automated retry"


def _method_failures(dec, underpowered: bool, n: int) -> list[dict]:
    """Where the METHOD itself is unreliable. Almost nobody ships this list."""
    out = []
    for f in dec.degenerate_factors:
        out.append(
            {
                "kind": "factor_not_identified",
                "factor": f,
                "detail": (
                    "effective support %.2f distinct values -- there is nothing "
                    "to reweight toward, so this attribution is unmeasurable "
                    "rather than small"
                    % dec.effective_support.get(f, 0.0)
                ),
            }
        )
    if not dec.reliable:
        out.append(
            {
                "kind": "weights_clamped",
                "factor": "all",
                "detail": (
                    "importance weights clamped on %.0f%% of transactions; this "
                    "merchant's profile is far from the cohort" % (dec.clamp_rate * 100)
                ),
            }
        )
    if underpowered:
        out.append(
            {
                "kind": "underpowered_batch",
                "factor": "all",
                "detail": (
                    "at n=%d the 95%% interval on the observed success rate is "
                    "wider than half the gap being decomposed" % n
                ),
            }
        )
    return out


def offline_stub(schema_name: str, prompt: str) -> dict:
    """Placeholder diagnosis when there is no key and no cache entry.

    Marked `stub` in the trace and never scored by any eval. It exists so the
    pipeline and the frontend are runnable during development, not so a demo
    can pretend to have called a model.
    """
    import re

    rows = re.findall(r"^\s{2}(bank|method|hour|amount_band)\s+([+-][\d.]+) pts", prompt, re.M)
    vals = {k: float(v) for k, v in rows}
    label_for = {
        "hour": "midnight_billing_penalty",
        "bank": "bank_concentration",
        "amount_band": "amount_band_risk",
        "method": "method_mix_mismatch",
    }
    if not vals or max(vals.values()) <= 0:
        return {
            "hypotheses": [],
            "primary_label": "none_of_the_above",
            "summary": "STUB -- no model was called (no API key and no cache entry).",
        }
    top = max(vals, key=lambda k: vals[k])
    return {
        "hypotheses": [
            {
                "factor": top,
                "attribution_pts": vals[top],
                "root_cause_label": label_for[top],
                "hypothesis": "STUB -- no model was called.",
                "evidence": ["%s carries %+.2f pts" % (top, vals[top])],
                "recommended_action": "STUB",
                "action_type": "investigation",
            }
        ],
        "primary_label": label_for[top],
        "summary": "STUB -- no model was called (no API key and no cache entry).",
    }
