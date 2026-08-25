"""The MCC cohort: what a well-run merchant in this category looks like.

Two things come out of here.

`s_star` -- the achievable success rate for the cohort. §5.4 is blunt that
this is an INPUT, not a discovery: it is asserted from cohort data, and the
whole attribution moves if it is wrong. That is why `s_star` is computed from
an explicit, inspectable profile rather than hardcoded, and why the
sensitivity sweep in §9 step 7 re-runs everything at s_star +/- 2 points. Have
the answer ready before the question is asked.

`cohort_marginals` -- the distribution q_i over each factor that the Shapley
reweighting pushes the merchant toward. The bank marginal is measured, taken
from NPCI's national volume share: a merchant with no concentration problem
sees customers arriving from banks roughly in proportion to how much those
banks actually move. The other three are assumed and labelled as such.

A note on the amount factor, which reads oddly at first: attributing part of a
gap to "your ticket mix differs from your cohort's" is not a recommendation to
sell cheaper things. It is Oaxaca-Blinder endowment accounting -- it says how
much of the gap is explained by a structural difference. The remediation that
follows is routing and retry policy for high-ticket payments, never pricing.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from .baseline import NPCI_DIR, Baseline, normalise_bank
from .features import FACTORS, AmountBand, HourBand, Method

#: MCC -> a coarse family, because method mix and ticket distribution are
#: properties of what is being sold, not of the four-digit code itself.
MCC_FAMILY: dict[str, str] = {
    "5411": "grocery",
    "5814": "food",
    "5812": "food",
    "5732": "electronics",
    "5734": "saas",
    "5045": "electronics",
    "4900": "utilities",
    "5541": "fuel",
    "5912": "pharmacy",
    "4121": "transport",
    "5651": "apparel",
    "5691": "apparel",
    "7011": "travel",
    "4722": "travel",
    "6300": "insurance",
}
DEFAULT_FAMILY = "retail"

#: Assumed method mix per family. A grocery merchant is overwhelmingly UPI; a
#: SaaS merchant is card and mandate. Sources are judgement, not measurement.
METHOD_MIX: dict[str, dict[Method, float]] = {
    "grocery": {Method.UPI: 0.88, Method.CARD: 0.10, Method.NETBANKING: 0.02, Method.UPI_MANDATE: 0.0},
    "food": {Method.UPI: 0.86, Method.CARD: 0.12, Method.NETBANKING: 0.02, Method.UPI_MANDATE: 0.0},
    "electronics": {Method.UPI: 0.46, Method.CARD: 0.36, Method.NETBANKING: 0.18, Method.UPI_MANDATE: 0.0},
    "saas": {Method.UPI: 0.20, Method.CARD: 0.42, Method.NETBANKING: 0.06, Method.UPI_MANDATE: 0.32},
    "utilities": {Method.UPI: 0.62, Method.CARD: 0.14, Method.NETBANKING: 0.12, Method.UPI_MANDATE: 0.12},
    "fuel": {Method.UPI: 0.92, Method.CARD: 0.07, Method.NETBANKING: 0.01, Method.UPI_MANDATE: 0.0},
    "pharmacy": {Method.UPI: 0.84, Method.CARD: 0.13, Method.NETBANKING: 0.03, Method.UPI_MANDATE: 0.0},
    "transport": {Method.UPI: 0.90, Method.CARD: 0.09, Method.NETBANKING: 0.01, Method.UPI_MANDATE: 0.0},
    "apparel": {Method.UPI: 0.62, Method.CARD: 0.30, Method.NETBANKING: 0.08, Method.UPI_MANDATE: 0.0},
    "travel": {Method.UPI: 0.38, Method.CARD: 0.44, Method.NETBANKING: 0.18, Method.UPI_MANDATE: 0.0},
    "insurance": {Method.UPI: 0.24, Method.CARD: 0.34, Method.NETBANKING: 0.14, Method.UPI_MANDATE: 0.28},
    "retail": {Method.UPI: 0.70, Method.CARD: 0.22, Method.NETBANKING: 0.08, Method.UPI_MANDATE: 0.0},
}

#: Assumed ticket distribution per family.
AMOUNT_MIX: dict[str, dict[AmountBand, float]] = {
    "grocery": {AmountBand.MICRO: 0.34, AmountBand.SMALL: 0.52, AmountBand.MEDIUM: 0.13, AmountBand.LARGE: 0.01},
    "food": {AmountBand.MICRO: 0.30, AmountBand.SMALL: 0.58, AmountBand.MEDIUM: 0.11, AmountBand.LARGE: 0.01},
    "electronics": {AmountBand.MICRO: 0.04, AmountBand.SMALL: 0.18, AmountBand.MEDIUM: 0.40, AmountBand.LARGE: 0.38},
    "saas": {AmountBand.MICRO: 0.06, AmountBand.SMALL: 0.36, AmountBand.MEDIUM: 0.44, AmountBand.LARGE: 0.14},
    "utilities": {AmountBand.MICRO: 0.12, AmountBand.SMALL: 0.46, AmountBand.MEDIUM: 0.34, AmountBand.LARGE: 0.08},
    "fuel": {AmountBand.MICRO: 0.10, AmountBand.SMALL: 0.56, AmountBand.MEDIUM: 0.32, AmountBand.LARGE: 0.02},
    "pharmacy": {AmountBand.MICRO: 0.26, AmountBand.SMALL: 0.54, AmountBand.MEDIUM: 0.18, AmountBand.LARGE: 0.02},
    "transport": {AmountBand.MICRO: 0.44, AmountBand.SMALL: 0.48, AmountBand.MEDIUM: 0.07, AmountBand.LARGE: 0.01},
    "apparel": {AmountBand.MICRO: 0.08, AmountBand.SMALL: 0.40, AmountBand.MEDIUM: 0.42, AmountBand.LARGE: 0.10},
    "travel": {AmountBand.MICRO: 0.02, AmountBand.SMALL: 0.10, AmountBand.MEDIUM: 0.34, AmountBand.LARGE: 0.54},
    "insurance": {AmountBand.MICRO: 0.02, AmountBand.SMALL: 0.14, AmountBand.MEDIUM: 0.44, AmountBand.LARGE: 0.40},
    "retail": {AmountBand.MICRO: 0.18, AmountBand.SMALL: 0.44, AmountBand.MEDIUM: 0.30, AmountBand.LARGE: 0.08},
}

#: Assumed natural consumer hour distribution -- when people actually transact
#: when a billing cron is NOT driving the timing. This is the profile a
#: midnight-billing merchant is compared against.
HOUR_MIX: dict[HourBand, float] = {
    HourBand.NIGHT: 0.08,
    HourBand.MORNING: 0.24,
    HourBand.AFTERNOON: 0.36,
    HourBand.EVENING: 0.32,
}


def family_of(mcc: str) -> str:
    return MCC_FAMILY.get(str(mcc), DEFAULT_FAMILY)


@lru_cache(maxsize=4)
def national_bank_mix(period: str, table: str, top_n: int = 20) -> dict[str, float]:
    """Bank marginal from NPCI volume share. MEASURED.

    This is the ecosystem baseline in §3.1: what a merchant's bank mix looks
    like if their customers are simply a random draw from the country.
    """
    path = NPCI_DIR / (table + ".csv")
    vols: dict[str, float] = defaultdict(float)
    display: dict[str, str] = {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["period"] != period:
                continue
            try:
                v = float(row["total_volume_mn"] or 0)
            except ValueError:
                continue
            key = normalise_bank(row["bank"])
            vols[key] += v
            display.setdefault(key, row["bank"])
    top = sorted(vols.items(), key=lambda kv: -kv[1])[:top_n]
    total = sum(v for _, v in top)
    return {display[k]: v / total for k, v in top} if total > 0 else {}


class Cohort(BaseModel):
    """The comparison group a merchant is diagnosed against."""

    model_config = {"frozen": True, "arbitrary_types_allowed": True}

    mcc: str
    family: str
    s_star: float
    #: factor -> {value: probability}
    marginals: dict[str, dict[str, float]]
    #: Which marginals are measured vs assumed, for the UI's honesty panel.
    provenance: dict[str, str]


def build_cohort(
    mcc: str,
    baseline: Baseline,
    *,
    s_star_override: float | None = None,
    s_star_shift_pts: float = 0.0,
) -> Cohort:
    """Assemble the cohort profile and its achievable rate.

    `s_star_shift_pts` is the §9 step 7 sensitivity knob: it moves the
    achievable rate by a fixed number of points without touching anything
    else, so we can watch the attribution reorder.
    """
    fam = family_of(mcc)
    banks = national_bank_mix(baseline.period, "remitter_banks")
    methods = METHOD_MIX.get(fam, METHOD_MIX[DEFAULT_FAMILY])
    amounts = AMOUNT_MIX.get(fam, AMOUNT_MIX[DEFAULT_FAMILY])

    marginals: dict[str, dict[str, float]] = {
        "bank": dict(banks),
        "method": {m.value: p for m, p in methods.items() if p > 0},
        "hour": {h.value: p for h, p in HOUR_MIX.items()},
        "amount_band": {a.value: p for a, p in amounts.items() if p > 0},
    }
    for f in FACTORS:
        total = sum(marginals[f].values())
        if total > 0:
            marginals[f] = {k: v / total for k, v in marginals[f].items()}

    if s_star_override is not None:
        s_star = s_star_override
    else:
        # Expected success under the cohort profile, assuming the four factors
        # are independent. That independence is exactly the assumption §5.1
        # flags and §9 step 6 measures the cost of.
        s_star = 0.0
        for bank, pb in marginals["bank"].items():
            for meth, pm in marginals["method"].items():
                for hb, ph in marginals["hour"].items():
                    for ab, pa in marginals["amount_band"].items():
                        s_star += (
                            pb * pm * ph * pa
                            * baseline.p_success(
                                bank, Method(meth), HourBand(hb), AmountBand(ab)
                            )
                        )
    s_star = min(max(s_star + s_star_shift_pts / 100.0, 0.0), 1.0)

    return Cohort(
        mcc=str(mcc),
        family=fam,
        s_star=s_star,
        marginals=marginals,
        provenance={
            "bank": "measured -- NPCI %s national volume share" % baseline.period,
            "method": "assumed -- %s family mix" % fam,
            "hour": "assumed -- natural consumer hour profile",
            "amount_band": "assumed -- %s family ticket distribution" % fam,
        },
    )
