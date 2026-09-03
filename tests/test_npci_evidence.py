"""External evidence has to be safe before it is useful.

NPCI data is the only thing in this system that comes from outside it, and the
whole risk profile follows from that. It can be absent, stale, malformed, or
quietly different from what a diagnosis recorded last month -- and none of
those may take the recovery pipeline down or, worse, change what the system
decides to do with someone's money.

So these tests are mostly about what NPCI evidence is NOT allowed to do:

  * it may not authorise or deny anything (test_policy_*, test_recovery_*)
  * it may not enter the ledger or move a reconciliation (test_ledger_*)
  * it may not make a causal claim about one payment (test_no_causal_*)
  * it may not fail loudly enough to break a diagnosis (test_unavailable_*)
  * it may not silently change under a historical run (test_reproducib*)

The corroboration tests are deliberately split between real committed data and
constructed snapshots. Against the shipped 2025-08 capture no merchant reaches
CONSISTENT -- the data simply does not show it, and a test that forced it
would be testing a lie. The CONSISTENT and MIXED paths are exercised on
snapshots built for the purpose, which tests the logic without claiming
anything about the real ecosystem.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from doctor import npci_evidence as npci
from doctor.run import load_merchant

NOW = datetime(2025, 9, 15, tzinfo=timezone.utc)   # 15 days after 2025-08 closed
LATER = datetime(2026, 9, 2, tzinfo=timezone.utc)  # a year on

GOOD_CSV = """period,bank,total_volume_mn,approved_pct,bd_pct,td_pct
2025-08,Alpha Bank,100.0,95.00,4.50,0.50
2025-08,Beta Bank,100.0,93.00,6.00,1.00
2025-08,Gamma Bank,200.0,90.00,9.00,1.00
2025-08,Delta Bank,50.0,96.00,3.50,0.50
2025-08,Epsilon Bank,50.0,94.00,5.00,1.00
2025-07,Alpha Bank,100.0,95.00,4.50,0.50
2025-07,Beta Bank,100.0,93.00,6.00,1.00
2025-07,Gamma Bank,200.0,90.00,9.00,1.00
2025-07,Delta Bank,50.0,96.00,3.50,0.50
2025-07,Epsilon Bank,50.0,94.00,5.00,1.00
"""

#: Same August, but a July in which technical declines were a fifth of what
#: they became. Used only where the ECOSYSTEM side must be elevated.
HOT_CSV = GOOD_CSV.replace("4.50,0.50\n2025-07", "4.50,0.50\n2025-07")
for _a, _b in (("2025-07,Alpha Bank,100.0,95.00,4.50,0.50",
                "2025-07,Alpha Bank,100.0,95.00,4.90,0.10"),
               ("2025-07,Beta Bank,100.0,93.00,6.00,1.00",
                "2025-07,Beta Bank,100.0,93.00,6.80,0.20"),
               ("2025-07,Gamma Bank,200.0,90.00,9.00,1.00",
                "2025-07,Gamma Bank,200.0,90.00,9.80,0.20"),
               ("2025-07,Delta Bank,50.0,96.00,3.50,0.50",
                "2025-07,Delta Bank,50.0,96.00,3.90,0.10"),
               ("2025-07,Epsilon Bank,50.0,94.00,5.00,1.00",
                "2025-07,Epsilon Bank,50.0,94.00,5.80,0.20")):
    HOT_CSV = HOT_CSV.replace(_a, _b)


def _snap(text: str = GOOD_CSV, period: str = "2025-08", **kw):
    return npci.build_snapshot(period, text=text, now=NOW, **kw)


class _Txn:
    """The two attributes the signal reads. Nothing else is touched."""

    def __init__(self, method="upi", succeeded=True, error_class=None,
                 bank="Alpha Bank"):
        self.method, self.succeeded = method, succeeded
        self.error_class, self.bank = error_class, bank


def _batch(n_upi=100, technical=0, business=0, bank="Alpha Bank", n_card=0):
    out = [_Txn(bank=bank) for _ in range(n_upi - technical - business)]
    out += [_Txn(succeeded=False, error_class="technical", bank=bank)
            for _ in range(technical)]
    out += [_Txn(succeeded=False, error_class="soft_decline", bank=bank)
            for _ in range(business)]
    out += [_Txn(method="card", bank=bank) for _ in range(n_card)]
    return out


# --------------------------------------------------------------------------
# 1-5  parsing, validation, units, hashing
# --------------------------------------------------------------------------


def test_parser_reads_a_valid_dataset():
    rows = npci.parse_rows(GOOD_CSV, "2025-08")
    assert [r.bank for r in rows] == [
        "Alpha Bank", "Beta Bank", "Delta Bank", "Epsilon Bank", "Gamma Bank"
    ]
    assert rows[0].approved_pct == 95.0


def test_parser_reads_the_real_committed_table():
    rows = npci.parse_rows(npci._table_text(), "2025-08")
    assert len(rows) == 50, "NPCI publishes a top-50 remitter table"
    for r in rows:
        assert 0.0 <= r.approved_pct <= 100.0
        assert abs(r.approved_pct + r.bd_pct + r.td_pct - 100.0) <= npci.SUM_TOLERANCE_PCT


@pytest.mark.parametrize("bad,why", [
    ("period,bank\n2025-08,Alpha\n", "missing the metric columns"),
    ("not,a,csv,at,all\n", "no period column"),
    ("", "empty"),
])
def test_parser_refuses_malformed_datasets(bad, why):
    try:
        rows = npci.parse_rows(bad, "2025-08")
    except npci.NPCIUnavailable:
        return                      # refused outright, which is correct
    assert rows == [], why          # or produced nothing, also correct


@pytest.mark.parametrize("value", ["nan", "NaN", "inf", "-inf", "Infinity"])
def test_non_finite_percentages_are_refused(value):
    """The red team reached auto_execute with a NaN once. Not through here."""
    csv = GOOD_CSV + "2025-08,Rogue Bank,100.0,%s,4.50,0.50\n" % value
    assert all(r.bank != "Rogue Bank" for r in npci.parse_rows(csv, "2025-08"))


@pytest.mark.parametrize("row,why", [
    ("2025-08,Rogue,100.0,120.00,4.50,0.50\n", "approved over 100"),
    ("2025-08,Rogue,100.0,-5.00,4.50,0.50\n", "negative percentage"),
    ("2025-08,Rogue,-100.0,95.00,4.50,0.50\n", "negative volume"),
    ("2025-08,Rogue,100.0,95.00,20.00,9.00\n", "shares sum to 124"),
    ("2025-08,,100.0,95.00,4.50,0.50\n", "no bank name"),
])
def test_impossible_rows_are_dropped_not_repaired(row, why):
    rows = npci.parse_rows(GOOD_CSV + row, "2025-08")
    assert all(r.bank != "Rogue" for r in rows), why
    assert len(rows) == 5, "the good rows survive alongside"


def test_the_anomaly_the_repo_already_quarantined_is_still_refused():
    """data/npci/anomalies.csv records a real 124.59% row. Same guard here."""
    bad = GOOD_CSV + "2025-08,Tamilnad Mercantile Bank,28.12,124.22,0.08,0.29\n"
    assert all("Tamilnad" not in r.bank for r in npci.parse_rows(bad, "2025-08"))


def test_units_are_in_the_field_names():
    """§5: no field called `rate`, `volume` or `value`."""
    fields = set(npci.EcosystemMetrics.model_fields) | set(
        npci.BaselineMetrics.model_fields)
    assert not ({"rate", "volume", "value", "pct", "amount"} & fields)
    for f in fields:
        if "pct" in f or "rate" in f:
            assert f.endswith("_pct"), f
    assert "transaction_volume_mn" in fields


def test_percentages_are_all_on_the_same_0_to_100_scale():
    """§5 forbids mixing 0.05 and 5.0. Everything here is percentage points."""
    m = _snap().metrics
    assert 1.0 < m.approval_rate_pct <= 100.0
    total = (m.approval_rate_pct + m.technical_decline_rate_pct
             + m.business_decline_rate_pct)
    assert abs(total - 100.0) <= npci.SUM_TOLERANCE_PCT


def test_source_hash_is_stable_and_content_addressed():
    rows = npci.parse_rows(GOOD_CSV, "2025-08")
    h1 = npci.source_hash(rows, "2025-08")
    assert h1 == npci.source_hash(npci.parse_rows(GOOD_CSV, "2025-08"), "2025-08")
    assert len(h1) == 64
    moved = GOOD_CSV.replace("95.00,4.50,0.50", "94.00,5.50,0.50")
    assert npci.source_hash(npci.parse_rows(moved, "2025-08"), "2025-08") != h1


def test_source_capture_matches_the_fetch_script():
    """Provenance that drifts from the fetcher is provenance that lies."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    src = (root / "scripts" / "fetch_data.py").read_text(encoding="utf-8")
    found = re.search(r'NPCI_CAPTURE = "(\d+)"', src)
    assert found and found.group(1) == npci.SOURCE_CAPTURE


