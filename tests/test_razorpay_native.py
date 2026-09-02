"""Mode separation, event ingestion, the adapter boundary, and the recovery loop.

The claims defended here are mostly negative ones, which is the point. This
part of the product is where a demo is most tempted to lie -- about whether a
gateway was involved, about whether a payment was really recovered, about
whether the same webhook arriving twice does the work twice. Each of those
gets a test that fails if the lie becomes possible.
"""

from __future__ import annotations

import json
import shutil

import pytest

from doctor import events as ev
from doctor import mode as md
from doctor.channels import CHANNEL_PICKUP, decide
from doctor.recovery import execute_recovery, plan_recovery, settle_from_events
from doctor.run import load_mandate
from doctor.rzp import NotConfigured, RazorpayAdapter, adapter_status

MERCHANT = "cloudsync"


@pytest.fixture(autouse=True)
def _isolated_events(tmp_path, monkeypatch):
    """Every test gets its own event store. Nothing leaks into data/events."""
    store_dir = tmp_path / "events"
    store_dir.mkdir()
    monkeypatch.setattr(ev, "STORE", store_dir)
    monkeypatch.setattr(ev.store, "_path", lambda s: store_dir / ("%s.jsonl" % s))
    ev._refused["count"] = 0
    yield
    shutil.rmtree(store_dir, ignore_errors=True)


@pytest.fixture(autouse=True)
def _no_credentials(monkeypatch):
    """The default state, and the one the whole demo has to work in."""
    for k in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"):
        monkeypatch.delenv(k, raising=False)


# -- 1. the mode is never blurred -----------------------------------------

def test_default_mode_is_synthetic_and_says_so():
    st = md.status()
    assert st.mode is md.Mode.SYNTHETIC
    assert st.label == "SYNTHETIC EVALUATION"
    assert not st.razorpay_configured
    assert "No RAZORPAY_KEY_ID" in st.reason


def test_a_live_key_is_refused_not_downgraded(monkeypatch):
    """The one environment variable between test mode and a real charge.

    A live key must not silently fall back to synthetic: silent degradation
    is how somebody demos something they believe is live.
    """
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_live_abcdef")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "x")
    with pytest.raises(md.LiveKeyRefused):
        md.credentials()
    st = md.status()
    assert st.mode is md.Mode.SYNTHETIC
    assert "LIVE key" in st.reason


def test_a_key_of_unknown_shape_is_refused(monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "something_else")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "x")
    with pytest.raises(md.LiveKeyRefused):
        md.credentials()


