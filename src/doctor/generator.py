"""Seeded merchant generation with injected causes and EXACT ground truth.

This is the module the entire validation protocol rests on, so the design is
worth stating plainly.

Synthetic data is normally a weakness. Here it is inverted into the source of
truth, because we control what is true. But that only works if "what is true"
is computed rigorously rather than asserted. So:

    GROUND TRUTH is the Shapley decomposition computed ANALYTICALLY over the
    merchant's true generating distribution -- the exact joint, exact
    p_success, no sampling, no importance weighting.

    THE ESTIMATE is the Shapley decomposition the engine produces from the
    sampled transactions, using importance weighting under an independence
    assumption.

The difference between them is precisely the estimator's error, and it has
three identifiable sources: sampling noise (finite batch), importance-weighting
bias (clamping, thin strata), and the independence assumption (when rho > 0).
That is what makes the MAE in evals/results/ mean something, and what lets the
correlation study isolate the third source by sweeping rho.

Injection strengths are calibrated: the caller asks for a penalty in POINTS,
and a bisection finds the distribution shift that delivers it. Without that,
"we injected a bank skew" spans an unknown range of true magnitudes and the
error grid is uninterpretable.
"""

from __future__ import annotations

import hashlib
import random
from itertools import combinations, product
from math import factorial
from typing import Iterable, Sequence

from pydantic import BaseModel

from .baseline import Baseline
from .cohort import Cohort, build_cohort
from .features import (
    FACTORS,
    AmountBand,
    ErrorClass,
    HourBand,
    Method,
    MerchantProfile,
    Transaction,
)
from .priors import BUSINESS_DECLINE_MIX

#: How many banks the joint distribution spans. 20 x 4 x 4 x 4 = 1280 cells,
#: still small enough to hold the exact joint in memory and compute ground
#: truth with no Monte Carlo.
#:
#: This was 12, chosen purely for tractability, and the cutoff turned out to
#: matter: Bank of India sits 13th by national volume and Fino 18th, so a
#: whole band of real issuers -- about 11% of UPI volume, and the band where
#: performance drifts most -- could never appear in a generated merchant. A
#: merchant book with no tail is not a merchant book.
N_BANKS = 20

Cell = tuple[str, str, str, str]  # (bank, method, hour_band, amount_band)


# --------------------------------------------------------------------------
# exact distributions
# --------------------------------------------------------------------------


def _normalise(d: dict[str, float]) -> dict[str, float]:
    total = sum(d.values())
    return {k: v / total for k, v in d.items()} if total > 0 else dict(d)


def independent_joint(marginals: dict[str, dict[str, float]]) -> dict[Cell, float]:
    joint: dict[Cell, float] = {}
    for b, pb in marginals["bank"].items():
        for m, pm in marginals["method"].items():
            for h, ph in marginals["hour"].items():
                for a, pa in marginals["amount_band"].items():
                    p = pb * pm * ph * pa
                    if p > 0:
                        joint[(b, m, h, a)] = p
    return joint


def _comonotone_pair(
    pa: dict[str, float], pb: dict[str, float], rank_a: list[str], rank_b: list[str]
) -> dict[tuple[str, str], float]:
    """Frechet upper-bound coupling: pair worst-with-worst, best-with-best.

    Walks the two sorted mass vectors together, emitting the overlap of each
    pair of intervals. This is the maximally correlated joint with the given
    marginals.
    """
    out: dict[tuple[str, str], float] = {}
    i = j = 0
    ra = [pa[v] for v in rank_a]
    rb = [pb[v] for v in rank_b]
    while i < len(ra) and j < len(rb):
        take = min(ra[i], rb[j])
        if take > 1e-12:
            out[(rank_a[i], rank_b[j])] = out.get((rank_a[i], rank_b[j]), 0.0) + take
        ra[i] -= take
        rb[j] -= take
        if ra[i] <= 1e-12:
            i += 1
        if j < len(rb) and rb[j] <= 1e-12:
            j += 1
    return out