# --------------------------------------------------------------------------
# 6-7  snapshots
# --------------------------------------------------------------------------


def test_snapshot_carries_every_provenance_field_the_brief_requires():
    p = _snap().provenance
    for field in ("source", "source_url", "dataset", "period", "as_of",
                  "fetched_at", "schema_version", "source_hash", "snapshot_id"):
        assert getattr(p, field), field
    assert p.source == "NPCI"
    assert p.dataset == "UPI_ECOSYSTEM_STATISTICS"
    assert p.source_url.startswith("https://www.npci.org.in/")


def test_snapshot_id_embeds_the_hash_so_a_changed_source_is_a_new_snapshot():
    a = _snap()
    b = _snap(GOOD_CSV.replace("95.00,4.50,0.50", "91.00,8.50,0.50"))
    assert a.snapshot_id != b.snapshot_id
    assert a.provenance.source_hash[:12] in a.snapshot_id


def test_duplicate_snapshot_is_reused_not_rewritten(tmp_path, monkeypatch):
    monkeypatch.setattr(npci, "SNAPSHOT_DIR", tmp_path)
    snap = _snap()
    first = npci.persist(snap)
    before = first.read_bytes()
    again = npci.persist(_snap())
    assert again == first and again.read_bytes() == before


def test_a_snapshot_id_can_never_be_silently_overwritten(tmp_path, monkeypatch):
    """Historical evidence is immutable. If bytes under an id ever differ,
    refuse -- do not serve whichever version landed last."""
    monkeypatch.setattr(npci, "SNAPSHOT_DIR", tmp_path)
    snap = _snap()
    npci.persist(snap)
    tampered = snap.model_copy(update={
        "metrics": snap.metrics.model_copy(update={"approval_rate_pct": 10.0})
    })
    with pytest.raises(npci.SourceChanged):
        npci.persist(tampered)


