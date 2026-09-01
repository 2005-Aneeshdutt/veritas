"""One payment's file, and the one thing that would ruin it.

The page ends by telling you whether the payment would truly have converted.
That is ground truth held by the generator, and it is the single most
dangerous number in the product to display, because a reader who cannot see
WHEN it was read will reasonably assume the engine had it.

It did not, and the tests here are the ones that would catch it if it ever
did:

  * the counterfactual is always the LAST beat. Putting it anywhere earlier
    would show it sitting alongside the evidence the decision was made from
  * no beat before it mentions conversion at all
  * the module reads the run record and never re-decides anything, so the
    page cannot disagree with the ledger it is describing. Assembling a
    journey twice has to give the same answer, and it has to match the stored
    ledger entry rather than a fresh evaluation of the gate

The rest is the ordinary duty of a detail view: unknown ids refuse rather
than invent, and a payment that was decided twice reports where it ended
rather than where it started.
"""

import json

import pytest

from doctor.journey import RUNS, build, candidates


@pytest.fixture(scope="module")
def run_id():
    """The run with the most decisions in it, so every branch is exercised."""
    best, n = None, -1
    for p in RUNS.glob("run_*.json"):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if rec.get("used_stubs"):
            continue
        k = len(rec.get("report", {}).get("ledger", []))
        if k > n:
            best, n = rec["run_id"], k
    assert best, "no runs on disk"
    return best


@pytest.fixture(scope="module")
def rec(run_id):
    return json.loads((RUNS / (run_id + ".json")).read_text(encoding="utf-8"))


def test_the_picker_offers_real_payments_only(run_id):
    rows = candidates(run_id, 200)
    assert rows
    for r in rows:
        assert r["txn_id"] and not r["txn_id"].startswith("merchant:")
        assert r["outcome"]


def test_the_picker_lists_each_payment_once(run_id):
    """A payment decided twice ended somewhere; it is not two payments."""
    rows = candidates(run_id, 500)
    ids = [r["txn_id"] for r in rows]
    assert len(ids) == len(set(ids))


def test_refusals_come_before_successes(run_id):
    """A list that opened on forty successes would read as a log."""
    rows = candidates(run_id, 500)
    rank = {"denied": 0, "merchant_action": 1, "escalated": 2, "executed": 3}
    seen = [rank.get(r["outcome"], 9) for r in rows]
    assert seen == sorted(seen)


def test_an_unknown_payment_refuses_rather_than_inventing(run_id):
    j = build(run_id, "pay_not_a_real_payment_0000")
    assert not j.found
    assert not j.beats
    assert "No payment with that id" in j.detail


def test_an_unknown_run_refuses(run_id):
    j = build("run_does_not_exist", "anything")
    assert not j.found
    assert "no such run" in j.detail


def test_the_counterfactual_is_always_last(run_id):
    """It is read after the decision, and it has to READ that way too."""
    for row in candidates(run_id, 60):
        j = build(run_id, row["txn_id"])
        truth_at = [i for i, b in enumerate(j.beats) if b.key == "truth"]
        if not truth_at:
            assert j.would_have_converted is None
            continue
        assert truth_at == [len(j.beats) - 1], (
            "%s shows the counterfactual before the decision" % row["txn_id"]
        )


def test_no_earlier_beat_mentions_what_would_have_happened(run_id):
    leak = ("would have converted", "would truly", "ground truth", "counterfactual")
    for row in candidates(run_id, 60):
        j = build(run_id, row["txn_id"])
        for b in j.beats[:-1] if j.beats else []:
            if b.key == "truth":
                continue
            blob = (b.title + " " + b.detail).lower()
            for word in leak:
                assert word not in blob, "%s leaks '%s' into %s" % (
                    row["txn_id"], word, b.key,
                )


def test_the_engine_never_saw_it(run_id, rec):
    """The reason the ordering above is honest and not just tidy.

    The ledger entry was hashed at the moment of the decision. If the outcome
    were derived from the counterfactual, payments that would have converted
    would be gated differently from ones that would not -- so the check is
    that the gate's reason codes do not sort by the truth.
    """
    from doctor.journey import _merchant_file

    truth = (
        _merchant_file(rec["merchant_id"]).get("ground_truth", {}).get(
            "retry_conversions", {}
        )
        or {}
    )
    assert truth, "no ground truth on file to test against"

    reasons_by_truth: dict[bool, set[str]] = {True: set(), False: set()}
    for e in rec["report"]["ledger"]:
        t = truth.get(e.get("txn_id"))
        if t is None:
            continue
        reasons_by_truth[bool(t)].add(e.get("gate_reason", ""))

    assert reasons_by_truth[True] and reasons_by_truth[False]
    assert reasons_by_truth[True] & reasons_by_truth[False], (
        "the gate's reasons separate perfectly by an outcome it cannot see"
    )


def test_the_file_agrees_with_the_ledger_it_describes(run_id, rec):
    """Nothing is recomputed, so nothing can drift."""
    entries = {
        e["txn_id"]: e
        for e in rec["report"]["ledger"]
        if not e["txn_id"].startswith("merchant:")
    }
    for row in candidates(run_id, 40):
        j = build(run_id, row["txn_id"])
        last = [
            e for e in rec["report"]["ledger"] if e["txn_id"] == row["txn_id"]
        ][-1]
        assert j.final_outcome == last["outcome"]
        assert j.final_reason == last["gate_reason"]
        assert row["txn_id"] in entries


def test_only_an_executed_action_reports_money(run_id):
    """A denied action recovered nothing and was never sent."""
    for row in candidates(run_id, 80):
        j = build(run_id, row["txn_id"])
        if j.final_outcome != "executed":
            assert j.recovered_paise == 0, "%s claims money it never moved" % j.txn_id


def test_building_the_same_file_twice_gives_the_same_answer(run_id):
    row = candidates(run_id, 1)[0]
    a = build(run_id, row["txn_id"])
    b = build(run_id, row["txn_id"])
    assert a.model_dump_json() == b.model_dump_json()


def test_every_reason_code_in_the_book_has_plain_words(run_id):
    """A glossary that silently falls back to the raw code is a glossary that
    has gone stale without anyone noticing."""
    from doctor.journey import _REASONS

    seen = set()
    for p in RUNS.glob("run_*.json"):
        r = json.loads(p.read_text(encoding="utf-8"))
        for e in r.get("report", {}).get("ledger", []):
            if e.get("gate_reason"):
                seen.add(e["gate_reason"])
    missing = sorted(seen - set(_REASONS))
    assert not missing, "no plain-words entry for: %s" % ", ".join(missing)