def correlated_joint(
    marginals: dict[str, dict[str, float]],
    baseline: Baseline,
    rho: float,
    couple: tuple[str, str] | None,
) -> dict[Cell, float]:
    """Joint with a controlled dependence between one pair of factors.

    joint = (1 - rho) * independent + rho * comonotone-on-the-coupled-pair.

    Factors are ranked by how much failure they carry, so the comonotone
    coupling pairs the merchant's worst bank with its worst hour -- which is
    what actually happens in the wild when a badly-timed billing cron hits a
    customer base concentrated on one weak issuer, and which is exactly the
    case where marginal reweighting should struggle.
    """
    if not couple or rho <= 0:
        return independent_joint(marginals)

    fa, fb = couple
    rank_a = _rank_by_badness(fa, marginals[fa], baseline)
    rank_b = _rank_by_badness(fb, marginals[fb], baseline)
    pair = _comonotone_pair(marginals[fa], marginals[fb], rank_a, rank_b)

    rest = [f for f in FACTORS if f not in couple]
    indep = independent_joint(marginals)
    como: dict[Cell, float] = {}
    for (va, vb), p_pair in pair.items():
        for combo in product(*[marginals[f].items() for f in rest]):
            p = p_pair
            values = {fa: va, fb: vb}
            for f, (v, pv) in zip(rest, combo):
                values[f] = v
                p *= pv
            if p > 0:
                cell = tuple(values[f] for f in FACTORS)  # type: ignore[assignment]
                como[cell] = como.get(cell, 0.0) + p

    # SORTED, and this matters. Iterating `set(indep) | set(como)` walks the
    # cells in an order that depends on Python's per-process string hash seed,
    # which changes the order the floats are summed in downstream, which moves
    # the analytic ground truth at the 15th significant figure. Every value
    # stayed correct; the committed numbers simply stopped being byte-identical
    # between runs. Determinism is a deliverable here, so the order is pinned.
    out: dict[Cell, float] = {}
    for cell in sorted(set(indep) | set(como)):
        out[cell] = (1 - rho) * indep.get(cell, 0.0) + rho * como.get(cell, 0.0)
    return out


def _rank_by_badness(
    factor: str, values: dict[str, float], baseline: Baseline
) -> list[str]:
    """Order a factor's values worst-first, holding the others at a reference."""
    ref_bank = "State Bank of India"
    scores: dict[str, float] = {}
    for v in values:
        if factor == "bank":
            scores[v] = baseline.bank_fail_rate(v)
        elif factor == "method":
            scores[v] = 1.0 - baseline.p_success(
                ref_bank, Method(v), HourBand.MORNING, AmountBand.SMALL
            )
        elif factor == "hour":
            scores[v] = 1.0 - baseline.p_success(
                ref_bank, Method.UPI, HourBand(v), AmountBand.SMALL
            )
        else:
            scores[v] = 1.0 - baseline.p_success(
                ref_bank, Method.UPI, HourBand.MORNING, AmountBand(v)
            )
    return sorted(values, key=lambda v: -scores[v])


def _cell_p_success(cell: Cell, baseline: Baseline) -> float:
    b, m, h, a = cell
    return baseline.p_success(b, Method(m), HourBand(h), AmountBand(a))


def expected_success(joint: dict[Cell, float], baseline: Baseline) -> float:
    total = sum(joint.values())
    if total <= 0:
        return 0.0
    return sum(p * _cell_p_success(c, baseline) for c, p in joint.items()) / total


# --------------------------------------------------------------------------
# analytic ground truth
# --------------------------------------------------------------------------


def _joint_marginal_on(joint: dict[Cell, float], S: frozenset[str]) -> dict[tuple, float]:
    idx = [i for i, f in enumerate(FACTORS) if f in S]
    out: dict[tuple, float] = {}
    for cell, p in joint.items():
        key = tuple(cell[i] for i in idx)
        out[key] = out.get(key, 0.0) + p
    return out