def test_baseline_is_one_prior_period_and_no_more():
    """§scope: one comparison period, not a historical archive."""
    snap = _snap()
    assert snap.baseline is not None
    assert snap.baseline.period == "2025-07"
    assert not hasattr(snap, "history")


def test_prev_period_wraps_the_year():
    assert npci.prev_period("2025-01") == "2024-12"
    assert npci.prev_period("2025-08") == "2025-07"


# --------------------------------------------------------------------------
# 8  freshness
# --------------------------------------------------------------------------


def test_fresh_within_the_publication_window():
    assert _snap().freshness(NOW) == npci.Freshness.FRESH
    assert _snap().age_days(NOW) == 15


def test_stale_is_reported_not_hidden():
    snap = _snap()
    assert snap.freshness(LATER) == npci.Freshness.STALE
    assert snap.age_days(LATER) > npci.FRESH_MAX_DAYS


def test_the_shipped_capture_is_honestly_stale_today():
    """The repo pins a 2025-09 capture. Against a 2026 clock that is stale,
    and the system says so rather than widening the window until it is not."""
    ev = npci.evidence_for("m", _batch(), snap=_snap(), now=LATER)
    assert ev.freshness_status == npci.Freshness.STALE
    assert ev.available, "stale evidence is still usable, just labelled"
    assert any("STALE" in line for line in npci.context_lines(ev))


def test_stale_evidence_is_labelled_for_the_model():
    lines = npci.context_lines(npci.evidence_for("m", _batch(), snap=_snap(),
                                                 now=LATER))
    assert any("labelled historical context" in ln for ln in lines)


# --------------------------------------------------------------------------
# 9, 19  unavailable and the whole failure matrix
# --------------------------------------------------------------------------


def test_unavailable_object_is_well_formed():
    ev = npci.unavailable("no table")
    assert ev.available is False
    assert ev.freshness_status == npci.Freshness.UNAVAILABLE
    assert ev.corroboration.status == npci.Corroboration.UNAVAILABLE
    assert ev.metrics is None and ev.provenance is None
    assert "no table" in ev.unavailable_reason


@pytest.mark.parametrize("period", ["2999-01", "not-a-period", "", "2025-13",
                                    "2025-1", None])
def test_bad_periods_are_refused_never_guessed(period):
    with pytest.raises(npci.NPCIUnavailable):
        npci.build_snapshot(period, text=GOOD_CSV, now=NOW)


def test_a_future_period_is_refused():
    with pytest.raises(npci.NPCIUnavailable):
        npci.build_snapshot("2025-08", text=GOOD_CSV,
                            now=datetime(2025, 1, 1, tzinfo=timezone.utc))


def test_too_few_members_is_refused_rather_than_averaged():
    thin = "\n".join(GOOD_CSV.splitlines()[:3]) + "\n"
    with pytest.raises(npci.NPCIUnavailable):
        npci.build_snapshot("2025-08", text=thin, now=NOW)


def test_zero_volume_cannot_divide_by_zero():
    zero = GOOD_CSV.replace("100.0,", "0.0,").replace("200.0,", "0.0,")
    zero = zero.replace("50.0,", "0.0,")
    with pytest.raises(npci.NPCIUnavailable):
        npci.build_snapshot("2025-08", text=zero, now=NOW)


@pytest.mark.parametrize("boom", [
    npci.NPCIUnavailable("gone"),
    OSError("network unreachable"),
    TimeoutError("timed out"),
    ValueError("garbage"),
    RuntimeError("something nobody predicted"),
])
def test_evidence_for_never_raises_whatever_goes_wrong(monkeypatch, boom):
    """§19: a diagnosis must survive every NPCI failure mode."""
    def explode(*a, **k):
        raise boom
    monkeypatch.setattr(npci, "current_snapshot", explode)
    ev = npci.evidence_for("cloudsync", _batch())
    assert ev.available is False
    assert ev.freshness_status == npci.Freshness.UNAVAILABLE
    assert ev.corroboration.status == npci.Corroboration.UNAVAILABLE


def test_missing_table_degrades_instead_of_crashing(monkeypatch):
    monkeypatch.setattr(npci, "NPCI_DIR", npci.ROOT / "nowhere")
    npci.reset_cache()
    try:
        ev = npci.evidence_for("cloudsync", _batch())
        assert ev.available is False
        assert "not present" in (ev.unavailable_reason or "")
    finally:
        npci.reset_cache()


def test_unavailable_evidence_still_renders_for_the_model():
    lines = npci.context_lines(npci.unavailable("network failure"))
    assert any("UNAVAILABLE" in ln for ln in lines)
    assert any("merchant evidence alone" in ln for ln in lines)


def test_unknown_schema_version_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(npci, "SNAPSHOT_DIR", tmp_path)
    snap = _snap()
    npci.persist(snap)
    p = tmp_path / (snap.snapshot_id + ".json")
    data = json.loads(p.read_text(encoding="utf-8"))
    data["provenance"]["schema_version"] = "99"
    p.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(npci.NPCIUnavailable):
        npci.load_snapshot(snap.snapshot_id)


# --------------------------------------------------------------------------
# 10, 18  determinism and reproducibility
# --------------------------------------------------------------------------


def test_normalisation_is_deterministic():
    a, b = _snap(), _snap()
    assert a.model_dump() == b.model_dump()
    assert a.provenance.source_hash == b.provenance.source_hash


def test_the_real_snapshot_is_deterministic_across_rebuilds():
    npci.reset_cache()
    a = npci.build_snapshot("2025-08")
    npci.reset_cache()
    b = npci.build_snapshot("2025-08")
    assert a.model_dump() == b.model_dump()