def test_test_mode_is_recognised(monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_abc")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    st = md.status()
    assert st.mode is md.Mode.RAZORPAY_TEST
    assert st.label == "RAZORPAY TEST MODE"
    assert "no razorpay_webhook_secret" in st.reason.lower()


def test_the_two_labels_are_never_the_same_string():
    assert md.LABEL[md.Mode.SYNTHETIC] != md.LABEL[md.Mode.RAZORPAY_TEST]
    assert "SYNTHETIC" in md.LABEL[md.Mode.SYNTHETIC]
    assert "TEST MODE" in md.LABEL[md.Mode.RAZORPAY_TEST]


# -- 2. the adapter never invents a gateway answer ------------------------

def test_the_adapter_raises_rather_than_faking_without_credentials():
    """The single most important negative test in this file.

    A stub returning a plausible payment link is how a submission ends up
    claiming a gateway confirmed something it never saw.
    """
    ad = RazorpayAdapter()
    assert not ad.configured
    for call in (
        lambda: ad.fetch_payment("pay_x"),
        lambda: ad.fetch_order("order_x"),
        lambda: ad.fetch_payment_link("plink_x"),
        lambda: ad.verify_payment_state("pay_x"),
        lambda: ad.create_payment_link(
            amount_paise=100, description="d", reference_id="r",
            merchant_id=MERCHANT,
        ),
        lambda: ad.cancel_payment_link("plink_x"),
    ):
        with pytest.raises(NotConfigured):
            call()


def test_adapter_status_is_safe_and_honest_with_no_credentials():
    st = adapter_status()
    assert st["configured"] is False
    assert st["reachable"] is False
    assert "SYNTHETIC" in st["detail"]


def test_ping_never_raises():
    assert RazorpayAdapter().ping() is False


# -- 3. events: idempotency, both kinds -----------------------------------

def _evt(eid: str, etype: str = "payment.failed", pay: str = "pay_1") -> ev.Event:
    return ev.Event(
        event_id=eid, source="synthetic", event_type=etype,
        timestamp="2026-09-01T00:00:00Z", received_at="2026-09-01T00:00:01Z",
        merchant_id=MERCHANT, payment_id=pay, amount_paise=10_000,
        new_state="failed",
    )


def test_the_same_delivery_twice_is_stored_once():
    """Gateways redeliver on timeout. That is normal traffic, not an error."""
    assert ev.ingest([_evt("evt_1")]).accepted == 1
    second = ev.ingest([_evt("evt_1")])
    assert second.accepted == 0 and second.duplicates == 1
    assert len(ev.store.all()) == 1


def test_a_redelivery_with_a_fresh_id_still_cannot_act_twice():
    """The key that actually matters.

    A gateway can invent a new event id for a redelivery. The delivery-level
    check would let that through; the (payment, action) key is what stops the
    second retry.
    """
    assert ev.record_action("pay_9", "retry", MERCHANT, 5_000) is True
    assert ev.record_action("pay_9", "retry", MERCHANT, 5_000) is False
    # A different action on the same payment is a different question.
    assert ev.record_action("pay_9", "payment_link", MERCHANT, 5_000) is True


def test_the_idempotency_key_survives_ingestion():
    """A regression guard for a real bug.

    `ingest` used to overwrite `processing_note` for any event type it did
    not recognise -- and that note is where the idempotency key lives. Our own
    event types were not in KNOWN_TYPES, so every duplicate-action check
    silently returned False and the one guarantee this module exists to give
    was not being given.
    """
    ev.record_action("pay_note", "retry", MERCHANT, 1_000, detail="gate=OK")
    stored = [e for e in ev.store.all() if e.payment_id == "pay_note"]
    assert stored
    assert stored[0].processing_note.startswith("action:pay_note|retry")
    assert ev.action_already_taken("pay_note", "retry")


def test_an_unknown_event_type_is_stored_not_dropped():
    ev.ingest([_evt("evt_odd", etype="payment.some_future_thing")])
    got = ev.store.all()
    assert len(got) == 1
    assert got[0].processing_status == "ignored"
    assert "not handled" in got[0].processing_note


def test_an_event_with_no_id_is_rejected():
    bad = _evt("x").model_copy(update={"event_id": ""})
    assert ev.ingest([bad]).rejected == 1
    assert ev.store.all() == []


# -- 4. webhook authentication --------------------------------------------

def test_an_unconfigured_webhook_secret_rejects_everything():
    """Fails closed. The mistake here is nearly always made the other way."""
    assert ev.verify_signature(b"{}", "deadbeef", "") is False
    assert ev.verify_signature(b"{}", "", "secret") is False


def test_a_correct_signature_verifies_and_a_tampered_body_does_not():
    import hmac
    from hashlib import sha256

    secret, body = "shh", b'{"event":"payment.captured"}'
    sig = hmac.new(secret.encode(), body, sha256).hexdigest()
    assert ev.verify_signature(body, sig, secret)
    assert not ev.verify_signature(body + b" ", sig, secret)
    assert not ev.verify_signature(body, sig, "wrong")


def test_a_razorpay_payload_normalises_without_inventing_fields():
    payload = {
        "id": "evt_abc",
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_real",
                    "amount": 24_816_00,
                    "currency": "INR",
                    "error_code": "BAD_REQUEST_ERROR",
                    "created_at": 1788000000,
                    "notes": {"merchant_id": MERCHANT},
                }
            }
        },
    }
    e = ev.normalise(payload, "razorpay_test")
    assert e is not None
    assert e.event_id == "evt_abc"
    assert e.source == "razorpay_test"
    assert e.payment_id == "pay_real"
    assert e.amount_paise == 2_481_600
    assert e.previous_state == "created" and e.new_state == "failed"
    assert e.merchant_id == MERCHANT
    # The raw payload is kept, so a normalisation bug is recoverable.
    assert e.raw == payload


def test_an_unreadable_payload_returns_none_rather_than_guessing():
    assert ev.normalise({}, "razorpay_test") is None
    assert ev.normalise({"not_an_event": 1}, "razorpay_test") is None


# -- 5. recovery is claimed by an outcome event and nothing else ----------

def test_no_outcome_event_means_no_recovery():
    paise, event_id, state = settle_from_events("pay_never_heard_of")
    assert paise == 0 and event_id is None and state == "awaiting_outcome"


def test_launching_an_intervention_is_not_a_recovery():
    """Sending is not recovering. The distinction the whole file exists for."""
    ev.record_action("pay_sent", "payment_link", MERCHANT, 50_000)
    ev.emit(
        event_type="payment_link.created", source="internal",
        merchant_id=MERCHANT, payment_id="pay_sent", amount_paise=50_000,
    )
    paise, _, state = settle_from_events("pay_sent")
    assert paise == 0
    assert state == "awaiting_outcome"


def test_an_outcome_event_is_what_makes_it_a_recovery():
    ev.ingest([_evt("evt_paid", etype="payment_link.paid", pay="pay_won")])
    paise, event_id, state = settle_from_events("pay_won")
    assert paise == 10_000
    assert event_id == "evt_paid"
    assert state == "recovered"


def test_a_test_mode_outcome_is_verified_against_the_gateway_before_it_counts():
    """An event says a thing happened. In test mode we go and check."""
    e = _evt("evt_rzp", etype="payment.captured", pay="pay_claim").model_copy(
        update={"source": "razorpay_test"}
    )
    ev.ingest([e])
    paise, _, state = settle_from_events("pay_claim")
    # No credentials, so it cannot be verified -- and therefore is not counted.
    assert paise == 0
    assert state == "event_received_but_unverifiable"


