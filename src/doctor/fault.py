"""Whose move is it?

The exceptions page called an entire class "permanently unusable -- the card
or account cannot be charged at all. Only the customer can fix this." Then you
read what is actually in it:

    merchant_not_activated
    live_mode_not_enabled
    upi_collect_not_enabled
    amount_less_than_minimum_amount
    invalid_email

None of those is a dead card. They are the merchant's own integration being
misconfigured, and the system was telling them nothing could be done while
they lost money on every affected payment. On the demo book that was roughly
Rs 3.5 lakh sitting inside a bucket labelled hopeless.

So this attributes each error code to whoever actually has to act. The
important design choice is WHERE the attribution comes from: Razorpay
publishes a `next_steps` line for every code, and that line says who is being
addressed --

    "The customer must use a different card or method."   -> customer
    "Please reach out to Razorpay."                       -> platform
    "Please make sure that the payment amount is ..."     -> merchant

Deriving it from that text means the attribution is grounded in the same
published source as the taxonomy, and a code Razorpay adds tomorrow is
classified by its own guidance rather than by a list here that has quietly
gone stale. Codes whose wording is genuinely ambiguous -- "retry with a
different payment method" could be either party -- come out UNKNOWN and are
reported as unknown. Guessing an owner would put a merchant to work on
something that was never theirs.

This is the highest-confidence money in the system, and the only figure here
that needs no error bar. Every other rupee is projected through a retry model.
A merchant who has not enabled UPI collect is not losing those payments
probabilistically; they are losing all of them, and they will keep losing them
until the setting changes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
LABELS = ROOT / "evals" / "error_labels.json"

CUSTOMER = "customer"
MERCHANT = "merchant"
PLATFORM = "platform"
UNKNOWN = "unknown"

#: Read off Razorpay's own next_steps wording. Ordered: the customer test runs
#: first because "the customer must ..." is unambiguous, then the platform
#: test, then the merchant test, which is the broadest and would otherwise
#: swallow the other two.
_CUSTOMER = re.compile(r"\b(the )?customer (must|should|can|has to|needs|may|to)\b", re.I)
_PLATFORM = re.compile(r"reach out to razorpay|contact razorpay|contact our support|razorpay support", re.I)
_MERCHANT = re.compile(
    r"\b(make sure|ensure|recheck|check your|check the payment|check for order|"
    r"verify|pass |update your|enable |choose another)",
    re.I,
)

OWNER_LABEL = {
    CUSTOMER: "The customer has to act",
    MERCHANT: "You have to act",
    PLATFORM: "Razorpay has to act",
    UNKNOWN: "Not attributable from the published guidance",
}


class FaultGroup(BaseModel):
    owner: str
    label: str
    count: int
    total_paise: int
    #: Distinct codes, largest first, with Razorpay's own instruction.
    codes: list[dict]


def _taxonomy() -> dict[str, dict]:
    try:
        d = json.loads(LABELS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return {r["code"]: r for r in d.get("labels", []) if r.get("code")}


def owner_of(next_steps: str | None) -> str:
    """Who Razorpay's own guidance is addressed to."""
    text = (next_steps or "").strip()
    if not text:
        return UNKNOWN
    if _CUSTOMER.search(text):
        return CUSTOMER
    if _PLATFORM.search(text):
        return PLATFORM
    if _MERCHANT.search(text):
        return MERCHANT
    return UNKNOWN


def attribute(txns) -> list[FaultGroup]:
    """Group unrecoverable failures by who actually has to do something.

    `txns` is any iterable of objects with `error_code` and `amount_paise` --
    the report passes the transactions it has already decided are not
    retryable.
    """
    tax = _taxonomy()
    buckets: dict[str, dict] = {}

    for t in txns:
        code = getattr(t, "error_code", None) or (
            t.get("error_code") if isinstance(t, dict) else None
        )
        amount = getattr(t, "amount_paise", None)
        if amount is None and isinstance(t, dict):
            amount = t.get("amount_paise", 0)
        if not code:
            continue

        row = tax.get(code, {})
        who = owner_of(row.get("next_steps"))
        b = buckets.setdefault(
            who, {"count": 0, "total_paise": 0, "codes": {}}
        )
        b["count"] += 1
        b["total_paise"] += int(amount or 0)
        c = b["codes"].setdefault(
            code,
            {
                "code": code,
                "count": 0,
                "total_paise": 0,
                # Razorpay's own words, so the merchant is not reading our
                # paraphrase of what to do about their own integration.
                "next_steps": (row.get("next_steps") or "").strip(),
                "explanation": (row.get("explanation") or "").strip(),
            },
        )
        c["count"] += 1
        c["total_paise"] += int(amount or 0)

    out = [
        FaultGroup(
            owner=who,
            label=OWNER_LABEL.get(who, who),
            count=b["count"],
            total_paise=b["total_paise"],
            codes=sorted(b["codes"].values(), key=lambda c: -c["total_paise"]),
        )
        for who, b in buckets.items()
    ]
    # The merchant's own faults first: they are the only ones the reader can
    # fix this afternoon, and burying them under the customer's is how this
    # was invisible in the first place.
    order = {MERCHANT: 0, PLATFORM: 1, CUSTOMER: 2, UNKNOWN: 3}
    out.sort(key=lambda g: (order.get(g.owner, 9), -g.total_paise))
    return out


def merchant_fault_paise(groups: list[FaultGroup]) -> int:
    """The part of the write-off the merchant can end today."""
    return sum(g.total_paise for g in groups if g.owner == MERCHANT)
