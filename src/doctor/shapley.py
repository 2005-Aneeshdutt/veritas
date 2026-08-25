"""Shapley-ordered Oaxaca-Blinder decomposition of a merchant's success gap.

The problem: a merchant is 4.2 points below their cohort. How much of that is
the bank mix, how much the billing hour, how much the ticket profile? A
groupby will not answer this, because the factors are correlated -- subtract
them in a different order and you get different numbers. Oaxaca-Blinder is the
standard gap-decomposition technique from labour economics; Shapley weighting
over all orderings removes the path dependence.

The value function. For a coalition S of factors, v(S) is the improvement from
"fixing" exactly those factors, computed by importance-weighting the
merchant's OWN transactions toward the cohort-optimal profile:

    w(x)  = prod over i in S of  q_i(x_i) / p_i(x_i)
    v(S)  = [ sum_x w(x) p_success(x) / sum_x w(x) ]  -  s_obs

Then the Shapley value of factor i averages its marginal contribution over
every coalition it could join:

    phi_i = sum over S subset of N\\{i} of
              [ |S|! (n-|S|-1)! / n! ] * [ v(S + i) - v(S) ]

Four factors, sixteen coalitions, no approximation needed.

THREE LIMITATIONS, STATED HERE BECAUSE THEY ARE REAL
---------------------------------------------------
1. Reweighting marginals independently assumes the factors are independent.
   They are not. When they are correlated, Shapley splits credit between them
   -- which is correct behaviour for the axioms, but means the causes are not
   separately identifiable. evals/results/correlation_degradation.json
   measures exactly what this costs as a function of injected rho.

2. s_star is an input, not a discovery (see cohort.py). The residual
   G - v(N) is always reported rather than being distributed away, because a
   decomposition that sums to exactly 100% of the gap is hiding something.

3. OVERLAP. Importance weighting can only reweight strata that actually
   occur. A merchant whose payments are 100% on one bank has no transactions
   on any other bank to upweight, so every weight for that factor is the same
   number, it cancels in the weighted mean, and the factor is not identified
   -- the returned value is noise, not a small effect. This is the positivity
   assumption from causal inference and it bites hardest on exactly the
   merchants whose problem looks most obvious. `effective_support` measures
   it per factor and `degenerate_factors` names the ones that fail, which is
   what puts a merchant on the method-failures exception list rather than
   silently reporting a confident wrong number.
"""

from __future__ import annotations

from collections import defaultdict
from itertools import combinations
from math import factorial
from typing import Iterable, Sequence

from pydantic import BaseModel

from .baseline import Baseline
from .cohort import Cohort
from .features import FACTORS, RECOVERABLE, ErrorClass, Transaction

#: Importance weights are clamped so one rare-stratum transaction cannot
#: dominate the estimate. A high clamp rate is itself a finding: it means the
#: merchant's profile is too far from the cohort for reweighting to be
#: reliable, and that merchant belongs on the method-failures exception list.
WEIGHT_CLAMP = (0.05, 20.0)
#: Above this share of clamped weight, the attribution is flagged unreliable.
#: PROVISIONAL: calibrated against the 200-merchant sweep, not guessed --
#: see evals/run_validation_sweep.py, which reports the realised distribution.
CLAMP_RATE_THRESHOLD = 0.35
#: A factor needs at least this many "effective" distinct values before
#: importance weighting can say anything about it. 1.0 means the merchant has
#: exactly one value and the factor is unidentified; 2.0 means two values of
#: equal weight. See limitation 3 above.
MIN_EFFECTIVE_SUPPORT = 1.35


class FactorAttribution(BaseModel):
    model_config = {"frozen": True}

    factor: str
    points: float
    #: Measured MAE for this factor, loaded from the validation sweep.
    #: None until evals/results/attribution_mae_by_factor.json exists.
    mae: float | None = None

    @property
    def is_inside_error_bar(self) -> bool:
        """True when the estimate is smaller than its own measured error."""
        return self.mae is not None and abs(self.points) < self.mae


