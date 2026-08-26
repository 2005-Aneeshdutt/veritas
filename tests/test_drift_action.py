"""Drift proposing an intervention, and the mandate ruling on it.

The proactive half used to stop at a report. These pin the part that makes it
an agent instead: a detected degradation becomes a typed action, gated against
the same signed mandate everything else goes through.

Two of these exist because of bugs found while writing it:

  * `test_a_routing_change_carries_no_amount` -- the first version put the
    monthly exposure in `amount_paise`, so a configuration change was compared
    against a per-payment money ceiling and every intervention worth making was
    denied.
  * `test_small_movements_are_reported_but_not_acted_on` -- an agent that
    proposes a routing change for every fractional wobble in a noisy monthly
    series is an agent nobody reads.
"""

import pytest

from chitragupta.types import ActionType
from doctor.drift import (
    MATERIAL_DELTA_PTS,
    MATERIAL_EXPOSURE_PAISE,
    Exposure,
    _propose_intervention,
    build_drift_report,
    simulate_exposure,
)


def expo(delta: float, paise: int, merchant: str = "quickmart") -> Exposure:
    return Exposure(
        merchant_id=merchant,
        merchant_name="QuickMart",
        run_id="run_test",
        bank="State Bank of India",
        share_pct=31.0,
        delta_pts=delta,
        exposure_paise=paise,
    )


def test_small_movements_are_reported_but_not_acted_on():
    got = _propose_intervention(expo(MATERIAL_DELTA_PTS - 0.1, 50_000_00))
    assert got.actionable is False
    assert got.proposed_action is None
    assert got.gate_decision is None
    assert "not acted on" in got.rationale


def test_small_money_is_reported_but_not_acted_on():
    got = _propose_intervention(expo(4.0, MATERIAL_EXPOSURE_PAISE - 1))
    assert got.actionable is False
    assert got.proposed_action is None


def test_a_material_movement_becomes_a_gated_action():
    got = _propose_intervention(expo(2.5, 50_000_00))
    assert got.actionable is True
    assert got.proposed_action is not None
    assert (
        got.proposed_action["action_type"] == ActionType.ENABLE_MULTI_BANK_ROUTING
    )
    assert got.gate_decision in ("allow", "step_up", "deny")


def test_a_routing_change_carries_no_amount():
    """The regression that mattered.

    The mandate's ceiling governs how much money one action MOVES. A routing
    change moves none. Passing the monthly exposure made the kernel compare a
    config change against a per-payment money limit and deny it.
    """
    got = _propose_intervention(expo(3.0, 12_00_000_00))
    assert got.proposed_action["amount_paise"] == 0
    assert got.gate_decision != "deny", (
        "a routing change was denied on an amount ceiling it should not touch"
    )
    assert "CEILING" not in (got.gate_reason or "")


def test_re_routing_always_needs_the_merchant():
    """The agent cannot move a merchant's traffic on their behalf."""
    got = _propose_intervention(expo(3.0, 50_000_00))
    assert got.proposed_action["requires_merchant_approval"] is True
    assert got.gate_decision != "allow" or got.gate_reason == "OK_MERCHANT_ACTION"


def test_the_reason_quotes_the_evidence():
    got = _propose_intervention(expo(2.5, 50_000_00))
    reason = got.proposed_action["reason"]
    assert "2.5" in reason and "31" in reason
    assert "NPCI" in reason


def test_an_unknown_merchant_is_denied_not_assumed():
    got = _propose_intervention(expo(3.0, 50_000_00, merchant="not_a_merchant"))
    assert got.gate_decision == "deny"
    assert got.gate_reason == "DENY_NO_MANDATE_ON_FILE"


def test_the_report_counts_what_it_put_to_the_mandate():
    r = build_drift_report()
    assert r.interventions_proposed == sum(1 for e in r.exposures if e.actionable)
    assert sum(r.intervention_decisions.values()) == sum(
        1 for e in r.exposures if e.gate_decision
    )


def test_simulation_uses_the_merchants_real_share():
    a = simulate_exposure("quickmart", "State Bank of India", 1.0)
    b = simulate_exposure("quickmart", "State Bank of India", 2.0)
    assert a.share_pct == b.share_pct, "share is real, only the movement is supposed"
    assert b.exposure_paise > a.exposure_paise
    assert b.exposure_paise == pytest.approx(2 * a.exposure_paise, rel=0.01)


def test_simulating_a_bank_the_merchant_does_not_use_is_refused():
    with pytest.raises(ValueError):
        simulate_exposure("quickmart", "Ujjivan Small Finance Bank Limited", 3.0)
