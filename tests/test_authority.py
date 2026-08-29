"""Pricing the merchant's own authority.

Everything here defends one idea: this feature exists to help a merchant
choose limits, and a tool that always advises raising them is not advising.
Every bug caught while building it failed in the same direction -- toward
recommending more authority -- which is exactly the direction that would make
the feature useless and nobody would notice from the output alone.

The four that are pinned below, in the order they were made:

  1. an absolute materiality floor recommended a change for all 8 merchants
  2. "almost nothing clears your limit" was true by construction -- a held
     action IS one that did not clear
  3. every hold above the limit was assumed to be caused by the limit, but
     `requires_merchant_approval` short-circuits before the amount is tested,
     so payment-link reissues wait for a human at any limit
  4. a raise that freed three actions was still reported as advice
"""

import glob
import json

import pytest

from chitragupta.mandate import Mandate, SignedMandate
from doctor.authority import (
    COMPLAIN_ABOVE,
    MIN_RELIEF_PTS,
    AuthorityReview,
    draft,
    review,
)
from doctor.run import load_mandate


@pytest.fixture(scope="module")
def book():
    """Every merchant, reviewed against its own signed mandate."""
    out = []
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        out.append((rec, load_mandate(rec["merchant_id"])))
    if not out:
        pytest.skip("no runs on disk")
    return out


def _entry(decision, reason, amount, action="retry_soft_decline", txn="pay_1"):
    return {
        "txn_id": txn,
        "gate_decision": decision,
        "gate_reason": reason,
        "proposed_action": {"action_type": action, "amount_paise": amount},
    }


def _rec(ledger, recoverable_high=0):
    return {
        "merchant_id": "test",
        "report": {
            "ledger": ledger,
            "projected": {"recoverable": {"high_paise": recoverable_high}},
            "exceptions": {"unrecoverable_transactions": []},
        },
    }


def _mandate(ceiling=200_000, auto=30_000):
    return SignedMandate(
        mandate=Mandate(
            mandate_id="m1",
            merchant_id="test",
            permitted_actions=["retry_soft_decline"],
            max_amount_paise=ceiling,
            auto_execute_limit_paise=auto,
            max_attempts_per_payment=3,
            not_before="2026-01-01T00:00:00Z",
            not_after="2027-01-01T00:00:00Z",
            public_key_hex="00" * 32,
        ),
        signature_hex="00" * 64,
    )


# ────────────────────────────────────────── it must be able to say no

def test_a_quiet_book_gets_no_recommendation():
    """The outcome that makes the loud one worth reading."""
    r = review(_rec([_entry("allow", "OK_WITHIN_MANDATE", 1000)]), _mandate())
    assert r.no_change_needed is True
    assert not r.proposals


def test_materiality_is_relative_to_what_is_actually_recoverable():
    """Rs 6,000 blocked reads as real money until you notice the same
    merchant has Rs 70,000 on the table that the ceiling is not touching."""
    blocked = [
        _entry("deny", "DENY_AMOUNT_ABOVE_CEILING", 1_500_00, txn="p%d" % i)
        for i in range(10)
    ]
    small = review(_rec(blocked, recoverable_high=0), _mandate())
    large = review(_rec(blocked, recoverable_high=2_000_000_00), _mandate())

    assert [p.field for p in small.proposals] == ["max_amount_paise"]
    assert large.no_change_needed, (
        "against a large recoverable pool this ceiling is not the constraint"
    )


def test_at_least_one_real_merchant_is_told_to_leave_it_alone(book):
    """If this ever hits zero the feature has become a salesman."""
    quiet = [rec["merchant_id"] for rec, sg in book if review(rec, sg).no_change_needed]
    assert quiet, "no merchant was told their limits are fine"


def test_a_marginal_raise_is_not_reported_as_advice():
    """Freeing three actions is noise, and spending a merchant's willingness
    to believe the next recommendation on it is the real cost."""
    ledger = [_entry("allow", "OK_WITHIN_MANDATE", 100, txn="a%d" % i) for i in range(30)]
    ledger += [
        _entry("step_up", "STEP_UP_MERCHANT_APPROVAL_REQUESTED", 100, "reissue_payment_link", "d%d" % i)
        for i in range(60)
    ]
    ledger += [
        _entry("step_up", "STEP_UP_ABOVE_AUTO_LIMIT", 90_000, txn="r%d" % i)
        for i in range(3)
    ]
    r = review(_rec(ledger), _mandate())
    assert "auto_execute_limit_paise" not in [p.field for p in r.proposals]


