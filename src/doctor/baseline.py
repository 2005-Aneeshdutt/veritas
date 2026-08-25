"""p_success(x) -- expected success probability for one transaction profile.

Structure: a logistic model on the log-odds of FAILURE.

    logit(p_fail) = logit(bank_base_fail) + b_method + b_hour + b_amount

The intercept is the bank's own published failure rate for the period, taken
straight from NPCI's top-50 remitter table (BD% + TD%). That part is
measured. Everything added to it is an assumed prior from priors.py, and this
module never blurs the two -- `explain()` returns the decomposition of any
single probability with each term's provenance, which is what lets the UI show
a panellist exactly which numbers are real.

MCC conditions the baseline only through the cohort's bank/method mix; it is
NOT a Shapley factor (see features.FACTORS).
"""

from __future__ import annotations

import csv
import math
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from .features import AmountBand, HourBand, Method
from .priors import AMOUNT, HOUR, METHOD

ROOT = Path(__file__).resolve().parents[2]
NPCI_DIR = ROOT / "data" / "npci"

#: The period every headline number is computed against. Pinned, like the
#: capture it came from -- change it deliberately, not incidentally.
DEFAULT_PERIOD = "2025-08"

#: Remitter = the payer's issuing bank, which is who declines a merchant's
#: collection. See load_bank_stats for why this is not the beneficiary table.
DEFAULT_TABLE = "remitter_banks"


def logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


class BankStats(BaseModel):
    """One bank's published performance for one month. All fields measured."""

    model_config = {"frozen": True}

    bank: str
    period: str
    total_volume_mn: float
    approved_pct: float
    bd_pct: float
    td_pct: float

    @property
    def fail_rate(self) -> float:
        return (self.bd_pct + self.td_pct) / 100.0

    @property
    def technical_share(self) -> float:
        """Of this bank's failures, the fraction that are technical.

        This is the number that distinguishes "my processor is flaky" from
        "my customers have no money", and it is measured per bank per month.
        """
        total = self.bd_pct + self.td_pct
        return (self.td_pct / total) if total > 0 else 0.0


class Term(BaseModel):
    """One additive contribution to the log-odds, with its provenance."""

    model_config = {"frozen": True}

    name: str
    value: float
    provenance: str
    source: str


class Explanation(BaseModel):
    model_config = {"frozen": True}

    p_success: float
    p_fail: float
    terms: list[Term]

    @property
    def measured_terms(self) -> list[Term]:
        return [t for t in self.terms if t.provenance == "measured"]

    @property
    def assumed_terms(self) -> list[Term]:
        return [t for t in self.terms if t.provenance == "assumed"]


