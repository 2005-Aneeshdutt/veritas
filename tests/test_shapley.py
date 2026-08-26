import random

import pytest

from doctor.baseline import Baseline
from doctor.cohort import build_cohort
from doctor.features import FACTORS, ErrorClass, Method, Transaction
from doctor.shapley import (
    ShapleyDecomposer,
    merchant_marginals,
    naive_attribution,
    observed_rate,
    process_gap,
)

BANKS = ["State Bank of India", "HDFC Bank Ltd.", "Bank Of India", "Axis Bank Ltd."]


def make_txns(n=200, seed=7, banks=None, hours=None, methods=None, amounts=None):
    rng = random.Random(seed)
    banks = banks or BANKS
    hours = hours or list(range(24))
    methods = methods or [Method.UPI, Method.CARD]
    amounts = amounts or [15000, 45000, 150000, 700000]
    base = Baseline()
    out = []
    for i in range(n):
        bank = rng.choice(banks)
        method = rng.choice(methods)
        hour = rng.choice(hours)
        amt = rng.choice(amounts)
        t = Transaction(
            txn_id="pay_%d" % i,
            merchant_id="m1",
            mcc="5411",
            bank=bank,
            method=method,
            hour=hour,
            day=rng.randint(1, 28),
            amount_paise=amt,
            succeeded=True,
        )
        p = base.p_success_txn(t)
        ok = rng.random() < p
        out.append(
            t.model_copy(
                update={
                    "succeeded": ok,
                    "error_class": None if ok else ErrorClass.SOFT_DECLINE,
                    "error_code": None if ok else "insufficient_funds",
                    "retried": False,
                }
            )
        )
    return out


@pytest.fixture(scope="module")
def setup():
    base = Baseline()
    coh = build_cohort("5411", base)
    return base, coh, ShapleyDecomposer(base, coh)


def test_efficiency_shapley_values_sum_to_v_of_grand_coalition(setup):
    # THE property. sum(phi_i) == v(N). If this fails the decomposition is
    # not a decomposition.
    _, _, dec = setup
    txns = make_txns()
    d = dec.decompose(txns)
    v_n = d.coalition_values["+".join(FACTORS)]
    assert d.explained_pts == pytest.approx(v_n, abs=1e-9)


def test_residual_is_the_gap_minus_v_of_n_and_is_reported(setup):
    _, _, dec = setup
    d = dec.decompose(make_txns())
    v_n = d.coalition_values["+".join(FACTORS)]
    assert d.residual_pts == pytest.approx(d.gap_pts - v_n, abs=1e-9)
    assert d.explained_pts + d.residual_pts == pytest.approx(d.gap_pts, abs=1e-9)


def test_empty_coalition_has_zero_value(setup):
    _, _, dec = setup
    d = dec.decompose(make_txns())
    assert d.coalition_values["{}"] == pytest.approx(0.0)


def test_all_sixteen_coalitions_are_computed(setup):
    _, _, dec = setup
    d = dec.decompose(make_txns())
    assert len(d.coalition_values) == 2 ** len(FACTORS) == 16


def test_decomposition_is_deterministic(setup):
    # RULE 3. Same transactions in, byte-identical attribution out.
    _, _, dec = setup
    txns = make_txns()
    a = dec.decompose(txns)
    b = dec.decompose(txns)
    assert a.by_factor() == b.by_factor()
    assert a.residual_pts == b.residual_pts


def test_a_merchant_already_on_the_cohort_profile_has_little_to_explain(setup):
    """Sanity: if nothing is skewed, no factor should carry a large value."""
    _, _, dec = setup
    txns = make_txns(n=400, seed=11)
    d = dec.decompose(txns)
    # v(N) is the total explainable movement; each factor is a share of it.
    assert abs(d.explained_pts) < 25.0


def test_marginals_sum_to_one(setup):
    p = merchant_marginals(make_txns())
    for f in FACTORS:
        assert sum(p[f].values()) == pytest.approx(1.0)


def test_observed_rate_matches_the_transactions(setup):
    txns = make_txns()
    expected = sum(1 for t in txns if t.succeeded) / len(txns)
    assert observed_rate(txns) == pytest.approx(expected)


# 70/30 rather than 100/0, because that is what the generator injects and
# because a 100% skew is the degenerate case tested separately below.
SKEWED_BANKS = ["Bank Of India"] * 7 + [
    "State Bank of India",
    "HDFC Bank Ltd.",
    "Axis Bank Ltd.",
]
SKEWED_HOURS = [23, 0, 1, 2, 3, 4] * 3 + [9, 10, 14, 15, 19, 20]