def test_row_order_does_not_change_the_hash():
    lines = GOOD_CSV.strip().splitlines()
    shuffled = "\n".join([lines[0]] + list(reversed(lines[1:]))) + "\n"
    assert (npci.source_hash(npci.parse_rows(shuffled, "2025-08"), "2025-08")
            == npci.source_hash(npci.parse_rows(GOOD_CSV, "2025-08"), "2025-08"))


def test_a_snapshot_round_trips_through_disk(tmp_path, monkeypatch):
    """§18: reproducing a historical diagnosis means re-reading its snapshot."""
    monkeypatch.setattr(npci, "SNAPSHOT_DIR", tmp_path)
    snap = _snap()
    npci.persist(snap)
    assert npci.load_snapshot(snap.snapshot_id).model_dump() == snap.model_dump()


def test_evidence_is_deterministic_for_the_same_inputs():
    snap, batch = _snap(), _batch(technical=5)
    a = npci.evidence_for("m", batch, snap=snap, now=NOW)
    b = npci.evidence_for("m", batch, snap=snap, now=NOW)
    assert a.model_dump() == b.model_dump()


def test_verify_reference_detects_a_tampered_hash():
    snap = npci.build_snapshot("2025-08")
    ref = json.loads(snap.provenance.model_dump_json())
    assert npci.verify_reference(ref)["ok"] is True
    ref["source_hash"] = "0" * 64
    out = npci.verify_reference(ref)
    assert out["ok"] is False
    assert any(c["key"] == "source_hash" and not c["ok"] for c in out["checks"])


def test_verify_reference_does_not_need_the_network(monkeypatch):
    """§23: Prove must verify with the network unplugged."""
    import urllib.request

    def forbidden(*a, **k):
        raise AssertionError("verification tried to reach the network")
    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    snap = npci.build_snapshot("2025-08")
    ref = json.loads(snap.provenance.model_dump_json())
    assert npci.verify_reference(ref)["ok"] is True


# --------------------------------------------------------------------------
# 9-13  relevance and corroboration
# --------------------------------------------------------------------------


def test_ecosystem_evidence_is_not_stapled_to_a_card_only_merchant():
    """§9: relevance is earned, not assumed."""
    sig = npci.signal_from_transactions(
        "m", _batch(n_upi=2, n_card=98), npci._members_for("2025-08"))
    rel = npci.assess_relevance(sig, _snap())
    assert rel.level == npci.Relevance.NONE
    assert "below" in rel.reasons[0]


def test_bank_relevance_when_the_merchant_banks_are_npci_members():
    members = {npci.normalise_bank(r.bank): r
               for r in npci.parse_rows(GOOD_CSV, "2025-08")}
    sig = npci.signal_from_transactions("m", _batch(bank="Alpha Bank"), members)
    assert sig.matched_members == ["Alpha Bank"]
    assert sig.matched_share_pct == 100.0
    rel = npci.assess_relevance(sig, _snap(), observed_period="2025-08")
    assert rel.level == npci.Relevance.MEMBER


def test_unknown_banks_fall_back_to_ecosystem_scope_never_invented():
    """§9: do not invent bank information."""
    members = {npci.normalise_bank(r.bank): r
               for r in npci.parse_rows(GOOD_CSV, "2025-08")}
    sig = npci.signal_from_transactions(
        "m", _batch(bank="Not An NPCI Member Bank"), members)
    assert sig.matched_members == []
    assert sig.member_technical_decline_pct is None
    rel = npci.assess_relevance(sig, _snap(), observed_period="2025-08")
    assert rel.level == npci.Relevance.PERIOD


def test_psp_matching_is_never_claimed_because_there_is_no_psp_field():
    """The payment model has no payer/payee PSP identifier, so the system must
    say so rather than approximate one from the bank."""
    from doctor.features import Transaction

    assert not {f for f in Transaction.model_fields if "psp" in f.lower()}
    members = {npci.normalise_bank(r.bank): r
               for r in npci.parse_rows(GOOD_CSV, "2025-08")}
    sig = npci.signal_from_transactions("m", _batch(), members)
    rel = npci.assess_relevance(sig, _snap(), observed_period="2025-08")
    assert any("PSP-level matching is not attempted" in x for x in rel.reasons)


def test_period_mismatch_drops_to_broad_ecosystem_scope():
    members = {npci.normalise_bank(r.bank): r
               for r in npci.parse_rows(GOOD_CSV, "2025-08")}
    sig = npci.signal_from_transactions("m", _batch(), members)
    rel = npci.assess_relevance(sig, _snap(), observed_period="2024-01")
    assert rel.level == npci.Relevance.ECOSYSTEM
    assert any("2024-01" in x for x in rel.reasons)


def test_corroboration_consistent_when_both_sides_are_elevated():
    """Constructed, and labelled as constructed: NPCI's own rate triples
    month over month while the merchant runs hot on the same rail."""
    snap = _snap(HOT_CSV)
    ev = npci.evidence_for("m", _batch(technical=20), snap=snap, now=NOW)
    assert ev.corroboration.status == npci.Corroboration.CONSISTENT
    assert ev.corroboration.merchant_technical_elevated
    assert ev.corroboration.ecosystem_technical_elevated
    assert ev.relevance.level == npci.Relevance.CORROBORATED


