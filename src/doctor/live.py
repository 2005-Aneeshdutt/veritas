"""Watching payments arrive, and noticing a bank go bad while it is happening.

Every other surface in this project is a batch: a month of payments lands and
the engine explains it afterwards. That is the honest way to attribute a gap,
but it is not how an incident feels. A bank starts declining at 14:20 and the
merchant finds out from a monthly report.

So this replays a real generated batch in payment order and runs an ONLINE
detector over it. What is streamed is genuine -- the same transactions the
batch pipeline sees, in their own time order, at whatever speed the caller
asks for. Nothing is scripted: the detector is a rolling window plus a Wilson
lower bound, and if a merchant has no bank in trouble it fires nothing and
says so. A demo that always finds an incident is not a detector.

WHY A WILSON LOWER BOUND RATHER THAN A THRESHOLD
The naive version -- "alert when the last 20 payments on a bank are more than
X% failed" -- fires constantly on small samples. Three failures out of four is
75%, and means nothing. The bound asks a stricter question: given what we have
seen, is the failure rate on this bank *confidently* worse than what NPCI
publishes for it nationally? Small samples widen the interval and the lower
bound stays under the baseline, so the alert simply does not fire until there
is enough evidence. That is the same discipline the batch engine applies to
its attributions, applied to time instead of to factors.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Iterator

from .baseline import Baseline
from .features import Transaction
from .stats import wilson_interval

#: Payments held in the rolling window, per bank. Large enough for the bound to
#: tighten, small enough that a bank recovering drops out of it quickly.
WINDOW = 60

#: Minimum payments on a bank before the detector will say anything at all.
MIN_SAMPLES = 25

#: How far above its NPCI baseline a bank's failure rate must confidently sit,
#: in points, before it is worth interrupting anyone for.
MATERIAL_PTS = 6.0

#: Once fired, stay quiet on that bank for this many of its payments. Without
#: it a degrading bank re-alerts on every payment and the feed is unreadable.
COOLDOWN = 120


@dataclass
class BankWindow:
    """Rolling outcomes for one bank, and whether we have already shouted."""

    outcomes: deque[bool] = field(default_factory=lambda: deque(maxlen=WINDOW))
    seen: int = 0
    quiet_until: int = 0

    def observe(self, succeeded: bool) -> None:
        self.outcomes.append(succeeded)
        self.seen += 1

    @property
    def n(self) -> int:
        return len(self.outcomes)

    @property
    def failures(self) -> int:
        return sum(1 for ok in self.outcomes if not ok)


@dataclass
class Alert:
    """A bank the detector is confident has degraded, with the evidence."""

    bank: str
    observed_fail_pct: float
    #: Lower end of the 95% interval on the observed rate. The conservative read.
    confident_fail_pct: float
    npci_fail_pct: float
    delta_pts: float
    window_n: int
    at_payment: int
    exposure_paise: int
    detail: str


class LiveMonitor:
    """An online detector over a stream of payments.

    Deliberately stateful and deliberately simple: `observe` one payment at a
    time, get back an Alert or None. Nothing here looks ahead, and nothing here
    reads the merchant's ground truth -- it sees exactly what a live system
    would see, which is why it is allowed to be wrong.
    """

    def __init__(self, baseline: Baseline) -> None:
        self.baseline = baseline
        self.banks: dict[str, BankWindow] = {}
        self.n_seen = 0
        self.n_failed = 0
        self.at_risk_paise = 0
        self.alerted: dict[str, Alert] = {}

    def observe(self, t: Transaction) -> Alert | None:
        self.n_seen += 1
        if not t.succeeded:
            self.n_failed += 1
            self.at_risk_paise += t.amount_paise

        w = self.banks.setdefault(t.bank, BankWindow())
        w.observe(t.succeeded)

        if w.n < MIN_SAMPLES or w.seen < w.quiet_until:
            return None

        # What NPCI says this bank should be doing, nationally.
        stats = self.baseline.bank_stats(t.bank)
        if stats is None:
            return None
        npci_fail = float(stats.bd_pct or 0.0) + float(stats.td_pct or 0.0)

        # The conservative read of what we are seeing on it right now.
        #
        # wilson_interval is on the SUCCESS rate, so the low end of the failure
        # rate is 1 - hi, not 1 - lo. Getting this backwards fires an alert on
        # a bank with zero failures, because the pessimistic end of a small
        # sample is always high. The whole point is to be sure before shouting.
        _, _, hi = wilson_interval(w.n - w.failures, w.n)
        confident_fail_pct = (1.0 - hi) * 100.0
        observed_fail_pct = 100.0 * w.failures / w.n

        delta = confident_fail_pct - npci_fail
        if delta < MATERIAL_PTS:
            return None

        w.quiet_until = w.seen + COOLDOWN
        alert = Alert(
            bank=t.bank,
            observed_fail_pct=round(observed_fail_pct, 2),
            confident_fail_pct=round(confident_fail_pct, 2),
            npci_fail_pct=round(npci_fail, 2),
            delta_pts=round(delta, 2),
            window_n=w.n,
            at_payment=self.n_seen,
            exposure_paise=self.at_risk_paise,
            detail=(
                "%d of the last %d payments on %s failed (%.1f%%). Even the "
                "conservative end of that interval is %.1f%%, against %.1f%% "
                "published nationally for this bank -- %.1f points worse, on "
                "enough payments to be sure."
                % (
                    w.failures, w.n, t.bank, observed_fail_pct,
                    confident_fail_pct, npci_fail, delta,
                )
            ),
        )
        self.alerted[t.bank] = alert
        return alert

    def snapshot(self) -> dict:
        """Counters the live header renders. Cheap enough to send per payment."""
        return {
            "seen": self.n_seen,
            "failed": self.n_failed,
            "success_pct": round(
                100.0 * (self.n_seen - self.n_failed) / self.n_seen, 2
            )
            if self.n_seen
            else 100.0,
            "at_risk_paise": self.at_risk_paise,
            "banks_watched": len(self.banks),
            "alerts": len(self.alerted),
        }


def in_arrival_order(txns: list[Transaction]) -> Iterator[Transaction]:
    """The batch, in the order the payments actually happened.

    The generator emits by construction rather than by clock, so sorting by
    (day, hour) is what turns a batch back into a timeline. Ties keep their
    original order, which keeps the stream deterministic.
    """
    return iter(sorted(txns, key=lambda t: (t.day, t.hour)))
