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


def test_every_reason_the_kernel_can_return_has_plain_words():
    """Stronger than the book, and it had already caught something.

    Checking only the codes this month's runs happen to produce leaves the
    rarer refusals unexplained until the day they fire, which is the day
    somebody needs the explanation. The stopping-rules panel had drifted the
    same way -- it listed seven checks and quietly omitted the bank-degraded
    hold, a rule that really does refuse retries.
    """
    from chitragupta.policy import ReasonCode
    from doctor.journey import _REASONS

    codes = {v for k, v in vars(ReasonCode).items() if not k.startswith("_")}
    missing = sorted(c for c in codes if c not in _REASONS)
    assert not missing, "the kernel can return these with no explanation: %s" % (
        ", ".join(missing)
    )


class TestTheKernelsChecks:
    """The rule sequence shown for one payment, and the values it quotes.

    The point of showing checks per payment is that a reader can disagree with
    them. "Rs 24,816 against a ceiling of Rs 15,000" is a claim about two
    numbers; "amount checked against ceiling" is a description of a rule and
    cannot be wrong. So the tests are about the numbers being the real ones and
    the sequence stopping where the stored decision says it stopped.
    """

    def test_the_sequence_matches_the_kernels_own_reason_codes(self, run_id):
        """Every code the kernel can emit has a place in the sequence, or a
        payment carrying it would render with nothing marked."""
        from chitragupta.policy import ReasonCode
        from doctor.journey import _ORDER

        placed = {code for _, _, code in _ORDER}
        # These two are decided on the ladder rather than by a numbered rule.
        placed |= {"OK_ESCALATION", "OK_WITHIN_MANDATE"}
        codes = {v for k, v in vars(ReasonCode).items() if not k.startswith("_")}
        assert not (codes - placed), "no rule row for: %s" % sorted(codes - placed)

    def test_it_stops_at_the_rule_the_ledger_blames(self, run_id):
        from doctor.journey import _ORDER

        by_code = {code: i for i, (_, _, code) in enumerate(_ORDER)}
        for row in candidates(run_id, 60):
            j = build(run_id, row["txn_id"])
            if not j.checks:
                continue
            stopped = [c for c in j.checks if c.status == "stopped"]
            expect = by_code.get(j.final_reason)
            if expect is None:
                # OK_WITHIN_MANDATE passes everything.
                if j.final_reason == "OK_WITHIN_MANDATE":
                    assert not stopped
                continue
            assert len(stopped) == 1
            assert stopped[0].n == expect + 1, (
                "%s says %s but the sequence stopped at %s"
                % (row["txn_id"], j.final_reason, stopped[0].label)
            )

    def test_nothing_after_the_stop_claims_to_have_run(self, run_id):
        for row in candidates(run_id, 40):
            j = build(run_id, row["txn_id"])
            seen_stop = False
            for c in j.checks:
                if seen_stop:
                    assert c.status == "not_reached", (
                        "%s ran %s after already stopping" % (row["txn_id"], c.label)
                    )
                if c.status == "stopped":
                    seen_stop = True

    def test_the_quoted_limits_are_the_mandates_own(self, run_id, rec):
        """Not restated numbers -- the ones in the signed file."""
        from doctor.run import load_mandate

        m = load_mandate(rec["merchant_id"]).mandate
        ceiling = "Rs %s" % format(m.max_amount_paise // 100, ",d")
        auto = "Rs %s" % format(m.auto_execute_limit_paise // 100, ",d")

        j = build(run_id, candidates(run_id, 1)[0]["txn_id"])
        by_key = {c.key: c for c in j.checks}
        assert ceiling in by_key["ceiling"].compared
        assert auto in by_key["auto_limit"].compared
        assert str(m.max_attempts_per_payment) in by_key["attempts"].compared
        assert m.not_after[:10] in by_key["validity"].compared

    def test_the_amount_quoted_is_the_payments_own(self, run_id):
        for row in candidates(run_id, 30):
            j = build(run_id, row["txn_id"])
            if not j.checks or not row["amount_paise"]:
                continue
            shown = "Rs %s" % format(row["amount_paise"] // 100, ",d")
            by_key = {c.key: c for c in j.checks}
            assert shown in by_key["ceiling"].compared, row["txn_id"]


class TestTheHashIsCheckable:
    """The published preimage has to actually be the preimage.

    A page that says "these are the bytes we hashed" and ships bytes that do
    not hash to the stored value would be worse than showing nothing -- it
    invites a reader to check, and rewards them with a mismatch they cannot
    interpret. This is the test that keeps that promise honest.
    """

    def test_sha256_of_the_published_bytes_is_the_stored_hash(self, run_id):
        import hashlib

        checked = 0
        for row in candidates(run_id, 40):
            j = build(run_id, row["txn_id"])
            if not j.hash_preimage:
                continue
            digest = hashlib.sha256(j.hash_preimage.encode("utf-8")).hexdigest()
            assert digest == j.raw_entry["entry_hash"], row["txn_id"]
            checked += 1
        assert checked > 5, "nothing was actually checked"

    def test_the_preimage_excludes_only_the_hash_itself(self, run_id):
        j = build(run_id, candidates(run_id, 1)[0]["txn_id"])
        payload = json.loads(j.hash_preimage)
        assert "entry_hash" not in payload
        assert set(j.raw_entry) - set(payload) == {"entry_hash"}

    def test_a_tampered_preimage_stops_matching(self, run_id):
        """The property is worth nothing if a changed field still hashes the
        same, so the test edits one and requires the digest to move."""
        import hashlib

        j = build(run_id, candidates(run_id, 1)[0]["txn_id"])
        payload = json.loads(j.hash_preimage)
        payload["sequence"] = payload["sequence"] + 1
        bumped = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        assert hashlib.sha256(bumped.encode("utf-8")).hexdigest() != j.raw_entry["entry_hash"]
