"""External ecosystem evidence: does NPCI's published UPI data agree with us?

A diagnosis that only ever reads the merchant's own payments can be internally
consistent and still wrong about the world. This module is the one place the
system asks an outside question:

    "Is the failure pattern we measured consistent with what NPCI published
     about the UPI ecosystem over the same period?"

It answers CONSISTENT, NOT_CONFIRMED, MIXED, NOT_APPLICABLE or UNAVAILABLE,
and it is allowed to say nothing at all. What it is never allowed to do is
decide anything. NPCI evidence has no path into the policy kernel, the gate,
the recovery amount or the ledger; the authority chain (diagnosis -> plan ->
policy -> execution -> outcome -> ledger -> prove) is untouched by this file.
Grep it: nothing here imports policy, plan, recovery or ledger.

Three design decisions worth defending:

  * **No runtime HTTP.** npci.org.in serves 403 to non-browser clients, so the
    repo already pins a specific Internet Archive capture of the official
    ecosystem-statistics page and parses it once, offline, in
    scripts/fetch_data.py. Determinism is a shipped guarantee here -- §18 of
    the brief asks that a diagnosis run today not change tomorrow because NPCI
    published new numbers. Fetching live at diagnosis time would break exactly
    that. So this adapter reads the committed tables and carries the capture id
    as provenance. Refreshing the evidence is a deliberate act: re-run the
    fetch script, which produces a new period and therefore a new snapshot id.

  * **Ecosystem figures are derived, and say so.** NPCI publishes per-member
    performance, not a single "UPI approved %" line. The ecosystem rate here is
    a volume-weighted mean over the remitter members NPCI reported that month.
    That derivation is recorded in the provenance as `derivation`, because a
    number the source never printed must never be quoted as if it had.

  * **Stale is reported, not hidden.** The pinned capture is from 2025-09 and
    covers 2025-08. Against a later clock this evidence is STALE, and it says
    STALE. Widening the freshness window until it read FRESH would be lying
    with a constant.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Iterable

from pydantic import AllowInfNan, BaseModel, Field

from .baseline import normalise_bank

ROOT = Path(__file__).resolve().parents[2]
NPCI_DIR = ROOT / "data" / "npci"
SNAPSHOT_DIR = NPCI_DIR / "snapshots"

# --- what this adapter is, on the record ----------------------------------

SOURCE = "NPCI"
DATASET = "UPI_ECOSYSTEM_STATISTICS"
SOURCE_URL = "https://www.npci.org.in/what-we-do/upi/upi-ecosystem-statistics"

#: The Internet Archive capture the committed tables were parsed from. Kept in
#: step with scripts/fetch_data.py::NPCI_CAPTURE -- test_npci_evidence.py
#: asserts the two agree, so this cannot drift silently.
SOURCE_CAPTURE = "20250908011442"

#: Schema version of the normalised object below. A snapshot written by an
#: older or newer version is refused rather than coerced.
SCHEMA_VERSION = "1"

#: NPCI reports the payer side under "remitter member". A merchant's failed
#: payment is charged to the payer's bank, so this is the correct table --
#: the same one baseline.py already joins against.
TABLE = "remitter_banks"

#: How the ecosystem line is built from the member table. Quoted verbatim in
#: the provenance so a reader knows the number is ours, not NPCI's.
DERIVATION = "volume_weighted_mean_over_reported_remitter_members"

# --- conventions (§5): every field name carries its unit -------------------
#
#   *_pct  percentage points on 0..100, exactly as NPCI prints them
#   *_mn   millions of transactions, exactly as NPCI prints them
#
# Nothing in this module stores a bare proportion. There is no field called
# `rate`, `volume` or `value`.

PCT_MIN, PCT_MAX = 0.0, 100.0

#: NPCI's three shares should sum to 100. Rounding in the published table
#: leaves a little slack; beyond this the row is not a row we understand.
#: data/npci/anomalies.csv shows the failure mode this guards (a 2024-09
#: beneficiary row summing to 124.59).
SUM_TOLERANCE_PCT = 1.5

#: Fewest members that make a volume-weighted ecosystem mean a measurement
#: rather than an anecdote. Mirrors ingest_npci.MIN_BANKS.
MIN_MEMBERS = 5

#: NPCI publishes monthly. Two publication cycles of slack, then it is stale.
FRESH_MAX_DAYS = 62

#: "Elevated" means half again above the comparison. Deliberately the same
#: factor node_bank_health already uses for "worse than the NPCI baseline",
#: so the system has one definition of elevated, not two.
ELEVATION_RATIO = 1.5

#: Below this UPI share, a UPI ecosystem statistic is not evidence about this
#: merchant and is not attached (§9 -- do not staple ecosystem data to every
#: payment).
MIN_UPI_SHARE_PCT = 5.0

#: Matched-member volume needed before bank-level relevance is claimed.
MIN_MATCHED_SHARE_PCT = 10.0

FiniteFloat = Annotated[float, AllowInfNan(False)]

#: YYYY-MM. The year is bounded so a period can never reach datetime()
#: with a value it will refuse -- year 0000 parsed as "valid" once, and
#: turned a clean refusal into a raw ValueError one layer down.
PERIOD_RE = re.compile(r"^(19|20|21)\d{2}-(0[1-9]|1[0-2])$")


class Freshness:
    FRESH = "FRESH"
    STALE = "STALE"
    UNAVAILABLE = "UNAVAILABLE"


class Corroboration:
    CONSISTENT = "CONSISTENT"
    NOT_CONFIRMED = "NOT_CONFIRMED"
    MIXED = "MIXED"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    UNAVAILABLE = "UNAVAILABLE"


class Relevance:
    """How close this evidence sits to the merchant. Scope, never authority.

    These levels describe how specific the external evidence is. They are not
    permissions and nothing reads them to allow or deny anything -- §10.
    """

    NONE = 0            # no usable NPCI evidence
    ECOSYSTEM = 1       # broad UPI ecosystem, period not matched
    PERIOD = 2          # ecosystem evidence for the observed period
    MEMBER = 3          # the merchant's own banks appear in NPCI's table
    CORROBORATED = 4    # member-level, and the patterns agree

    LABELS = {
        0: "NONE",
        1: "ECOSYSTEM",
        2: "PERIOD",
        3: "MEMBER",
        4: "CORROBORATED",
    }


#: Attached to every evidence object and repeated to the LLM. §13.
NO_CAUSAL_CLAIM = (
    "NPCI ecosystem statistics describe aggregate UPI activity and do not "
    "establish the cause of any individual payment failure."
)

#: Sentences this module must never emit. Asserted over every reason string
#: the module can produce, the same way voice.py polices its script.
FORBIDDEN = [
    re.compile(r"npci\s+(caused|proves|confirms\s+that\s+this)", re.I),
    re.compile(r"because\s+of\s+npci", re.I),
    re.compile(r"npci\s+data\s+shows\s+this\s+payment", re.I),
]


class NPCIUnavailable(Exception):
    """No usable snapshot. Callers degrade; they never propagate this."""


class SourceChanged(Exception):
    """A stored snapshot id exists with different bytes underneath it.

    Snapshot ids embed the source hash, so this should be unreachable. If it
    ever fires, historical evidence has been tampered with and refusing is the
    only safe answer.
    """


# --------------------------------------------------------------------------
# normalised model
# --------------------------------------------------------------------------


class EcosystemMetrics(BaseModel):
    """The four signals the brief asks for, and nothing else."""

    model_config = {"frozen": True}

    approval_rate_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    technical_decline_rate_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    business_decline_rate_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    transaction_volume_mn: FiniteFloat = Field(ge=0.0)
    #: How many remitter members the mean was taken over.
    members_reported: int = Field(ge=MIN_MEMBERS)


class BaselineMetrics(BaseModel):
    """One earlier period, for period-over-period comparison. Nothing more."""

    model_config = {"frozen": True}

    period: str
    approval_rate_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    technical_decline_rate_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    business_decline_rate_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)


class Provenance(BaseModel):
    """Everything needed to find this exact number again."""

    model_config = {"frozen": True}

    source: str = SOURCE
    source_url: str = SOURCE_URL
    dataset: str = DATASET
    table: str = TABLE
    period: str
    as_of: str
    fetched_at: str
    schema_version: str = SCHEMA_VERSION
    source_hash: str
    snapshot_id: str
    source_capture: str = SOURCE_CAPTURE
    derivation: str = DERIVATION
    #: Row count behind the aggregate. A reference, not a filesystem path --
    #: this object is served over HTTP (§17).
    rows_used: int


class NPCISnapshot(BaseModel):
    """One period of NPCI ecosystem statistics, validated and pinned."""

    model_config = {"frozen": True}

    provenance: Provenance
    metrics: EcosystemMetrics
    baseline: BaselineMetrics | None = None

    @property
    def period(self) -> str:
        return self.provenance.period

    @property
    def snapshot_id(self) -> str:
        return self.provenance.snapshot_id

    def age_days(self, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        as_of = datetime.fromisoformat(self.provenance.as_of)
        return max(0, (now - as_of).days)

    def freshness(self, now: datetime | None = None) -> str:
        return (
            Freshness.FRESH
            if self.age_days(now) <= FRESH_MAX_DAYS
            else Freshness.STALE
        )


class MerchantSignal(BaseModel):
    """The merchant-side half of the comparison, computed from the batch."""

    model_config = {"frozen": True}

    merchant_id: str
    upi_payments: int = Field(ge=0)
    upi_share_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    upi_technical_fail_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    upi_business_fail_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    #: Merchant banks that appear in NPCI's reported member list, and how much
    #: of the merchant's UPI volume they carry.
    matched_members: list[str] = []
    matched_share_pct: FiniteFloat = Field(default=0.0, ge=PCT_MIN, le=PCT_MAX)
    #: NPCI's own technical-decline rate for the merchant's matched banks,
    #: weighted by how much of ITS UPI volume each bank carries. None when no
    #: bank matched -- never guessed.
    member_technical_decline_pct: FiniteFloat | None = Field(
        default=None, ge=PCT_MIN, le=PCT_MAX)


class CorroborationResult(BaseModel):
    model_config = {"frozen": True}

    status: str
    reason: str
    merchant_technical_elevated: bool
    ecosystem_technical_elevated: bool
    #: The two numbers actually compared, so the verdict is checkable.
    merchant_technical_fail_pct: FiniteFloat | None = None
    ecosystem_technical_decline_pct: FiniteFloat | None = None
    member_technical_decline_pct: FiniteFloat | None = None
    baseline_technical_decline_pct: FiniteFloat | None = None
    #: Which of the two external comparisons fired, so the verdict is
    #: auditable rather than a single opaque boolean.
    elevation_basis: str | None = None


class RelevanceResult(BaseModel):
    model_config = {"frozen": True}

    level: int = Field(ge=0, le=4)
    label: str
    reasons: list[str]
    matched_members: list[str] = []
    upi_share_pct: FiniteFloat | None = None


class NPCIEvidence(BaseModel):
    """The small object the rest of the system consumes. Read-only."""

    model_config = {"frozen": True}

    available: bool
    scope: str = "ecosystem"
    evidence_class: str = "EXTERNAL"
    freshness_status: str
    age_days: int | None = None
    note: str = NO_CAUSAL_CLAIM
    provenance: Provenance | None = None
    metrics: EcosystemMetrics | None = None
    baseline: BaselineMetrics | None = None
    relevance: RelevanceResult | None = None
    corroboration: CorroborationResult | None = None
    #: Set when unavailable, so the reason is legible instead of a bare false.
    unavailable_reason: str | None = None


# --------------------------------------------------------------------------
# parsing and validation (§20)
# --------------------------------------------------------------------------


class _Row(BaseModel):
    model_config = {"frozen": True}

    bank: str
    total_volume_mn: FiniteFloat = Field(ge=0.0)
    approved_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    bd_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)
    td_pct: FiniteFloat = Field(ge=PCT_MIN, le=PCT_MAX)


def valid_period(period: str) -> bool:
    return bool(PERIOD_RE.match(period or ""))


def _as_of(period: str) -> datetime:
    """Last day of the reporting month, UTC. NPCI reports monthly totals."""
    y, m = (int(x) for x in period.split("-"))
    first_next = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return first_next - timedelta(days=1)


def prev_period(period: str) -> str:
    y, m = (int(x) for x in period.split("-"))
    return "%04d-%02d" % ((y - 1, 12) if m == 1 else (y, m - 1))


def _capture_time() -> datetime:
    return datetime.strptime(SOURCE_CAPTURE, "%Y%m%d%H%M%S").replace(
        tzinfo=timezone.utc
    )


def parse_rows(text: str, period: str) -> list[_Row]:
    """Validate one period out of NPCI's member table.

    Rejects, rather than repairs: NaN, +/-Inf, percentages outside 0..100,
    negative volume, and rows whose three shares do not sum to ~100. A row we
    cannot understand is dropped with the rest of the period left intact; a
    period with too few surviving rows is refused entirely by `load_period`.
    """
    out: list[_Row] = []
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames or "period" not in reader.fieldnames:
        raise NPCIUnavailable("member table is missing its header row")
    for raw in reader:
        if (raw.get("period") or "").strip() != period:
            continue
        try:
            row = _Row(
                bank=(raw.get("bank") or "").strip(),
                total_volume_mn=float(raw["total_volume_mn"]),
                approved_pct=float(raw["approved_pct"]),
                bd_pct=float(raw["bd_pct"]),
                td_pct=float(raw["td_pct"]),
            )
        except (TypeError, ValueError, KeyError):
            continue  # unparseable row, quarantined by omission
        if not row.bank:
            continue
        total = row.approved_pct + row.bd_pct + row.td_pct
        if not math.isfinite(total) or abs(total - 100.0) > SUM_TOLERANCE_PCT:
            continue  # the anomalies.csv failure mode
        out.append(row)
    return sorted(out, key=lambda r: r.bank)


def source_hash(rows: Iterable[_Row], period: str) -> str:
    """Deterministic fingerprint of the exact numbers behind a snapshot."""
    payload = json.dumps(
        {
            "dataset": DATASET,
            "table": TABLE,
            "schema_version": SCHEMA_VERSION,
            "capture": SOURCE_CAPTURE,
            "period": period,
            "rows": [
                [r.bank, r.total_volume_mn, r.approved_pct, r.bd_pct, r.td_pct]
                for r in rows
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _aggregate(rows: list[_Row]) -> tuple[float, float, float, float]:
    """Volume-weighted ecosystem mean. See DERIVATION."""
    vol = sum(r.total_volume_mn for r in rows)
    if vol <= 0:
        raise NPCIUnavailable("member table reports no volume for this period")
    w = lambda f: round(sum(f(r) * r.total_volume_mn for r in rows) / vol, 4)
    return (
        w(lambda r: r.approved_pct),
        w(lambda r: r.td_pct),
        w(lambda r: r.bd_pct),
        round(vol, 4),
    )


def _table_text() -> str:
    p = NPCI_DIR / (TABLE + ".csv")
    if not p.exists():
        raise NPCIUnavailable("NPCI member table is not present in this build")
    return p.read_text(encoding="utf-8")


# --------------------------------------------------------------------------
# snapshots (§7, §18)
# --------------------------------------------------------------------------

#: Process-lifetime memo. Ecosystem data does not change per payment, so a
#: diagnosis must not re-read and re-hash the table for every merchant.
_MEMO: dict[tuple[str, str | None], NPCISnapshot] = {}

#: snapshot id -> the member rows that snapshot was derived from.
_MEMBERS_BY_SNAPSHOT: dict[str, dict[str, "_Row"]] = {}


def snapshot_id(period: str, digest: str) -> str:
    return "npci_upi_eco_%s_%s" % (period, digest[:12])


def build_snapshot(
    period: str,
    *,
    baseline_period: str | None = None,
    text: str | None = None,
    now: datetime | None = None,
) -> NPCISnapshot:
    """Derive one validated, hashed snapshot. No network, no mutation."""
    if not valid_period(period):
        raise NPCIUnavailable("period %r is not YYYY-MM" % period)
    now = now or datetime.now(timezone.utc)
    as_of = _as_of(period)
    if as_of > now:
        raise NPCIUnavailable("period %s has not happened yet" % period)

    body = _table_text() if text is None else text
    rows = parse_rows(body, period)
    if len(rows) < MIN_MEMBERS:
        raise NPCIUnavailable(
            "only %d usable member rows for %s (need %d)"
            % (len(rows), period, MIN_MEMBERS)
        )
    approved, td, bd, vol = _aggregate(rows)
    digest = source_hash(rows, period)

    base = None
    if baseline_period is None:
        baseline_period = prev_period(period)
    if valid_period(baseline_period) and baseline_period != period:
        brows = parse_rows(body, baseline_period)
        if len(brows) >= MIN_MEMBERS:
            b_app, b_td, b_bd, _ = _aggregate(brows)
            base = BaselineMetrics(
                period=baseline_period,
                approval_rate_pct=b_app,
                technical_decline_rate_pct=b_td,
                business_decline_rate_pct=b_bd,
            )

    snap = NPCISnapshot(
        provenance=Provenance(
            period=period,
            as_of=as_of.isoformat(),
            fetched_at=_capture_time().isoformat(),
            source_hash=digest,
            snapshot_id=snapshot_id(period, digest),
            rows_used=len(rows),
        ),
        metrics=EcosystemMetrics(
            approval_rate_pct=approved,
            technical_decline_rate_pct=td,
            business_decline_rate_pct=bd,
            transaction_volume_mn=vol,
            members_reported=len(rows),
        ),
        baseline=base,
    )
    # A snapshot and the member list used to match banks against it must come
    # from the same bytes. Registering them together is what makes that true
    # even when the snapshot was built from supplied text rather than the
    # committed table -- otherwise the metrics say one thing and the bank
    # matching silently consults another source.
    _MEMBERS_BY_SNAPSHOT[snap.snapshot_id] = {
        normalise_bank(r.bank): r for r in rows
    }
    return snap


def persist(snap: NPCISnapshot) -> Path:
    """Write once, never mutate. The id embeds the hash, so a changed source
    lands in a new file and history keeps pointing at the old one (§7, §18)."""
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    p = SNAPSHOT_DIR / (snap.snapshot_id + ".json")
    body = snap.model_dump_json(indent=2)
    if p.exists():
        if json.loads(p.read_text(encoding="utf-8")) != json.loads(body):
            raise SourceChanged(
                "snapshot %s already exists with different content"
                % snap.snapshot_id
            )
        return p
    p.write_text(body, encoding="utf-8", newline="\n")
    return p


def load_snapshot(sid: str) -> NPCISnapshot:
    """Re-read a snapshot by id, for reproducing a historical diagnosis."""
    p = SNAPSHOT_DIR / (sid + ".json")
    if not p.exists():
        raise NPCIUnavailable("snapshot %s is not on this machine" % sid)
    data = json.loads(p.read_text(encoding="utf-8"))
    got = (data.get("provenance") or {}).get("schema_version")
    if got != SCHEMA_VERSION:
        raise NPCIUnavailable(
            "snapshot %s uses schema %r, this build reads %r"
            % (sid, got, SCHEMA_VERSION)
        )
    return NPCISnapshot.model_validate(data)


def current_snapshot(
    period: str | None = None,
    *,
    baseline_period: str | None = None,
    now: datetime | None = None,
    write: bool = True,
) -> NPCISnapshot:
    """The snapshot a diagnosis should use, memoised for the process."""
    period = period or latest_period()
    key = (period, baseline_period)
    if key in _MEMO:
        return _MEMO[key]
    snap = build_snapshot(period, baseline_period=baseline_period, now=now)
    if write:
        try:
            persist(snap)
        except (OSError, SourceChanged):
            # A read-only deployment, or a stored file that no longer matches.
            # Neither is a reason to withhold evidence we just derived from
            # the committed source. Tampering is caught where it matters, on
            # the verify path, which compares against the source rather than
            # against whatever is cached on this disk.
            pass
    _MEMO[key] = snap
    return snap


def latest_period() -> str:
    """Newest period present in the committed member table."""
    seen = set()
    for raw in csv.DictReader(_table_text().splitlines()):
        p = (raw.get("period") or "").strip()
        if valid_period(p):
            seen.add(p)
    if not seen:
        raise NPCIUnavailable("member table carries no usable period")
    return max(seen)


def reset_cache() -> None:
    """Test seam. Never called by the application."""
    _MEMO.clear()
    _MEMBERS.clear()
    _MEMBERS_BY_SNAPSHOT.clear()


# --------------------------------------------------------------------------
# relevance (§9, §10)
# --------------------------------------------------------------------------

#: NPCI's UPI tables describe UPI. These are the merchant rails they can speak
#: about; card and netbanking failures get no ecosystem evidence from here.
UPI_METHODS = {"upi", "upi_mandate"}

#: NPCI's technical-decline bucket is infrastructure failing. The merchant-side
#: analogue is the taxonomy's `technical` class. Everything else that failed
#: (soft, hard, auth) is a business decline in NPCI's sense.
TECHNICAL_CLASS = "technical"


def signal_from_transactions(
    merchant_id: str, txns: list, members: dict[str, "_Row"]
) -> MerchantSignal:
    """The merchant half of the comparison. Deterministic, no model calls."""
    total = len(txns)
    upi = [t for t in txns if str(_attr(t, "method") or "").lower() in UPI_METHODS]
    n = len(upi)
    tech = sum(1 for t in upi if not _attr(t, "succeeded")
               and str(_attr(t, "error_class") or "").lower() == TECHNICAL_CLASS)
    biz = sum(1 for t in upi if not _attr(t, "succeeded")
              and str(_attr(t, "error_class") or "").lower() != TECHNICAL_CLASS
              and _attr(t, "error_class") is not None)

    matched, matched_vol = set(), 0
    td_num = 0.0
    for t in upi:
        row = members.get(normalise_bank(str(_attr(t, "bank") or "")))
        if row is not None:
            matched.add(str(_attr(t, "bank")))
            matched_vol += 1
            td_num += row.td_pct

    pct = lambda a, b: round(100.0 * a / b, 4) if b else 0.0
    return MerchantSignal(
        member_technical_decline_pct=(
            round(td_num / matched_vol, 4) if matched_vol else None
        ),
        merchant_id=merchant_id,
        upi_payments=n,
        upi_share_pct=pct(n, total),
        upi_technical_fail_pct=pct(tech, n),
        upi_business_fail_pct=pct(biz, n),
        matched_members=sorted(matched),
        matched_share_pct=pct(matched_vol, n),
    )


def _attr(t, name):
    """Transactions arrive as pydantic models or as dicts out of a run file."""
    if isinstance(t, dict):
        return t.get(name)
    v = getattr(t, name, None)
    return getattr(v, "value", v)


def assess_relevance(sig: MerchantSignal, snap: NPCISnapshot,
                     observed_period: str | None = None) -> RelevanceResult:
    """How specific is this evidence to this merchant? Scope, not permission."""
    reasons: list[str] = []
    if sig.upi_share_pct < MIN_UPI_SHARE_PCT:
        return RelevanceResult(
            level=Relevance.NONE,
            label=Relevance.LABELS[Relevance.NONE],
            reasons=[
                "UPI is %.1f%% of this merchant's payments, below the %.0f%% "
                "at which UPI ecosystem statistics say anything about it"
                % (sig.upi_share_pct, MIN_UPI_SHARE_PCT)
            ],
            upi_share_pct=sig.upi_share_pct,
        )

    level = Relevance.ECOSYSTEM
    reasons.append(
        "UPI carries %.1f%% of this merchant's payments, so UPI ecosystem "
        "statistics are on-rail evidence" % sig.upi_share_pct
    )

    if observed_period is None or observed_period == snap.period:
        level = Relevance.PERIOD
        reasons.append(
            "NPCI evidence is the %s reporting period, the period the "
            "merchant batch is measured against" % snap.period
        )
    else:
        reasons.append(
            "merchant data is period %s but NPCI evidence is %s, so only "
            "broad ecosystem context applies" % (observed_period, snap.period)
        )

    if (sig.matched_members
            and sig.matched_share_pct >= MIN_MATCHED_SHARE_PCT
            and level >= Relevance.PERIOD):
        level = Relevance.MEMBER
        reasons.append(
            "%d of the merchant's UPI banks are in NPCI's reported member "
            "list for %s, carrying %.1f%% of its UPI volume"
            % (len(sig.matched_members), snap.period, sig.matched_share_pct)
        )
    else:
        reasons.append(
            "the merchant's UPI banks do not match enough of NPCI's reported "
            "member list for %s, so only ecosystem-level evidence applies"
            % snap.period
        )

    # Stated on every verdict, not only the ones that missed. NPCI publishes
    # payer- and payee-PSP tables, but the payment model carries no PSP
    # identifier, so PSP relevance is never claimed at any level -- and a
    # reader should be told that rather than left to assume it was checked.
    reasons.append(
        "no payer-PSP identifier exists in the payment model, so PSP-level "
        "matching is not attempted"
    )

    return RelevanceResult(
        level=level,
        label=Relevance.LABELS[level],
        reasons=reasons,
        matched_members=sig.matched_members,
        upi_share_pct=sig.upi_share_pct,
    )


# --------------------------------------------------------------------------
# corroboration (§11, §12)
# --------------------------------------------------------------------------


def corroborate(sig: MerchantSignal, snap: NPCISnapshot,
                rel: RelevanceResult) -> CorroborationResult:
    """Compare the two patterns. Never force them to agree.

    Two separate questions, kept separate on purpose:

      * is the MERCHANT elevated? -- its UPI technical failure rate against the
        closest external rate we legitimately have: NPCI's rate for the
        merchant's own banks when they matched, the ecosystem rate otherwise.

      * is NPCI ITSELF showing elevated technical declines relevant to this
        merchant? -- either the merchant's banks running above the ecosystem
        mean, or the ecosystem running above its own previous period.

    Only the first is about this merchant's data; only the second is external.
    Corroboration needs both, and `elevation_basis` records which comparison
    carried the external half so the verdict can be checked by hand.
    """
    eco_td = snap.metrics.technical_decline_rate_pct
    mem_td = sig.member_technical_decline_pct
    base_td = snap.baseline.technical_decline_rate_pct if snap.baseline else None

    if rel.level == Relevance.NONE:
        return CorroborationResult(
            status=Corroboration.NOT_APPLICABLE,
            reason="this merchant's payments do not run on UPI in enough "
                   "volume for UPI ecosystem statistics to bear on them",
            merchant_technical_elevated=False,
            ecosystem_technical_elevated=False,
        )

    use_member = rel.level >= Relevance.MEMBER and mem_td is not None
    ref_td = mem_td if use_member else eco_td
    ref_name = ("NPCI's rate for this merchant's own banks"
                if use_member else "the NPCI ecosystem rate")

    m_elev = sig.upi_technical_fail_pct > ref_td * ELEVATION_RATIO
    member_elev = mem_td is not None and mem_td > eco_td * ELEVATION_RATIO
    period_elev = base_td is not None and eco_td > base_td * ELEVATION_RATIO
    e_elev = member_elev or period_elev
    basis = ("member_above_ecosystem" if member_elev
             else "ecosystem_above_previous_period" if period_elev else "none")

    ext = (
        "NPCI reports %.2f%% technical declines for this merchant's banks "
        "against a %.2f%% ecosystem mean" % (mem_td, eco_td) if member_elev
        else "NPCI's ecosystem technical-decline rate rose to %.2f%% from "
             "%.2f%% in %s" % (eco_td, base_td, snap.baseline.period)
        if period_elev
        else "NPCI shows no elevated technical declines for %s (%.2f%% "
             "ecosystem%s%s)" % (
                 snap.period, eco_td,
                 "" if mem_td is None
                 else ", %.2f%% for this merchant's banks" % mem_td,
                 "" if base_td is None
                 else ", %.2f%% in %s" % (base_td, snap.baseline.period))
    )

    if m_elev and e_elev:
        status = Corroboration.CONSISTENT
        reason = (
            "merchant UPI technical failures run at %.2f%%, above %s at "
            "%.2f%%, and %s -- external ecosystem conditions are consistent "
            "with the observed pattern"
            % (sig.upi_technical_fail_pct, ref_name, ref_td, ext)
        )
    elif m_elev and not e_elev:
        status = Corroboration.NOT_CONFIRMED
        reason = (
            "merchant UPI technical failures run at %.2f%%, above %s at "
            "%.2f%%, but %s -- the merchant signal stands on its own and is "
            "not externally corroborated"
            % (sig.upi_technical_fail_pct, ref_name, ref_td, ext)
        )
    elif e_elev and not m_elev:
        status = Corroboration.MIXED
        reason = (
            "%s, but this merchant's UPI technical failures are %.2f%% and "
            "not elevated against %s at %.2f%% -- the ecosystem moved and "
            "this merchant did not"
            % (ext, sig.upi_technical_fail_pct, ref_name, ref_td)
        )
    else:
        status = Corroboration.NOT_APPLICABLE
        reason = (
            "neither the merchant's UPI technical failure rate (%.2f%%) nor "
            "NPCI's technical-decline reporting is elevated, so there is no "
            "technical-decline pattern to corroborate"
            % sig.upi_technical_fail_pct
        )

    _assert_no_causal_claim(reason)
    return CorroborationResult(
        status=status,
        reason=reason,
        merchant_technical_elevated=m_elev,
        ecosystem_technical_elevated=e_elev,
        merchant_technical_fail_pct=sig.upi_technical_fail_pct,
        ecosystem_technical_decline_pct=eco_td,
        member_technical_decline_pct=mem_td,
        baseline_technical_decline_pct=base_td,
        elevation_basis=basis,
    )


def _assert_no_causal_claim(text: str) -> None:
    for pat in FORBIDDEN:
        if pat.search(text):
            raise AssertionError(
                "NPCI evidence tried to make a causal claim: %r" % text
            )


# --------------------------------------------------------------------------
# the one call the rest of the system makes
# --------------------------------------------------------------------------


def evidence_for(
    merchant_id: str,
    txns: list,
    *,
    period: str | None = None,
    observed_period: str | None = None,
    snap: NPCISnapshot | None = None,
    now: datetime | None = None,
) -> NPCIEvidence:
    """Build the evidence object, or explain why there isn't one.

    This never raises. Every failure path in §19 -- missing table, malformed
    rows, invalid percentages, negative volume, a future period, an unreadable
    snapshot -- lands on the same UNAVAILABLE object, and the caller carries on
    with merchant evidence alone.
    """
    try:
        if snap is None:
            snap = current_snapshot(period, now=now)
        members = _MEMBERS_BY_SNAPSHOT.get(snap.snapshot_id)
        if members is None:
            members = _members_for(snap.period)
        sig = signal_from_transactions(merchant_id, txns, members)
        rel = assess_relevance(sig, snap, observed_period)
        cor = corroborate(sig, snap, rel)
        if rel.level == Relevance.MEMBER and cor.status == Corroboration.CONSISTENT:
            rel = rel.model_copy(update={
                "level": Relevance.CORROBORATED,
                "label": Relevance.LABELS[Relevance.CORROBORATED],
            })
        return NPCIEvidence(
            available=True,
            freshness_status=snap.freshness(now),
            age_days=snap.age_days(now),
            provenance=snap.provenance,
            metrics=snap.metrics,
            baseline=snap.baseline,
            relevance=rel,
            corroboration=cor,
        )
    except (NPCIUnavailable, SourceChanged, OSError, ValueError) as exc:
        return unavailable(str(exc))
    except Exception as exc:  # never take the diagnosis down with us
        return unavailable("NPCI evidence could not be built: %s" % exc)


def evidence_for_merchant(
    merchant_id: str,
    *,
    period: str | None = None,
    observed_period: str | None = None,
    now: datetime | None = None,
) -> NPCIEvidence:
    """Evidence for a merchant by id, loading its committed batch.

    The convenience form for callers that hold a merchant id rather than a
    list of payments -- the read-only API, and the assistant when it is
    looking at a run diagnosed before evidence was recorded. Like
    `evidence_for`, it never raises: a missing batch is an UNAVAILABLE object,
    not an exception into someone else's request.
    """
    try:
        from .run import load_merchant

        m = load_merchant(merchant_id)
    except (Exception, SystemExit) as exc:
        # SystemExit, not just Exception: load_merchant is also a CLI entry
        # point and exits rather than raising when a batch file is missing.
        # SystemExit derives from BaseException, so a plain `except Exception`
        # let it straight through -- which turned "this merchant has no batch"
        # into a 500 on the read-only evidence endpoint and would have taken
        # the assistant down with it. Evidence degrades. It never propagates.
        return unavailable("merchant batch unavailable: %s" % type(exc).__name__)
    return evidence_for(
        merchant_id,
        list(m.transactions),
        period=period,
        observed_period=observed_period,
        now=now,
    )


def unavailable(reason: str) -> NPCIEvidence:
    return NPCIEvidence(
        available=False,
        freshness_status=Freshness.UNAVAILABLE,
        unavailable_reason=reason,
        corroboration=CorroborationResult(
            status=Corroboration.UNAVAILABLE,
            reason="no NPCI snapshot is available; the diagnosis stands on "
                   "merchant evidence alone",
            merchant_technical_elevated=False,
            ecosystem_technical_elevated=False,
        ),
    )


_MEMBERS: dict[str, dict[str, _Row]] = {}


def _members_for(period: str) -> dict[str, _Row]:
    """Normalised bank name -> NPCI's reported row for that member."""
    if period not in _MEMBERS:
        _MEMBERS[period] = {
            normalise_bank(r.bank): r for r in parse_rows(_table_text(), period)
        }
    return _MEMBERS[period]