def test_corroboration_not_confirmed_when_only_the_merchant_is_elevated():
    """§12: do not force agreement. This is the honest disagreement case."""
    ev = npci.evidence_for("m", _batch(technical=20), snap=_snap(), now=NOW)
    assert ev.corroboration.status == npci.Corroboration.NOT_CONFIRMED
    assert ev.corroboration.merchant_technical_elevated is True
    assert ev.corroboration.ecosystem_technical_elevated is False
    assert "not externally corroborated" in ev.corroboration.reason


def test_conflicting_evidence_keeps_the_merchant_number_intact():
    """The disagreement is recorded; the merchant's own measurement stands."""
    ev = npci.evidence_for("m", _batch(technical=20), snap=_snap(), now=NOW)
    assert ev.corroboration.merchant_technical_fail_pct == 20.0
    assert ev.corroboration.ecosystem_technical_decline_pct is not None
    assert ev.available is True


def test_mixed_when_the_ecosystem_moved_and_the_merchant_did_not():
    members = {npci.normalise_bank(r.bank): r
               for r in npci.parse_rows(GOOD_CSV, "2025-08")}
    sig = npci.signal_from_transactions("m", _batch(technical=0), members)
    snap = _snap(HOT_CSV)   # ecosystem technical declines up sharply on July
    rel = npci.assess_relevance(sig, snap, observed_period="2025-08")
    cor = npci.corroborate(sig, snap, rel)
    assert cor.status == npci.Corroboration.MIXED
    assert cor.ecosystem_technical_elevated and not cor.merchant_technical_elevated


def test_not_applicable_when_there_is_nothing_to_corroborate():
    ev = npci.evidence_for("m", _batch(technical=0), snap=_snap(), now=NOW)
    assert ev.corroboration.status == npci.Corroboration.NOT_APPLICABLE


def test_elevation_basis_names_the_comparison_that_fired():
    ev = npci.evidence_for("m", _batch(technical=20), snap=_snap(), now=NOW)
    assert ev.corroboration.elevation_basis == "none"


def test_relevance_levels_are_scope_not_permission():
    """§10: nothing may read a relevance level to authorise anything."""
    import subprocess
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    hits = subprocess.run(
        ["git", "grep", "-n", "-E",
         r"Relevance\.|relevance\.level|evidence_class", "--", "src/"],
        cwd=root, capture_output=True, text=True).stdout.splitlines()
    for line in hits:
        path = line.split(":", 1)[0]
        assert "policy" not in path and "plan.py" not in path, line
        assert "recovery.py" not in path and "approvals" not in path, line


# --------------------------------------------------------------------------
# 13, 17  no causal claims
# --------------------------------------------------------------------------


@pytest.mark.parametrize("batch", [
    _batch(technical=0), _batch(technical=20), _batch(technical=50),
    _batch(technical=5, business=30), _batch(n_upi=10, n_card=90),
])
def test_no_reason_string_ever_makes_a_causal_claim(batch):
    ev = npci.evidence_for("m", batch, snap=_snap(), now=NOW)
    text = " ".join(
        [ev.corroboration.reason] + (ev.relevance.reasons if ev.relevance else [])
    )
    for pattern in npci.FORBIDDEN:
        assert not pattern.search(text), text


def test_the_no_causal_claim_note_is_on_every_evidence_object():
    for ev in (npci.evidence_for("m", _batch(), snap=_snap(), now=NOW),
               npci.unavailable("gone")):
        assert "do not" in ev.note.lower()
        assert "cause" in ev.note.lower()


def test_the_guard_actually_fires_on_a_causal_sentence():
    """A guard nobody has seen fail is a guard nobody should trust."""
    with pytest.raises(AssertionError):
        npci._assert_no_causal_claim("NPCI caused the failure")
    with pytest.raises(AssertionError):
        npci._assert_no_causal_claim("this failed because of NPCI downtime")


def test_context_lines_tell_the_model_what_it_may_not_conclude():
    lines = npci.context_lines(npci.evidence_for("m", _batch(technical=20),
                                                 snap=_snap(), now=NOW))
    blob = "\n".join(lines)
    assert "cannot establish causality" in blob
    assert "cannot authorise recovery" in blob
    assert "scope=ecosystem" in blob


# --------------------------------------------------------------------------
# 16, 18  assistant provenance
# --------------------------------------------------------------------------


def test_assistant_context_separates_external_from_merchant_evidence():
    from doctor.assistant import build_context
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    rec = json.loads((root / "data" / "runs" / "run_beec9668.json")
                     .read_text(encoding="utf-8"))
    ctx = build_context(rec)
    assert "EXTERNAL EVIDENCE (NPCI)" in ctx
    # the measured/projected separation the earlier defect was about survives
    assert "RECOVERED / MEASURED" in ctx
    assert "EXPECTED RECOVERY / PROJECTED" in ctx
    # and external evidence comes after them, not mixed in
    assert ctx.index("RECOVERED / MEASURED") < ctx.index("EXTERNAL EVIDENCE")


def test_assistant_is_told_npci_has_no_authority():
    from doctor.assistant import SYSTEM

    assert "EXTERNAL EVIDENCE (NPCI)" in SYSTEM
    assert "no authority" in SYSTEM
    assert "aggregate ecosystem data" in SYSTEM


def test_assistant_context_labels_evidence_derived_after_the_fact():
    """A run diagnosed before this integration must not appear to have
    recorded a snapshot it never saw."""
    from doctor.assistant import build_context
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    rec = json.loads((root / "data" / "runs" / "run_beec9668.json")
                     .read_text(encoding="utf-8"))
    assert "external_evidence" not in rec["report"]
    assert "not part of that run's record" in build_context(rec)


