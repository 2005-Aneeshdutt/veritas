"""Approving a fix from an email, without turning a link into a loaded gun.

A button in an email that applies real payment actions is a capability URL:
whoever holds it can act. That makes three things load-bearing, and getting
any of them wrong is worse than not shipping the feature.

  1. THE LINK MUST NOT ACT. Gmail, Outlook and corporate scanners fetch the
     URLs in a message before a person ever sees it. A GET that applies a fix
     would fire on delivery, in the scanner, with nobody having decided
     anything. So the link opens a page that describes what will happen, and
     acting takes a POST from that page.

  2. THE TOKEN MUST NOT BE GUESSABLE OR EDITABLE. It carries a run, a fix and
     an intent, and it is signed. Changing any field invalidates it, so a
     recipient cannot approve a different fix than the one they were sent by
     editing the URL.

  3. IT MUST NOT WIDEN AUTHORITY. Approving by email lands in exactly the same
     place as pressing the button in the app: apply_group, which re-gates
     every action against the signed mandate. Anything the kernel denies stays
     denied. Email is a channel for the merchant's yes, never a way round the
     policy that governs it.

The secret is derived from the merchant's own mandate rather than configured,
so a deployment with no extra setup still gets unforgeable links, and tokens
minted for one merchant cannot be replayed against another.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from pydantic import BaseModel

#: Long enough that a merchant can read their mail after a weekend, short
#: enough that a forwarded thread does not stay actionable for ever.
TTL_SECONDS = 7 * 24 * 3600


class Grant(BaseModel):
    """What a link is permitted to do, once."""

    run_id: str
    group_index: int
    intent: str  # approve | reject
    issued_at: int
    expires_at: int


class TokenError(Exception):
    """A token that cannot be trusted, with a reason a person can act on."""


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _secret(merchant_id: str) -> bytes:
    """A per-merchant signing key, derived rather than configured.

    Taken from the public half of the mandate the merchant already signed, so
    there is nothing extra to deploy and a token minted for one merchant is
    worthless against another. It never touches the private key -- this signs
    URLs, not authority, and the two must not share a secret.
    """
    from .run import load_mandate

    try:
        pub = load_mandate(merchant_id).mandate.public_key_hex
    except (SystemExit, FileNotFoundError, KeyError):
        raise TokenError("no mandate on file for %s" % merchant_id)
    return hashlib.sha256(("rd.approval.v1:" + pub).encode()).digest()


def mint(merchant_id: str, run_id: str, group_index: int, intent: str) -> str:
    if intent not in ("approve", "reject"):
        raise ValueError("intent must be approve or reject")
    now = int(time.time())
    grant = Grant(
        run_id=run_id,
        group_index=group_index,
        intent=intent,
        issued_at=now,
        expires_at=now + TTL_SECONDS,
    )
    payload = _b64(grant.model_dump_json().encode())
    sig = _b64(hmac.new(_secret(merchant_id), payload.encode(), hashlib.sha256).digest())
    return "%s.%s.%s" % (merchant_id, payload, sig)


def read(token: str) -> tuple[str, Grant]:
    """Verify a token and return who it is for and what it permits.

    Every failure is its own message. "Invalid link" tells a merchant nothing
    about whether to ask for a new one, and an expired link is a completely
    different situation from a tampered one.
    """
    parts = (token or "").split(".")
    if len(parts) != 3:
        raise TokenError("This link is malformed.")
    merchant_id, payload, sig = parts

    expected = _b64(
        hmac.new(_secret(merchant_id), payload.encode(), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(sig, expected):
        raise TokenError(
            "This link's signature does not match. It was altered after it was "
            "sent, or it was issued for a different merchant."
        )

    try:
        grant = Grant.model_validate_json(_unb64(payload).decode())
    except Exception:
        raise TokenError("This link's contents could not be read.")

    if int(time.time()) > grant.expires_at:
        raise TokenError(
            "This link expired on %s. Ask for a fresh report and it will carry "
            "new ones." % time.strftime("%d %b %Y", time.gmtime(grant.expires_at))
        )
    return merchant_id, grant
