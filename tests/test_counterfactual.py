"""The Counterfactual Recovery Lab, and the property that makes it worth reading.

The headline claim of this module is not "Revenue Doctor recovers more" -- on
this batch it recovers less than a naive loop, and these tests assert that,
because the interesting result is WHY. The claims actually being defended:

  * no strategy can see the outcome it is being scored on
  * the evaluation is deterministic and re-runs identically
  * the policies that recover more do so by breaking the mandate, and the
    number of breaches is counted rather than elided
  * abstention happens, is counted, and is not the same thing as a denial

If one of these breaks the comparison becomes marketing, so each gets a test.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from doctor import counterfactual as cf
from doctor.counterfactual import (
    DEFAULT_P_FLOOR,
    Disposition,
    decide_naive_retry,
    decide_no_intervention,
    decide_revenue_doctor,
    decide_static_rules,
    run_lab,
)
from doctor.run import load_mandate

ROOT = Path(__file__).resolve().parents[1]
MERCHANT = "cloudsync"


@pytest.fixture(scope="module")
def lab():
    return run_lab(MERCHANT)


@pytest.fixture(scope="module")
def batch():
    _profile, failures, settled = cf._load_batch(MERCHANT)
    return failures, settled


# -- 1. no ground-truth leakage -------------------------------------------

def test_no_strategy_takes_a_truth_argument():
    """Structural, not behavioural: the leak has to be impossible to write.

    A strategy that could see `retry_conversions` would score perfectly and
    tell you nothing. Rather than trusting review to catch that, the shape of
    every decision function is asserted: none of them may take a parameter
    that could carry an outcome.
    """
    banned = {"truth", "ground_truth", "retry_conversions", "converted", "outcome"}
    for fn in (
        decide_no_intervention,
        decide_naive_retry,
        decide_static_rules,
        decide_revenue_doctor,
    ):
        params = set(inspect.signature(fn).parameters)
        assert not (params & banned), "%s can see an outcome: %s" % (
            fn.__name__, params & banned
        )


def test_decisions_are_unchanged_when_the_truth_is_inverted(batch, monkeypatch):
    """The behavioural half of the same claim.

    Invert every outcome in the ground truth and re-derive the decisions. If
    any strategy were reading it -- directly, or through a helper that quietly
    loaded the merchant file again -- the decisions would move. They must not.
    """
    failures, settled = batch
    signed = load_mandate(MERCHANT)
    before = [d.model_dump() for d in decide_revenue_doctor(
        failures, signed, settled=settled)]

    real = cf._ground_truth(MERCHANT)
    monkeypatch.setattr(
        cf, "_ground_truth", lambda m: {k: not v for k, v in real.items()}
    )
    after = [d.model_dump() for d in decide_revenue_doctor(
        failures, signed, settled=settled)]

    assert before == after


def test_inverting_the_truth_does_change_the_score(batch, monkeypatch):
    """The control for the test above.

    If the score were also unmoved, the previous test would be passing for the
    wrong reason -- the truth would simply not be reaching the marker.
    """
    failures, settled = batch
    signed = load_mandate(MERCHANT)
    d = decide_revenue_doctor(failures, signed, settled=settled)
    real = cf._ground_truth(MERCHANT)

    hit = cf._reveal("x", "x", "", d, real, signed, failures)
    flipped = cf._reveal(
        "x", "x", "", d, {k: not v for k, v in real.items()}, signed, failures
    )
    assert hit.recovered_paise != flipped.recovered_paise


# -- 2. determinism --------------------------------------------------------

def test_the_lab_is_deterministic():
    a = run_lab(MERCHANT).model_dump_json()
    b = run_lab(MERCHANT).model_dump_json()
    assert a == b


def test_the_lab_writes_nothing(tmp_path):
    """Opening the page must not create a run file or touch the batch."""
    runs = ROOT / "data" / "runs"
    synth = ROOT / "data" / "synthetic"
    before = {
        p: p.stat().st_mtime for p in list(runs.glob("*.json")) + list(synth.glob("*.json"))
    }
    run_lab(MERCHANT)
    after = {
        p: p.stat().st_mtime for p in list(runs.glob("*.json")) + list(synth.glob("*.json"))
    }
    assert before == after


# -- 3. the comparison is over one batch ----------------------------------

def test_every_strategy_sees_the_same_batch(lab):
    """Different denominators would make the whole table meaningless."""
    for s in lab.strategies:
        touched = (
            s.attempted_payments + s.held + s.denied + s.escalated + s.abstained
        )
        assert touched == lab.batch_failures, (
            "%s ruled on %d of %d payments" % (s.key, touched, lab.batch_failures)
        )


def test_no_policy_beats_the_ceiling(lab):
    """No strategy can recover a payment that would never have converted."""
    for s in lab.strategies + ([lab.observed] if lab.observed else []):
        assert s.recovered_paise <= lab.convertible_paise
        assert s.converted <= lab.convertible


def test_no_intervention_is_the_floor(lab):
    a = next(s for s in lab.strategies if s.key == "no_intervention")
    assert a.attempts == 0 and a.recovered_paise == 0 and a.converted == 0


# -- 4. the actual finding: the baselines win by breaking the mandate ------

def test_the_naive_baselines_breach_the_mandate(lab):
    """This is the result, and it is the reason gross recovery is not the score.

    Naive retry and static rules recover more on this batch. They do it by
    exceeding the per-payment attempt cap and by retrying amounts above the
    signed ceiling -- things Revenue Doctor is forbidden to do. If either
    number ever reached zero the comparison would have stopped being a
    comparison.
    """
    naive = next(s for s in lab.strategies if s.key == "naive_retry")
    static = next(s for s in lab.strategies if s.key == "static_rules")

    assert naive.cap_violations > 0
    assert naive.ceiling_violations > 0
    assert static.cap_violations > 0


def test_revenue_doctor_never_breaches_the_mandate(lab):
    for key in ("revenue_doctor", "revenue_doctor_confirmed"):
        s = next(x for x in lab.strategies if x.key == key)
        assert s.mandate_violations == 0, "%s breached the mandate" % key
        assert s.cap_violations == 0
        assert s.ceiling_violations == 0


def test_revenue_doctor_spends_far_fewer_attempts(lab):
    naive = next(s for s in lab.strategies if s.key == "naive_retry")
    rd = next(s for s in lab.strategies if s.key == "revenue_doctor")
    assert rd.attempts < naive.attempts
    assert rd.wasted_attempts < naive.wasted_attempts
    # And it is more accurate per payment it does touch.
    assert rd.recovery_rate > naive.recovery_rate


# -- 5. abstention is a first-class outcome -------------------------------

def test_revenue_doctor_abstains_and_says_why(lab, batch):
    """ABSTAIN is not DENY. One is the mandate refusing, one is the system
    declining, and a product that conflates them cannot explain itself."""
    failures, settled = batch
    signed = load_mandate(MERCHANT)
    ds = decide_revenue_doctor(failures, signed, settled=settled)

    abstained = [d for d in ds if d.disposition == Disposition.ABSTAIN]
    denied = [d for d in ds if d.disposition == Disposition.DENY]
    assert abstained and denied

    reasons = {d.reason for d in abstained}
    assert reasons <= {"NOT_RECOVERABLE_BY_CLASS", "BELOW_EVIDENCE_FLOOR"}
    assert "NOT_RECOVERABLE_BY_CLASS" in reasons
    # A denial always carries a policy reason code, never an abstention one.
    assert all(d.reason.startswith("DENY_") for d in denied)


def test_naive_retry_abstains_on_nothing(lab):
    """The contrast that makes abstention worth counting."""
    naive = next(s for s in lab.strategies if s.key == "naive_retry")
    assert naive.abstained == 0


def test_a_higher_floor_abstains_more(batch):
    """The evidence floor has to actually bind, or it is decoration."""
    failures, settled = batch
    signed = load_mandate(MERCHANT)
    low = decide_revenue_doctor(failures, signed, p_floor=0.0, settled=settled)
    high = decide_revenue_doctor(failures, signed, p_floor=0.5, settled=settled)

    def abstains(ds):
        return sum(1 for d in ds if d.disposition == Disposition.ABSTAIN)

    assert abstains(high) > abstains(low)


# -- 6. stopping rules -----------------------------------------------------

def test_attempts_respect_the_history_the_merchant_already_spent(batch):
    """Stopping rule 1 counts the merchant's own prior attempts."""
    failures, settled = batch
    signed = load_mandate(MERCHANT)
    cap = signed.mandate.max_attempts_per_payment
    prior = {p.txn_id: p.prior_attempts for p in failures}

    for d in decide_revenue_doctor(failures, signed, settled=settled):
        if d.disposition == Disposition.RECOVER:
            assert prior[d.txn_id] + d.attempts <= cap


