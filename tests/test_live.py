"""The online detector.

The property that matters is not that it fires. It is that it stays quiet
when it should — a monitor that always finds an incident is not detecting
anything, and on a demo it is worse than nothing.

The first version of this got the Wilson bound backwards and alerted on a
bank with zero failures, because the pessimistic end of a small sample is
always high. `test_silent_on_a_clean_bank` is that bug, pinned.
"""

import pytest

from doctor.baseline import Baseline
from doctor.features import Method, Transaction
from doctor.live import MIN_SAMPLES, LiveMonitor, in_arrival_order

BANK = "State Bank of India"


def txn(i: int, succeeded: bool, bank: str = BANK, day: int = 1, hour: int = 9):
    return Transaction(
        txn_id="pay_%04d" % i,
        merchant_id="testco",
        mcc="5411",
        bank=bank,
        method=Method.UPI,
        hour=hour,
        day=day,
        amount_paise=50_000,
        succeeded=succeeded,
        error_code=None if succeeded else "payment_failed",
    )


@pytest.fixture
def monitor():
    return LiveMonitor(Baseline())


def _feed(monitor, outcomes, bank=BANK):
    alerts = []
    for i, ok in enumerate(outcomes):
        a = monitor.observe(txn(i, ok, bank=bank))
        if a is not None:
            alerts.append(a)
    return alerts


def test_silent_on_a_clean_bank(monitor):
    """Zero failures must never raise an alert, however many payments."""
    assert _feed(monitor, [True] * 300) == []


def test_silent_at_the_published_rate(monitor):
    """A bank performing as NPCI says it does is not an incident."""
    stats = Baseline().bank_stats(BANK)
    fail_rate = (stats.bd_pct + stats.td_pct) / 100.0
    n = 400
    # Failures spread evenly at exactly the national rate.
    every = max(2, int(round(1 / fail_rate)))
    outcomes = [(i % every != 0) for i in range(n)]
    assert _feed(monitor, outcomes) == []


def test_silent_below_the_minimum_sample(monitor):
    """Even a total outage says nothing until there is enough to be sure."""
    assert _feed(monitor, [False] * (MIN_SAMPLES - 1)) == []


def test_fires_on_a_bank_that_is_confidently_worse(monitor):
    alerts = _feed(monitor, [False] * 60)
    assert alerts, "a 100% failure rate over 60 payments must alert"
    a = alerts[0]
    assert a.bank == BANK
    assert a.observed_fail_pct == 100.0
    assert a.confident_fail_pct > a.npci_fail_pct
    assert a.delta_pts > 0


def test_the_confident_floor_never_exceeds_what_was_observed(monitor):
    """It is a lower bound. Above the observed rate would mean overstating."""
    alerts = _feed(monitor, ([False] * 3 + [True]) * 20)
    for a in alerts:
        assert a.confident_fail_pct <= a.observed_fail_pct + 1e-9


def test_one_bad_bank_does_not_implicate_a_healthy_one(monitor):
    for i in range(200):
        monitor.observe(txn(i, False, bank=BANK))
        monitor.observe(txn(10_000 + i, True, bank="HDFC Bank Ltd."))
    assert BANK in monitor.alerted
    assert "HDFC Bank Ltd." not in monitor.alerted


def test_cooldown_stops_a_degrading_bank_flooding_the_feed(monitor):
    alerts = _feed(monitor, [False] * 600)
    assert 0 < len(alerts) <= 6, "600 failing payments should not be 600 alerts"


def test_snapshot_counts_match_what_was_fed(monitor):
    _feed(monitor, [True] * 90 + [False] * 10)
    s = monitor.snapshot()
    assert s["seen"] == 100
    assert s["failed"] == 10
    assert s["success_pct"] == 90.0
    assert s["at_risk_paise"] == 10 * 50_000


def test_arrival_order_is_by_day_then_hour():
    txns = [
        txn(0, True, day=3, hour=1),
        txn(1, True, day=1, hour=20),
        txn(2, True, day=1, hour=4),
    ]
    got = [t.txn_id for t in in_arrival_order(txns)]
    assert got == ["pay_0002", "pay_0001", "pay_0000"]


def test_playback_rate_cannot_change_what_is_detected():
    """The detector is per-payment, so speed must not enter into it."""
    outcomes = ([False] * 3 + [True] * 7) * 40
    a = _feed(LiveMonitor(Baseline()), outcomes)
    b = _feed(LiveMonitor(Baseline()), outcomes)
    assert [x.at_payment for x in a] == [x.at_payment for x in b]
    assert [x.delta_pts for x in a] == [x.delta_pts for x in b]
