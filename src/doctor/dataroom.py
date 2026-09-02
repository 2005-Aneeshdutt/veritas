"""Every source behind a recovery number, and how complete each one is.

WHAT THIS IS FOR
----------------
"₹39,833 recovered" is a claim about data. The Evidence page already lets you
walk that number down to the payments and the audit entries under it. This is
the layer below even that: is the data those records were computed from
actually whole?

A dashboard that shows a confident total over a source with 40% of its rows
missing is worse than one that shows nothing, because the confidence is the
part that is wrong. So each source reports its own record count, when it was
last written, how many rows failed validation, how many duplicates were
refused, and how many references point at something that is not there.

Nothing here is decorative. `unresolved` is the field that matters: a
payment-link event naming a payment no batch contains means the loop has a
hole in it, and this is where that shows up rather than as a total that is
quietly a bit small.

LINEAGE
-------
`lineage()` answers the other direction: given one payment, show every record
that touched it, in order, ending at the hash of the audit entry. It is the
drilldown the Evidence page offers per bucket, narrowed to a single payment
and widened to include the event log.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel

from . import events as ev

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "data" / "synthetic"
RUNS = ROOT / "data" / "runs"
MANDATES = ROOT / "data" / "mandates"
NPCI = ROOT / "data" / "npci"
CHALLENGES = ROOT / "data" / "challenges"


class SourceStat(BaseModel):
    """One data source, and whether it can be relied on."""

    key: str
    label: str
    #: Where it physically lives, so a reader can go and look.
    path: str
    records: int
    #: synthetic | razorpay_test | real | derived
    origin: str
    ingestion_state: str
    last_updated: str | None
    #: Share of records that carry every field the pipeline needs.
    completeness_pct: float
    duplicates_refused: int = 0
    invalid_records: int = 0
    #: References that point at a record no source contains.
    unresolved_relationships: int = 0
    note: str = ""


class DataRoom(BaseModel):
    sources: list[SourceStat]
    total_records: int
    ok: bool
    #: Anything a reader should know before trusting the totals.
    warnings: list[str] = []


def _mtime(p: Path) -> str | None:
    if not p.exists():
        return None
    return datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat()


def _newest(paths: list[Path]) -> str | None:
    stamps = [t for t in (_mtime(p) for p in paths) if t]
    return max(stamps) if stamps else None


def _merchant_files() -> list[Path]:
    return sorted(SYNTH.glob("merchant_*.json"))


def _runs() -> list[dict]:
    out = []
    for p in sorted(RUNS.glob("run_*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    return out


def build_dataroom() -> DataRoom:
    """Count every source the recovery number depends on."""
    sources: list[SourceStat] = []
    warnings: list[str] = []

    # -- payments and orders, from the generated batches -------------------
    txns = 0
    failures = 0
    bad = 0
    ids: set[str] = set()
    dup_txn = 0
    for p in _merchant_files():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for t in d.get("transactions", []):
            txns += 1
            if t["txn_id"] in ids:
                dup_txn += 1
            ids.add(t["txn_id"])
            # A row the pipeline cannot use: no amount, or a failure with no
            # error class to classify it by.
            if not t.get("amount_paise") or (
                not t.get("succeeded") and not t.get("error_class")
            ):
                bad += 1
            if not t.get("succeeded"):
                failures += 1

    sources.append(SourceStat(
        key="payments", label="Payments",
        path="data/synthetic/merchant_*.json",
        records=txns, origin="synthetic",
        ingestion_state="loaded",
        last_updated=_newest(_merchant_files()),
        completeness_pct=round(100 * (txns - bad) / txns, 2) if txns else 0.0,
        duplicates_refused=dup_txn,
        invalid_records=bad,
        note="Generated batches with analytic ground truth. The engine never "
             "sees the ground-truth block.",
    ))

    sources.append(SourceStat(
        key="failures", label="Failed payments",
        path="data/synthetic/merchant_*.json",
        records=failures, origin="synthetic",
        ingestion_state="loaded",
        last_updated=_newest(_merchant_files()),
        completeness_pct=100.0,
        note="The denominator of every recovery figure in the product.",
    ))

    # -- events -------------------------------------------------------------
    summary = ev.summarise()
    evs = ev.store.all()
    ev_bad = sum(1 for e in evs if e.ingestion_status == "rejected")
    sources.append(SourceStat(
        key="events", label="Payment events",
        path="data/events/*.jsonl",
        records=summary.total,
        origin=(
            "razorpay_test" if summary.by_source.get("razorpay_test")
            else "synthetic" if summary.total else "none"
        ),
        ingestion_state="live" if summary.total else "empty",
        last_updated=summary.last_received_at,
        completeness_pct=100.0 if summary.total else 0.0,
        duplicates_refused=summary.duplicates_refused,
        invalid_records=ev_bad,
        unresolved_relationships=summary.unresolved_payment_refs,
        note=(
            "Idempotent by the source's own event id, and again by "
            "(payment, action) before anything is sent. Duplicates refused "
            "counts this process only."
        ),
    ))

    # -- payment links ------------------------------------------------------
    links = [e for e in evs if e.event_type.startswith("payment_link")]
    paid_links = {e.payment_link_id for e in links if e.event_type == "payment_link.paid"}
    sources.append(SourceStat(
        key="payment_links", label="Payment links",
        path="data/events/*.jsonl",
        records=len({e.payment_link_id for e in links if e.payment_link_id}),
        origin="synthetic" if links else "none",
        ingestion_state="live" if links else "empty",
        last_updated=links[-1].received_at if links else None,
        completeness_pct=100.0 if links else 0.0,
        note="%d settled by a paid event. A link that was created is not a "
             "recovery." % len(paid_links),
    ))

    # -- recovery outcomes --------------------------------------------------
    outcomes = [e for e in evs if e.event_type in ev.OUTCOME_TYPES]
    sources.append(SourceStat(
        key="outcomes", label="Recovery outcomes",
        path="data/events/*.jsonl",
        records=len(outcomes),
        origin=(
            "razorpay_test"
            if any(e.source == "razorpay_test" for e in outcomes)
            else "synthetic" if outcomes else "none"
        ),
        ingestion_state="live" if outcomes else "empty",
        last_updated=outcomes[-1].received_at if outcomes else None,
        completeness_pct=100.0 if outcomes else 0.0,
        note="The ONLY thing that turns an intervention into a recovered "
             "rupee. Nothing else in the product may set that figure.",
    ))

    # -- the audit chain ----------------------------------------------------
    runs = _runs()
    entries = sum(len(r["report"].get("ledger", [])) for r in runs)
    verified = sum(
        1 for r in runs if r["report"]["measured"].get("chain_verified")
    )
    sources.append(SourceStat(
        key="audit", label="Audit entries",
        path="data/runs/run_*.json",
        records=entries, origin="derived",
        ingestion_state="%d/%d chains verified" % (verified, len(runs)),
        last_updated=_newest(sorted(RUNS.glob("run_*.json"))),
        completeness_pct=round(100 * verified / len(runs), 2) if runs else 0.0,
        note="Hash-chained from genesis, actor inside the hash. Re-verified "
             "on every read.",
    ))

    # -- the real data, which is the part nobody generated ------------------
    npci_files = sorted(NPCI.glob("*"))
    sources.append(SourceStat(
        key="npci", label="NPCI bank tables",
        path="data/npci/", records=len(npci_files), origin="real",
        ingestion_state="pinned capture",
        last_updated=_newest(npci_files),
        completeness_pct=100.0,
        note="Published NPCI monthly remitter tables. The one input to this "
             "product that nobody here generated.",
    ))

    mandate_files = sorted(MANDATES.glob("*_mandate.json"))
    sources.append(SourceStat(
        key="mandates", label="Signed mandates",
        path="data/mandates/", records=len(mandate_files), origin="derived",
        ingestion_state="signed",
        last_updated=_newest(mandate_files),
        completeness_pct=100.0,
        note="Ed25519. The agent holds the public key and has never held the "
             "signing key.",
    ))

    if summary.unresolved_payment_refs:
        warnings.append(
            "%d outcome events name a payment no batch contains. Those "
            "rupees are NOT counted anywhere."
            % summary.unresolved_payment_refs
        )
    if verified != len(runs):
        warnings.append(
            "%d of %d audit chains did not verify."
            % (len(runs) - verified, len(runs))
        )
    if not outcomes:
        warnings.append(
            "No outcome events have been received, so no recovery has been "
            "confirmed through the event loop. The batch-level measured "
            "figure comes from marking executed retries against ground truth, "
            "which is a separate and older path."
        )

    return DataRoom(
        sources=sources,
        total_records=sum(s.records for s in sources),
        ok=not any(s.invalid_records or s.unresolved_relationships
                   for s in sources),
        warnings=warnings,
    )


# -- lineage ---------------------------------------------------------------

class LineageStep(BaseModel):
    stage: str
    label: str
    detail: str
    #: Where this came from, so a reader can check it themselves.
    source: str
    #: A hash, an id, a rule name -- whatever identifies this record.
    ref: str | None = None
    at: str | None = None


class Lineage(BaseModel):
    txn_id: str
    merchant_id: str
    amount_paise: int
    steps: list[LineageStep]
    recovered_paise: int
    recovery_basis: str


def lineage(merchant_id: str, txn_id: str) -> Lineage | None:
    """Every record that touched one payment, in the order it happened."""
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    if not p.exists():
        return None
    d = json.loads(p.read_text(encoding="utf-8"))
    txn = next(
        (t for t in d["transactions"] if t["txn_id"] == txn_id), None
    )
    if txn is None:
        return None

    steps: list[LineageStep] = [
        LineageStep(
            stage="payment", label="The payment",
            detail="%s on %s, %s, hour %s — %s"
            % (
                txn["txn_id"], txn.get("bank"), txn.get("method"),
                txn.get("hour"),
                "succeeded" if txn.get("succeeded") else txn.get("error_code"),
            ),
            source="data/synthetic/merchant_%s.json" % merchant_id,
            ref=txn["txn_id"],
        )
    ]

    # what the run decided about it
    for f in sorted(RUNS.glob("run_*.json")):
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if r.get("merchant_id") != merchant_id:
            continue
        for e in r["report"].get("ledger", []):
            if e.get("txn_id") != txn_id:
                continue
            pa = e.get("proposed_action") or {}
            steps.append(LineageStep(
                stage="decision", label="Action proposed",
                detail="%s — %s" % (pa.get("action_type"), pa.get("reason", "")[:90]),
                source="%s · plan" % r["run_id"],
                ref=pa.get("action_type"),
            ))
            steps.append(LineageStep(
                stage="policy", label="Policy kernel",
                detail="%s · %s" % (e.get("gate_decision"), e.get("gate_reason")),
                source="chitragupta/policy.py",
                ref=e.get("gate_reason"),
            ))
            steps.append(LineageStep(
                stage="execution", label="Outcome of the action",
                detail="%s, by %s" % (e.get("outcome"), e.get("actor")),
                source="%s · ledger" % r["run_id"],
                ref=str(e.get("sequence")),
                at=e.get("timestamp"),
            ))
            steps.append(LineageStep(
                stage="audit", label="Audit entry",
                detail="entry %s, chained to %s"
                % (str(e.get("entry_hash"))[:16], str(e.get("prev_hash"))[:16]),
                source="SHA-256 hash chain",
                ref=e.get("entry_hash"),
                at=e.get("timestamp"),
            ))
        break

    # anything the event log knows
    for e in ev.store.all():
        if e.payment_id != txn_id:
            continue
        steps.append(LineageStep(
            stage="event", label=e.event_type,
            detail="%s → %s%s"
            % (
                e.previous_state or "?", e.new_state,
                " (%s)" % e.processing_note if e.processing_note else "",
            ),
            source="%s event" % e.source,
            ref=e.event_id,
            at=e.received_at,
        ))

    from .recovery import settle_from_events

    paise, event_id, state = settle_from_events(txn_id)
    return Lineage(
        txn_id=txn_id, merchant_id=merchant_id,
        amount_paise=int(txn["amount_paise"]),
        steps=steps,
        recovered_paise=paise,
        recovery_basis=(
            "confirmed by outcome event %s" % event_id if paise
            else "no outcome event has confirmed this payment — %s" % state
        ),
    )