def true_value(
    joint: dict[Cell, float],
    cohort_marginals: dict[str, dict[str, float]],
    S: frozenset[str],
    baseline: Baseline,
    s_true: float,
) -> float:
    """Exact v(S): replace the joint marginal on S with the cohort's, keeping
    the conditional structure of the remaining factors intact.

        P_S(x) = [prod_{i in S} q_i(x_i)] * P(x) / P_S_marginal(x_S)

    When the joint is a product this collapses to the familiar form, but
    writing it this way is what makes the ground truth correct under
    correlation -- which is the whole point of the rho sweep.
    """
    if not S:
        return 0.0
    idx = [i for i, f in enumerate(FACTORS) if f in S]
    marg = _joint_marginal_on(joint, S)
    num = 0.0
    den = 0.0
    for cell, p in joint.items():
        key = tuple(cell[i] for i in idx)
        m = marg.get(key, 0.0)
        if m <= 0:
            continue
        q = 1.0
        for i in idx:
            q *= cohort_marginals[FACTORS[i]].get(cell[i], 0.0)
        w = q * p / m
        if w <= 0:
            continue
        num += w * _cell_p_success(cell, baseline)
        den += w
    return (num / den - s_true) if den > 0 else 0.0


def analytic_shapley(
    joint: dict[Cell, float],
    cohort: Cohort,
    baseline: Baseline,
) -> tuple[dict[str, float], float, dict[str, float]]:
    """Ground-truth Shapley values in points, plus v(N) and all coalitions."""
    s_true = expected_success(joint, baseline)
    n = len(FACTORS)
    v: dict[frozenset[str], float] = {}
    for r in range(n + 1):
        for combo in combinations(FACTORS, r):
            S = frozenset(combo)
            v[S] = true_value(joint, cohort.marginals, S, baseline, s_true)

    phi: dict[str, float] = {}
    for i in FACTORS:
        others = [f for f in FACTORS if f != i]
        total = 0.0
        for r in range(len(others) + 1):
            for combo in combinations(others, r):
                S = frozenset(combo)
                w = factorial(r) * factorial(n - r - 1) / factorial(n)
                total += w * (v[S | {i}] - v[S])
        phi[i] = total * 100.0
    coalitions = {
        ("+".join(f for f in FACTORS if f in S) or "{}"): val * 100.0
        for S, val in v.items()
    }
    return phi, v[frozenset(FACTORS)] * 100.0, coalitions


# --------------------------------------------------------------------------
# injections
# --------------------------------------------------------------------------


def _shift_toward(
    marginal: dict[str, float], target_value: str, strength: float
) -> dict[str, float]:
    """Move `strength` of the total mass onto one value, scaling the rest down."""
    strength = min(max(strength, 0.0), 0.98)
    out = {k: v * (1.0 - strength) for k, v in marginal.items()}
    out[target_value] = out.get(target_value, 0.0) + strength
    return _normalise(out)


def _shift_toward_set(
    marginal: dict[str, float], targets: Sequence[str], strength: float
) -> dict[str, float]:
    strength = min(max(strength, 0.0), 0.98)
    out = {k: v * (1.0 - strength) for k, v in marginal.items()}
    share = strength / len(targets)
    for t in targets:
        out[t] = out.get(t, 0.0) + share
    return _normalise(out)


def _one_factor_effect(
    marginals: dict[str, dict[str, float]],
    factor: str,
    shifted: dict[str, float],
    baseline: Baseline,
) -> float:
    """Points of success rate lost by moving ONE factor's marginal.

    Used only to calibrate injection strength. The recorded ground truth is
    always the full Shapley value, not this.
    """
    clean = independent_joint(marginals)
    dirty_marginals = dict(marginals)
    dirty_marginals[factor] = shifted
    dirty = independent_joint(dirty_marginals)
    return (expected_success(clean, baseline) - expected_success(dirty, baseline)) * 100.0


def calibrate_strength(
    marginals: dict[str, dict[str, float]],
    factor: str,
    targets: Sequence[str],
    target_pts: float,
    baseline: Baseline,
) -> tuple[float, float]:
    """Bisect the shift strength until the injected penalty hits target_pts.

    Returns (strength, realised_pts). If the target is unreachable even at
    maximum skew, returns the closest achievable -- and the caller records the
    realised value, never the requested one.
    """
    lo, hi = 0.0, 0.95
    best = (0.0, 0.0)
    for _ in range(40):
        mid = (lo + hi) / 2
        shifted = _shift_toward_set(marginals[factor], targets, mid)
        pts = _one_factor_effect(marginals, factor, shifted, baseline)
        best = (mid, pts)
        if abs(pts - target_pts) < 0.01:
            break
        if pts < target_pts:
            lo = mid
        else:
            hi = mid
    return best


