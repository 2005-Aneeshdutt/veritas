"""Which world the numbers on screen came from. One answer, computed once.

THE PROBLEM THIS SOLVES
-----------------------
This product has always been careful about *measured* versus *projected*. It
now also has to be careful about a second, harder distinction: whether a
figure came from a deterministic replay over generated data, or from a real
payment gateway that really answered.

Those two are much easier to blur than measured/projected, because they look
identical on screen. A recovered rupee from the mock rail and a recovered
rupee from a Razorpay test-mode capture render the same way, and only one of
them means "an external system agreed with us".

So the mode is not a flag threaded through call sites where somebody can
forget it. It is one function, read from the environment, surfaced on
/api/health, and stamped on every response that carries money.

WHY LIVE KEYS ARE REFUSED, NOT SUPPORTED
----------------------------------------
`rzp_live_` is rejected outright and the process says so. This is a
buildathon submission that proposes retrying customers' failed payments; the
distance between "test mode" and "charged a real person" is one environment
variable, and the correct number of ways to cross that line accidentally is
zero. A live key does not degrade to synthetic silently either -- silent
degradation is how you end up demoing something you think is live.
"""

from __future__ import annotations

import os
from enum import Enum

from pydantic import BaseModel


class Mode(str, Enum):
    """Where the payment facts on screen come from."""

    #: Generated batches, deterministic rail, ground truth on file. Every
    #: rupee is a replay. This is the default and needs no credentials.
    SYNTHETIC = "synthetic"
    #: A real Razorpay test-mode account answered. Nothing here touches real
    #: money, but the gateway is genuinely in the loop.
    RAZORPAY_TEST = "razorpay_test"


#: What each mode is called on screen. Never abbreviated, never softened.
LABEL: dict[Mode, str] = {
    Mode.SYNTHETIC: "SYNTHETIC EVALUATION",
    Mode.RAZORPAY_TEST: "RAZORPAY TEST MODE",
}

BLURB: dict[Mode, str] = {
    Mode.SYNTHETIC: (
        "Every payment, outcome and rupee below is generated and replayed "
        "deterministically. No external system was contacted."
    ),
    Mode.RAZORPAY_TEST: (
        "Payment facts below came from a Razorpay test-mode account. No real "
        "money moves in test mode, and nothing here is a live transaction."
    ),
}


class ModeStatus(BaseModel):
    """What the running process can actually do, and what it cannot."""

    mode: Mode
    label: str
    blurb: str
    #: Are test-mode credentials configured at all?
    razorpay_configured: bool
    #: Can the process reach Razorpay right now? None until something tries.
    razorpay_reachable: bool | None = None
    #: Is a webhook secret set, so inbound events can be authenticated?
    webhook_secret_configured: bool
    #: Why the mode is what it is, in one sentence a person can act on.
    reason: str


class LiveKeyRefused(RuntimeError):
    """A `rzp_live_` key was supplied. Refused rather than downgraded."""


def _key_id() -> str:
    return (os.getenv("RAZORPAY_KEY_ID") or "").strip()


def _key_secret() -> str:
    return (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()


def webhook_secret() -> str:
    return (os.getenv("RAZORPAY_WEBHOOK_SECRET") or "").strip()


def credentials() -> tuple[str, str] | None:
    """Test-mode key pair, or None. Raises on a live key.

    Nothing else in the codebase reads the environment for these, so this is
    the only place a credential can enter the process.
    """
    kid, secret = _key_id(), _key_secret()
    if kid.startswith("rzp_live_"):
        raise LiveKeyRefused(
            "RAZORPAY_KEY_ID is a LIVE key. This system proposes retrying "
            "customers' failed payments and will not run against live "
            "credentials. Use a rzp_test_ key."
        )
    if not kid or not secret:
        return None
    if not kid.startswith("rzp_test_"):
        raise LiveKeyRefused(
            "RAZORPAY_KEY_ID is neither a rzp_test_ nor a rzp_live_ key. "
            "Refusing rather than guessing which it is."
        )
    return kid, secret


def current() -> Mode:
    """The mode this process is in. Cheap; safe to call per request."""
    try:
        return Mode.RAZORPAY_TEST if credentials() else Mode.SYNTHETIC
    except LiveKeyRefused:
        # A live key is a hard stop, not a fallback. Reported by status().
        raise


def status() -> ModeStatus:
    """The mode plus everything a person needs to change it."""
    try:
        creds = credentials()
    except LiveKeyRefused as e:
        # Surfaced rather than raised through the API, so the page can say
        # what is wrong instead of returning a 500 with no explanation.
        return ModeStatus(
            mode=Mode.SYNTHETIC,
            label=LABEL[Mode.SYNTHETIC],
            blurb=BLURB[Mode.SYNTHETIC],
            razorpay_configured=False,
            webhook_secret_configured=bool(webhook_secret()),
            reason=str(e),
        )

    if creds:
        return ModeStatus(
            mode=Mode.RAZORPAY_TEST,
            label=LABEL[Mode.RAZORPAY_TEST],
            blurb=BLURB[Mode.RAZORPAY_TEST],
            razorpay_configured=True,
            webhook_secret_configured=bool(webhook_secret()),
            reason=(
                "A rzp_test_ key pair is configured, so payment facts can be "
                "fetched from and verified against Razorpay test mode."
                + (
                    ""
                    if webhook_secret()
                    else " No RAZORPAY_WEBHOOK_SECRET is set, so inbound "
                    "events cannot be authenticated and will be rejected."
                )
            ),
        )

    return ModeStatus(
        mode=Mode.SYNTHETIC,
        label=LABEL[Mode.SYNTHETIC],
        blurb=BLURB[Mode.SYNTHETIC],
        razorpay_configured=False,
        webhook_secret_configured=bool(webhook_secret()),
        reason=(
            "No RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in the environment. The "
            "whole product runs in this mode -- credentials add a second "
            "source of payment facts, they are not required for anything."
        ),
    )


def stamp() -> dict:
    """The provenance block to attach to any response carrying money."""
    st = status()
    return {"mode": st.mode.value, "mode_label": st.label}
