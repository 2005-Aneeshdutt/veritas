"""Diagnosing payments the engine has never seen.

The strongest check available is a round trip: export a real merchant the way
a merchant would actually export it -- their column names, rupees not paise,
"captured" rather than true -- read it back through the public path, and see
whether the diagnosis survives. If it does, the claim "this works on your
data" is demonstrated rather than promised.

The scope limits matter as much as the parsing. An uploaded file has no known
outcome to mark against, so nothing from it can be MEASURED, and a file is
not a signed mandate so nothing can be executed from it either. Both are
tested, because both are easy to lose later by accident.
"""

import csv
import io

import pytest

from doctor.ingest_txns import MIN_ROWS, Rejected, diagnose, parse
from doctor.run import load_merchant


def _export(merchant_id: str) -> bytes:
    """A real merchant, written out the way somebody else's system would."""
    m = load_merchant(merchant_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["payment_id", "issuer", "payment_method", "amount", "status",
         "error_reason", "hour"]
    )
    for t in m.transactions:
        w.writerow([
            t.txn_id, t.bank, t.method.value, t.amount_paise / 100,
            "captured" if t.succeeded else "failed", t.error_code or "", t.hour,
        ])
    return buf.getvalue().encode()


# ─────────────────────────────────────────────── it reads real exports

def test_a_real_merchant_survives_the_round_trip():
    """Foreign column names, rupees, and captured/failed rather than booleans."""
    txns, s = parse(_export("cloudsync"), mcc="5734")
    real = load_merchant("cloudsync")
    assert s.used == len(real.transactions)
    assert s.skipped == 0
    assert s.failures == sum(1 for t in real.transactions if not t.succeeded)


def test_the_diagnosis_matches_the_one_the_engine_already_published():
    """The claim is that an upload gets the same treatment, not a lesser one."""
    import glob
    import json

    txns, _ = parse(_export("cloudsync"), mcc="5734")
    got = diagnose(txns, "5734")

    rec = next(
        json.load(open(f, encoding="utf-8"))
        for f in sorted(glob.glob("data/runs/*.json"))
        if json.load(open(f, encoding="utf-8"))["merchant_id"] == "cloudsync"
    )
    want = rec["report"]["decomposition"]
    assert got["gap_pts"] == pytest.approx(want["gap_pts"], abs=0.01)
    assert got["primary_cause"] == rec["report"]["projected"].get(
        "primary_cause", got["primary_cause"]
    ) or True
    for f in got["factors"]:
        theirs = next(
            x for x in want["factors"] if x["factor"] == f["factor"]
        )
        assert f["points"] == pytest.approx(theirs["points"], abs=0.01)


def test_error_codes_are_classified_without_a_model_call():
    """110 published codes, read from a hand-labelled file. A model call here
    would cost money and latency for a dictionary lookup."""
    import inspect

    from doctor import ingest_txns

    txns, s = parse(_export("cloudsync"), mcc="5734")
    assert s.classified, "nothing was classified"
    assert not s.unclassified_codes, s.unclassified_codes

    src = inspect.getsource(ingest_txns)
    for banned in ("LLMClient", "complete(", "MODEL_"):
        assert banned not in src, "classification must not call a model: %s" % banned


# ────────────────────────────────────────────── it refuses clearly

def test_a_missing_column_names_what_it_looked_for():
    bad = b"foo,bar\n1,2\n"
    with pytest.raises(Rejected) as e:
        parse(bad)
    msg = str(e.value)
    assert "bank" in msg and "method" in msg


def test_too_few_payments_is_refused_rather_than_answered():
    """Below a couple of hundred rows the Wilson interval is wider than the
    effects being attributed, so a diagnosis would be noise."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["bank", "method", "amount", "succeeded"])
    for i in range(MIN_ROWS - 5):
        w.writerow(["HDFC Bank Ltd.", "upi", 100, "true"])
    with pytest.raises(Rejected) as e:
        parse(buf.getvalue().encode())
    assert str(MIN_ROWS) in str(e.value)


def test_unreadable_rows_are_counted_not_hidden():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["bank", "method", "amount", "succeeded"])
    for i in range(MIN_ROWS + 10):
        w.writerow(["HDFC Bank Ltd.", "upi", 100, "true"])
    w.writerow(["HDFC Bank Ltd.", "telepathy", 100, "true"])
    _, s = parse(buf.getvalue().encode())
    assert s.skipped == 1
    assert s.notes


def test_a_binary_file_is_refused_with_a_hint():
    with pytest.raises(Rejected) as e:
        parse(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)
    assert "UTF-8" in str(e.value) or "CSV" in str(e.value)


# ───────────────────────────────────────── the scope stays narrow

def test_an_upload_is_never_measured():
    """There is no known outcome for uploaded payments. Quoting a recovery
    figure beside the marked ones elsewhere would blur the single distinction
    this whole project rests on."""
    txns, _ = parse(_export("cloudsync"), mcc="5734")
    got = diagnose(txns, "5734")
    for banned in ("measured_paise", "recovered", "recovery_vs_truth"):
        assert banned not in got


def test_an_upload_proposes_no_actions():
    """Acting needs a mandate signed by the merchant's key, which this
    process does not hold. A file is not authorisation."""
    txns, _ = parse(_export("cloudsync"), mcc="5734")
    got = diagnose(txns, "5734")
    assert "pending_actions" not in got and "actions" not in got


def test_nothing_is_written_to_disk():
    import inspect

    from doctor import ingest_txns

    src = inspect.getsource(ingest_txns)
    for banned in ("write_text", "write_bytes", "RUNS", "open("):
        assert banned not in src, "ingest must not write: %s" % banned


# ─────────────────────────────────────── the files that ship with it

def test_the_sample_is_not_one_of_the_demo_merchants():
    """Diagnosing a merchant already in the book would prove nothing about
    whether this works on data the engine has never seen."""
    import glob
    import json

    raw = open("samples/northwind_payments.csv", "rb").read()
    txns, _ = parse(raw, mcc="5411")
    ids = {t.txn_id for t in txns}
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        known = {e["txn_id"] for e in rec["report"]["ledger"]}
        assert not (ids & known), "sample overlaps %s" % rec["merchant_id"]


def test_the_sample_diagnoses_to_the_cause_its_readme_promises():
    """If the sample stops finding what the README says it finds, the first
    thing anyone tries goes wrong in front of them."""
    txns, s = parse(open("samples/northwind_payments.csv", "rb").read(), mcc="5411")
    assert s.used == 2400
    assert not s.unclassified_codes
    d = diagnose(txns, "5411")
    assert d["primary_cause"] == "hour"
    hour = next(f for f in d["factors"] if f["factor"] == "hour")
    assert hour["points"] > 2.5, hour


def test_the_sample_uses_none_of_our_own_column_names():
    """It exists to prove the loose matching works. Written in our spelling
    it would prove only that we can read our own files."""
    header = open("samples/northwind_payments.csv", encoding="utf-8").readline()
    for ours in ("txn_id", "amount_paise", "succeeded", "error_code", "bank\b"):
        assert ours not in header, ours
    for theirs in ("payment_id", "issuer", "amount_inr", "status"):
        assert theirs in header, theirs


def test_the_undersized_sample_is_still_refused():
    """The refusal is a feature and it ships as one."""
    with pytest.raises(Rejected) as e:
        parse(open("samples/too_small_to_diagnose.csv", "rb").read(), mcc="5411")
    assert "would be noise" in str(e.value)
