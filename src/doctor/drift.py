"""Bank drift: catching the ecosystem moving before a merchant complains.

Everything else in this project is reactive -- a merchant has a gap, we explain
it. This is the other half. NPCI publishes bank-level performance monthly, and
docs/npci_finding.md shows those numbers move a lot: the median top-50 bank got
0.62 points worse over three years, and several roughly doubled. A merchant
concentrated on a degrading issuer is losing money for reasons that have
nothing to do with anything they changed.

Razorpay sees its own transactions in real time. What nobody does is
systematically join that against NPCI's published series to say "this issuer
is deteriorating, here is who is exposed, here is what it costs them." That
join is the whole module.

Two deliberate choices:

  * Drift is measured as recent window vs prior window, NOT last month vs the
    month before. Single-month comparisons on a noisy series generate an alert
    every month and get ignored, which is worse than no alert at all.
  * Exposure is computed from each merchant's ACTUAL bank mix, so the output
    is a rupee figure per merchant rather than a chart of percentages. An
    alert nobody can act on is a newsletter.
"""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel

from chitragupta.policy import GateContext, evaluate
from chitragupta.types import ActionType, ProposedAction

from .baseline import NPCI_DIR, normalise_bank
from .run import load_mandate
from .stats import mean

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data" / "runs"