# --------------------------------------------------------------------------
# 20-23  the things NPCI must not touch
# --------------------------------------------------------------------------


def test_the_adapter_imports_nothing_from_the_authority_chain():
    """§26: NPCI sits beside diagnosis, never above policy or execution."""
    from pathlib import Path

    src = (Path(npci.__file__)).read_text(encoding="utf-8")
    for banned in ("from .policy", "import policy", "from .plan", "import plan",
                   "from .recovery", "import recovery", "from .ledger",
                   "import ledger", "chitragupta"):
        assert banned not in src, banned


def test_policy_never_sees_npci_evidence():
    """The kernel's inputs are the action and the mandate. Nothing else."""
    from pathlib import Path
    import chitragupta.policy as policy

    src = Path(policy.__file__).read_text(encoding="utf-8")
    for word in ("npci", "NPCI", "external_evidence", "corroborat"):
        assert word not in src, word


def test_recovery_and_plan_never_see_npci_evidence():
    from pathlib import Path

    from doctor import plan, recovery

    for mod in (plan, recovery):
        src = Path(mod.__file__).read_text(encoding="utf-8")
        for word in ("npci_evidence", "external_evidence", "corroborat"):
            assert word not in src, "%s in %s" % (word, mod.__name__)


def test_no_npci_entry_ever_reaches_the_ledger():
    """The ledger's invariant is that every entry is a payment decision
    carrying a gate decision. Evidence rows would break reconcile.py."""
    from pathlib import Path

    from doctor import reconcile

    src = Path(reconcile.__file__).read_text(encoding="utf-8")
    assert "npci" not in src.lower()

    root = Path(__file__).resolve().parents[1]
    for run in sorted((root / "data" / "runs").glob("run_*.json")):
        rec = json.loads(run.read_text(encoding="utf-8"))
        for entry in rec["report"]["ledger"]:
            assert entry.get("gate_decision"), run.name


def test_committed_ledgers_still_reconcile():
    from pathlib import Path

    from doctor.reconcile import reconcile_run_id

    root = Path(__file__).resolve().parents[1]
    for run in sorted((root / "data" / "runs").glob("run_*.json")):
        out = reconcile_run_id(run.stem)
        assert out.ok, "%s: %s" % (run.stem, [c for c in out.checks if not c.ok])


def test_prove_ignores_runs_that_recorded_no_external_evidence():
    from pathlib import Path

    from doctor.prove import verify_external_evidence

    root = Path(__file__).resolve().parents[1]
    rec = json.loads((root / "data" / "runs" / "run_beec9668.json")
                     .read_text(encoding="utf-8"))
    out = verify_external_evidence(rec)
    assert out["recorded"] is False and out["ok"] is True


def test_prove_verifies_a_run_that_did_record_evidence():
    from doctor.prove import verify_external_evidence

    ev = npci.evidence_for_merchant("cloudsync")
    rec = {"report": {"external_evidence": json.loads(ev.model_dump_json())}}
    out = verify_external_evidence(rec)
    assert out["recorded"] is True and out["ok"] is True


def test_prove_catches_a_run_whose_evidence_no_longer_matches():
    from doctor.prove import verify_external_evidence

    ev = json.loads(npci.evidence_for_merchant("cloudsync").model_dump_json())
    ev["provenance"]["source_hash"] = "f" * 64
    out = verify_external_evidence({"report": {"external_evidence": ev}})
    assert out["ok"] is False


def test_sealed_challenges_do_not_contain_npci_evidence():
    """§23: adding external evidence must not change what a challenge seals."""
    from pathlib import Path
    import inspect

    from doctor import prove

    src = inspect.getsource(prove._sealed_payload)
    assert "npci" not in src.lower() and "external" not in src.lower()


# --------------------------------------------------------------------------
# 24-25  security
# --------------------------------------------------------------------------


def test_the_adapter_needs_no_credentials():
    from pathlib import Path

    src = Path(npci.__file__).read_text(encoding="utf-8")
    for word in ("api_key", "API_KEY", "secret", "SECRET", "token", "TOKEN",
                 "password", "Authorization", "getenv", "environ"):
        assert word not in src, word


def test_the_evidence_object_leaks_no_filesystem_paths():
    """§17: this object is served over HTTP."""
    ev = npci.evidence_for_merchant("cloudsync")
    blob = ev.model_dump_json()
    for leak in ("C:\\\\", "/home/", "/Users/", "\\\\Users", "buildathon",
                 "data/npci", "data\\\\npci", ".csv", "site-packages"):
        assert leak not in blob, leak


def test_the_api_response_leaks_nothing_either():
    from fastapi.testclient import TestClient

    from doctor.api import app

    body = TestClient(app).get("/api/external/npci/cloudsync").text
    for leak in ("C:\\\\", "/Users/", "buildathon", "site-packages",
                 "rzp_test", "rzp_live", "sk_", "Bearer "):
        assert leak not in body, leak


def test_external_endpoints_are_read_only():
    from doctor.api import app

    for route in app.routes:
        path = getattr(route, "path", "")
        if "/api/external/" in path:
            assert set(getattr(route, "methods", set())) <= {"GET", "HEAD"}, path


