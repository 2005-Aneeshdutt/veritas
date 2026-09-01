"""Choosing WHEN to retry, not just whether.

The bug this closes is subtle and was invisible for a long time: the baseline
ladder's `policy_t` has always chosen a per-payment delay from the failure
class and the bank's technical share, while the shipped pipeline passed a flat
36 hours for everything. The eval was crediting the product with sequencing it
did not do.

`test_the_shipped_ladder_matches_the_one_the_eval_scores` is the guard against
that reopening. If the two ever drift apart again, the published T-vs-B3
comparison stops describing the product and this test fails first.
"""

from datetime import datetime, timedelta, timezone

import pytest

from chitragupta.policy import BANK_DEGRADED_HOLD, RECOVERY_WINDOW
from chitragupta.rails.mock_rail import p_retry_success
from doctor.sequence import (
    INCIDENT_TECH_SHARE,
    NAIVE_HOURS,
    first_slot_hours,
    ladder_for,
    plan_retries,
)

FAILED = datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc)
NOW = FAILED + timedelta(minutes=5)


def test_technical_failures_are_retried_early():
    """An incident clears in hours. Waiting is pure loss."""
    s = plan_retries("p", "technical", FAILED, now=NOW)
    assert s.attempts
    assert s.attempts[0].hours_after_failure <= 4.0


def test_funding_failures_skip_the_dead_zone():
    """Retrying an empty account within hours asks the same question twice."""
    s = plan_retries("p", "soft_decline", FAILED, now=NOW)
    assert all(a.hours_after_failure >= 24.0 for a in s.attempts)


def test_a_soft_decline_on_an_incident_bank_is_treated_as_an_incident():
    normal = plan_retries("p", "soft_decline", FAILED, now=NOW, technical_share=0.1)
    incident = plan_retries(
        "p", "soft_decline", FAILED, now=NOW, technical_share=INCIDENT_TECH_SHARE + 0.1
    )
    assert (
        incident.attempts[0].hours_after_failure
        < normal.attempts[0].hours_after_failure
    ), "an issuer mid-incident should be retried sooner than an empty account"


def test_the_shipped_ladder_matches_the_one_the_eval_scores():
    """The regression that motivated this module.

    Mirrors evals/run_baseline_ladder.py::policy_t. If these drift, the
    published T-vs-B3 result stops describing the shipped system.
    """
    import inspect

    import evals.run_baseline_ladder as ladder_eval

    src = inspect.getsource(ladder_eval.policy_t)
    assert "ladder_for(" in src, (
        "policy_t must import the shipped ladder, not restate it -- that is "
        "how the two drifted apart in the first place"
    )
    assert ladder_for("technical") == (2.0, 8.0, 24.0)
    assert ladder_for("soft_decline", 0.5) == (6.0, 24.0, 48.0)


def test_every_funding_slot_sits_inside_the_rails_plateau():
    """The bug the uplift test caught.

    The rail scores 24-72h at 1.0 and 72-120h at 0.7, so a slot at 84h was
    worth less than simply repeating the first attempt -- the ladder came out
    WORSE than the flat schedule it was supposed to beat.
    """
    for h in ladder_for("soft_decline", 0.1):
        assert 24.0 <= h <= 72.0, "+%gh is outside the plateau" % h


def test_nothing_is_scheduled_outside_the_recovery_window():
    """The kernel denies anything older than 7 days, so proposing one is a bug."""
    for ec in ("technical", "soft_decline"):
        for age_days in (0, 3, 6, 7, 10):
            s = plan_retries(
                "p", ec, FAILED, now=FAILED + timedelta(days=age_days)
            )
            for a in s.attempts:
                assert (
                    timedelta(hours=a.hours_after_failure) <= RECOVERY_WINDOW
                ), "%s at %dd proposed +%gh, past the window" % (
                    ec, age_days, a.hours_after_failure
                )


def test_a_slot_pushed_past_the_window_by_a_slide_is_dropped():
    """The ordering bug: the window check has to run AFTER sliding."""
    s = plan_retries(
        "p", "soft_decline", FAILED,
        now=FAILED + timedelta(days=6, hours=23),
    )
    for a in s.attempts:
        assert timedelta(hours=a.hours_after_failure) <= RECOVERY_WINDOW


def test_a_bank_hold_moves_the_slot_rather_than_dropping_it():
    held = FAILED + timedelta(hours=30)
    s = plan_retries(
        "p", "soft_decline", FAILED, now=NOW, bank_held_at=held, technical_share=0.1
    )
    assert s.attempts, "a brief hold is a reason to wait, not to give up"
    for a in s.attempts:
        at = FAILED + timedelta(hours=a.hours_after_failure)
        assert at >= held + BANK_DEGRADED_HOLD or at < held


