"""Who approved this, and why that had to go inside the hash.

The product has two approval paths and they were indistinguishable in the
record. One is a Razorpay operator clearing a queue in the console; the other
is the merchant themselves clicking a signed button in an email. Both run the
same kernel and neither is more legitimate than the other -- but they are
different people, and a ledger that could not tell you which had happened
would be crediting an account manager with the merchant's own decisions.

The obvious cheap fix is to record the actor alongside the chain. That was
rejected: an actor that can be edited after the fact is a signature nobody
signed. It goes inside the hash, which cost a rebuild of every committed
chain, and these tests are what that rebuild bought:

  * the field is covered by the hash, so editing it breaks verification
  * the console path records "platform" and the emailed path records
    "merchant" -- not by convention, but because a test fails otherwise
  * the agent's own unattended work stays "agent", so approving something
    cannot retroactively claim credit for what ran without anyone
"""

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from chitragupta.ledger import Ledger
from doctor.api import RUNS, app
from doctor.apply import apply_group
from doctor.approvals import mint
from doctor.run import load_mandate


@pytest.fixture
def sandbox(tmp_path_factory):
    """A run to approve things in, restored afterwards."""
    backup = tmp_path_factory.mktemp("actor_backup")
    for p in RUNS.glob("run_*.json"):
        shutil.copy2(p, backup / p.name)
    yield
    for p in RUNS.glob("run_*.json"):
        p.unlink()
    for p in backup.glob("run_*.json"):
        shutil.copy2(p, RUNS / p.name)


def _a_run_with_held_actions() -> dict:
    for p in sorted(RUNS.glob("run_*.json")):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if rec.get("used_stubs"):
            continue
        for i, g in enumerate(rec.get("pending_actions") or []):
            if g.get("count"):
                return {"rec": rec, "group_index": i}
    pytest.skip("no run with a pending fix on disk")


def test_the_agent_s_own_work_is_recorded_as_the_agent(sandbox):
    """Everything written at diagnosis ran without anyone being asked."""
    for p in RUNS.glob("run_*.json"):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if rec.get("used_stubs") or rec.get("applied"):
            continue
        actors = {e.get("actor") for e in rec["report"]["ledger"]}
        assert actors == {"agent"}, "%s: %s" % (rec["run_id"], actors)


def test_approving_in_the_console_is_recorded_as_the_platform(sandbox):
    found = _a_run_with_held_actions()
    rec, idx = found["rec"], found["group_index"]
    before = len(rec["report"]["ledger"])

    apply_group(rec["run_id"], idx, load_mandate(rec["merchant_id"]), confirmed=True)

    after = json.loads((RUNS / (rec["run_id"] + ".json")).read_text(encoding="utf-8"))
    new = after["report"]["ledger"][before:]
    assert new, "nothing was appended"
    assert {e["actor"] for e in new} == {"platform"}
    assert after["applied"][-1]["actor"] == "platform"


def test_approving_from_the_emailed_link_is_recorded_as_the_merchant(sandbox):
    found = _a_run_with_held_actions()
    rec, idx = found["rec"], found["group_index"]
    before = len(rec["report"]["ledger"])

    token = mint(rec["merchant_id"], rec["run_id"], idx, "approve")
    r = TestClient(app).post("/api/decide/%s" % token)
    assert r.status_code == 200, r.text

    after = json.loads((RUNS / (rec["run_id"] + ".json")).read_text(encoding="utf-8"))
    new = after["report"]["ledger"][before:]
    assert new, "nothing was appended"
    assert {e["actor"] for e in new} == {"merchant"}


def test_the_two_paths_run_the_same_kernel(sandbox):
    """Different actor, identical rules. The console cannot approve into
    happening anything the emailed link could not, and vice versa."""
    found = _a_run_with_held_actions()
    rec, idx = found["rec"], found["group_index"]
    run_id, mid = rec["run_id"], rec["merchant_id"]

    console = apply_group(run_id, idx, load_mandate(mid), confirmed=True)

    # Put the run back and take the other door to the same fix.
    (RUNS / (run_id + ".json")).write_text(
        json.dumps(rec, indent=2), encoding="utf-8", newline="\n"
    )
    token = mint(mid, run_id, idx, "approve")
    emailed = TestClient(app).post("/api/decide/%s" % token).json()

    assert emailed["allowed"] == console.allowed
    assert emailed["stepped_up"] == console.stepped_up
    assert emailed["denied"] == console.denied


def test_the_actor_cannot_be_edited_afterwards(sandbox):
    """The reason it is in the hash rather than beside it."""
    rec = next(
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted(RUNS.glob("run_*.json"))
        if not json.loads(p.read_text(encoding="utf-8")).get("used_stubs")
    )
    entries = json.loads(json.dumps(rec["report"]["ledger"]))
    assert Ledger.from_entries(entries).verify().ok

    entries[0]["actor"] = "merchant"
    v = Ledger.from_entries(entries).verify()
    assert not v.ok
    assert v.broken_at == 0
    assert "modified" in v.detail


def test_only_the_three_real_actors_are_accepted():
    """A free-text actor would let anything be written into the record."""
    from pydantic import ValidationError

    from chitragupta.ledger import LedgerEntry

    rec = next(
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted(RUNS.glob("run_*.json"))
        if not json.loads(p.read_text(encoding="utf-8")).get("used_stubs")
    )
    row = dict(rec["report"]["ledger"][0])
    for bad in ("razorpay", "admin", "", "AGENT"):
        row["actor"] = bad
        with pytest.raises(ValidationError):
            LedgerEntry.model_validate(row)
