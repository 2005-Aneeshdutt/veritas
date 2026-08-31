"""Approving a fix from an email.

A button in a message that applies real payment actions is a capability URL,
and the three ways that goes wrong are all silent. This file exists to make
them loud.

The one that would have shipped without thinking about it: mail providers and
corporate security appliances fetch every link in a message before a person
opens it. A GET that applied a fix would therefore fire on delivery, inside a
scanner, with nobody having decided anything -- and the audit trail would say
the merchant approved it.
"""

import glob
import json
import os
import shutil
import tempfile
import time

import pytest

from doctor.approvals import TTL_SECONDS, Grant, TokenError, mint, read


@pytest.fixture(scope="module")
def run():
    for f in sorted(glob.glob("data/runs/*.json")):
        rec = json.load(open(f, encoding="utf-8"))
        if rec.get("pending_actions"):
            return rec
    pytest.skip("no run with proposed fixes")


# ─────────────────────────────────────────── the token cannot be forged

def test_a_token_round_trips(run):
    t = mint(run["merchant_id"], run["run_id"], 0, "approve")
    who, grant = read(t)
    assert who == run["merchant_id"]
    assert grant.run_id == run["run_id"]
    assert grant.group_index == 0
    assert grant.intent == "approve"


def test_editing_the_payload_invalidates_it(run):
    """Otherwise a recipient could approve a fix they were never sent by
    changing a number in the URL."""
    t = mint(run["merchant_id"], run["run_id"], 0, "approve")
    mid, payload, sig = t.split(".")
    tampered = "%s.%sX.%s" % (mid, payload[:-1], sig)
    with pytest.raises(TokenError) as e:
        read(tampered)
    assert "signature" in str(e.value).lower()


def test_a_token_cannot_be_replayed_against_another_merchant(run):
    """The key is derived per merchant, so one merchant's link is worthless
    on another's account."""
    others = [
        json.load(open(f, encoding="utf-8"))["merchant_id"]
        for f in sorted(glob.glob("data/runs/*.json"))
    ]
    other = next((m for m in others if m != run["merchant_id"]), None)
    if not other:
        pytest.skip("need two merchants")
    t = mint(run["merchant_id"], run["run_id"], 0, "approve")
    _, payload, sig = t.split(".")
    with pytest.raises(TokenError):
        read("%s.%s.%s" % (other, payload, sig))


def test_an_expired_token_says_when_it_expired(run, monkeypatch):
    """"Invalid link" tells a merchant nothing about whether to ask for a new
    one. Expired and tampered are completely different situations."""
    t = mint(run["merchant_id"], run["run_id"], 0, "approve")
    monkeypatch.setattr(time, "time", lambda: time.time.__self__ if False else 10**10)
    with pytest.raises(TokenError) as e:
        read(t)
    assert "expired" in str(e.value).lower()


def test_a_malformed_token_is_refused_not_parsed():
    for junk in ("", "nonsense", "a.b", "a.b.c.d"):
        with pytest.raises(TokenError):
            read(junk)


def test_the_intent_is_part_of_what_is_signed(run):
    """Swapping approve for reject in the URL must not work."""
    ok = mint(run["merchant_id"], run["run_id"], 0, "approve")
    no = mint(run["merchant_id"], run["run_id"], 0, "reject")
    assert ok != no
    assert read(ok)[1].intent == "approve"
    assert read(no)[1].intent == "reject"


def test_the_window_is_days_not_months():
    """A forwarded thread should stop being actionable at some point."""
    assert 24 * 3600 <= TTL_SECONDS <= 30 * 24 * 3600


def test_signing_never_touches_the_private_key():
    """This signs URLs, not authority. Sharing a secret with the mandate key
    would let a link-signing bug reach the thing that grants permission."""
    import inspect

    from doctor import approvals

    src = inspect.getsource(approvals)
    for banned in ("private_key", "Ed25519PrivateKey", "sign_mandate", ".sign("):
        assert banned not in src, banned


# ───────────────────────────────────── the link must not act on its own

def test_opening_the_link_changes_nothing():
    """Mail scanners fetch links before a person sees them. If GET applied a
    fix it would fire on delivery and the ledger would record a merchant
    decision that no merchant made."""
    import inspect

    from doctor import api

    src = inspect.getsource(api.decide_preview)
    for banned in ("apply_group", "write_text", "send("):
        assert banned not in src, "the preview must be read-only: %s" % banned


def test_acting_goes_through_the_same_gate_as_the_button():
    """Email is a channel for the merchant's yes. It is not a way round the
    policy that decides what that yes can authorise."""
    import inspect

    from doctor import api

    src = inspect.getsource(api.decide)
    assert "apply_group" in src
    assert "confirmed=True" in src
    assert "load_mandate" in src


def test_a_rejection_is_recorded_rather_than_discarded():
    """A button that changed nothing and left no trace would be decoration."""
    import inspect

    from doctor import api

    src = inspect.getsource(api.decide)
    assert '"rejected"' in src
    assert "write_text" in src


# ────────────────────────────────────────────── the report itself

def test_the_report_carries_a_decision_for_every_fix(run):
    from doctor.report_mail import render

    html = render(run, "https://example.test")
    assert html.count("/decide/") == 2 * len(run["pending_actions"])


def test_the_report_inlines_its_styles(run):
    """Gmail strips <style> blocks, so a stylesheet renders as an unstyled
    wall of text in the client that matters most here."""
    from doctor.report_mail import render

    html = render(run, "https://example.test")
    assert "<style" not in html
    assert 'style="' in html


def test_the_report_still_states_what_is_not_recoverable(run):
    """The honesty in the plain-text mail must survive the redesign."""
    from doctor.report_mail import render

    html = render(run, "https://example.test")
    if run["report"].get("exceptions", {}).get("unrecoverable_paise"):
        assert "not recoverable by any retry" in html
    assert "projected" in html.lower()


def test_the_html_is_an_alternative_not_a_replacement():
    """A mail with no text part scores worse with spam filters, and this one
    has already landed in spam once."""
    import inspect

    from doctor import outreach

    src = inspect.getsource(outreach.send)
    assert "set_content" in src
    assert "add_alternative" in src


def test_a_broken_report_does_not_stop_the_mail():
    """The plain-text body already carries every figure, so a rendering bug
    must not cost the merchant their report."""
    import inspect

    from doctor import outreach

    src = inspect.getsource(outreach.send)
    block = src[src.index("add_alternative") - 400 : src.index("add_alternative") + 200]
    assert "except" in block