def test_a_payment_at_the_cap_is_denied_not_attempted(batch):
    failures, signed = batch[0], load_mandate(MERCHANT)
    cap = signed.mandate.max_attempts_per_payment
    at_cap = [p for p in failures if p.prior_attempts >= cap]
    if not at_cap:
        pytest.skip("no payment in this batch has exhausted its attempts")
    ids = {p.txn_id for p in at_cap}
    for d in decide_revenue_doctor(failures, signed, settled=batch[1]):
        if d.txn_id in ids:
            assert d.disposition != Disposition.RECOVER


# -- 7. confirming a hold is not widening the mandate ---------------------

def test_confirming_step_ups_releases_holds_but_not_denials(lab):
    rd = next(s for s in lab.strategies if s.key == "revenue_doctor")
    ok = next(s for s in lab.strategies if s.key == "revenue_doctor_confirmed")

    assert ok.held == 0
    assert ok.denied == rd.denied, "confirming released something the mandate denied"
    assert ok.denied_paise == rd.denied_paise
    assert ok.recovered_paise >= rd.recovered_paise


# -- 8. the frontier -------------------------------------------------------

def test_the_frontier_is_a_real_trade(lab):
    """More autonomy recovers more AND exposes more. Both, or it is not a trade."""
    pts = lab.frontier
    assert len(pts) >= 4
    lo, hi = pts[0], pts[-1]
    assert hi.recovered_paise > lo.recovered_paise
    assert hi.unsupervised_paise > lo.unsupervised_paise
    # Held money is what the dial converts into unsupervised money.
    assert hi.held_paise < lo.held_paise


