"""Run the engine against bank data it has never seen.

The single question a payments company asks a demo is "would this work on OUR
numbers?", and every hackathon answer to it is a promise. This is the answer
you can watch: hand the system a CSV in NPCI's own published shape, and it
re-derives every baseline from that file instead of the committed one, then
shows what moved.

Nothing here is a new model. It is the same decomposer, the same cohort, the
same priors -- pointed at a different measurement of the world. That is the
claim worth making, because a diagnosis that changes when the evidence changes
is the only kind that was ever reading the evidence.

Two rules this file exists to enforce:

  * a bad upload must fail loudly and specifically. "Nothing happened" during
    a demo is indistinguishable from a broken product, so every rejection
    names the row and what was wrong with it
  * an upload is never persisted over the committed data. The shipped NPCI
    tables are what CI reproduces against; a demo that quietly overwrote them
    would make the reproducibility job a lie
"""

from __future__ import annotations

import csv
import io

from pydantic import BaseModel

from .baseline import BankStats, Baseline, normalise_bank

#: NPCI's remitter table, which is the shape the repo already ships.
REQUIRED = ("period", "bank", "approved_pct", "bd_pct", "td_pct")

#: Enough banks to be a measurement rather than an anecdote. Below this the
#: median fallback carries most merchants and the "your data" claim is hollow.
MIN_BANKS = 5

#: Uploads are held in memory for the session only, never written to
#: data/npci/. See the module docstring.
MAX_BYTES = 4_000_000


class Rejected(Exception):
    """A refusal that names the row and the reason."""


class UploadSummary(BaseModel):
    period: str
    banks: int
    #: Periods present in the file, so the caller can pick another.
    periods: list[str]
    median_fail_pct: float
    best_bank: str
    best_fail_pct: float
    worst_bank: str
    worst_fail_pct: float
    #: Rows skipped and why, reported rather than silently dropped.
    skipped: int
    notes: list[str]


def parse(raw: bytes, period: str | None = None) -> tuple[dict[str, BankStats], UploadSummary]:
    """Read an NPCI-shaped CSV into bank statistics.

    `period` picks a month; the newest in the file is used when omitted, which
    is almost always what someone uploading a fresh export wants.
    """
    if len(raw) > MAX_BYTES:
        raise Rejected("file is larger than %d MB" % (MAX_BYTES // 1_000_000))
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise Rejected("file is not UTF-8 text -- export it as CSV, not XLSX")

    reader = csv.DictReader(io.StringIO(text))
    cols = set(reader.fieldnames or [])
    missing = [c for c in REQUIRED if c not in cols]
    if missing:
        # The two upload panels take different files and look alike, so the
        # commonest failure is dropping a payments export in here. Naming the
        # absent columns is technically correct and useless -- what the person
        # needs is to be told which box to use.
        looks_like_payments = bool(
            cols
            & {
                "payment_id", "txn_id", "transaction_id", "order_id",
                "issuer", "payment_method", "method", "status",
                "succeeded", "error_code", "error_reason", "amount",
                "amount_inr", "amount_paise",
            }
        )
        if looks_like_payments:
            raise Rejected(
                "This looks like a payments export, not a bank table -- it has "
                "columns like %s. Use the 'Diagnose a month of your own "
                "transactions' panel above; this one takes NPCI's published "
                "bank performance table."
                % ", ".join(sorted(cols & {"payment_id", "issuer", "status",
                                           "payment_method", "amount_inr",
                                           "error_reason"})[:3])
            )
        raise Rejected(
            "missing column%s: %s. Expected NPCI's remitter shape: %s"
            % (
                "" if len(missing) == 1 else "s",
                ", ".join(missing),
                ", ".join(REQUIRED),
            )
        )

    rows: list[dict] = []
    skipped = 0
    notes: list[str] = []
    for n, row in enumerate(reader, start=2):
        try:
            row["_approved"] = float(row["approved_pct"])
            row["_bd"] = float(row["bd_pct"])
            row["_td"] = float(row["td_pct"])
        except (TypeError, ValueError):
            skipped += 1
            if len(notes) < 3:
                notes.append("row %d: %r is not a number" % (n, row.get("approved_pct")))
            continue
        if not row.get("bank") or not row.get("period"):
            skipped += 1
            if len(notes) < 3:
                notes.append("row %d: missing bank or period" % n)
            continue
        rows.append(row)

    if not rows:
        raise Rejected("no usable rows. %s" % ("; ".join(notes) or "file was empty"))

    periods = sorted({r["period"] for r in rows}, reverse=True)
    chosen = period or periods[0]
    if chosen not in periods:
        raise Rejected(
            "period %r is not in this file. Found: %s"
            % (chosen, ", ".join(periods[:6]))
        )

    stats: dict[str, BankStats] = {}
    for r in rows:
        if r["period"] != chosen:
            continue
        stats[normalise_bank(r["bank"])] = BankStats(
            bank=r["bank"],
            period=r["period"],
            total_volume_mn=float(r.get("total_volume_mn") or 0),
            approved_pct=r["_approved"],
            bd_pct=r["_bd"],
            td_pct=r["_td"],
        )

    if len(stats) < MIN_BANKS:
        raise Rejected(
            "only %d bank%s for %s. Need at least %d for the cohort comparison "
            "to mean anything." % (len(stats), "" if len(stats) == 1 else "s", chosen, MIN_BANKS)
        )

    ranked = sorted(stats.values(), key=lambda s: s.fail_rate)
    fails = [s.fail_rate for s in ranked]
    summary = UploadSummary(
        period=chosen,
        banks=len(stats),
        periods=periods[:24],
        median_fail_pct=round(100 * fails[len(fails) // 2], 3),
        best_bank=ranked[0].bank,
        best_fail_pct=round(100 * ranked[0].fail_rate, 3),
        worst_bank=ranked[-1].bank,
        worst_fail_pct=round(100 * ranked[-1].fail_rate, 3),
        skipped=skipped,
        notes=notes,
    )
    return stats, summary


def baseline_from(stats: dict[str, BankStats], period: str) -> Baseline:
    """A Baseline reading the uploaded numbers rather than the shipped file.

    Built by substitution rather than by a second code path, so the engine
    cannot behave differently on uploaded data than on committed data -- which
    is the whole point of the exercise.
    """
    b = Baseline.__new__(Baseline)
    b.period = period
    b.stats = stats
    b.prior_scale = None
    rates = sorted(s.fail_rate for s in stats.values())
    b._median_fail = rates[len(rates) // 2]
    return b
