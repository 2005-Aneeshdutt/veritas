"""The sealed-envelope console.

Two properties carry the whole demo, and neither is about accuracy:

  * the engine cannot see the answer  -- `blind_batch` carries no ground truth
  * the seal cannot be moved afterwards -- change any part of the truth and the
    published digest stops matching

If either of those fails, the console is theatre. Accuracy is measured by the
validation sweep; what is pinned here is that the exam is honest.
"""

import pytest

from chitragupta.canonical import sha256_hex
from doctor.baseline import Baseline
from doctor.cohort import build_cohort
from doctor.plan import load_mae
from doctor.prove import (
    CAUSES,
    _sealed_payload,
    blind_batch,
    load_challenge,
    new_challenge,
    score,
    verify_seal,
)
from doctor.shapley import ShapleyDecomposer

SPEC = dict(mcc="5411", n_txns=400, magnitude_pts=2.5, seed=90210)


@pytest.fixture(scope="module")
def sealed():
    return new_challenge(causes=["midnight_billing_penalty"], **SPEC)


def _diagnose(m):
    b = Baseline()
    return ShapleyDecomposer(b, build_cohort(m.profile.mcc, b)).decompose(
        blind_batch(m), mae_by_factor=load_mae()
    )


def test_the_batch_handed_to_the_engine_has_no_answer_in_it(sealed):
    _, m = sealed
    batch = blind_batch(m)
    assert batch, "there should be payments"
    for t in batch:
        assert not hasattr(t, "ground_truth")
        assert "true_attribution" not in t.model_dump()


def test_the_challenge_never_leaks_the_truth(sealed):
    challenge, m = sealed
    published = challenge.model_dump_json()
    assert m.ground_truth.primary_cause not in published
    for cause in m.ground_truth.injected_causes:
        assert cause not in published
    # The count is fair game; which ones is not.
    assert challenge.spec["n_causes"] == len(m.ground_truth.injected_causes)


def test_the_seal_matches_what_is_revealed(sealed):
    challenge, m = sealed
    result = score(m, _diagnose(m), load_mae())
    assert result.seal == challenge.seal
    assert verify_seal(result.sealed_payload, challenge.seal)


def test_moving_any_part_of_the_truth_breaks_the_seal(sealed):
    challenge, m = sealed
    payload = _sealed_payload(m)

    for field in ("primary_cause", "true_attribution", "s_true", "injected_causes"):
        tampered = dict(payload)
        if field == "true_attribution":
            tampered[field] = {**payload[field], "bank": payload[field]["bank"] + 0.01}
        elif field == "injected_causes":
            tampered[field] = list(payload[field]) + ["bank_concentration"]
        elif field == "s_true":
            tampered[field] = payload[field] + 1e-6
        else:
            tampered[field] = "amount_band_risk"
        assert not verify_seal(tampered, challenge.seal), (
            "%s was changed and the seal still matched" % field
        )


def test_the_seal_is_reproducible_from_the_stored_challenge(sealed):
    challenge, _ = sealed
    _, reloaded = load_challenge(challenge.challenge_id)
    assert sha256_hex(_sealed_payload(reloaded)) == challenge.seal


def test_the_same_spec_reproduces_the_same_seal():
    a, _ = new_challenge(causes=["amount_band_risk"], **SPEC)
    b, _ = new_challenge(causes=["amount_band_risk"], **SPEC)
    assert a.seal == b.seal, "a seeded challenge must be reproducible"


def test_a_different_seed_produces_a_different_seal():
    a, _ = new_challenge(causes=["amount_band_risk"], **{**SPEC, "seed": 1})
    b, _ = new_challenge(causes=["amount_band_risk"], **{**SPEC, "seed": 2})
    assert a.seal != b.seal


def test_scoring_reports_the_planner_decision_for_every_factor(sealed):
    _, m = sealed
    result = score(m, _diagnose(m), load_mae())
    allowed = {"act alone", "ask the merchant", "refuse", "no measured error"}
    assert {v.agent_would for v in result.factors} <= allowed
    assert len(result.factors) == 4


def test_an_uninjected_merchant_has_no_primary_cause_to_find():
    _, m = new_challenge(causes=[], **{**SPEC, "seed": 555})
    result = score(m, _diagnose(m), load_mae())
    assert result.true_primary is None
    assert result.primary_correct is None
    assert "no primary cause" in result.verdict


@pytest.mark.parametrize("cause", CAUSES)
def test_every_offered_cause_can_actually_be_sealed(cause):
    """The menu must not advertise a cause the generator cannot inject."""
    challenge, m = new_challenge(causes=[cause], **{**SPEC, "seed": 4})
    assert challenge.seal
    assert cause in m.ground_truth.injected_causes
