"""Running the engine on bank data it has never seen.

The claim this feature makes is small and checkable: the same decomposer,
pointed at a different measurement of the world, produces a different answer.
Everything here defends the two ways that claim could quietly become false.

  1. an upload that silently did nothing would look identical to one that
     worked, because the page would still render numbers. So a rejection must
     be loud, and a re-run must actually differ from the shipped baseline
  2. an upload that overwrote the committed tables would make the CI job
     "Committed results reproduce" meaningless, and nobody would notice until
     a judge re-ran the sweep
"""

import io
import json

import pytest

from doctor.baseline import Baseline
from doctor.cohort import build_cohort
from doctor.ingest_npci import (
    MIN_BANKS,
    Rejected,
    UploadSummary,
    baseline_from,
    parse,
)
from doctor.run import load_merchant
from doctor.shapley import ShapleyDecomposer

REAL = "data/npci/remitter_banks.csv"


@pytest.fixture(scope="module")
def raw():
    with open(REAL, "rb") as f:
        return f.read()


def _csv(rows, header="period,bank,total_volume_mn,approved_pct,bd_pct,td_pct"):
    return ("%s\n%s\n" % (header, "\n".join(rows))).encode("utf-8")


# ─────────────────────────────────────────────── it reads real data

def test_the_shipped_table_parses(raw):
    stats, summary = parse(raw)
    assert summary.banks >= MIN_BANKS
    assert len(summary.periods) > 1, "the shipped file spans several months"
    assert 0 < summary.median_fail_pct < 100


def test_a_named_period_is_honoured(raw):
    _, summary = parse(raw, "2024-01")
    assert summary.period == "2024-01"


def test_an_unknown_period_says_what_is_available(raw):
    with pytest.raises(Rejected) as e:
        parse(raw, "1999-01")
    assert "not in this file" in str(e.value)
    assert "20" in str(e.value), "it should name real periods"


def test_the_summary_is_serialisable(raw):
    _, summary = parse(raw)
    UploadSummary.model_validate_json(summary.model_dump_json())


# ───────────────────────────────────────── it refuses loudly

def test_a_missing_column_is_named():
    bad = _csv(["2025-08,HDFC,10,95,4,1"], header="period,bank,total_volume_mn")
    with pytest.raises(Rejected) as e:
        parse(bad)
    msg = str(e.value)
    for col in ("approved_pct", "bd_pct", "td_pct"):
        assert col in msg


def test_a_non_csv_is_refused_with_a_hint():
    with pytest.raises(Rejected) as e:
        parse(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)
    assert "UTF-8" in str(e.value) or "CSV" in str(e.value)


def test_too_few_banks_is_refused_rather_than_averaged():
    """A three-bank file would make every merchant fall back to the median,
    and the page would still render numbers as if it had worked."""
    rows = ["2025-08,Bank %d,10,95,4,1" % i for i in range(MIN_BANKS - 2)]
    with pytest.raises(Rejected) as e:
        parse(_csv(rows))
    assert str(MIN_BANKS) in str(e.value)


def test_unparseable_rows_are_counted_not_hidden():
    rows = ["2025-08,Bank %d,10,95,4,1" % i for i in range(MIN_BANKS + 2)]
    rows.append("2025-08,Broken Bank,10,not-a-number,4,1")
    _, summary = parse(_csv(rows))
    assert summary.skipped == 1
    assert summary.notes, "a skipped row must say why"


def test_an_empty_file_is_refused():
    with pytest.raises(Rejected):
        parse(_csv([]))


# ──────────────────────────────────── the engine actually uses it

def test_an_uploaded_baseline_answers_differently(raw):
    """The whole claim. If a different month produced identical numbers, the
    engine was never reading the bank table."""
    stats_a, sum_a = parse(raw, "2025-08")
    stats_b, sum_b = parse(raw, "2024-01")

    m = load_merchant("cloudsync")

    def diagnose(b):
        cohort = build_cohort(m.profile.mcc, b)
        dec = ShapleyDecomposer(b, cohort).decompose(m.transactions)
        return cohort.s_star, dec.gap_pts, dec.by_factor()

    s1, g1, f1 = diagnose(baseline_from(stats_a, sum_a.period))
    s2, g2, f2 = diagnose(baseline_from(stats_b, sum_b.period))

    assert s1 != s2, "a different month must move the achievable rate"
    assert g1 != g2, "a different month must move the gap"
    assert any(abs(f1[k] - f2[k]) > 1e-6 for k in f1)


def test_an_uploaded_baseline_matches_the_shipped_one_for_the_same_month(raw):
    """Substitution, not a second code path: uploading the file the repo
    already ships must reproduce the shipped baseline exactly."""
    stats, summary = parse(raw, Baseline().period)
    up = baseline_from(stats, summary.period)
    shipped = Baseline()

    m = load_merchant("cloudsync")
    for t in list(m.transactions)[:200]:
        assert up.bank_fail_rate(t.bank) == pytest.approx(
            shipped.bank_fail_rate(t.bank), rel=1e-12
        )


def test_uploading_never_writes_to_the_committed_tables(raw, tmp_path):
    """If this ever wrote through, the CI job that verifies committed results
    reproduce would be checking a file the demo had edited."""
    import inspect

    from doctor import ingest_npci

    src = inspect.getsource(ingest_npci)
    for banned in ("write_text", "write_bytes", 'open(', "shutil", "NPCI_DIR"):
        assert banned not in src, "ingest must not write: %s" % banned


def test_the_upload_path_and_the_shipped_path_share_one_baseline_class(raw):
    stats, summary = parse(raw)
    assert isinstance(baseline_from(stats, summary.period), Baseline)