class Decomposition(BaseModel):
    model_config = {"frozen": True}

    s_obs: float
    s_star: float
    #: Total gap in points: (s_star - s_obs) * 100.
    gap_pts: float
    #: Shapley value per factor, in points. Sums to v(N) by construction.
    attributions: list[FactorAttribution]
    #: gap_pts - v(N)*100. Never hidden.
    residual_pts: float
    #: The process gap from §5.0, computed directly and NOT part of the
    #: Shapley sum. Reported alongside, visually distinct.
    process_gap_pts: float
    #: All 16 coalition values, for the frontend's coalition explorer.
    coalition_values: dict[str, float]
    clamp_rate: float
    #: factor -> effective number of distinct values (inverse Herfindahl).
    effective_support: dict[str, float]
    #: Factors that fail the overlap check and whose attribution is therefore
    #: not identified. Their numbers are reported but must not be acted on.
    degenerate_factors: list[str]
    #: Whether the reweighting itself held up. Deliberately NOT invalidated by
    #: a degenerate factor: a grocery merchant is ~88% UPI, so `method` is
    #: unidentified for almost all of them, but that says nothing about
    #: whether the BANK attribution is trustworthy. Identifiability is
    #: per-factor and lives in degenerate_factors; this flag is about clamping.
    reliable: bool

    @property
    def explained_pts(self) -> float:
        return sum(a.points for a in self.attributions)

    def by_factor(self) -> dict[str, float]:
        return {a.factor: a.points for a in self.attributions}

    def primary_cause(self) -> str | None:
        """The factor carrying the most of the gap. Used by naive-vs-Shapley."""
        if not self.attributions:
            return None
        return max(self.attributions, key=lambda a: a.points).factor

    def identified(self) -> list[FactorAttribution]:
        """Only the factors the overlap check says are actually estimable."""
        return [
            a for a in self.attributions if a.factor not in self.degenerate_factors
        ]


def observed_rate(txns: Sequence[Transaction]) -> float:
    if not txns:
        return 0.0
    return sum(1 for t in txns if t.succeeded) / len(txns)


def merchant_marginals(txns: Sequence[Transaction]) -> dict[str, dict[str, float]]:
    """The merchant's own realised distribution p_i over each factor."""
    out: dict[str, dict[str, float]] = {}
    for f in FACTORS:
        counts: dict[str, float] = defaultdict(float)
        for t in txns:
            counts[t.factor_value(f)] += 1.0
        n = sum(counts.values())
        out[f] = {k: v / n for k, v in counts.items()} if n else {}
    return out


def effective_support(p: dict[str, dict[str, float]]) -> dict[str, float]:
    """Effective number of distinct values per factor: 1 / sum(p^2).

    The inverse Herfindahl index. A merchant split evenly across four banks
    scores 4.0; one entirely on a single bank scores 1.0, and at 1.0 the
    importance weights for that factor are all identical, cancel in the
    weighted mean, and the factor is unidentified (limitation 3).
    """
    out: dict[str, float] = {}
    for f, dist in p.items():
        hhi = sum(v * v for v in dist.values())
        out[f] = (1.0 / hhi) if hhi > 0 else 0.0
    return out


def _coalition_key(S: Iterable[str]) -> str:
    ordered = [f for f in FACTORS if f in set(S)]
    return "+".join(ordered) if ordered else "{}"