# --------------------------------------------------------------------------
# generation
# --------------------------------------------------------------------------


class GroundTruth(BaseModel):
    """What is actually true about this merchant, by construction."""

    model_config = {"frozen": True}

    injected_causes: list[str]
    #: The label the LLM hypothesiser is scored against (§4.2), = the
    #: strongest injected cause.
    primary_cause: str
    #: Exact analytic Shapley value per factor, in points.
    true_attribution: dict[str, float]
    true_v_n: float
    true_coalitions: dict[str, float]
    #: NO_SOFT_DECLINE_RETRY is scored against this, not against a Shapley
    #: value -- see §5.0.
    true_process_gap_pts: float
    #: What was asked for vs what the calibration actually delivered.
    requested_pts: dict[str, float]
    realised_pts: dict[str, float]
    rho_nominal: float
    rho_realised: float
    coupled_factors: list[str]
    s_true: float
    s_star: float


class GeneratedMerchant(BaseModel):
    model_config = {"frozen": True}

    profile: MerchantProfile
    transactions: list[Transaction]
    ground_truth: GroundTruth
    seed: int


CAUSE_TARGETS: dict[str, tuple[str, tuple[str, ...]]] = {
    # cause -> (factor, values to push mass onto)
    "midnight_billing_penalty": ("hour", (HourBand.NIGHT.value,)),
    "amount_band_risk": ("amount_band", (AmountBand.LARGE.value,)),
    "method_mix_mismatch": ("method", (Method.UPI_MANDATE.value, Method.CARD.value)),
}


def _worst_banks(marginals: dict[str, dict[str, float]], baseline: Baseline, k: int = 1):
    ranked = _rank_by_badness("bank", marginals["bank"], baseline)
    return tuple(ranked[:k])


def _realised_rho(joint: dict[Cell, float], couple: tuple[str, str] | None,
                  baseline: Baseline) -> float:
    """Spearman-style correlation between the two coupled factors' badness.

    Reported instead of trusting the nominal knob, because the mixture
    construction does not deliver its nominal rho exactly.
    """
    if not couple:
        return 0.0
    ia, ib = FACTORS.index(couple[0]), FACTORS.index(couple[1])
    marg_a = {}
    marg_b = {}
    for cell, p in joint.items():
        marg_a[cell[ia]] = marg_a.get(cell[ia], 0.0) + p
        marg_b[cell[ib]] = marg_b.get(cell[ib], 0.0) + p
    rank_a = {v: i for i, v in enumerate(_rank_by_badness(couple[0], marg_a, baseline))}
    rank_b = {v: i for i, v in enumerate(_rank_by_badness(couple[1], marg_b, baseline))}
    ex = ey = exy = exx = eyy = 0.0
    for cell, p in joint.items():
        x, y = float(rank_a[cell[ia]]), float(rank_b[cell[ib]])
        ex += p * x
        ey += p * y
        exy += p * x * y
        exx += p * x * x
        eyy += p * y * y
    cov = exy - ex * ey
    va, vb = exx - ex * ex, eyy - ey * ey
    if va <= 0 or vb <= 0:
        return 0.0
    return cov / (va ** 0.5 * vb ** 0.5)


# --------------------------------------------------------------------------
# error codes -- drawn from the real Razorpay taxonomy
# --------------------------------------------------------------------------

import json as _json
from pathlib import Path as _Path

_LABELS_PATH = _Path(__file__).resolve().parents[2] / "evals" / "error_labels.json"

#: Codes that only make sense on particular rails. Assigning a card CVV error
#: to a UPI payment would be an obvious tell to anyone who reads the batch,
#: and would also corrupt the classification eval's method feature.
_METHOD_HINTS: dict[str, tuple[str, ...]] = {
    "card": ("card", "cvv", "emi", "atm_pin", "cardholder"),
    "upi": ("upi", "vpa", "psp", "collect", "device"),
    "netbanking": ("netbanking",),
    "upi_mandate": ("mandate", "upi", "vpa", "psp", "autopay", "reqauth"),
}
_ALL_HINTS = {h for hs in _METHOD_HINTS.values() for h in hs}