# ──────────────────────────────────── holds the limit cannot free

def test_approval_holds_are_not_counted_as_unlockable():
    """The bug that would have promised time back that no limit can give.

    `requires_merchant_approval` short-circuits before the amount is compared,
    so these wait for a human at any limit -- even though every one of them is
    above it.
    """
    ledger = [_entry("allow", "OK_WITHIN_MANDATE", 100, txn="a%d" % i) for i in range(5)]
    ledger += [
        _entry(
            "step_up",
            "STEP_UP_MERCHANT_APPROVAL_REQUESTED",
            90_000,
            "reissue_payment_link",
            "d%d" % i,
        )
        for i in range(60)
    ]
    r = review(_rec(ledger), _mandate())
    assert r.no_change_needed, (
        "every hold is approval-gated; raising the limit frees none of them"
    )


def test_the_reason_code_split_matches_the_policy_gate():
    """If the gate grows a new step-up reason, this review must not silently
    fold it into the amount-driven bucket and over-promise."""
    import inspect

    from chitragupta import policy
    from doctor import authority

    src = inspect.getsource(policy.evaluate if hasattr(policy, "evaluate") else policy)
    assert "STEP_UP_ABOVE_AUTO_LIMIT" in src
    assert "STEP_UP_ABOVE_AUTO_LIMIT" in inspect.getsource(authority.review)


def test_a_reachable_target_leaves_no_caveat():
    ledger = [_entry("allow", "OK_WITHIN_MANDATE", 100, txn="a%d" % i) for i in range(5)]
    ledger += [
        _entry("step_up", "STEP_UP_ABOVE_AUTO_LIMIT", 40_000 + i, txn="r%d" % i)
        for i in range(60)
    ]
    r = review(_rec(ledger), _mandate())
    auto = [p for p in r.proposals if p.field == "auto_execute_limit_paise"]
    assert auto and "no change here would free them" not in auto[0].rationale


# ────────────────────────────────────────────── the draft is a draft

def test_the_draft_is_unsigned(book):
    """The whole security property. An agent that could sign its own
    authority would make the policy kernel decorative."""
    for rec, sg in book:
        r = review(rec, sg)
        if r.no_change_needed:
            continue
        d = draft(sg, r.proposals)
        assert isinstance(d, Mandate)
        assert not isinstance(d, SignedMandate)
        assert not hasattr(d, "signature_hex")


def test_nothing_in_the_module_can_sign():
    import inspect

    from doctor import authority

    src = inspect.getsource(authority)
    for banned in ("sign_mandate", "private_key", "Ed25519PrivateKey", ".sign("):
        assert banned not in src, "authority.py must never sign: %s" % banned


def test_the_draft_never_lets_auto_exceed_the_ceiling(book):
    """Two proposals are computed independently; nothing else stops them
    landing as 'may spend unattended more than it may spend at all'."""
    for rec, sg in book:
        r = review(rec, sg)
        if r.no_change_needed:
            continue
        d = draft(sg, r.proposals)
        assert d.auto_execute_limit_paise <= d.max_amount_paise, rec["merchant_id"]


def test_the_draft_only_changes_the_fields_it_proposed(book):
    for rec, sg in book:
        r = review(rec, sg)
        if r.no_change_needed:
            continue
        d = draft(sg, r.proposals)
        changed = {p.field for p in r.proposals}
        before = sg.mandate.model_dump(mode="json")
        after = d.model_dump(mode="json")
        for k in before:
            if k in changed or k == "mandate_id":
                continue
            if k == "auto_execute_limit_paise":
                continue  # may be clamped down for coherence, never up
            assert before[k] == after[k], "%s changed unbidden" % k


def test_a_revision_never_widens_a_field_it_did_not_price(book):
    for rec, sg in book:
        r = review(rec, sg)
        if r.no_change_needed:
            continue
        d = draft(sg, r.proposals)
        priced = {p.field for p in r.proposals}
        if "max_amount_paise" not in priced:
            assert d.max_amount_paise == sg.mandate.max_amount_paise
        if "auto_execute_limit_paise" not in priced:
            assert (
                d.auto_execute_limit_paise <= sg.mandate.auto_execute_limit_paise
            )
        assert d.max_attempts_per_payment == sg.mandate.max_attempts_per_payment


# ──────────────────────────────────────────── the numbers it quotes

def test_every_proposal_carries_its_calibration_caveat(book):
    """A projected recovery figure without its measured error is a sales
    number. The rail is optimistic and the repo measures by how much."""
    for rec, sg in book:
        for p in review(rec, sg).proposals:
            assert p.calibration_note
            assert p.recovery_low_paise <= p.recovery_high_paise