def test_the_attempt_cap_is_respected():
    for used in (0, 1, 2, 3, 5):
        s = plan_retries("p", "soft_decline", FAILED, now=NOW, attempts_used=used)
        assert len(s.attempts) <= max(0, 3 - used)


def test_no_attempts_left_says_so():
    s = plan_retries("p", "soft_decline", FAILED, now=NOW, attempts_used=3)
    assert s.attempts == []
    assert "No attempts left" in s.headline


def test_the_comparison_is_against_the_same_number_of_attempts():
    """Otherwise a 3-attempt ladder beats 1 naive attempt and says nothing."""
    s = plan_retries("p", "soft_decline", FAILED, now=NOW, technical_share=0.1)
    one = p_retry_success("soft_decline", NAIVE_HOURS)
    expected = 1 - (1 - one) ** len(s.attempts)
    assert s.naive_p == pytest.approx(expected, abs=1e-3)


def test_sequencing_earns_most_on_technical_failures():
    """The honest finding: the old flat 36h was already fine for funding
    problems and badly wrong for incidents."""
    soft = plan_retries("p", "soft_decline", FAILED, now=NOW, technical_share=0.1)
    tech = plan_retries("p", "technical", FAILED, now=NOW)
    assert tech.uplift > soft.uplift
    assert soft.uplift == pytest.approx(0.0, abs=0.02)


def test_each_attempt_gets_its_own_slot():
    """A second try must not be the first one repeated."""
    slots = [first_slot_hours("technical", n) for n in (1, 2, 3)]
    assert len(set(slots)) == 3
    assert slots == sorted(slots)


def test_an_unrecoverable_class_falls_back_rather_than_crashing():
    assert first_slot_hours("hard_decline") in (
        NAIVE_HOURS,
        *ladder_for("soft_decline"),
    )


class TestTheScheduleReachesTheScreen:
    """The ladder is planned per error class and was invisible for weeks.

    Only the first slot's hours ever leaked out, inside an action's reason
    string. These tests are about the endpoint that surfaces it telling the
    truth in both directions -- including the direction that flatters nobody.
    """

    def _get(self, run_id="run_beec9668"):
        from fastapi.testclient import TestClient

        from doctor.api import app

        r = TestClient(app).get("/api/run/%s/schedule" % run_id)
        assert r.status_code == 200, r.text
        return r.json()

    def test_it_counts_retries_by_their_real_error_class(self):
        """The first cut read the report's unrecoverable list, where a payment
        the agent chose to RETRY can never appear -- so every retry defaulted
        to soft_decline and a run full of technical failures reported zero."""
        d = self._get()
        by = {c["error_class"]: c for c in d["classes"]}
        assert by["technical"]["payments"] > 0, "technical retries went missing again"
        assert by["soft_decline"]["payments"] > 0
        assert by["technical"]["value_paise"] > 0

    def test_the_two_classes_are_scheduled_differently(self):
        """If both ladders came out the same the whole module is decoration."""
        d = self._get()
        by = {c["error_class"]: c for c in d["classes"]}
        tech = [a["hours_after_failure"] for a in by["technical"]["attempts"]]
        soft = [a["hours_after_failure"] for a in by["soft_decline"]["attempts"]]
        assert tech != soft
        assert tech[0] < soft[0], "a technical failure must be retried sooner"

    def test_it_reports_the_case_where_sequencing_earns_nothing(self):
        """The honest half. A soft decline's flat 36h already sat in its good
        window, and claiming a lift there would make the technical number
        worthless."""
        d = self._get()
        by = {c["error_class"]: c for c in d["classes"]}
        assert by["soft_decline"]["lift_pts"] == 0
        assert by["technical"]["lift_pts"] > 5

    def test_every_slot_survives_the_kernels_own_constraints(self):
        """A schedule proposing an attempt the gate would refuse is not a
        schedule."""
        from chitragupta.policy import RECOVERY_WINDOW

        d = self._get()
        for c in d["classes"]:
            assert len(c["attempts"]) <= 3, "over the mandate's attempt cap"
            for a in c["attempts"]:
                hours = a["hours_after_failure"]
                assert hours <= RECOVERY_WINDOW.total_seconds() / 3600, (
                    "%s attempt %d falls outside the recovery window"
                    % (c["error_class"], a["n"])
                )

    def test_the_lift_is_the_difference_it_claims_to_be(self):
        d = self._get()
        for c in d["classes"]:
            expect = round(100 * (c["cumulative_p"] - c["naive_p"]), 2)
            assert abs(c["lift_pts"] - expect) < 0.01

    def test_an_unknown_run_refuses(self):
        from fastapi.testclient import TestClient

        from doctor.api import app

        assert TestClient(app).get("/api/run/nope/schedule").status_code == 404
