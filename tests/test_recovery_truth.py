"""The retry counterfactual that turns a projected rupee into a measured one.

Two things have to hold or the whole measurement is worthless:

  * the engine must not be able to see it -- it lives on GroundTruth, never on
    a Transaction, so the batch handed to the decomposer cannot leak it
  * adding it must not have moved anything -- it is drawn from a separate RNG
    precisely so the sampled batches stay byte-identical to what was already
    committed

The second is the one that would be easy to get wrong and hard to notice.
"""

import random

import pytest

from doctor.baseline import Baseline
from doctor.features import ErrorClass
from doctor.generator import (
    _TRUE_RETRY_BASE,
    _true_retry_conversion,
    generate_merchant,
)

SPEC = dict(
    merchant_id="t",
    name="T",
    mcc="5411",
    n_txns=600,
    causes=["bank_concentration"],
    target_pts={"bank_concentration": 2.0},
)


@pytest.fixture(scope="module")
def merchant():
    return generate_merchant(seed=4242, **SPEC)


def test_the_counterfactual_is_not_on_the_transactions(merchant):
    """The engine receives Transactions. None of them may carry the answer."""
    for t in merchant.transactions[:50]:
        d = t.model_dump()
        assert "retry_conversions" not in d
        assert "would_convert" not in d
        assert not hasattr(t, "retry_conversions")


def test_a_counterfactual_is_held_for_every_recoverable_failure(merchant):
    held = merchant.ground_truth.retry_conversions
    recoverable = [
        t
        for t in merchant.transactions
        if not t.succeeded
        and t.error_class in (ErrorClass.SOFT_DECLINE, ErrorClass.TECHNICAL)
    ]
    assert recoverable, "the fixture should contain recoverable failures"
    assert {t.txn_id for t in recoverable} == set(held)


def test_no_counterfactual_is_held_for_an_unrecoverable_failure(merchant):
    held = merchant.ground_truth.retry_conversions
    for t in merchant.transactions:
        if not t.succeeded and t.error_class not in (
            ErrorClass.SOFT_DECLINE,
            ErrorClass.TECHNICAL,
        ):
            assert t.txn_id not in held, (
                "%s is a %s -- no retry addresses it, so there is no "
                "counterfactual to hold" % (t.txn_id, t.error_class)
            )


def test_successful_payments_have_no_counterfactual(merchant):
    held = merchant.ground_truth.retry_conversions
    for t in merchant.transactions:
        if t.succeeded:
            assert t.txn_id not in held


def test_adding_the_counterfactual_did_not_disturb_the_batch():
    """The whole point of the separate RNG.

    If the counterfactual were drawn from the main stream, every downstream
    draw would shift and every committed number in the repo would move.
    Re-generating with the same seed must reproduce identical payments.
    """
    a = generate_merchant(seed=777, **SPEC)
    b = generate_merchant(seed=777, **SPEC)
    assert [t.model_dump() for t in a.transactions] == [
        t.model_dump() for t in b.transactions
    ]
    assert a.ground_truth.true_attribution == b.ground_truth.true_attribution
    assert a.ground_truth.retry_conversions == b.ground_truth.retry_conversions


def test_the_true_model_differs_in_shape_from_the_rail():
    """If both models keyed on the same things, measuring one against the
    other would be circular. The truth must respond to amount; the rail does
    not see amount at all."""
    b = Baseline()
    bank = "State Bank of India"

    def rate(amount, n=4000):
        rng = random.Random(11)
        hits = sum(
            bool(
                _true_retry_conversion(
                    ErrorClass.SOFT_DECLINE, amount, bank, b, rng
                )
            )
            for _ in range(n)
        )
        return hits / n

    small = rate(100_00)
    large = rate(900_00)
    assert large < small - 0.05, (
        "a large ask must convert materially less often (%.3f vs %.3f)"
        % (large, small)
    )


def test_unrecoverable_classes_have_no_true_conversion():
    b = Baseline()
    rng = random.Random(0)
    for ecls in (ErrorClass.HARD_DECLINE, ErrorClass.AUTH_FAILURE, None):
        assert (
            _true_retry_conversion(ecls, 50_00, "State Bank of India", b, rng)
            is None
        )


def test_technical_failures_convert_more_often_than_soft_declines():
    assert (
        _TRUE_RETRY_BASE[ErrorClass.TECHNICAL]
        > _TRUE_RETRY_BASE[ErrorClass.SOFT_DECLINE]
    ), "an incident clearing is a better bet than a customer finding money"


def test_the_conversion_rate_is_plausible(merchant):
    """Not a target -- a sanity bound. Every retry converting, or none of
    them, would mean the model is broken rather than merely wrong."""
    held = merchant.ground_truth.retry_conversions
    rate = sum(held.values()) / len(held)
    assert 0.05 < rate < 0.75, "implausible true conversion rate %.3f" % rate