# --------------------------------------------------------------------------
# verification, for Prove (§23)
# --------------------------------------------------------------------------


def verify_reference(ref: dict, *, snap: NPCISnapshot | None = None) -> dict:
    """Does the NPCI evidence a diagnosis recorded still match its source?

    Takes the provenance block a run stored and re-derives the snapshot from
    committed data. Deliberately offline: Prove must never depend on a live
    NPCI fetch (§23), only on the exact snapshot the diagnosis named.
    """
    if not isinstance(ref, dict):
        return {"ok": False, "snapshot_id": None, "checks": [
            {"key": "reference", "ok": False,
             "claimed": type(ref).__name__, "recomputed": "a provenance object"}
        ]}
    out = {"ok": False, "snapshot_id": ref.get("snapshot_id"), "checks": []}

    def check(key: str, ok: bool, claimed, recomputed) -> None:
        out["checks"].append({
            "key": key, "ok": bool(ok),
            "claimed": claimed, "recomputed": recomputed,
        })

    period = ref.get("period")
    if not valid_period(period or ""):
        check("period", False, period, "not a YYYY-MM period")
        return out
    try:
        snap = snap or build_snapshot(period)
    except NPCIUnavailable as exc:
        check("source", False, ref.get("source_hash"), str(exc))
        return out

    check("schema_version", ref.get("schema_version") == SCHEMA_VERSION,
          ref.get("schema_version"), SCHEMA_VERSION)
    check("period", ref.get("period") == snap.period, ref.get("period"),
          snap.period)
    check("source_hash", ref.get("source_hash") == snap.provenance.source_hash,
          ref.get("source_hash"), snap.provenance.source_hash)
    check("snapshot_id", ref.get("snapshot_id") == snap.snapshot_id,
          ref.get("snapshot_id"), snap.snapshot_id)
    check("source_capture",
          ref.get("source_capture", SOURCE_CAPTURE) == SOURCE_CAPTURE,
          ref.get("source_capture"), SOURCE_CAPTURE)
    out["ok"] = all(c["ok"] for c in out["checks"])
    return out


