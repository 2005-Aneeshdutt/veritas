"""The feature space the decomposition operates over.

Four factors are decomposed -- bank, method, hour, amount_band -- and MCC
conditions the baseline without being a factor. That distinction is load
bearing and §5 asks for it to be visible in the naming, so:

    FACTORS      things Shapley reweights
    mcc          a conditioning variable, never reweighted

An earlier draft had a fifth factor `mcc_fit`; it was dropped because it is
nearly a deterministic function of `method`, which would bake collinearity
into the factor set by construction and make the method look worse in its own
validation.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

#: The four Shapley factors, in a fixed order. 2**4 = 16 coalitions.
FACTORS: tuple[str, ...] = ("bank", "method", "hour", "amount_band")


class Method(str, Enum):
    UPI = "upi"
    CARD = "card"
    NETBANKING = "netbanking"
    UPI_MANDATE = "upi_mandate"  # recurring / autopay


class HourBand(str, Enum):
    NIGHT = "night"  # 23:00-05:59 -- the subscription-cron window
    MORNING = "morning"  # 06:00-11:59
    AFTERNOON = "afternoon"  # 12:00-17:59
    EVENING = "evening"  # 18:00-22:59


class AmountBand(str, Enum):
    MICRO = "micro"  # < Rs 200
    SMALL = "small"  # Rs 200 - 1,000
    MEDIUM = "medium"  # Rs 1,000 - 5,000
    LARGE = "large"  # >= Rs 5,000


class ErrorClass(str, Enum):
    """The classification taxonomy §4.1 evaluates against."""

    SOFT_DECLINE = "soft_decline"
    HARD_DECLINE = "hard_decline"
    TECHNICAL = "technical"
    AUTH_FAILURE = "auth_failure"


#: Which error classes are worth retrying at all. A hard decline (closed
#: account, expired card) will not become a success by being asked twice.
RECOVERABLE: frozenset[ErrorClass] = frozenset(
    {ErrorClass.SOFT_DECLINE, ErrorClass.TECHNICAL}
)


def hour_band(hour: int) -> HourBand:
    if hour >= 23 or hour < 6:
        return HourBand.NIGHT
    if hour < 12:
        return HourBand.MORNING
    if hour < 18:
        return HourBand.AFTERNOON
    return HourBand.EVENING


def amount_band(amount_paise: int) -> AmountBand:
    if amount_paise < 200_00:
        return AmountBand.MICRO
    if amount_paise < 1_000_00:
        return AmountBand.SMALL
    if amount_paise < 5_000_00:
        return AmountBand.MEDIUM
    return AmountBand.LARGE


class Transaction(BaseModel):
    """One payment attempt. Amounts are integer paise, never float rupees."""

    model_config = {"frozen": True}

    txn_id: str
    merchant_id: str
    mcc: str
    bank: str
    method: Method
    hour: int = Field(ge=0, le=23)
    day: int = Field(ge=1, le=31)
    amount_paise: int = Field(ge=1)
    succeeded: bool
    #: Populated only when `succeeded` is False.
    error_code: str | None = None
    error_class: ErrorClass | None = None
    #: True when a soft decline was left unretried -- the process gap in §5.0.
    retried: bool = False
    attempts: int = 1

    @property
    def hour_band(self) -> HourBand:
        return hour_band(self.hour)

    @property
    def amount_band(self) -> AmountBand:
        return amount_band(self.amount_paise)

    def factor_value(self, factor: str) -> str:
        """The merchant's realised value for one Shapley factor."""
        if factor == "bank":
            return self.bank
        if factor == "method":
            return self.method.value
        if factor == "hour":
            return self.hour_band.value
        if factor == "amount_band":
            return self.amount_band.value
        raise KeyError("unknown factor %r" % factor)


class MerchantProfile(BaseModel):
    """Everything the diagnosis knows about a merchant besides its payments."""

    model_config = {"frozen": True}

    merchant_id: str
    name: str
    mcc: str
    mcc_description: str = ""
    monthly_txn_count: int = 0
    avg_ticket_paise: int = 0

    @property
    def monthly_gmv_paise(self) -> int:
        return self.monthly_txn_count * self.avg_ticket_paise


InjectedCause = Literal[
    "midnight_billing_penalty",
    "bank_concentration",
    "no_soft_decline_retry",
    "amount_band_risk",
    "method_mix_mismatch",
]

#: §5.0 -- four injected causes map onto Shapley factors; the fifth does not,
#: because "this merchant never retries soft declines" is a missing policy, not
#: a distribution over transaction features. It is computed directly instead.
CAUSE_TO_FACTOR: dict[str, str | None] = {
    "midnight_billing_penalty": "hour",
    "bank_concentration": "bank",
    "method_mix_mismatch": "method",
    "amount_band_risk": "amount_band",
    "no_soft_decline_retry": None,  # process gap, computed outside Shapley
}