@lru_cache(maxsize=8)
def load_bank_stats(
    period: str = DEFAULT_PERIOD, table: str = DEFAULT_TABLE
) -> dict[str, BankStats]:
    """Load one month of NPCI bank performance, keyed by normalised bank name.

    Remitter is the default, and the choice matters more than it looks. The
    beneficiary table measures the CREDIT leg -- did money land in the payee
    account -- and runs about 99.2% approved, which is nowhere near a
    merchant's observed success rate. A merchant's collection is declined by
    the PAYER's issuing bank, which NPCI reports on the remitter side, where
    the median bank sits near 92% approved. Using the beneficiary table here
    would model the wrong leg of the transaction and make every gap look
    fictitious.

    The beneficiary table is still loaded for the ecosystem join in the
    report, which needs both sides of a failure.
    """
    path = NPCI_DIR / (table + ".csv")
    if not path.exists():
        raise FileNotFoundError(
            "%s missing -- run: python scripts/fetch_data.py" % path
        )
    out: dict[str, BankStats] = {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["period"] != period:
                continue
            try:
                out[normalise_bank(row["bank"])] = BankStats(
                    bank=row["bank"],
                    period=row["period"],
                    total_volume_mn=float(row["total_volume_mn"] or 0),
                    approved_pct=float(row["approved_pct"]),
                    bd_pct=float(row["bd_pct"]),
                    td_pct=float(row["td_pct"]),
                )
            except ValueError:
                continue  # quarantined / unparseable row
    if not out:
        raise ValueError(
            "no rows for period %r in %s -- available periods differ" % (period, table)
        )
    return out


def normalise_bank(name: str) -> str:
    """NPCI spells the same bank several ways across months.

    'State Bank of India', 'State Bank Of India', 'SBI Bank Ltd.' all have to
    collapse, or a merchant's bank silently misses the join and falls back to
    the median -- which would quietly flatten the very factor we are trying to
    attribute.
    """
    s = name.strip().lower()
    for junk in (" ltd.", " ltd", " limited", " bank", "the "):
        s = s.replace(junk, " ")
    s = " ".join(s.split())
    aliases = {
        "state of india": "sbi",
        "sbi": "sbi",
        "hdfc": "hdfc",
        "icici": "icici",
        "axis": "axis",
        "kotak mahindra": "kotak",
        "kotak": "kotak",
        "punjab national": "pnb",
        "pnb": "pnb",
        "union of india": "union",
        "bank of baroda": "bob",
        "of baroda": "bob",
        "baroda": "bob",
        "canara": "canara",
        "of india": "boi",
        "yes": "yes",
        "indusind": "indusind",
        "idfc first": "idfc",
        "au small finance": "au",
        "paytm payments": "paytm",
        "airtel payments": "airtel",
    }
    return aliases.get(s, s)


class Baseline:
    """The success model. Deterministic and side-effect free."""

    def __init__(
        self,
        period: str = DEFAULT_PERIOD,
        table: str = DEFAULT_TABLE,
        *,
        prior_scale: float | None = None,
    ) -> None:
        """`prior_scale` in [-1, 1] shifts every ASSUMED prior within its
        stated range, and leaves measured quantities alone. That is the knob
        the sensitivity analysis turns."""
        self.period = period
        self.stats = load_bank_stats(period, table)
        self.prior_scale = prior_scale
        rates = sorted(s.fail_rate for s in self.stats.values())
        self._median_fail = rates[len(rates) // 2]

    def _prior(self, p) -> float:
        return p.value if self.prior_scale is None else p.clamped(self.prior_scale)

    def bank_fail_rate(self, bank: str) -> float:
        st = self.stats.get(normalise_bank(bank))
        return st.fail_rate if st else self._median_fail

    def bank_stats(self, bank: str) -> BankStats | None:
        return self.stats.get(normalise_bank(bank))

    def explain(
        self,
        bank: str,
        method: Method,
        hour_band_: HourBand,
        amount_band_: AmountBand,
    ) -> Explanation:
        st = self.stats.get(normalise_bank(bank))
        base = st.fail_rate if st else self._median_fail
        terms = [
            Term(
                name="bank:" + bank,
                value=logit(base),
                provenance="measured",
                source=(
                    "NPCI %s, BD %.2f%% + TD %.2f%%" % (self.period, st.bd_pct, st.td_pct)
                    if st
                    else "bank not in NPCI top-50 for %s; all-bank median used"
                    % self.period
                ),
            )
        ]
        for name, prior in (
            ("method:" + method.value, METHOD[method]),
            ("hour:" + hour_band_.value, HOUR[hour_band_]),
            ("amount:" + amount_band_.value, AMOUNT[amount_band_]),
        ):
            terms.append(
                Term(
                    name=name,
                    value=self._prior(prior),
                    provenance=prior.provenance,
                    source=prior.source,
                )
            )
        p_fail = sigmoid(sum(t.value for t in terms))
        return Explanation(p_success=1.0 - p_fail, p_fail=p_fail, terms=terms)

    def p_success(
        self,
        bank: str,
        method: Method,
        hour_band_: HourBand,
        amount_band_: AmountBand,
    ) -> float:
        return self.explain(bank, method, hour_band_, amount_band_).p_success

    def p_success_txn(self, txn) -> float:
        return self.p_success(txn.bank, txn.method, txn.hour_band, txn.amount_band)