# -- 6. the channel policy -------------------------------------------------

def test_the_quietest_workable_channel_wins():
    signed = load_mandate(MERCHANT)
    d = decide(
        txn_id="pay_quiet", merchant_id=MERCHANT, amount_paise=200_000,
        error_class="soft_decline", bank="HDFC Bank Ltd.",
        prior_attempts=1, signed=signed,
    )
    assert d.chosen == "retry"
    assert d.max_contact_attempts == 0, "a retry must not contact anybody"


def test_a_contact_channel_inherits_the_cap_and_the_ceiling():
    """A regression guard for a real design bug.

    REISSUE_PAYMENT_LINK is auto-executable, so the kernel applies the attempt
    cap and the hard ceiling to a payment link exactly as to a retry. The
    channel layer used to ignore that and proposed calls the kernel then
    denied on every single one.
    """
    signed = load_mandate(MERCHANT)
    over = signed.mandate.max_amount_paise + 1
    d = decide(
        txn_id="pay_big", merchant_id=MERCHANT, amount_paise=over,
        error_class="soft_decline", bank="HDFC Bank Ltd.",
        prior_attempts=1, signed=signed,
    )
    assert d.chosen in ("escalate", "no_action")
    assert all(
        not o.eligible for o in d.options
        if o.channel in ("payment_link", "voice", "email")
    )


def test_an_exhausted_attempt_budget_leaves_no_auto_channel():
    signed = load_mandate(MERCHANT)
    d = decide(
        txn_id="pay_spent", merchant_id=MERCHANT, amount_paise=200_000,
        error_class="soft_decline", bank="HDFC Bank Ltd.",
        prior_attempts=signed.mandate.max_attempts_per_payment,
        signed=signed,
    )
    assert d.chosen == "escalate"


def test_a_hard_decline_gets_no_channel_at_all():
    signed = load_mandate(MERCHANT)
    d = decide(
        txn_id="pay_dead", merchant_id=MERCHANT, amount_paise=200_000,
        error_class="hard_decline", bank="HDFC Bank Ltd.",
        prior_attempts=1, signed=signed,
    )
    assert d.chosen == "no_action"


def test_a_degraded_issuer_produces_a_hold_with_a_resume_condition():
    """Section 35: the system has to know when NOT to recover immediately."""
    signed = load_mandate(MERCHANT)
    d = decide(
        txn_id="pay_down", merchant_id=MERCHANT, amount_paise=200_000,
        error_class="technical", bank="Sick Bank",
        prior_attempts=1, signed=signed,
        bank_health=[{"bank": "Sick Bank", "npci_td_pct": 4.0}],
    )
    assert d.chosen == "no_action"
    assert d.downtime_hold is True
    assert d.max_contact_attempts == 0
    assert "technical-decline" in d.resume_condition
    assert all(not o.eligible for o in d.options)


def test_every_channel_option_is_priced_from_the_stated_assumption():
    signed = load_mandate(MERCHANT)
    d = decide(
        txn_id="pay_priced", merchant_id=MERCHANT, amount_paise=200_000,
        error_class="soft_decline", bank="HDFC Bank Ltd.",
        prior_attempts=1, signed=signed,
    )
    for o in d.options:
        if o.eligible:
            assert o.pickup_assumed == CHANNEL_PICKUP[o.channel]
            assert o.net_paise == o.expected_recovery_paise - o.cost_paise
        else:
            assert o.expected_recovery_paise == 0


def test_the_channel_decision_never_sees_ground_truth_by_default():
    """`convertible` exists for marking after the fact, never for deciding."""
    import inspect

    sig = inspect.signature(decide)
    assert sig.parameters["convertible"].default is None


# -- 7. the recovery loop, end to end -------------------------------------

def test_planning_writes_nothing_and_is_repeatable():
    signed = load_mandate(MERCHANT)
    a = plan_recovery(MERCHANT, "pay_cloudsync_0060", signed)
    b = plan_recovery(MERCHANT, "pay_cloudsync_0060", signed)
    assert a.model_dump() == b.model_dump()
    assert ev.store.all() == []


def test_a_denied_payment_is_never_executed():
    signed = load_mandate(MERCHANT)
    att = plan_recovery(MERCHANT, "pay_cloudsync_0060", signed)
    # Above the ceiling and uncontactable: nothing is available.
    assert att.decision.chosen in ("escalate", "no_action")
    assert att.executed is False


def test_an_unknown_payment_is_a_404_not_a_guess():
    signed = load_mandate(MERCHANT)
    with pytest.raises(FileNotFoundError):
        plan_recovery(MERCHANT, "pay_does_not_exist", signed)


def test_the_attempt_carries_its_mode_label():
    signed = load_mandate(MERCHANT)
    att = plan_recovery(MERCHANT, "pay_cloudsync_0060", signed)
    assert att.mode == "synthetic"
    assert att.mode_label == "SYNTHETIC EVALUATION"