#: Months averaged on each side of the comparison. Three is enough to damp
#: the month-to-month noise without smearing a real step change.
WINDOW = 3
#: Below this the move is not worth anyone's attention.
MIN_DELTA_PTS = 0.35
#: A bank must appear in this many months to be judged at all.
MIN_MONTHS = 12
def national_avg_ticket_paise(period: str | None = None) -> int:
    """Average merchant-facing UPI ticket, DERIVED from NPCI, not assumed.

    NPCI's merchant-category table publishes volume and value side by side, so
    this is a division rather than a guess: about Rs 402 for 2025-08 across
    10.3 billion transactions.

    Worth stating because the first version of this hardcoded Rs 1,650, which
    was four times too high and inflated every national figure by the same
    factor. It is still an average over a very skewed distribution, so
    anything built on it is PROJECTED.
    """
    vol = val = 0.0
    with (NPCI_DIR / "mcc_volumes.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    period = period or max(r["period"] for r in rows)
    for r in rows:
        if r["period"] != period:
            continue
        try:
            vol += float(r["volume_mn"] or 0)
            val += float(r["value_cr"] or 0)
        except ValueError:
            continue
    if vol <= 0:
        return 400_00
    # value is in crore, volume in millions -> paise per transaction
    return int((val * 1e7) / (vol * 1e6) * 100)


class BankDrift(BaseModel):
    bank: str
    key: str
    prior_pct: float
    recent_pct: float
    delta_pts: float
    #: Positive means deteriorating.
    direction: str
    prior_window: list[str]
    recent_window: list[str]
    volume_mn: float
    #: Share of the move that is technical rather than business declines.
    #: A jump in technical share means an incident, not poorer customers.
    technical_share_delta: float
    severity: str
    #: Monthly rupees the drift costs ACROSS INDIA, not just one book. Volume
    #: is NPCI's published figure; ticket size is a stated assumption, so this
    #: is projected and labelled as such wherever it is shown.
    national_impact_paise: int = 0


class Exposure(BaseModel):
    merchant_id: str
    merchant_name: str
    run_id: str
    bank: str
    share_pct: float
    delta_pts: float
    #: Monthly rupees this drift is costing, at the merchant's own volume.
    exposure_paise: int

    # --- the intervention, and whether the merchant authorised it ---------
    #
    # Detecting a bank going bad and printing it is a dashboard. What makes
    # this the proactive half of an AGENT is that the finding becomes a typed
    # action, gated against the same signed mandate everything else goes
    # through. The gate runs here, at detection time, so the page can say
    # "and your mandate permits this" rather than leaving it to be discovered
    # on click.
    proposed_action: dict | None = None
    gate_decision: str | None = None
    gate_reason: str | None = None
    #: Why this action, in the merchant's language.
    rationale: str | None = None
    #: False when the drift is real but too small to be worth an intervention.
    actionable: bool = False


class DriftReport(BaseModel):
    period_range: list[str]
    prior_window: list[str]
    recent_window: list[str]
    banks_examined: int
    deteriorating: list[BankDrift]
    improving: list[BankDrift]
    exposures: list[Exposure]
    total_exposure_paise: int
    merchants_affected: int
    #: Exposures that cleared both thresholds and were put to the mandate.
    interventions_proposed: int = 0
    #: How the policy kernel ruled on them.
    intervention_decisions: dict[str, int] = {}
    #: Sum of national impact across every deteriorating bank.
    total_national_impact_paise: int = 0


def _load_rows(table: str = "remitter_banks") -> dict[str, dict[str, dict]]:
    """key -> period -> {bd, td, volume, display}."""
    out: dict[str, dict[str, dict]] = defaultdict(dict)
    with (NPCI_DIR / (table + ".csv")).open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                bd, td = float(row["bd_pct"]), float(row["td_pct"])
                vol = float(row["total_volume_mn"] or 0)
            except (ValueError, KeyError):
                continue
            out[normalise_bank(row["bank"])][row["period"]] = {
                "bd": bd, "td": td, "vol": vol, "display": row["bank"],
            }
    return out


def _severity(delta: float) -> str:
    if delta >= 2.0:
        return "critical"
    if delta >= 1.0:
        return "high"
    return "moderate"


def detect_drift(table: str = "remitter_banks") -> tuple[list[BankDrift], list[BankDrift], list[str], list[str], int]:
    data = _load_rows(table)
    avg_ticket = national_avg_ticket_paise()
    all_periods = sorted({p for v in data.values() for p in v})
    recent_w = all_periods[-WINDOW:]
    prior_w = all_periods[-(WINDOW * 2) : -WINDOW]

    worse: list[BankDrift] = []
    better: list[BankDrift] = []
    examined = 0

    for key, series in data.items():
        if len(series) < MIN_MONTHS:
            continue
        recent = [series[p] for p in recent_w if p in series]
        prior = [series[p] for p in prior_w if p in series]
        if len(recent) < 2 or len(prior) < 2:
            continue
        examined += 1

        r_fail = mean([x["bd"] + x["td"] for x in recent])
        p_fail = mean([x["bd"] + x["td"] for x in prior])
        delta = r_fail - p_fail
        if abs(delta) < MIN_DELTA_PTS:
            continue

        def tech_share(rows):
            tot = sum(x["bd"] + x["td"] for x in rows)
            return (sum(x["td"] for x in rows) / tot) if tot > 0 else 0.0

        # Volume is in millions of transactions per month.
        national = int(
            mean([x["vol"] for x in recent]) * 1_000_000
            * (abs(delta) / 100.0) * avg_ticket
        )
        d = BankDrift(
            national_impact_paise=national,
            bank=recent[-1]["display"],
            key=key,
            prior_pct=round(p_fail, 3),
            recent_pct=round(r_fail, 3),
            delta_pts=round(delta, 3),
            direction="deteriorating" if delta > 0 else "improving",
            prior_window=prior_w,
            recent_window=recent_w,
            volume_mn=round(mean([x["vol"] for x in recent]), 1),
            technical_share_delta=round(tech_share(recent) - tech_share(prior), 4),
            severity=_severity(abs(delta)),
        )
        (worse if delta > 0 else better).append(d)

    worse.sort(key=lambda d: -d.delta_pts)
    better.sort(key=lambda d: d.delta_pts)
    return worse, better, prior_w, recent_w, examined


#: Below this the drift is real but not worth a routing change. Moving volume
#: has its own cost, and an agent that proposes an intervention for every
#: fractional movement is an agent nobody reads.
MATERIAL_EXPOSURE_PAISE = 5_000_00

#: The published series is monthly and noisy. A movement smaller than this is
#: inside the range these tables wander in normal months, so it is reported
#: but never acted on -- the same discipline the attribution error bar
#: enforces, applied to a different measurement.
MATERIAL_DELTA_PTS = 1.0


def _propose_intervention(e: Exposure) -> Exposure:
    """Turn an exposure into a typed action, gated against the mandate.

    Returns the exposure unchanged when the movement is too small to act on.
    Saying nothing is a valid output here and is the common one.
    """
    if e.exposure_paise < MATERIAL_EXPOSURE_PAISE or e.delta_pts < MATERIAL_DELTA_PTS:
        return e.model_copy(
            update={
                "actionable": False,
                "rationale": (
                    "Reported, not acted on: %s moved %.2f points and carries "
                    "Rs %s/month here, below the %.1f point and Rs %s thresholds "
                    "a routing change has to clear."
                    % (
                        e.bank, e.delta_pts,
                        format(e.exposure_paise // 100, ",d"),
                        MATERIAL_DELTA_PTS,
                        format(MATERIAL_EXPOSURE_PAISE // 100, ",d"),
                    )
                ),
            }
        )

    action = ProposedAction(
        action_type=ActionType.ENABLE_MULTI_BANK_ROUTING,
        txn_id="drift:%s:%s" % (e.merchant_id, normalise_bank(e.bank)),
        # Zero, and deliberately.
        #
        # The mandate's amount ceiling governs how much money a single action
        # MOVES -- retrying a Rs 2,000 payment risks Rs 2,000. A routing change
        # moves no money; it changes configuration. Passing the monthly
        # exposure here would compare a config change against a per-payment
        # money limit and deny every intervention worth making, which is what
        # the first version of this did. The exposure is carried on the
        # Exposure record, where it belongs.
        amount_paise=0,
        target_bank=e.bank,
        reason=(
            "%s has degraded %.2f points against its own prior quarter in "
            "NPCI's published series. %.1f%% of this merchant's volume routes "
            "through it, costing about Rs %s a month."
            % (e.bank, e.delta_pts, e.share_pct,
               format(e.exposure_paise // 100, ",d"))
        ),
        requires_merchant_approval=True,
    )

    try:
        signed = load_mandate(e.merchant_id)
    except (SystemExit, FileNotFoundError, OSError):
        # SystemExit is deliberate here, not sloppy: load_mandate raises it as
        # a CLI convenience, and it inherits from BaseException, so a bare
        # `except Exception` would let it through and take the API process
        # down with it the first time a merchant had no mandate on file.
        #
        # No mandate means no authority, which is a DENY rather than an
        # excuse to act.
        return e.model_copy(
            update={
                "proposed_action": action.model_dump(mode="json"),
                "gate_decision": "deny",
                "gate_reason": "DENY_NO_MANDATE_ON_FILE",
                "actionable": True,
                "rationale": "No signed mandate on file for this merchant.",
            }
        )

    gate = evaluate(
        action,
        signed,
        GateContext(now=datetime.now(timezone.utc), attempts_by_txn={}),
    )
    return e.model_copy(
        update={
            "proposed_action": action.model_dump(mode="json"),
            "gate_decision": gate.decision.value,
            "gate_reason": gate.reason_code,
            "actionable": True,
            "rationale": (
                "Spread volume off %s. This is a merchant action -- the agent "
                "cannot re-route on your behalf, so it is proposed and gated, "
                "not executed." % e.bank
            ),
        }
    )


def _merchant_exposure(worse: list[BankDrift]) -> list[Exposure]:
    """Which merchants are actually exposed, and for how much.

    Uses each merchant's real bank mix from their latest run, so the answer is
    "you have 41% of volume on a bank that got 4.5 points worse" rather than a
    generic warning nobody can price.
    """
    by_key = {d.key: d for d in worse}
    out: list[Exposure] = []
    seen: dict[str, float] = {}

    for p in RUNS.glob("run_*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if rec.get("used_stubs"):
            continue
        mid = rec["merchant_id"]
        # newest run per merchant only
        if mid in seen and p.stat().st_mtime <= seen[mid]:
            continue
        seen[mid] = p.stat().st_mtime
        out = [e for e in out if e.merchant_id != mid]

        gmv = rec["report"]["projected"].get("monthly_gmv_paise", 0)
        for row in rec["report"].get("bank_health", {}).get("banks", []):
            d = by_key.get(normalise_bank(row["bank"]))
            if not d:
                continue
            share = row["share_pct"] / 100.0
            # Points of success rate lost on this merchant's book, in rupees.
            exposure = int(gmv * share * (d.delta_pts / 100.0))
            if exposure <= 0:
                continue
            out.append(
                Exposure(
                    merchant_id=mid,
                    merchant_name=rec["merchant_name"],
                    run_id=rec["run_id"],
                    bank=row["bank"],
                    share_pct=row["share_pct"],
                    delta_pts=d.delta_pts,
                    exposure_paise=exposure,
                )
            )

    out.sort(key=lambda e: -e.exposure_paise)
    return [_propose_intervention(e) for e in out]


def simulate_exposure(merchant_id: str, bank: str, delta_pts: float) -> Exposure:
    """What would the agent do if THIS bank moved by THIS much?

    A hypothetical, and labelled one everywhere it surfaces. It exists because
    the honest answer on the current data is that no merchant here is
    materially exposed -- the issuers that degraded this quarter are small
    regional banks and this book routes through the large nationals.

    Rather than quietly re-weighting the demo merchants until the feature had
    something to show, this asks the counterfactual directly. Everything it
    touches is real: the merchant's actual bank mix and monthly volume, the
    real action type, and the merchant's real signed mandate. Only the
    movement is supposed.
    """
    latest, mtime = None, -1.0
    for p in RUNS.glob("run_*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if rec.get("merchant_id") != merchant_id or rec.get("used_stubs"):
            continue
        if p.stat().st_mtime > mtime:
            latest, mtime = rec, p.stat().st_mtime
    if latest is None:
        raise FileNotFoundError("no run on file for %s" % merchant_id)

    key = normalise_bank(bank)
    row = next(
        (
            r
            for r in latest["report"].get("bank_health", {}).get("banks", [])
            if normalise_bank(r["bank"]) == key
        ),
        None,
    )
    if row is None:
        raise ValueError("%s does not route through %s" % (merchant_id, bank))

    gmv = latest["report"]["projected"].get("monthly_gmv_paise", 0)
    share = row["share_pct"] / 100.0
    return _propose_intervention(
        Exposure(
            merchant_id=merchant_id,
            merchant_name=latest["merchant_name"],
            run_id=latest["run_id"],
            bank=row["bank"],
            share_pct=row["share_pct"],
            delta_pts=delta_pts,
            exposure_paise=max(0, int(gmv * share * (delta_pts / 100.0))),
        )
    )


def build_drift_report() -> DriftReport:
    worse, better, prior_w, recent_w, examined = detect_drift()
    exposures = _merchant_exposure(worse)
    periods = sorted({p for w in (worse + better) for p in w.recent_window})
    return DriftReport(
        period_range=[prior_w[0] if prior_w else "", recent_w[-1] if recent_w else ""],
        prior_window=prior_w,
        recent_window=recent_w,
        banks_examined=examined,
        deteriorating=worse[:15],
        improving=better[:10],
        exposures=exposures[:25],
        total_exposure_paise=sum(e.exposure_paise for e in exposures),
        merchants_affected=len({e.merchant_id for e in exposures}),
        total_national_impact_paise=sum(d.national_impact_paise for d in worse),
        interventions_proposed=sum(1 for e in exposures if e.actionable),
        intervention_decisions=dict(
            Counter(e.gate_decision for e in exposures if e.gate_decision)
        ),
    )
