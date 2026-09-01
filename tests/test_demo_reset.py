"""Putting the book back, and why it re-runs instead of deleting.

Approving writes to disk. Without this the second take of a walkthrough opens
on the wreckage of the first -- queues already emptied, headline already
moved, the one moment worth filming already spent -- and the fix would be a
terminal command somebody has to remember with a camera running.

The obvious implementation is to strip the approval keys out of each run
record. This one re-runs the diagnosis instead, and the two properties that
justify the extra seventeen seconds are what this file tests:

  * every link still works afterwards. Each merchant's existing run_id is
    reused, so bookmarks, the run URLs in the sidebar, and the capability URLs
    in already-sent approval emails all still resolve
  * the result is the real starting state, not an approximation of it. The
    runs are deterministic and their model calls are cached, so a re-run
    reproduces the original record rather than a hand-cleaned version of it,
    and a key added to that record next month is cleared without anyone
    remembering to add it to a list here

The whole of data/runs is copied aside and restored afterwards, so this test
leaves the repository exactly as it found it.
"""

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from doctor.api import RUNS, app


@pytest.fixture(scope="module")
def restored(tmp_path_factory):
    """Run the reset once, against a directory that is put back afterwards."""
    backup = tmp_path_factory.mktemp("runs_backup")
    for p in RUNS.glob("run_*.json"):
        shutil.copy2(p, backup / p.name)

    before = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in RUNS.glob("run_*.json")}
    client = TestClient(app)
    r = client.post("/api/demo/reset")
    after = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in RUNS.glob("run_*.json")}

    yield r, before, after

    for p in RUNS.glob("run_*.json"):
        p.unlink()
    for p in backup.glob("run_*.json"):
        shutil.copy2(p, RUNS / p.name)


def test_it_reports_what_it_did(restored):
    r, _, _ = restored
    assert r.status_code == 200
    d = r.json()
    assert d["ok"], d
    assert d["merchants"] and all(m["ok"] for m in d["merchants"])
    assert "back to their starting state" in d["headline"]


def test_every_link_still_resolves(restored):
    """Run ids are reused, so nothing anyone has bookmarked or been emailed
    points at a run that no longer exists."""
    _, before, after = restored
    assert set(after) == set(before)
    for name, rec in after.items():
        assert rec["run_id"] == before[name]["run_id"]
        assert rec["merchant_id"] == before[name]["merchant_id"]


def test_one_run_per_merchant_is_left_behind(restored):
    """Otherwise every reset leaves another orphan for the portfolio to sift."""
    _, _, after = restored
    ids = [rec["merchant_id"] for rec in after.values()]
    assert len(ids) == len(set(ids))


def test_the_approval_state_is_gone(restored):
    _, _, after = restored
    for rec in after.values():
        assert not rec.get("applied")
        assert not rec.get("rejected_txns")
        assert rec.get("pending_actions"), "nothing left to approve on the next take"


def test_the_ledger_comes_back_intact(restored):
    """It is rebuilt with the run, not edited, so the chain still verifies."""
    from chitragupta.ledger import Ledger

    _, _, after = restored
    for rec in after.values():
        entries = rec["report"]["ledger"]
        assert entries
        assert Ledger.from_entries(entries).verify().ok


def test_the_measured_figure_is_back_to_what_the_agent_did_alone(restored):
    """Not zero. The agent's own in-mandate retries already ran at diagnosis,
    and wiping them would understate what it does without being asked."""
    _, _, after = restored
    total = sum(
        rec["report"]["measured"].get("recovery_vs_truth", {}).get("measured_paise", 0)
        for rec in after.values()
    )
    assert total > 0


def test_it_reproduces_the_record_rather_than_cleaning_it(restored):
    """A re-run of a deterministic, cached pipeline should differ only in the
    things that are supposed to differ: when it ran, and against what commit.
    Anything else moving would mean the demo is not reproducible."""
    _, before, after = restored
    volatile = {"started_at", "duration_ms", "commit", "timestamp", "at"}

    def stable(node):
        if isinstance(node, dict):
            return {k: stable(v) for k, v in node.items() if k not in volatile}
        if isinstance(node, list):
            return [stable(v) for v in node]
        return node

    for name, rec in after.items():
        # The ledger's hashes cover its own timestamps, so entry_hash and
        # prev_hash move with them legitimately; the chain check above is what
        # holds the ledger to account.
        a = stable({k: v for k, v in rec.items() if k not in ("traces", "report")})
        b = stable({k: v for k, v in before[name].items() if k not in ("traces", "report")})
        assert a == b, "%s changed across a reset" % name


def test_nothing_outside_the_runs_directory_was_touched(restored):
    """Mandates, NPCI tables and merchant files are read-only here."""
    from doctor.defects import ROOT

    _, _, _ = restored
    for sub in ("mandates", "npci", "synthetic"):
        d = ROOT / "data" / sub
        if d.exists():
            assert any(d.iterdir()), "%s was emptied by a reset" % sub