def test_the_proposal_never_promises_more_than_it_unlocks(book):
    for rec, sg in book:
        for p in review(rec, sg).proposals:
            assert p.recovery_high_paise <= p.unlocks_paise, (
                "recovery cannot exceed the value of what was unlocked"
            )


def test_a_raise_is_always_upward(book):
    for rec, sg in book:
        for p in review(rec, sg).proposals:
            assert p.proposed_paise > p.current_paise


def test_the_exposure_is_stated_for_every_proposal(book):
    """A merchant reading only the recovery figure is being sold to."""
    for rec, sg in book:
        for p in review(rec, sg).proposals:
            assert p.exposure and p.rationale
            assert "cap" in p.exposure or "denied" in p.exposure


def test_blocked_groups_reconcile_with_the_ledger(book):
    for rec, sg in book:
        r = review(rec, sg)
        denied = [
            e for e in rec["report"]["ledger"] if e.get("gate_decision") == "deny"
        ]
        assert sum(g.count for g in r.blocked) == len(denied)
        assert r.blocked_total_paise == sum(
            e["proposed_action"]["amount_paise"] for e in denied
        )


def test_the_review_is_serialisable(book):
    for rec, sg in book:
        AuthorityReview.model_validate_json(review(rec, sg).model_dump_json())


def test_the_thresholds_are_sane():
    assert 0 < COMPLAIN_ABOVE < 1
    assert 0 < MIN_RELIEF_PTS < 1


def test_the_two_proposals_do_not_contradict_each_other(book):
    """Both are shown together and signed together.

    The auto-execute proposal used to reassure the merchant that their hard
    ceiling was untouched while the proposal directly above it raised that
    ceiling tenfold. A draft whose halves disagree gives a merchant no reason
    to trust either half.
    """
    for rec, sg in book:
        r = review(rec, sg)
        fields = {p.field for p in r.proposals}
        if fields != {"max_amount_paise", "auto_execute_limit_paise"}:
            continue
        auto = next(p for p in r.proposals if p.field == "auto_execute_limit_paise")
        assert "untouched" not in auto.exposure, (
            "%s: the ceiling is being raised in the same draft" % rec["merchant_id"]
        )
        new_ceiling = next(
            p.proposed_paise for p in r.proposals if p.field == "max_amount_paise"
        )
        assert format(new_ceiling // 100, ",d") in auto.exposure


def test_a_lone_auto_proposal_still_says_the_ceiling_holds(book):
    for rec, sg in book:
        r = review(rec, sg)
        fields = {p.field for p in r.proposals}
        if fields != {"auto_execute_limit_paise"}:
            continue
        auto = r.proposals[0]
        assert "untouched" in auto.exposure
        assert format(sg.mandate.max_amount_paise // 100, ",d") in auto.exposure


def test_the_review_is_stable_across_an_approval(tmp_path):
    """The ledger is append-only, so a re-gated action leaves two rows.

    Reading them all doubled every money figure in this review the moment a
    merchant approved their queue -- and the copy went on telling them 446
    actions were waiting for an approval they had already given.

    What the review reports is a property of the MANDATE on this run: it
    required approval for N actions. Approving them does not change that, so
    the figures must not move.
    """
    import shutil

    from doctor.apply import apply_group

    target = None
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        if rec.get("pending_actions") and not rec.get("applied"):
            target = (f, rec)
            break
    if not target:
        pytest.skip("no run with an unapplied queue")

    path, rec = target
    backup = tmp_path / "b.json"
    shutil.copy(path, backup)
    try:
        signed = load_mandate(rec["merchant_id"])
        before = review(rec, signed)

        for i in range(len(rec["pending_actions"])):
            try:
                apply_group(rec["run_id"], i, signed, confirmed=True)
            except (IndexError, FileNotFoundError, ValueError):
                pass

        after = review(json.load(open(path, encoding="utf-8")), signed)
        assert after.held_count == before.held_count
        assert after.blocked_total_paise == before.blocked_total_paise
        assert after.held_total_paise == before.held_total_paise
        assert [p.field for p in after.proposals] == [
            p.field for p in before.proposals
        ]
    finally:
        shutil.copy(backup, path)


def test_the_review_counts_actions_not_ledger_rows():
    import inspect

    from doctor import authority

    src = inspect.getsource(authority.review)
    assert "final[" in src and "for e in final.values()" in src
