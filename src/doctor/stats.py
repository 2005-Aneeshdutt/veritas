"""Small statistical helpers used by both the evals and the live report.

Wilson intervals rather than normal-approximation intervals, because several
things this project reports have small denominators -- held-out error codes
number in the single digits per class, and a merchant's monthly batch can be a
few hundred payments. The normal approximation is badly wrong there, and
quoting a bare percentage would be worse.
"""

from __future__ import annotations

import math

#: 1.959964 -- two-sided 95%.
Z95 = 1.959963984540054


def wilson_interval(
    successes: int, n: int, z: float = Z95
) -> tuple[float, float, float]:
    """Return (point, low, high) for a binomial proportion.

    Wilson's score interval. Unlike the normal approximation it stays inside
    [0, 1], behaves at 0 and 100 percent, and is honest at small n -- which is
    exactly where this project needs it.
    """
    if n <= 0:
        return 0.0, 0.0, 1.0
    p = successes / n
    z2 = z * z
    denom = 1.0 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = (z / denom) * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return p, max(0.0, centre - half), min(1.0, centre + half)


def wilson_halfwidth_pts(successes: int, n: int, z: float = Z95) -> float:
    """Half-width of the Wilson interval, in percentage points."""
    _, lo, hi = wilson_interval(successes, n, z)
    return (hi - lo) * 100.0 / 2.0


def is_underpowered(successes: int, n: int, gap_pts: float, ratio: float = 0.5) -> bool:
    """True when the batch is too small to resolve the gap being claimed.

    The diagnosis divides a gap across four factors. If the uncertainty on the
    gap itself is a large fraction of the gap, the per-factor split is noise
    dressed as insight, and the honest output is "come back with more data"
    rather than a confident ranking. This is the data-sufficiency sibling of
    the error-bar gating in plan.py.
    """
    if n <= 0 or gap_pts <= 0:
        return True
    return wilson_halfwidth_pts(successes, n) > ratio * abs(gap_pts)


def mean(xs) -> float:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def median(xs) -> float:
    xs = sorted(xs)
    if not xs:
        return 0.0
    mid = len(xs) // 2
    return xs[mid] if len(xs) % 2 else (xs[mid - 1] + xs[mid]) / 2.0


def percentile(xs, q: float) -> float:
    xs = sorted(xs)
    if not xs:
        return 0.0
    k = (len(xs) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    if lo == hi:
        return xs[lo]
    return xs[lo] * (hi - k) + xs[hi] * (k - lo)
