"""Reading the merchant's own theory and checking it against the data.

The extraction is a model call; the adjudication is arithmetic. These use a
fake client for the first and the real decomposition for the second, because
what has to hold is the ruling, not the model's manners.

The verdict that matters most is INSIDE_ERROR_BAR. Telling a merchant "yes,
you were right" on a factor sitting inside its own measured error is
confirming a theory with noise, and it is the failure mode a system like this
would fall into by default.
"""

import json

import pytest

from doctor.claims import (
    Adjudication,
    Claim,
    adjudicate,
    context_lines,
    extract,
    read_note,
)
from doctor.hypothesise import RootCauseLabel

NOTE = "We moved billing to 2 AM and too much volume sits on one bank."


class FakeResult:
    def __init__(self, payload=None, stub=False):
        self.text = json.dumps(payload) if payload is not None else ""
        self.parsed = payload
        self.stub = stub
        self.cache_hit = False


class FakeClient:
    def __init__(self, payload=None, stub=False):
        self.payload = payload
        self.stub = stub

    def complete(self, **kw):
        return FakeResult(self.payload, self.stub)


def _rec(factors, process_gap=0.0):
    return {
        "report": {
            "decomposition": {
                "factors": factors,
                "process_gap_pts": process_gap,
            }
        }
    }


def F(name, pts, mae=0.57, identified=True):
    return {"factor": name, "points": pts, "mae": mae, "identified": identified}


# ───────────────────────────────────────────────────────── extraction

def test_a_label_outside_the_enum_is_dropped():
    """Otherwise the model widens its own vocabulary."""
    claims, _ = extract(
        NOTE,
        FakeClient({"claims": [{"label": "gateway_is_flaky", "quote": "", "paraphrase": ""}]}),
    )
    assert claims == []


def test_none_of_the_above_is_not_a_claim():
    claims, _ = extract(
        NOTE,
        FakeClient({"claims": [{"label": "none_of_the_above", "quote": "", "paraphrase": ""}]}),
    )
    assert claims == []


def test_a_quote_that_is_not_in_the_note_is_discarded():
    """A paraphrase presented as a quotation stops a reader auditing it."""
    claims, _ = extract(
        NOTE,
        FakeClient({"claims": [{
            "label": "midnight_billing_penalty",
            "quote": "we run our cron at midnight",  # never said
            "paraphrase": "billing moved late",
        }]}),
    )
    assert claims[0].quote == ""
    assert claims[0].paraphrase


def test_a_real_quote_survives():
    claims, _ = extract(
        NOTE,
        FakeClient({"claims": [{
            "label": "midnight_billing_penalty",
            "quote": "We moved billing to 2 AM",
            "paraphrase": "",
        }]}),
    )
    assert claims[0].quote == "We moved billing to 2 AM"


def test_an_empty_note_calls_nothing():
    claims, stubbed = extract("   ", FakeClient({"claims": []}))
    assert claims == [] and stubbed is False


# ──────────────────────────────────────────────────────── adjudication

def _one(label):
    return [Claim(label=label, quote="q", paraphrase="p")]


def test_a_strong_attribution_corroborates():
    v = adjudicate(
        _one(RootCauseLabel.MIDNIGHT_BILLING_PENALTY.value),
        _rec([F("hour", 3.79), F("bank", 0.1), F("method", 0.1), F("amount_band", 0.1)]),
    )[0]
    assert v.status == "corroborated"
    assert v.factor == "hour"


def test_a_factor_inside_its_error_bar_is_not_agreement():
    """The verdict that matters. 0.16 points against a 0.57-point error is
    not evidence the merchant was right -- it is noise."""
    v = adjudicate(
        _one(RootCauseLabel.MIDNIGHT_BILLING_PENALTY.value),
        _rec([F("hour", 0.16), F("bank", 0.1), F("method", 0.1), F("amount_band", 0.1)]),
    )[0]
    assert v.status == "inside_error_bar"
    assert "noise" in v.detail


def test_a_negative_attribution_refutes():
    v = adjudicate(
        _one(RootCauseLabel.BANK_CONCENTRATION.value),
        _rec([F("bank", -0.4), F("hour", 1.0), F("method", 0.1), F("amount_band", 0.1)]),
    )[0]
    assert v.status == "not_supported"


def test_an_unidentified_factor_is_unmeasurable_not_wrong():
    v = adjudicate(
        _one(RootCauseLabel.MIDNIGHT_BILLING_PENALTY.value),
        _rec([F("hour", 2.0, identified=False), F("bank", 0.1),
              F("method", 0.1), F("amount_band", 0.1)]),
    )[0]
    assert v.status == "unmeasurable"
    assert "rather than wrong" in v.detail


def test_the_process_gap_is_judged_on_its_own_number():
    """It is not a Shapley factor, so mapping it onto one would compare it
    against a number that is not about it."""
    hit = adjudicate(
        _one(RootCauseLabel.NO_SOFT_DECLINE_RETRY.value),
        _rec([F("hour", 0.1)], process_gap=2.6),
    )[0]
    miss = adjudicate(
        _one(RootCauseLabel.NO_SOFT_DECLINE_RETRY.value),
        _rec([F("hour", 0.1)], process_gap=0.0),
    )[0]
    assert hit.status == "corroborated" and hit.factor == "process_gap"
    assert miss.status == "not_supported"


# ─────────────────────────────────────────────────────────── end to end

def test_a_stub_refuses_rather_than_guessing():
    adj = read_note(NOTE, _rec([F("hour", 3.0)]), FakeClient(stub=True))
    assert adj.ok is False
    assert "no API key" in adj.refused_reason


def test_counts_match_the_verdicts():
    adj = read_note(
        NOTE,
        _rec([F("hour", 3.79), F("bank", -0.4), F("method", 0.1), F("amount_band", 0.1)]),
        FakeClient({"claims": [
            {"label": "midnight_billing_penalty", "quote": "We moved billing to 2 AM", "paraphrase": ""},
            {"label": "bank_concentration", "quote": "too much volume sits on one bank", "paraphrase": ""},
        ]}),
    )
    assert adj.ok
    assert adj.corroborated == sum(1 for v in adj.verdicts if v.status == "corroborated")
    assert adj.refuted == sum(1 for v in adj.verdicts if v.status == "not_supported")
    assert adj.corroborated == 1 and adj.refuted == 1


def test_the_adjudication_reaches_the_assistant_context():
    """This is what makes the note queryable afterwards."""
    adj = read_note(
        NOTE,
        _rec([F("hour", 3.79), F("bank", 0.1), F("method", 0.1), F("amount_band", 0.1)]),
        FakeClient({"claims": [
            {"label": "midnight_billing_penalty", "quote": "We moved billing to 2 AM", "paraphrase": ""},
        ]}),
    )
    lines = "\n".join(context_lines(adj))
    assert "CORROBORATED" in lines
    assert "We moved billing to 2 AM" in lines


def test_no_note_contributes_nothing_to_the_context():
    assert context_lines(None) == []
    assert context_lines(
        Adjudication(ok=False, note="", verdicts=[], corroborated=0, refuted=0)
    ) == []