# --------------------------------------------------------------------------
# LLM-facing rendering (§15)
# --------------------------------------------------------------------------


def context_lines(ev: NPCIEvidence | None) -> list[str]:
    """Normalised, labelled, provenance-carrying. Never the raw table."""
    if ev is None or not ev.available:
        why = (ev.unavailable_reason if ev else None) or "not configured"
        return [
            "EXTERNAL EVIDENCE (NPCI)   UNAVAILABLE (%s)" % why,
            "  the diagnosis stands on merchant evidence alone",
        ]
    p, m, c, r = ev.provenance, ev.metrics, ev.corroboration, ev.relevance
    lines = [
        "EXTERNAL EVIDENCE (NPCI)   scope=ecosystem  period=%s  freshness=%s"
        % (p.period, ev.freshness_status),
        "  NPCI APPROVAL / ECOSYSTEM        %.2f%%" % m.approval_rate_pct,
        "  NPCI TECHNICAL DECLINE / ECOSYSTEM  %.2f%%"
        % m.technical_decline_rate_pct,
        "  NPCI BUSINESS DECLINE / ECOSYSTEM   %.2f%%"
        % m.business_decline_rate_pct,
        "  NPCI UPI VOLUME / ECOSYSTEM      %.2f mn transactions"
        % m.transaction_volume_mn,
    ]
    if ev.baseline:
        lines.append(
            "  NPCI TECHNICAL DECLINE / BASELINE %s  %.2f%%"
            % (ev.baseline.period, ev.baseline.technical_decline_rate_pct)
        )
    lines += [
        "  EXTERNAL CORROBORATION           %s" % c.status,
        "  corroboration reason             %s" % c.reason,
        "  evidence relevance               LEVEL %d %s" % (r.level, r.label),
        "  source                           NPCI %s, snapshot %s"
        % (p.dataset, p.snapshot_id),
        "  RULE  %s" % NO_CAUSAL_CLAIM,
        "  RULE  NPCI evidence is ecosystem-scope context. It cannot "
        "establish causality for one payment and cannot authorise recovery.",
    ]
    if ev.freshness_status == Freshness.STALE:
        lines.append(
            "  RULE  This evidence is STALE (%d days old). Quote it only as "
            "labelled historical context." % (ev.age_days or 0)
        )
    return lines
