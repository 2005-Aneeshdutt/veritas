"""The voice channel: bounded, unable to decide, and unable to say the wrong thing.

Voice is the highest-risk surface in this submission. An agent on a phone call
about money can be talked into offering a discount, calling back, asking for a
card number, or agreeing to something the merchant never authorised — and
unlike every other output here, a customer hears it immediately and cannot be
shown a caveat afterwards.

So the tests are adversarial rather than confirmatory. They try to make the
agent decide something, say something forbidden, call twice, or claim money,
and assert it cannot.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from doctor.channels import ChannelDecision, ChannelOption, decide
from doctor.voice import (
    FORBIDDEN,
    SCENARIOS,
    GuardrailViolation,
    _check,
    _lines,
    demo,
    run_call,
)

LANGS = ("en", "hinglish")


# The demo signing keys are private material and deliberately gitignored, so a
# fresh checkout -- CI included -- does not have them. `_ask_dont_charge`
# re-signs a narrowed mandate with the real key on purpose: an unsigned struct
# smuggled past the gate would test nothing. Without the key it returns the
# mandate unchanged, so the property under test cannot exist, and skipping is
# more honest than asserting something weaker.
_KEY_MERCHANT = "cloudsync"
_KEY_PATH = (
    Path(__file__).resolve().parents[1]
    / "data" / "mandates" / ("%s_signing_key.hex" % _KEY_MERCHANT)
)
needs_signing_key = pytest.mark.skipif(
    not _KEY_PATH.exists(),
    reason=(
        "%s is gitignored. Create it with: python -m chitragupta.mandate "
        "--generate --merchant %s --auto-limit-paise 300000 --ceiling-paise 1500000"
        % (_KEY_PATH.name, _KEY_MERCHANT)
    ),
)


# -- 1. it cannot decide anything -----------------------------------------

def _decision(channel: str = "voice", attempts: int = 1) -> ChannelDecision:
    return ChannelDecision(
        txn_id="pay_t", merchant_id="cloudsync", amount_paise=1_240_000,
        error_class="soft_decline", bank="HDFC Bank Ltd.",
        chosen=channel, reason="test", options=[],
        max_contact_attempts=attempts,
    )


@pytest.mark.parametrize(
    "channel", ["retry", "email", "payment_link", "no_action", "escalate"]
)
def test_it_refuses_to_run_when_the_decision_was_not_voice(channel):
    """The agent does not get to decide that a call is a good idea."""
    with pytest.raises(PermissionError):
        run_call(_decision(channel), merchant_name="X")


def test_it_refuses_when_policy_allows_no_contact():
    with pytest.raises(PermissionError):
        run_call(_decision("voice", attempts=0), merchant_name="X")


def test_it_never_calls_more_than_once():
    for scenario in SCENARIOS:
        out = run_call(_decision(), merchant_name="X", scenario=scenario)
        assert out.attempted == 1
        assert out.max_attempts == 1


# -- 2. it cannot say the wrong thing -------------------------------------

@pytest.mark.parametrize("lang", LANGS)
def test_no_scripted_line_trips_a_guardrail(lang):
    """Every line the agent can ever say, checked against every guardrail."""
    for key, line in _lines(lang, "CloudSync Pro", 1_240_000).items():
        assert _check(line) == line, key


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_no_transcript_contains_a_forbidden_phrase(lang, scenario):
    out = run_call(
        _decision(), merchant_name="CloudSync Pro",
        scenario=scenario, language=lang,
    )
    for turn in out.transcript:
        if turn.speaker != "agent":
            continue
        for pat in FORBIDDEN:
            assert not pat.search(turn.text), (pat.pattern, turn.text)


def test_the_guardrail_actually_fires():
    """A guardrail that cannot fail is decoration."""
    with pytest.raises(GuardrailViolation):
        _check("Could you read me your CVV please")
    with pytest.raises(GuardrailViolation):
        _check("I can offer you a discount on this")


def test_asking_for_a_card_number_is_refused_and_the_call_continues_safely():
    """Section 43's hard case. The refusal is a turn, not a crash."""
    out = run_call(
        _decision(), merchant_name="CloudSync Pro", scenario="asks_for_card"
    )
    agent_lines = [t.text for t in out.transcript if t.speaker == "agent"]
    assert any("never take them over the phone" in t for t in agent_lines)
    assert out.customer_accepted is False
    assert out.action_taken == "none"


# -- 3. it identifies itself, states the amount, and asks -----------------

