"""The book-wide audit trail, and the one thing that makes it worth keeping.

A hash chain is only evidence if somebody recomputes it. The per-run report
stores `chain_verified: true`, and that flag is a CLAIM -- it was written by
the same process that wrote the entries, so a tampered run would carry a
cheerful `true` alongside its edited row. The endpoint therefore re-hashes
every chain from genesis on each request rather than reading the flag, and the
test that matters here is the one that proves the difference: edit a stored
entry and the verification has to fail.

The rest is reconciliation. An audit view that quietly dropped entries, or
counted one twice, would be worse than no audit view, because it would look
like one.
"""

import json

import pytest
from fastapi.testclient import TestClient

from chitragupta.ledger import Ledger
from doctor.api import RUNS, app


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def audit(client):
    r = client.get("/api/audit?limit=400")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def stored():
    """Every non-stub run on disk, as written."""
    out = []
    for p in sorted(RUNS.glob("run_*.json")):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if rec.get("run_id") and not rec.get("used_stubs"):
            out.append(rec)
    return out


def test_every_chain_in_the_book_is_intact(audit):
    assert audit["chains_total"] > 0
    assert audit["chains_verified"] == audit["chains_total"]
    for c in audit["chains"]:
        assert c["verified"], "%s: %s" % (c["merchant_name"], c["detail"])


def test_the_entry_count_reconciles_against_the_runs(audit, stored):
    assert audit["entries_total"] == sum(
        len(r["report"].get("ledger", [])) for r in stored
    )
    assert sum(c["entries"] for c in audit["chains"]) == audit["entries_total"]


def test_the_decision_breakdowns_account_for_every_entry(audit):
    assert sum(audit["by_outcome"].values()) == audit["entries_total"]
    assert sum(audit["by_reason"].values()) == audit["entries_total"]


def test_a_tampered_entry_fails_verification(stored):
    """The whole reason for keeping hashes rather than a boolean.

    Nothing is written to disk: the chain is rehydrated from the stored
    entries, one amount is edited in the copy, and the recomputed hash no
    longer matches the one that was recorded.
    """
    rec = max(stored, key=lambda r: len(r["report"].get("ledger", [])))
    entries = json.loads(json.dumps(rec["report"]["ledger"]))
    assert len(entries) > 2

    assert Ledger.from_entries(entries).verify().ok

    victim = next(
        i for i, e in enumerate(entries)
        if (e.get("proposed_action") or {}).get("amount_paise", 0) > 0
    )
    entries[victim]["proposed_action"]["amount_paise"] += 1

    v = Ledger.from_entries(entries).verify()
    assert not v.ok
    assert v.broken_at == victim
    assert "modified" in v.detail


def test_reordering_the_chain_fails_verification(stored):
    rec = max(stored, key=lambda r: len(r["report"].get("ledger", [])))
    entries = json.loads(json.dumps(rec["report"]["ledger"]))
    entries[1], entries[2] = entries[2], entries[1]
    v = Ledger.from_entries(entries).verify()
    assert not v.ok


def test_rehydrating_does_not_quietly_repair(stored):
    """`from_entries` must not re-hash on the way in.

    Recomputing hashes at load time would silently fix exactly the tampering
    verify exists to catch, and every chain in the product would verify
    forever regardless of what had been done to it.
    """
    rec = stored[0]
    entries = json.loads(json.dumps(rec["report"]["ledger"]))
    entries[0]["entry_hash"] = "0" * 64
    led = Ledger.from_entries(entries)
    assert led.entries[0].entry_hash == "0" * 64
    assert not led.verify().ok


def test_recent_entries_are_newest_first_and_capped(client):
    d = client.get("/api/audit?limit=5").json()
    assert len(d["recent"]) == 5
    stamps = [e["timestamp"] for e in d["recent"]]
    assert stamps == sorted(stamps, reverse=True)


def test_a_silly_limit_cannot_take_the_page_down(client):
    for limit in (0, -3, 100_000):
        r = client.get("/api/audit?limit=%d" % limit)
        assert r.status_code == 200
        assert 1 <= len(r.json()["recent"]) <= 400


def test_every_listed_entry_carries_what_the_page_shows(audit):
    for e in audit["recent"]:
        assert e["txn_id"] and e["entry_hash"]
        assert e["gate_decision"] in ("allow", "step_up", "deny")
        assert e["gate_reason"]
        assert e["outcome"]


def test_the_denials_are_on_the_record(audit):
    """A kernel that only logged its approvals would be marketing."""
    assert audit["by_outcome"].get("denied", 0) > 0
    assert any(r.startswith("DENY") for r in audit["by_reason"])