def test_a_hostile_csv_cannot_inject_anything():
    """External text is data. It is never formatted into a decision."""
    nasty = GOOD_CSV + (
        '2025-08,"<script>alert(1)</script>",100.0,95.00,4.50,0.50\n'
        '2025-08,../../etc/passwd,100.0,95.00,4.50,0.50\n'
        "2025-08,'; DROP TABLE runs; --,100.0,95.00,4.50,0.50\n"
    )
    snap = npci.build_snapshot("2025-08", text=nasty, now=NOW)
    # the rows parse as bank names and change nothing but the hash
    assert snap.metrics.members_reported == 8
    assert 0.0 <= snap.metrics.approval_rate_pct <= 100.0


def test_api_404s_for_an_unknown_merchant():
    from fastapi.testclient import TestClient

    from doctor.api import app

    assert TestClient(app).get("/api/external/npci/nosuch").status_code == 404


# --------------------------------------------------------------------------
# the real committed data, end to end
# --------------------------------------------------------------------------


def test_every_shipped_merchant_gets_a_well_formed_verdict():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    ids = sorted(p.stem[len("merchant_"):]
                 for p in (root / "data" / "synthetic").glob("merchant_*.json"))
    assert len(ids) >= 8
    for mid in ids:
        ev = npci.evidence_for_merchant(mid)
        assert ev.available is True
        assert ev.corroboration.status in {
            npci.Corroboration.CONSISTENT, npci.Corroboration.NOT_CONFIRMED,
            npci.Corroboration.MIXED, npci.Corroboration.NOT_APPLICABLE,
        }
        assert ev.provenance.period == "2025-08"
        assert ev.relevance.level >= npci.Relevance.ECOSYSTEM


def test_the_shipped_data_does_not_corroborate_and_that_is_recorded_honestly():
    """Against the pinned 2025-08 capture no merchant reaches CONSISTENT.

    Not because the code refuses to say it, but because the numbers do not
    support it. This test pins those numbers so the verdict is auditable.
    """
    from pathlib import Path

    statuses = set()
    root = Path(__file__).resolve().parents[1]
    for p in sorted((root / "data" / "synthetic").glob("merchant_*.json")):
        statuses.add(npci.evidence_for_merchant(
            p.stem[len("merchant_"):]).corroboration.status)
    assert npci.Corroboration.CONSISTENT not in statuses
    assert statuses <= {npci.Corroboration.NOT_CONFIRMED,
                        npci.Corroboration.NOT_APPLICABLE}


def test_the_external_half_of_corroboration_is_genuinely_absent():
    """§10: the guard against tuning a CONSISTENT into existence.

    CONSISTENT needs BOTH halves. The merchant half varies by merchant, but
    the external half is a property of the capture itself, and on this capture
    it is absent by a wide margin:

      * ecosystem technical declines moved 0.4316% -> 0.5429% month over
        month. That is a ratio of ~1.26, not the 1.5 that counts as elevated.
      * every shipped merchant's banks sit BELOW the ecosystem mean, so the
        member-level comparison cannot fire either.

    Both numbers are asserted here. If someone lowers ELEVATION_RATIO until
    the demo shows agreement, the ratio assertion below fails and says so.
    """
    snap = npci.build_snapshot("2025-08")
    eco = snap.metrics.technical_decline_rate_pct
    base = snap.baseline.technical_decline_rate_pct

    assert round(eco, 4) == 0.5429, "the pinned capture changed"
    assert round(base, 4) == 0.4316, "the pinned baseline changed"

    moved = eco / base
    assert 1.2 < moved < 1.3, "period-over-period movement is %.3f" % moved
    assert moved < npci.ELEVATION_RATIO, (
        "ELEVATION_RATIO has been lowered to %.3f, which would manufacture "
        "agreement the 2025-08 capture does not support (movement %.3f)"
        % (npci.ELEVATION_RATIO, moved)
    )

    # and the member-level route is closed too: no shipped merchant's banks
    # run above the ecosystem mean
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    members = npci._members_for("2025-08")
    for p in sorted((root / "data" / "synthetic").glob("merchant_*.json")):
        mid = p.stem[len("merchant_"):]
        m = load_merchant(mid)
        sig = npci.signal_from_transactions(mid, list(m.transactions), members)
        if sig.member_technical_decline_pct is not None:
            assert sig.member_technical_decline_pct <= eco * npci.ELEVATION_RATIO, (
                "%s's banks would now count as elevated" % mid)