def test_the_frontier_recovery_is_monotone_in_the_limit(lab):
    """Raising the auto-execute limit can never recover less."""
    seq = [p.recovered_paise for p in lab.frontier]
    assert seq == sorted(seq)


def test_the_frontier_marks_the_signed_mandate(lab):
    marked = [p for p in lab.frontier if p.shipped]
    assert len(marked) == 1
    signed = load_mandate(MERCHANT)
    assert marked[0].auto_limit_paise == signed.mandate.auto_execute_limit_paise


def test_every_frontier_point_is_a_mandate_that_verifies():
    """A point the gate would refuse is not a point on the curve."""
    signed = load_mandate(MERCHANT)
    for limit in (0, 250_000, signed.mandate.max_amount_paise):
        assert cf._resign(signed, MERCHANT, limit).verify()


# -- 9. the explanation cannot drift from the evaluation ------------------

def test_the_explanation_quotes_the_evaluation_verbatim(lab):
    """No prose is generated; every field is lifted from a StrategyResult."""
    rd = next(s for s in lab.strategies if s.key == "revenue_doctor")
    naive = next(s for s in lab.strategies if s.key == "naive_retry")
    c = lab.choice

    assert c["expected_recovery_paise"] == rd.recovered_paise
    assert c["attempts"] == rd.attempts
    assert c["friction_paise"] == rd.friction_paise
    assert c["net_paise"] == rd.recovered_paise - rd.friction_paise
    assert c["attempts_avoided_vs_naive"] == naive.attempts - rd.attempts
    assert c["alternatives"]["naive_retry"]["cap_violations"] == naive.cap_violations
    assert c["ceiling_paise"] == lab.convertible_paise


def test_friction_is_the_stated_constant_and_nothing_else(lab):
    for s in lab.strategies:
        assert s.friction_paise == s.attempts * cf.FRICTION_PAISE_PER_ATTEMPT
        assert s.net_paise == s.recovered_paise - s.friction_paise


# -- 10. the observed arm is labelled apart from the replays --------------

def test_the_observed_arm_is_not_labelled_counterfactual(lab):
    assert lab.observed is not None
    assert lab.observed.basis == "observed"
    assert all(s.basis == "counterfactual" for s in lab.strategies)
    assert lab.label == "SYNTHETIC EVALUATION"


def test_the_observed_arm_agrees_with_the_runs_own_score(lab):
    """The lab and scoring.py must not disagree about what the run recovered."""
    runs = ROOT / "data" / "runs"
    rec = None
    for p in sorted(runs.glob("*.json")):
        r = json.loads(p.read_text(encoding="utf-8"))
        if r.get("merchant_id") == MERCHANT:
            rec = r
            break
    assert rec is not None
    rv = rec["report"]["measured"]["recovery_vs_truth"]
    assert lab.observed.attempts == rv["attempted"]
    assert lab.observed.converted == rv["truly_converted"]
    assert lab.observed.recovered_paise == rv["measured_paise"]


# -- 11. it works for every merchant on the book --------------------------

@pytest.mark.parametrize("merchant", [
    "cloudsync", "quickmart", "voltbill", "medisure",
    "urbanthread", "techbazaar", "chaipoint", "fuelstop",
])
def test_the_lab_runs_for_every_merchant(merchant):
    lab = run_lab(merchant)
    assert lab.batch_failures > 0
    assert lab.at_risk_paise > 0
    rd = next(s for s in lab.strategies if s.key == "revenue_doctor")
    assert rd.mandate_violations == 0
    assert rd.recovered_paise <= lab.convertible_paise
