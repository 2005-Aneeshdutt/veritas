"""Offering a fresh payment link to customers who fumbled authentication.

These were being written off. An auth failure is a wrong OTP, a wrong PIN, or
someone who walked away at the 3DS screen -- and the system filed the money
under unrecoverable and did nothing, while REISSUE_PAYMENT_LINK sat in the
action enum unused. Across the demo book that was 347 payments and Rs 11.3
lakh, about a quarter of all failed value.

Two properties matter here and both are about restraint:

  * it must never execute unattended, because it messages the merchant's
    customer
  * it must not claim a conversion rate, because nobody here knows one
"""

import pytest

from chitragupta.types import ActionType
from doctor.features import ErrorClass, Method, Transaction
from doctor.plan import _reissue_for_auth_failures


def txn(i, cls, amount=50_000, succeeded=False):
    return Transaction(
        txn_id="pay_%04d" % i,
        merchant_id="testco",
        mcc="5411",
        bank="State Bank of India",
        method=Method.CARD,
        hour=14,
        day=8,
        amount_paise=amount,
        succeeded=succeeded,
        error_code=None if succeeded else "incorrect_otp",
        error_class=None if succeeded else cls,
    )


def test_every_auth_failure_gets_a_link():
    txns = [txn(i, ErrorClass.AUTH_FAILURE) for i in range(5)]
    actions = _reissue_for_auth_failures(txns)
    assert len(actions) == 5
    assert all(a.action_type is ActionType.REISSUE_PAYMENT_LINK for a in actions)


def test_it_never_runs_unattended():
    """It messages the merchant's customer. That is theirs to authorise."""
    actions = _reissue_for_auth_failures([txn(1, ErrorClass.AUTH_FAILURE)])
    assert actions[0].requires_merchant_approval is True


def test_no_conversion_rate_is_claimed():
    """The rail does not model a reissue and neither does anything else here.
    Inventing a rate to inflate the recovery figure is the thing this project
    refuses to do everywhere else."""
    a = _reissue_for_auth_failures([txn(1, ErrorClass.AUTH_FAILURE)])[0]
    assert "No conversion rate is claimed" in a.reason
    assert "value at stake" in a.reason


def test_successful_payments_are_left_alone():
    txns = [txn(i, ErrorClass.AUTH_FAILURE, succeeded=True) for i in range(3)]
    assert _reissue_for_auth_failures(txns) == []


@pytest.mark.parametrize(
    "cls",
    [ErrorClass.SOFT_DECLINE, ErrorClass.TECHNICAL, ErrorClass.HARD_DECLINE],
)
def test_only_auth_failures_get_a_link(cls):
    """A soft decline gets a retry; a hard decline gets nothing. Sending a new
    link to someone whose card is closed is noise."""
    assert _reissue_for_auth_failures([txn(1, cls)]) == []


def test_the_largest_are_offered_first():
    txns = [
        txn(1, ErrorClass.AUTH_FAILURE, amount=10_000),
        txn(2, ErrorClass.AUTH_FAILURE, amount=90_000),
        txn(3, ErrorClass.AUTH_FAILURE, amount=50_000),
    ]
    amounts = [a.amount_paise for a in _reissue_for_auth_failures(txns)]
    assert amounts == sorted(amounts, reverse=True)


def test_the_action_carries_the_real_amount():
    """Unlike a routing change, this IS about that specific payment."""
    a = _reissue_for_auth_failures([txn(1, ErrorClass.AUTH_FAILURE, amount=77_000)])[0]
    assert a.amount_paise == 77_000


def test_the_reason_quotes_the_error_code():
    a = _reissue_for_auth_failures([txn(1, ErrorClass.AUTH_FAILURE)])[0]
    assert "incorrect_otp" in a.reason


def test_the_kernel_steps_these_up_rather_than_allowing_them():
    """The property that actually protects the customer, checked against the
    real policy kernel rather than assumed from the flag."""
    from datetime import datetime, timezone

    from chitragupta.policy import GateContext, evaluate
    from doctor.run import load_mandate

    signed = load_mandate("quickmart")
    ctx = GateContext(now=datetime.now(timezone.utc), attempts_by_txn={})
    action = _reissue_for_auth_failures(
        [txn(1, ErrorClass.AUTH_FAILURE, amount=20_000)]
    )[0]
    gate = evaluate(action, signed, ctx)
    assert gate.decision.value != "allow", (
        "a reissue must not be allowed unattended -- it messages a customer"
    )


def test_a_group_of_these_is_not_badged_as_automatic():
    """REISSUE_PAYMENT_LINK is auto-executable in principle, so the badge has
    to come from the action's own approval flag, not from its type."""
    import glob
    import json

    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        for g in rec.get("pending_actions", []):
            if g["group_id"] == "reissue_payment_link":
                assert g["auto"] is False
                return
    pytest.skip("no run with reissues on file")