def test_bank_concentration_is_attributed_to_the_bank_factor(setup):
    """Skew toward the worst bank and the bank factor should carry more."""
    _, _, dec = setup
    spread = dec.decompose(make_txns(n=400, seed=5))
    concentrated = dec.decompose(make_txns(n=400, seed=5, banks=SKEWED_BANKS))
    assert concentrated.by_factor()["bank"] > spread.by_factor()["bank"]


def test_night_concentration_is_attributed_to_the_hour_factor(setup):
    _, _, dec = setup
    spread = dec.decompose(make_txns(n=400, seed=5))
    midnight = dec.decompose(make_txns(n=400, seed=5, hours=SKEWED_HOURS))
    assert midnight.by_factor()["hour"] > spread.by_factor()["hour"]


def test_a_single_valued_factor_is_reported_as_degenerate(setup):
    """Limitation 3: with 100% of payments on one bank there is nothing to
    upweight, so the bank attribution is not identified. The method must say
    so rather than return a confident number."""
    _, _, dec = setup
    d = dec.decompose(make_txns(n=200, banks=["Bank Of India"]))
    assert d.effective_support["bank"] == pytest.approx(1.0)
    assert "bank" in d.degenerate_factors
    # Identifiability is per-factor: bank is unusable, the rest still stand.
    assert "bank" not in {a.factor for a in d.identified()}
    assert {a.factor for a in d.identified()} == {"method", "hour", "amount_band"}


def test_effective_support_counts_distinct_values(setup):
    _, _, dec = setup
    d = dec.decompose(make_txns(n=400, seed=5))
    # Four banks sampled uniformly -> close to 4 effective values.
    assert d.effective_support["bank"] == pytest.approx(4.0, abs=0.3)
    assert not d.degenerate_factors


def test_clamp_rate_is_tracked(setup):
    _, _, dec = setup
    d = dec.decompose(make_txns(n=200, banks=["Some Tiny Gramin Bank"]))
    assert 0.0 <= d.clamp_rate <= 1.0
    assert d.reliable == (
        d.clamp_rate <= 0.35
    )


def test_process_gap_counts_only_unretried_recoverable_failures():
    txns = make_txns(n=100, seed=3)
    # Nothing is marked retried in the fixture, so every recoverable failure
    # counts toward the process gap.
    unretried = sum(
        1 for t in txns if not t.succeeded and t.error_class is not None
    )
    expected = (unretried / len(txns)) * 100.0 * 0.30
    assert process_gap(txns) == pytest.approx(expected)

    retried = [t.model_copy(update={"retried": True}) for t in txns]
    assert process_gap(retried) == pytest.approx(0.0)


def test_process_gap_is_not_part_of_the_shapley_sum(setup):
    """§5.0 -- the process gap sits alongside the decomposition, never inside
    it, or it would break the efficiency property."""
    _, _, dec = setup
    d = dec.decompose(make_txns())
    v_n = d.coalition_values["+".join(FACTORS)]
    assert d.explained_pts == pytest.approx(v_n, abs=1e-9)
    assert d.process_gap_pts > 0.0  # it exists
    assert d.explained_pts != pytest.approx(v_n + d.process_gap_pts)  # but is separate


def test_hard_declines_do_not_count_toward_the_process_gap():
    txns = make_txns(n=60, seed=9)
    hard = [
        t.model_copy(update={"error_class": ErrorClass.HARD_DECLINE})
        if not t.succeeded
        else t
        for t in txns
    ]
    # An expired card does not become a success by being asked twice.
    assert process_gap(hard) == pytest.approx(0.0)


def test_naive_attribution_returns_all_factors(setup):
    base, coh, _ = setup
    naive = naive_attribution(make_txns(), base, coh)
    assert set(naive) == set(FACTORS)


def test_naive_and_shapley_differ_when_factors_are_correlated(setup):
    """The whole justification for the complicated method. Correlate bank with
    hour and the two attributions should not agree."""
    base, coh, dec = setup
    txns = make_txns(n=400, seed=5, banks=SKEWED_BANKS, hours=SKEWED_HOURS)
    shap = dec.decompose(txns).by_factor()
    naive = naive_attribution(txns, base, coh)
    assert any(abs(shap[f] - naive[f]) > 0.1 for f in FACTORS)
