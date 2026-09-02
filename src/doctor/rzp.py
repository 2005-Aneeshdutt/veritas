"""The Razorpay boundary. One class, no credentials in the source, offline by default.

WHAT THIS IS FOR
----------------
Every call this product could make to Razorpay goes through `RazorpayAdapter`.
Nothing else imports the SDK, reads the key, or knows the API's shape. That
boundary is what makes two things possible at once:

  * the whole product runs, and the whole demo works, with no credentials
  * when a test-mode key IS present, the same code paths talk to a real
    gateway rather than to a second, parallel implementation written for the
    occasion

THE HONESTY PROPERTY
--------------------
Without credentials, every method here raises `NotConfigured`. It does NOT
return a plausible-looking fake payment link and let the UI say "created".

That is the entire point. A stub that returns success is how a demo ends up
claiming a gateway confirmed something no gateway ever saw, and this file is
the one place that mistake would be easy to make. Callers are expected to
catch `NotConfigured` and fall back to the SYNTHETIC path, which is labelled
as such all the way to the screen.

`verify_payment_state` is the method that matters most. Recovery is only
claimed when the gateway says the payment moved to captured/paid -- not when
we sent a link, not when the customer said yes on a call. It exists so that
claim has exactly one implementation.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from .mode import Mode, credentials, current


class NotConfigured(RuntimeError):
    """No test-mode credentials. The caller must fall back to synthetic."""


class RazorpayUnavailable(RuntimeError):
    """Credentials exist but the gateway did not answer."""


class PaymentFacts(BaseModel):
    """What the gateway says about one payment. Its words, not ours."""

    payment_id: str
    status: str
    amount_paise: int
    currency: str = "INR"
    method: str | None = None
    error_code: str | None = None
    error_description: str | None = None
    captured: bool = False
    #: Always razorpay_test here. Present so a caller cannot lose track.
    source: str = "razorpay_test"


class PaymentLinkFacts(BaseModel):
    link_id: str
    status: str          # created | sent | paid | expired | cancelled
    short_url: str | None = None
    amount_paise: int = 0
    payment_id: str | None = None
    source: str = "razorpay_test"


class RazorpayAdapter:
    """The only thing in this codebase that talks to Razorpay.

    Constructed per call rather than held as a module singleton, so a
    credential added to the environment takes effect without a restart and
    one removed stops working immediately.
    """

    def __init__(self) -> None:
        self._creds = credentials()      # raises on a live key
        self._client: Any | None = None

    # -- availability ------------------------------------------------------

    @property
    def configured(self) -> bool:
        return self._creds is not None

    def _require(self) -> Any:
        if not self._creds:
            raise NotConfigured(
                "No RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. Running synthetic."
            )
        if self._client is None:
            try:
                import razorpay  # noqa: PLC0415 -- optional dependency by design
            except ImportError as e:
                raise NotConfigured(
                    "razorpay SDK is not installed. `pip install razorpay` to "
                    "enable test mode; the product does not require it."
                ) from e
            self._client = razorpay.Client(auth=self._creds)
        return self._client

    def ping(self) -> bool:
        """Can we reach the gateway right now? Never raises."""
        try:
            client = self._require()
            client.payment.all({"count": 1})
            return True
        except Exception:
            return False

    # -- reads -------------------------------------------------------------

    def fetch_payment(self, payment_id: str) -> PaymentFacts:
        client = self._require()
        try:
            p = client.payment.fetch(payment_id)
        except Exception as e:
            raise RazorpayUnavailable(str(e)) from e
        return PaymentFacts(
            payment_id=p["id"],
            status=p.get("status", "unknown"),
            amount_paise=int(p.get("amount") or 0),
            currency=p.get("currency", "INR"),
            method=p.get("method"),
            error_code=p.get("error_code"),
            error_description=p.get("error_description"),
            captured=bool(p.get("captured")),
        )

    def fetch_order(self, order_id: str) -> dict:
        client = self._require()
        try:
            return client.order.fetch(order_id)
        except Exception as e:
            raise RazorpayUnavailable(str(e)) from e

    def fetch_payment_link(self, link_id: str) -> PaymentLinkFacts:
        client = self._require()
        try:
            lk = client.payment_link.fetch(link_id)
        except Exception as e:
            raise RazorpayUnavailable(str(e)) from e
        return PaymentLinkFacts(
            link_id=lk["id"],
            status=lk.get("status", "created"),
            short_url=lk.get("short_url"),
            amount_paise=int(lk.get("amount") or 0),
            payment_id=(lk.get("payments") or [{}])[0].get("payment_id")
            if lk.get("payments") else None,
        )

    # -- the one write -----------------------------------------------------

    def create_payment_link(
        self,
        *,
        amount_paise: int,
        description: str,
        reference_id: str,
        merchant_id: str,
        customer_contact: str | None = None,
        customer_email: str | None = None,
        expire_by_epoch: int | None = None,
    ) -> PaymentLinkFacts:
        """Create a link for one failed payment.

        `reference_id` is the idempotency handle Razorpay itself enforces: a
        second create with the same reference is rejected by the gateway. So
        the double-charge protection is belt and braces -- events.py refuses
        the second attempt before it is made, and the gateway would refuse it
        again if that check were ever removed.

        Customer contact details are passed through, never stored, and never
        logged. The audit entry records that a link was created and for which
        payment; it does not record who was contacted beyond an identifier.
        """
        client = self._require()
        body: dict[str, Any] = {
            "amount": amount_paise,
            "currency": "INR",
            "description": description[:255],
            "reference_id": reference_id,
            "notes": {"merchant_id": merchant_id, "source": "revenue_doctor"},
            # The customer is being asked to re-attempt a payment they already
            # started. Reminders are the merchant's decision, not ours, and
            # the stopping rules live in the policy kernel -- so the gateway's
            # own reminder loop stays off.
            "reminder_enable": False,
        }
        cust: dict[str, str] = {}
        if customer_contact:
            cust["contact"] = customer_contact
        if customer_email:
            cust["email"] = customer_email
        if cust:
            body["customer"] = cust
            body["notify"] = {"sms": False, "email": bool(customer_email)}
        if expire_by_epoch:
            body["expire_by"] = expire_by_epoch

        try:
            lk = client.payment_link.create(body)
        except Exception as e:
            raise RazorpayUnavailable(str(e)) from e
        return PaymentLinkFacts(
            link_id=lk["id"],
            status=lk.get("status", "created"),
            short_url=lk.get("short_url"),
            amount_paise=int(lk.get("amount") or amount_paise),
        )

    def cancel_payment_link(self, link_id: str) -> PaymentLinkFacts:
        client = self._require()
        try:
            lk = client.payment_link.cancel(link_id)
        except Exception as e:
            raise RazorpayUnavailable(str(e)) from e
        return PaymentLinkFacts(
            link_id=lk["id"],
            status=lk.get("status", "cancelled"),
            amount_paise=int(lk.get("amount") or 0),
        )

    # -- the method the recovery claim rests on ----------------------------

    def verify_payment_state(self, payment_id: str) -> tuple[bool, str]:
        """Did this payment actually complete? The gateway's answer, not ours.

        Returns (money_moved, status). This is the ONLY thing entitled to turn
        an intervention into a recovered rupee in RAZORPAY_TEST mode. Sending
        a link is not recovery. A customer agreeing on a call is not recovery.
        `captured` or `paid`, from here, is recovery.
        """
        facts = self.fetch_payment(payment_id)
        return (facts.status in ("captured", "authorized") and facts.captured,
                facts.status)


def adapter_status() -> dict:
    """What the boundary can do right now. Safe to call with no credentials."""
    try:
        ad = RazorpayAdapter()
    except Exception as e:                       # a live key
        return {
            "configured": False, "sdk_installed": False, "reachable": False,
            "detail": str(e),
        }

    try:
        import razorpay  # noqa: F401
        sdk = True
    except ImportError:
        sdk = False

    if not ad.configured:
        return {
            "configured": False, "sdk_installed": sdk, "reachable": False,
            "detail": (
                "No test-mode credentials. Every recovery figure comes from "
                "the deterministic synthetic path and is labelled "
                "SYNTHETIC EVALUATION."
            ),
        }
    if not sdk:
        return {
            "configured": True, "sdk_installed": False, "reachable": False,
            "detail": (
                "Credentials present but the razorpay SDK is not installed, "
                "so nothing can be fetched or verified. Still synthetic."
            ),
        }
    ok = ad.ping()
    return {
        "configured": True, "sdk_installed": True, "reachable": ok,
        "detail": (
            "Razorpay test mode reachable. Payment facts and payment-link "
            "outcomes come from the gateway."
            if ok else
            "Credentials present but the gateway did not answer. Nothing is "
            "claimed as test-mode until it does."
        ),
    }


def effective_mode() -> Mode:
    """The mode after checking the boundary actually works, not just the env."""
    if current() is Mode.SYNTHETIC:
        return Mode.SYNTHETIC
    st = adapter_status()
    return Mode.RAZORPAY_TEST if st.get("reachable") else Mode.SYNTHETIC