_CODES_BY_CLASS: dict[str, list[dict]] | None = None


def codes_by_class() -> dict[str, list[dict]]:
    """The hand-labelled taxonomy, grouped by class. Loaded once."""
    global _CODES_BY_CLASS
    if _CODES_BY_CLASS is None:
        if not _LABELS_PATH.exists():
            raise FileNotFoundError(
                "%s missing -- run: python scripts/build_error_labels.py"
                % _LABELS_PATH
            )
        data = _json.loads(_LABELS_PATH.read_text(encoding="utf-8"))
        grouped: dict[str, list[dict]] = {}
        for rec in data["labels"]:
            grouped.setdefault(rec["category"], []).append(rec)
        for v in grouped.values():
            v.sort(key=lambda r: r["code"])  # determinism
        _CODES_BY_CLASS = grouped
    return _CODES_BY_CLASS


def pick_error(error_class: ErrorClass, method: Method, rng: random.Random) -> str:
    """Choose a plausible published code for this class and rail.

    Assigning a card CVV error to a UPI payment would be an obvious tell to
    anyone who opens the batch, so codes carrying another rail's marker are
    excluded rather than merely deprioritised.
    """
    pool = codes_by_class()[error_class.value]
    hints = _METHOD_HINTS.get(method.value, ())
    on_rail = [c for c in pool if any(h in c["code"] for h in hints)]
    generic = [c for c in pool if not any(h in c["code"] for h in _ALL_HINTS)]
    candidates = on_rail + generic
    return rng.choice(candidates or pool)["code"]


def choose_error_class(
    bank: str, baseline: Baseline, rng: random.Random
) -> ErrorClass:
    """Split a failure into technical vs business using MEASURED NPCI data.

    A bank's TD/BD ratio is published per month, so the technical share is not
    a guess -- it is the one part of the failure mix that comes from reality.
    How business declines then split into soft / hard / auth is a prior.
    """
    st = baseline.bank_stats(bank)
    tech_share = st.technical_share if st else 0.25
    if rng.random() < tech_share:
        return ErrorClass.TECHNICAL
    total = sum(p.value for p in BUSINESS_DECLINE_MIX.values())
    r = rng.random() * total
    acc = 0.0
    for name, prior in BUSINESS_DECLINE_MIX.items():
        acc += prior.value
        if r <= acc:
            return ErrorClass(name)
    return ErrorClass.SOFT_DECLINE


# --------------------------------------------------------------------------
# the public entry point
# --------------------------------------------------------------------------

_BAND_HOURS = {
    "night": [23, 0, 1, 2, 3, 4, 5],
    "morning": [6, 7, 8, 9, 10, 11],
    "afternoon": [12, 13, 14, 15, 16, 17],
    "evening": [18, 19, 20, 21, 22],
}
_BAND_AMOUNTS = {
    "micro": (2_00, 199_00),
    "small": (200_00, 999_00),
    "medium": (1_000_00, 4_999_00),
    "large": (5_000_00, 25_000_00),
}


def _sample_cells(joint: dict[Cell, float], n: int, rng: random.Random) -> list[Cell]:
    # Sorted so the sample depends only on the seed, never on dict ordering.
    cells = sorted(joint)
    weights = [joint[c] for c in cells]
    return rng.choices(cells, weights=weights, k=n)