@pytest.mark.parametrize("lang", LANGS)
def test_the_first_thing_it_says_is_that_it_is_not_a_person(lang):
    out = run_call(_decision(), merchant_name="CloudSync Pro", language=lang)
    first = out.transcript[0]
    assert first.speaker == "agent"
    assert ("not a person" in first.text) or ("insaan nahi" in first.text)


@pytest.mark.parametrize("lang", LANGS)
def test_it_states_the_amount_before_asking_for_anything(lang):
    out = run_call(_decision(), merchant_name="CloudSync Pro", language=lang)
    assert "12,400" in out.transcript[0].text


def test_it_only_proceeds_after_affirmative_intent():
    accepted = run_call(_decision(), merchant_name="X", scenario="accepts")
    assert accepted.customer_accepted
    assert accepted.action_taken == "payment_link_requested"

    for scenario in ("declines", "disputes", "asks_for_card"):
        out = run_call(_decision(), merchant_name="X", scenario=scenario)
        assert out.customer_accepted is False
        assert out.action_taken == "none"


# -- 4. it cannot claim money ---------------------------------------------

@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_a_call_never_reports_recovered_money(scenario):
    """A customer saying yes is not a payment. Only an outcome event is."""
    out = run_call(_decision(), merchant_name="X", scenario=scenario)
    assert out.recovered_paise == 0
    assert "not recovered" in out.recovery_basis


def test_every_transcript_is_labelled_simulated():
    out = run_call(_decision(), merchant_name="X")
    assert out.simulated is True
    assert out.label == "DETERMINISTIC VOICE DEMO"


# -- 5. the graceful failure §49 asks for ---------------------------------

def test_a_disputed_payment_escalates_and_takes_no_action():
    out = run_call(_decision(), merchant_name="X", scenario="disputes")
    assert out.final_state == "escalated"
    assert out.action_taken == "none"
    assert out.recovered_paise == 0
    assert "did not recognise" in out.escalation_reason
    last = out.transcript[-1]
    assert last.speaker == "agent"
    assert "escalating" in last.text.lower()


# -- 6. the constructed demo runs through the real machinery --------------

def test_the_demo_is_labelled_constructed_and_says_why():
    d = demo("accepts")
    assert d.label == "CONSTRUCTED SCENARIO"
    assert "No payment in the committed book" in d.why_constructed
    assert "retry_soft_decline" in d.mandate_excludes


@needs_signing_key
def test_the_demo_mandate_verifies_and_is_genuinely_narrower():
    """A scenario running against an unsigned struct would test nothing."""
    from doctor.voice import _ask_dont_charge

    signed = _ask_dont_charge("cloudsync")
    assert signed.verify()
    permitted = {a.value for a in signed.mandate.permitted_actions}
    assert "retry_soft_decline" not in permitted
    assert "reissue_payment_link" in permitted


@needs_signing_key
def test_the_demo_call_still_needs_a_person_to_confirm_it():
    """Rs 12,400 is above the Rs 3,000 auto-execute limit. It is a STEP_UP."""
    d = demo("accepts")
    assert d.decision["chosen"] == "voice"
    assert d.gate_decision == "step_up"
    assert d.gate_reason == "STEP_UP_ABOVE_AUTO_LIMIT"
    assert d.required_confirmation is True


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
@pytest.mark.parametrize("lang", LANGS)
def test_every_demo_scenario_is_reproducible(scenario, lang):
    a = demo(scenario, lang).model_dump_json()
    b = demo(scenario, lang).model_dump_json()
    assert a == b


@needs_signing_key
def test_the_demo_reaches_voice_only_because_charging_is_not_permitted():
    """The finding that made this feature honest.

    Under the merchant's real mandate a retry is always available first, so
    the policy never calls anybody. Voice becomes correct only when the
    merchant has said "ask them, do not charge them".
    """
    from doctor.run import load_mandate
    from doctor.voice import DEMO_PAYMENT

    real = decide(
        txn_id=DEMO_PAYMENT["txn_id"], merchant_id="cloudsync",
        amount_paise=DEMO_PAYMENT["amount_paise"],
        error_class=DEMO_PAYMENT["error_class"], bank=DEMO_PAYMENT["bank"],
        prior_attempts=DEMO_PAYMENT["prior_attempts"],
        signed=load_mandate("cloudsync"),
    )
    assert real.chosen == "retry"
    assert demo("accepts").decision["chosen"] == "voice"
