"""Never charge a payment that already went through.

The worst thing an agent in this position can do is not "recover nothing".
It is collecting the same payment twice -- that costs the merchant a refund,
a chargeback risk and the customer, and no amount of recovered revenue buys
that back.

This was previously prevented by a filter in `apply_group`, which is
protection the kernel could not promise and no other caller inherited. It is
a rule now, and it runs before every other check.
"""

from datetime import datetime, timezone

import pytest

from chitragupta.mandate import Mandate, SignedMandate
from chitragupta.policy import GateContext, ReasonCode, evaluate
from chitragupta.types import ActionType, PolicyDecision, ProposedAction


def _mandate():
    """A real, validly signed mandate.

    A hand-built one with a dummy signature is refused by rule 1 before any
    of this is reached -- which is correct of the kernel and useless for
    testing what comes after it.
    """
    from doctor.run import load_mandate

    return load_mandate("cloudsync")


def _action(txn="pay_1", kind=ActionType.RETRY_SOFT_DECLINE, amount=1000):
    return ProposedAction(
        txn_id=txn,
        action_type=kind,
        amount_paise=amount,
        reason="test",
    )


def _ctx(settled=(), attempts=None):
    return GateContext(
        now=datetime.now(timezone.utc),
        attempts_by_txn=attempts or {},
        settled_txns=set(settled),
    )


def test_a_settled_payment_is_refused(monkeypatch):
    """The whole point of the rule."""
    got = evaluate(_action("pay_1"), _mandate(), _ctx(settled=["pay_1"]))
    assert got.decision is PolicyDecision.DENY
    assert got.reason_code == ReasonCode.DENY_ALREADY_SETTLED


def test_an_unsettled_payment_is_untouched():
    got = evaluate(_action("pay_2"), _mandate(), _ctx(settled=["pay_1"]))
    assert got.decision is not PolicyDecision.DENY


def test_the_rule_runs_before_the_attempt_cap():
    """A payment that is both settled AND over its cap must be refused for
    having been paid. Reporting the cap would tell a merchant the agent ran
    out of tries, when in fact it was about to double-charge someone."""
    got = evaluate(
        _action("pay_1"),
        _mandate(),
        _ctx(settled=["pay_1"], attempts={"pay_1": 99}),
    )
    assert got.reason_code == ReasonCode.DENY_ALREADY_SETTLED


def test_escalating_a_settled_payment_is_still_allowed():
    """Flagging one for a human to look at moves no money, and blocking it
    would strand exactly the payments someone most needs to see."""
    got = evaluate(
        _action("pay_1", ActionType.FLAG_FOR_INVESTIGATION, 0),
        _mandate(),
        _ctx(settled=["pay_1"]),
    )
    assert got.decision is not PolicyDecision.DENY


def test_the_kernel_enforces_it_not_the_caller():
    """It used to live in apply_group's filtering, where any other caller of
    the gate inherited none of it."""
    import inspect

    from chitragupta import policy

    src = inspect.getsource(policy)
    assert "settled_txns" in src
    assert "DENY_ALREADY_SETTLED" in src


def test_apply_reads_settled_payments_from_the_ledger():
    """Not from a side table that could drift from what actually happened."""
    import inspect

    from doctor import apply

    src = inspect.getsource(apply.apply_group)
    assert "settled_txns=" in src
    assert '"executed"' in src


def test_the_committed_book_never_retried_a_paid_payment():
    """A regression check against the data itself, not just the code."""
    import glob
    import json

    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        paid = set()
        for e in rec["report"]["ledger"]:
            a = e.get("proposed_action") or {}
            if not a.get("action_type", "").startswith("retry"):
                continue
            if e["txn_id"] in paid and e.get("outcome") in ("executed", "exception"):
                pytest.fail(
                    "%s retried %s after it was collected"
                    % (rec["merchant_id"], e["txn_id"])
                )
            if e.get("outcome") == "executed":
                paid.add(e["txn_id"])