def generate_merchant(
    *,
    merchant_id: str,
    name: str,
    mcc: str,
    n_txns: int,
    seed: int,
    causes: Sequence[str],
    target_pts: dict[str, float] | None = None,
    rho: float = 0.0,
    baseline: Baseline | None = None,
    retry_rate_when_healthy: float = 0.75,
) -> GeneratedMerchant:
    """Build one merchant, its batch, and the exact truth about it.

    `causes` names the injected problems; `target_pts` says how many points
    each should be worth, and the strength is calibrated to deliver that so
    the error grid spans a known range of true magnitudes.
    """
    baseline = baseline or Baseline()
    rng = random.Random(seed)
    cohort = build_cohort(mcc, baseline)

    # Start the merchant ON the cohort profile, then break it deliberately.
    # Restricting to the top N banks keeps the exact joint tractable.
    top_banks = dict(
        sorted(cohort.marginals["bank"].items(), key=lambda kv: -kv[1])[:N_BANKS]
    )
    marginals: dict[str, dict[str, float]] = {
        "bank": _normalise(top_banks),
        "method": dict(cohort.marginals["method"]),
        "hour": dict(cohort.marginals["hour"]),
        "amount_band": dict(cohort.marginals["amount_band"]),
    }

    target_pts = dict(target_pts or {})
    requested: dict[str, float] = {}
    realised: dict[str, float] = {}
    injected_factors: list[str] = []

    for cause in causes:
        if cause == "no_soft_decline_retry":
            continue  # a policy, not a distribution -- applied at sampling time
        if cause == "bank_concentration":
            factor = "bank"
            targets = _worst_banks(marginals, baseline, k=1)
        else:
            factor, targets = CAUSE_TARGETS[cause]
            in_range = tuple(t for t in targets if t in marginals[factor])
            targets = in_range or tuple(marginals[factor])[:1]
        want = target_pts.get(cause, 2.0)
        strength, got = calibrate_strength(marginals, factor, targets, want, baseline)
        marginals[factor] = _shift_toward_set(marginals[factor], targets, strength)
        requested[cause] = want
        realised[cause] = got
        injected_factors.append(factor)

    couple = (
        (injected_factors[0], injected_factors[1])
        if rho > 0 and len(injected_factors) >= 2
        else None
    )
    joint = correlated_joint(marginals, baseline, rho, couple)
    s_true = expected_success(joint, baseline)
    phi_true, v_n_true, coalitions_true = analytic_shapley(joint, cohort, baseline)

    # --- realise the batch -------------------------------------------------
    skips_retry = "no_soft_decline_retry" in causes
    txns: list[Transaction] = []
    for i, cell in enumerate(_sample_cells(joint, n_txns, rng)):
        bank, method, hband, aband = cell
        lo, hi = _BAND_AMOUNTS[aband]
        p = _cell_p_success(cell, baseline)
        ok = rng.random() < p
        ecls = None if ok else choose_error_class(bank, baseline, rng)
        code = None if ok else pick_error(ecls, Method(method), rng)
        retried = False
        if not ok and ecls in (ErrorClass.SOFT_DECLINE, ErrorClass.TECHNICAL):
            retried = (not skips_retry) and rng.random() < retry_rate_when_healthy
        txns.append(
            Transaction(
                txn_id="pay_%s_%04d" % (merchant_id, i),
                merchant_id=merchant_id,
                mcc=mcc,
                bank=bank,
                method=Method(method),
                hour=rng.choice(_BAND_HOURS[hband]),
                day=rng.randint(1, 28),
                amount_paise=rng.randint(lo, hi),
                succeeded=ok,
                error_code=code,
                error_class=ecls,
                retried=retried,
                attempts=2 if retried else 1,
            )
        )

    avg_ticket = sum(t.amount_paise for t in txns) // max(len(txns), 1)
    profile = MerchantProfile(
        merchant_id=merchant_id,
        name=name,
        mcc=mcc,
        mcc_description=cohort.family,
        monthly_txn_count=len(txns),
        avg_ticket_paise=avg_ticket,
    )

    from .shapley import process_gap  # local import avoids an import cycle

    if realised:
        primary = max(realised, key=lambda k: realised[k])
    elif causes:
        primary = causes[0]
    else:
        primary = "none_of_the_above"

    gt = GroundTruth(
        injected_causes=list(causes),
        primary_cause=primary,
        true_attribution=phi_true,
        true_v_n=v_n_true,
        true_coalitions=coalitions_true,
        true_process_gap_pts=process_gap(txns),
        requested_pts=requested,
        realised_pts=realised,
        rho_nominal=rho,
        rho_realised=_realised_rho(joint, couple, baseline),
        coupled_factors=list(couple) if couple else [],
        s_true=s_true,
        s_star=cohort.s_star,
    )
    return GeneratedMerchant(
        profile=profile, transactions=txns, ground_truth=gt, seed=seed
    )