def test_elevation_ratio_matches_the_one_the_rest_of_the_system_uses():
    """One definition of "elevated", not two. node_bank_health uses 1.5."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    graph = (root / "src" / "doctor" / "graph.py").read_text(encoding="utf-8")
    assert 'r["npci_td_pct"]) * 1.5' in graph
    assert npci.ELEVATION_RATIO == 1.5


# --------------------------------------------------------------------------
# §16 failure matrix: the cases not covered above
# --------------------------------------------------------------------------


def test_a_row_missing_a_metric_column_is_dropped_not_defaulted():
    """A missing metric must never become a zero that reads like a measurement."""
    short = GOOD_CSV + "2025-08,Truncated Bank,100.0,95.00" + chr(10)
    rows = npci.parse_rows(short, "2025-08")
    assert all(r.bank != "Truncated Bank" for r in rows)
    assert len(rows) == 5


def test_a_table_missing_a_metric_column_entirely_is_refused():
    headerless = (chr(10).join(["period,bank,total_volume_mn",
                                "2025-08,Alpha Bank,100.0"]) + chr(10))
    rows = npci.parse_rows(headerless, "2025-08")
    assert rows == []
    with pytest.raises(npci.NPCIUnavailable):
        npci.build_snapshot("2025-08", text=headerless, now=NOW)


@pytest.mark.parametrize("bad", ["2025-00", "0000-01", "2025-99", "20250801",
                                 "2025/08", "aug-2025", "  ", "2025-08-01"])
def test_invalid_dates_are_refused_at_the_boundary(bad):
    assert not npci.valid_period(bad)
    with pytest.raises(npci.NPCIUnavailable):
        npci.build_snapshot(bad, text=GOOD_CSV, now=NOW)


def test_verify_reference_refuses_an_invalid_date_in_a_stored_reference():
    out = npci.verify_reference({"period": "2025-13", "source_hash": "x"})
    assert out["ok"] is False
    assert out["checks"][0]["key"] == "period"


@pytest.mark.parametrize("junk", [None, "not a dict", 42, [], ("a", "b")])
def test_verify_reference_survives_a_malformed_reference(junk):
    out = npci.verify_reference(junk)
    assert out["ok"] is False and isinstance(out["checks"], list)


def test_as_of_is_the_close_of_the_reporting_month():
    assert npci._as_of("2025-08").isoformat().startswith("2025-08-31")
    assert npci._as_of("2025-02").isoformat().startswith("2025-02-28")
    assert npci._as_of("2024-02").isoformat().startswith("2024-02-29")
    assert npci._as_of("2025-12").isoformat().startswith("2025-12-31")


def test_a_tampered_snapshot_on_disk_does_not_deny_evidence(tmp_path,
                                                            monkeypatch):
    """A bad cached file is not a reason to withhold evidence derived from the
    committed source -- but it must not be served either."""
    monkeypatch.setattr(npci, "SNAPSHOT_DIR", tmp_path)
    npci.reset_cache()
    try:
        snap = npci.build_snapshot("2025-08")
        (tmp_path / (snap.snapshot_id + ".json")).write_text(
            json.dumps({"provenance": {"schema_version": "1"},
                        "metrics": {"approval_rate_pct": 1.0}}),
            encoding="utf-8")
        ev = npci.evidence_for_merchant("cloudsync")
        assert ev.available is True
        assert ev.metrics.approval_rate_pct != 1.0, "served the tampered file"
    finally:
        npci.reset_cache()


def test_the_snapshot_endpoint_never_returns_a_server_error(monkeypatch):
    """Its whole contract is UNAVAILABLE rather than a 500."""
    from fastapi.testclient import TestClient

    from doctor.api import app

    def explode(*a, **k):
        raise RuntimeError("something nobody predicted")

    monkeypatch.setattr(npci, "current_snapshot", explode)
    r = TestClient(app).get("/api/external/npci")
    assert r.status_code == 200
    assert r.json()["available"] is False
    assert r.json()["freshness_status"] == "UNAVAILABLE"


def test_a_refresh_cannot_silently_rewrite_the_pinned_capture():
    """§7: a future NPCI update must create a NEW snapshot id, never mutate
    the one a historical diagnosis already points at."""
    a = npci.build_snapshot("2025-08")
    fresher = npci._table_text().replace(
        "2025-08,State Bank of India,5368.74,93.66,5.92,0.42",
        "2025-08,State Bank of India,5368.74,91.66,5.92,2.42")
    b = npci.build_snapshot("2025-08", text=fresher, now=LATER)
    assert a.snapshot_id != b.snapshot_id
    assert a.provenance.source_hash != b.provenance.source_hash
    # and the original is still reproducible from the committed source
    assert npci.build_snapshot("2025-08").snapshot_id == a.snapshot_id


def test_the_official_source_is_the_only_one_named():
    """§5: no third-party site may appear as the authoritative source."""
    assert npci.SOURCE_URL.startswith("https://www.npci.org.in/")
    ev = npci.evidence_for_merchant("cloudsync")
    blob = ev.model_dump_json().lower()
    for third_party in ("dataful", "indiadataportal", "ckan", "kaggle",
                        "statista", "web.archive.org"):
        assert third_party not in blob, third_party

# --------------------------------------------------------------------------
# freeze audit regressions
# --------------------------------------------------------------------------


def test_evidence_for_an_unknown_merchant_degrades_and_does_not_raise():
    """`load_merchant` exits rather than raising when a batch is missing, and
    SystemExit is a BaseException -- so `except Exception` let it straight
    through. That turned a missing batch into a 500 on a read-only endpoint
    and would have taken the assistant down with it."""
    ev = npci.evidence_for_merchant("zzz_no_such_merchant")
    assert ev.available is False
    assert ev.freshness_status == npci.Freshness.UNAVAILABLE
    assert ev.corroboration.status == npci.Corroboration.UNAVAILABLE


def test_the_unavailable_reason_never_carries_a_filesystem_path():
    ev = npci.evidence_for_merchant("zzz_no_such_merchant")
    reason = ev.unavailable_reason or ""
    for leak in ("buildathon", "C:", "/Users/", ".json", "data"):
        assert leak not in reason, reason


def test_parameterised_routes_answer_404_not_500_for_an_unknown_id():
    """A 500 on a public read route is an unhandled exception by another
    name, and unhandled exceptions are how internals escape."""
    from fastapi.testclient import TestClient

    from doctor.api import app

    c = TestClient(app, raise_server_exceptions=False)
    for url in ("/api/external/npci/zzznosuch",
                "/api/external/npci/zzznosuch/verify",
                "/api/recovery/zzznosuch/zzznosuch"):
        r = c.get(url)
        assert r.status_code == 404, "%s -> %d" % (url, r.status_code)
        assert "buildathon" not in r.text and "C:" not in r.text, url