class ShapleyDecomposer:
    def __init__(self, baseline: Baseline, cohort: Cohort) -> None:
        self.baseline = baseline
        self.cohort = cohort

    def _weights(
        self, txns: Sequence[Transaction], S: frozenset[str], p: dict[str, dict[str, float]]
    ) -> tuple[list[float], float]:
        """Importance weights toward the cohort profile on the factors in S."""
        q = self.cohort.marginals
        lo, hi = WEIGHT_CLAMP
        raw: list[float] = []
        for t in txns:
            w = 1.0
            for f in S:
                val = t.factor_value(f)
                p_i = p[f].get(val, 0.0)
                q_i = q[f].get(val, 0.0)
                if p_i <= 0:
                    continue
                # A factor value the cohort never exhibits gets pushed to the
                # floor rather than to zero, so the transaction still counts.
                w *= (q_i / p_i) if q_i > 0 else lo
            raw.append(w)

        # Clamp RELATIVE influence, not the raw product. Across a multi-factor
        # coalition the weights multiply, so the whole vector can drift orders
        # of magnitude away from 1 while every transaction still carries a
        # perfectly reasonable share of the total. That common scale factor
        # cancels in the weighted mean, so clamping the raw product would
        # report mass clamping for a reweighting that is doing nothing wrong.
        # What actually threatens the estimate is one transaction dominating
        # its peers, which is what the normalised weight measures.
        mean_w = (sum(raw) / len(raw)) if raw else 0.0
        if mean_w <= 0:
            return [1.0] * len(txns), 1.0

        weights: list[float] = []
        clamped = 0
        for w in raw:
            rel = w / mean_w
            if rel < lo:
                rel, clamped = lo, clamped + 1
            elif rel > hi:
                rel, clamped = hi, clamped + 1
            weights.append(rel)
        rate = clamped / len(txns) if txns else 0.0
        return weights, rate

    def value(
        self,
        txns: Sequence[Transaction],
        S: frozenset[str],
        p: dict[str, dict[str, float]],
        s_obs: float,
    ) -> tuple[float, float]:
        """v(S) and the clamp rate incurred computing it."""
        if not S:
            return 0.0, 0.0
        weights, clamp_rate = self._weights(txns, S, p)
        total_w = sum(weights)
        if total_w <= 0:
            return 0.0, clamp_rate
        num = sum(
            w * self.baseline.p_success_txn(t) for w, t in zip(weights, txns)
        )
        return (num / total_w) - s_obs, clamp_rate

    def decompose(
        self, txns: Sequence[Transaction], *, mae_by_factor: dict[str, float] | None = None
    ) -> Decomposition:
        n = len(FACTORS)
        s_obs = observed_rate(txns)
        s_star = self.cohort.s_star
        gap_pts = (s_star - s_obs) * 100.0
        p = merchant_marginals(txns)

        # All 16 coalition values up front -- each is used by several of the
        # marginal-contribution terms below, so computing once is both faster
        # and what the coalition explorer displays.
        v: dict[frozenset[str], float] = {}
        clamp_rates: list[float] = []
        for r in range(n + 1):
            for combo in combinations(FACTORS, r):
                S = frozenset(combo)
                val, cr = self.value(txns, S, p, s_obs)
                v[S] = val
                if S:
                    clamp_rates.append(cr)

        attributions: list[FactorAttribution] = []
        for i in FACTORS:
            others = [f for f in FACTORS if f != i]
            phi = 0.0
            for r in range(len(others) + 1):
                for combo in combinations(others, r):
                    S = frozenset(combo)
                    weight = factorial(r) * factorial(n - r - 1) / factorial(n)
                    phi += weight * (v[S | {i}] - v[S])
            mae = (mae_by_factor or {}).get(i)
            attributions.append(
                FactorAttribution(factor=i, points=phi * 100.0, mae=mae)
            )

        v_all = v[frozenset(FACTORS)] * 100.0
        clamp_rate = max(clamp_rates) if clamp_rates else 0.0
        support = effective_support(p)
        degenerate = sorted(
            f for f, s in support.items() if s < MIN_EFFECTIVE_SUPPORT
        )

        return Decomposition(
            s_obs=s_obs,
            s_star=s_star,
            gap_pts=gap_pts,
            attributions=attributions,
            residual_pts=gap_pts - v_all,
            process_gap_pts=process_gap(txns),
            coalition_values={_coalition_key(S): val * 100.0 for S, val in v.items()},
            clamp_rate=clamp_rate,
            effective_support=support,
            degenerate_factors=degenerate,
            reliable=clamp_rate <= CLAMP_RATE_THRESHOLD,
        )


def process_gap(
    txns: Sequence[Transaction], expected_retry_success_rate: float = 0.30
) -> float:
    """NO_SOFT_DECLINE_RETRY, computed directly rather than decomposed.

    §5.0: this cause cannot be a Shapley factor. The machinery reweights a
    merchant's distribution over transaction FEATURES; "this merchant never
    retries soft declines" is a missing remediation policy, and there is no
    q_i to reweight toward. So it is computed here as its own term and
    reported alongside the four Shapley rows, visually distinct.

    Every rupee this term implies is PROJECTED, because
    expected_retry_success_rate comes from the mock rail's model, not from an
    observation.
    """
    if not txns:
        return 0.0
    unretried = sum(
        1
        for t in txns
        if not t.succeeded
        and t.error_class in RECOVERABLE
        and not t.retried
    )
    return (unretried / len(txns)) * 100.0 * expected_retry_success_rate


def naive_attribution(
    txns: Sequence[Transaction], baseline: Baseline, cohort: Cohort
) -> dict[str, float]:
    """The obvious thing a good engineer builds instead. Deliberately included.

    For each factor independently: how much would the success rate improve if
    ONLY this factor were moved to the cohort profile? That is v({i}) -- no
    coalition structure, no ordering correction. It double-counts whenever
    factors are correlated, and §10B measures how often that makes it pick the
    wrong primary cause.
    """
    dec = ShapleyDecomposer(baseline, cohort)
    s_obs = observed_rate(txns)
    p = merchant_marginals(txns)
    return {
        f: dec.value(txns, frozenset({f}), p, s_obs)[0] * 100.0 for f in FACTORS
    }
