"""Every coefficient in the success model, with its provenance attached.

This module exists because of RULE 2. The bank effect is measured -- it comes
from 32 months of NPCI's published top-50 tables. The method, hour and amount
effects are not, and NPCI publishes nothing that would let them be: their
monthly tables have no hourly breakdown, no card or netbanking rails, and no
ticket-size split. Pretending otherwise would be the exact failure this
project is built to avoid.

So each coefficient carries a `provenance` of MEASURED or ASSUMED, a source or
rationale, and a plausible range. The range is not decoration -- the
sensitivity analysis in §9 sweeps it, and the UI renders assumed coefficients
differently from measured ones.

Coefficients are additive in log-odds of FAILURE. Positive means more failure.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .features import AmountBand, HourBand, Method

Provenance = Literal["measured", "assumed"]


class Prior(BaseModel):
    """One coefficient, plus an honest account of where it came from."""

    model_config = {"frozen": True}

    value: float
    provenance: Provenance
    source: str
    #: (low, high) plausible range, swept by the sensitivity analysis.
    range: tuple[float, float]

    def clamped(self, scale: float) -> float:
        """Interpolate within the stated range. scale in [-1, 1], 0 = value."""
        if scale >= 0:
            return self.value + scale * (self.range[1] - self.value)
        return self.value + (-scale) * (self.range[0] - self.value)


# --- method ---------------------------------------------------------------
# NPCI's product-wise decline file covers only NFS (ATM) and AEPS, so it
# cannot supply a UPI-vs-card differential. These are assumptions, ordered by
# the widely reported pattern that UPI collect/mandate flows fail more than
# UPI intent, and that cards carry 3DS/OTP drop-off netbanking does not.
METHOD: dict[Method, Prior] = {
    Method.UPI: Prior(
        value=0.0,
        provenance="assumed",
        source="reference level -- all other method effects are relative to UPI",
        range=(0.0, 0.0),
    ),
    Method.CARD: Prior(
        value=0.45,
        provenance="assumed",
        source=(
            "cards carry a 3DS/OTP step UPI intent does not; magnitude is a "
            "judgement, not a measurement"
        ),
        range=(0.20, 0.75),
    ),
    Method.NETBANKING: Prior(
        value=0.30,
        provenance="assumed",
        source="bank-page redirect drop-off; magnitude is a judgement",
        range=(0.10, 0.60),
    ),
    Method.UPI_MANDATE: Prior(
        value=0.55,
        provenance="assumed",
        source=(
            "recurring debits execute without the payer present, so funding "
            "failures cannot be corrected in the moment"
        ),
        range=(0.30, 0.90),
    ),
}

# --- hour -----------------------------------------------------------------
# THE most consequential assumption in the project. NPCI publishes monthly
# aggregates only; there is no public hourly TD% series. The night penalty is
# asserted, and the §9 sensitivity sweep exists to show how much the
# conclusion depends on it.
HOUR: dict[HourBand, Prior] = {
    HourBand.NIGHT: Prior(
        value=0.50,
        provenance="assumed",
        source=(
            "bank core-banking maintenance windows and subscription-cron "
            "pile-up both land overnight; NPCI publishes no hourly series, so "
            "this is the single least-grounded number in the model"
        ),
        range=(0.15, 0.95),
    ),
    HourBand.MORNING: Prior(
        value=0.0, provenance="assumed", source="reference level", range=(0.0, 0.0)
    ),
    HourBand.AFTERNOON: Prior(
        value=-0.05,
        provenance="assumed",
        source="peak-hours capacity is provisioned for; slight advantage",
        range=(-0.15, 0.05),
    ),
    HourBand.EVENING: Prior(
        value=0.08,
        provenance="assumed",
        source="evening consumer peak adds queueing pressure",
        range=(0.0, 0.20),
    ),
}

# --- amount ---------------------------------------------------------------
AMOUNT: dict[AmountBand, Prior] = {
    AmountBand.MICRO: Prior(
        value=-0.10,
        provenance="assumed",
        source="small tickets clear balance checks that larger ones fail",
        range=(-0.25, 0.0),
    ),
    AmountBand.SMALL: Prior(
        value=0.0, provenance="assumed", source="reference level", range=(0.0, 0.0)
    ),
    AmountBand.MEDIUM: Prior(
        value=0.18,
        provenance="assumed",
        source="insufficient-funds and per-txn limit pressure rises with ticket",
        range=(0.05, 0.35),
    ),
    AmountBand.LARGE: Prior(
        value=0.42,
        provenance="assumed",
        source=(
            "per-transaction limits and issuer risk rules bind hardest at high "
            "ticket; drives the AMOUNT_BAND_RISK cause"
        ),
        range=(0.20, 0.70),
    ),
}

# --- error-class mix given a failure --------------------------------------
# Used by the generator to pick a plausible error class once a transaction has
# been decided to fail. Technical declines follow the bank's own TD/BD split,
# which IS measured; the soft/hard/auth split within business declines is not.
BUSINESS_DECLINE_MIX: dict[str, Prior] = {
    "soft_decline": Prior(
        value=0.62,
        provenance="assumed",
        source="insufficient funds dominates business declines in dunning data",
        range=(0.50, 0.72),
    ),
    "hard_decline": Prior(
        value=0.21,
        provenance="assumed",
        source="closed/blocked accounts, expired instruments",
        range=(0.15, 0.30),
    ),
    "auth_failure": Prior(
        value=0.17,
        provenance="assumed",
        source="OTP/PIN/3DS abandonment",
        range=(0.10, 0.25),
    ),
}


def provenance_summary() -> dict[str, int]:
    """Counts for the UI's honesty panel and the README."""
    all_priors = (
        list(METHOD.values())
        + list(HOUR.values())
        + list(AMOUNT.values())
        + list(BUSINESS_DECLINE_MIX.values())
    )
    return {
        "measured": sum(1 for p in all_priors if p.provenance == "measured"),
        "assumed": sum(1 for p in all_priors if p.provenance == "assumed"),
        "total": len(all_priors),
    }
