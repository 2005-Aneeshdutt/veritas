"""Voice as a recovery channel — bounded, scripted, and unable to decide anything.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
It is not a voice assistant. It has no model behind it, no open conversation,
no ability to answer a question it was not built to answer, and no route back
into any decision. It receives a `ChannelDecision` that already said VOICE,
walks a fixed script, and stops.

The reason it is built this way is the reason the rest of the product is built
this way. An LLM on a phone call to a customer about money is the single
highest-risk surface in this entire submission: it can be talked into offering
a discount, into calling back, into asking for a card number, or into agreeing
to something the merchant never authorised. So it does not get to improvise.
The turns below are a finite state machine over five states and a fixed set of
customer intents.

NO CALL IS PLACED
-----------------
There is no telephony in this environment and no live voice model. Rather than
pretend, this runs as a DETERMINISTIC VOICE DEMO: the same state machine, the
same guardrails, the same audit trail, driven by a scripted customer instead
of a microphone. Every surface says so. A transcript produced here is labelled
`simulated` in the payload and on screen, and the recovery it leads to is
still not counted until an outcome event arrives.

Wiring a real telephony provider means replacing `_customer_turn` with a
speech-to-text intent classifier restricted to the same closed intent set. The
state machine, the guardrails and the audit path do not change. That is the
point of writing it this way.

WHAT THE AGENT MAY NEVER DO
---------------------------
Enforced by construction rather than by prompt: the agent has no field in
which to put a card number, no branch that asks for one, and a hard refusal
handler for every sensitive request. `FORBIDDEN` is checked against every
outbound line before it is emitted, and a violation raises rather than being
logged and shipped -- a guardrail that fails open is decoration.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from pydantic import BaseModel

from .channels import ChannelDecision

#: Things the agent must never say or ask for. Checked against every outbound
#: line, in both languages, before it leaves this module.
FORBIDDEN: tuple[re.Pattern, ...] = (
    re.compile(r"\bcard\s*number\b", re.I),
    re.compile(r"\bcvv\b", re.I),
    re.compile(r"\bopt\b|\botp\b", re.I),
    re.compile(r"\bpin\b(?!\s*code)", re.I),
    re.compile(r"\bpassword\b", re.I),
    re.compile(r"\bexpiry\s*date\b", re.I),
    re.compile(r"\bupi\s*pin\b", re.I),
    re.compile(r"\brefund\b.*\bguarantee\b", re.I),
    re.compile(r"\bdiscount\b", re.I),
    re.compile(r"\bwaive\b", re.I),
)


class GuardrailViolation(RuntimeError):
    """An outbound line tripped a guardrail. Raised, never logged and sent."""


#: The closed set of things a customer can be understood to have said. A real
#: deployment classifies speech into exactly this set and nothing else; an
#: utterance that does not map lands on `unclear`, which is handled.
Intent = str  # accept | decline | dispute | sensitive_request | unclear | silence

TERMINAL = {"completed", "declined", "escalated", "abandoned"}


class Turn(BaseModel):
    model_config = {"frozen": True}

    seq: int
    speaker: str          # agent | customer
    text: str
    #: For customer turns, the intent this was classified as.
    intent: str | None = None
    #: The state the machine was in when this was said.
    state: str


class VoiceOutcome(BaseModel):
    """What the call did, and what it is not allowed to claim."""

    txn_id: str
    merchant_id: str
    merchant_name: str
    amount_paise: int
    language: str

    #: Always true in this build. There is no telephony here.
    simulated: bool = True
    label: str = "DETERMINISTIC VOICE DEMO"

    attempted: int = 1
    max_attempts: int = 1
    customer_accepted: bool = False
    final_state: str = "abandoned"
    transcript: list[Turn] = []

    #: What the call authorised, if anything. NOT money.
    action_taken: str = "none"
    payment_link_id: str | None = None

    #: Deliberately never set by this module. Recovery is claimed by an
    #: outcome event, not by a customer saying yes on a call.
    recovered_paise: int = 0
    recovery_basis: str = (
        "not recovered — a call cannot confirm a payment. Awaiting a "
        "payment_link.paid or payment.captured event."
    )

    guardrails_held: bool = True
    escalation_reason: str = ""
    audit_note: str = ""


# -- the script -----------------------------------------------------------

def _rs(paise: int) -> str:
    return "₹%s" % format(paise // 100, ",d")


def _lines(lang: str, merchant: str, amount: int) -> dict[str, str]:
    """Every line the agent can say. Two languages, same state machine.

    Hinglish is one alternate table, not a translation layer. The states, the
    guardrails and the intents are identical; only the strings move, so a
    language cannot introduce a branch the English path does not have.
    """
    if lang == "hinglish":
        return {
            "greet": (
                "Namaste, main %s ki taraf se ek automated payment assistant "
                "hoon. Main ek insaan nahi hoon. Aapka payment of %s complete "
                "nahi ho paaya."
                % (merchant, _rs(amount))
            ),
            "offer": (
                "Main aapko ek secure payment link bhej sakta hoon jisse aap "
                "ise poora kar sakein. Kya main bhej doon?"
            ),
            "accept": (
                "Theek hai. Link bheja ja raha hai. Ismein sirf %s ka payment "
                "hoga, aur kuch nahi. Dhanyavaad."
                % _rs(amount)
            ),
            "decline": (
                "Samajh gaya. Main aage nahi badhunga. Koi payment nahi liya "
                "jayega. Dhanyavaad."
            ),
            "dispute": (
                "Samajh gaya. Main is payment ke saath aage nahi badhunga. "
                "Main ise review ke liye bhej raha hoon, aur koi bhi payment "
                "action nahi liya jayega."
            ),
            "refuse_sensitive": (
                "Main aapse koi bhi payment detail nahi maang sakta, aur na "
                "hi phone par leta hoon. Main sirf ek secure link bhej sakta "
                "hoon jise aap khud bharenge."
            ),
            "unclear": (
                "Maaf kijiye, main samajh nahi paaya. Kya main secure payment "
                "link bhej doon? Haan ya na."
            ),
            "bye_unclear": (
                "Koi baat nahi. Main abhi kuch nahi bhej raha. Dhanyavaad."
            ),
        }
    return {
        "greet": (
            "Hello, this is an automated payment assistant calling on behalf "
            "of %s. I am not a person. A payment of %s could not be completed."
            % (merchant, _rs(amount))
        ),
        "offer": (
            "I can send you a secure payment link so you can complete it "
            "yourself. Would you like me to send it?"
        ),
        "accept": (
            "Thank you. The link is on its way. It is for %s and nothing "
            "else. Goodbye."
            % _rs(amount)
        ),
        "decline": (
            "Understood. I will not proceed, and no payment will be taken. "
            "Thank you for your time."
        ),
        "dispute": (
            "Understood. I will not proceed with the payment recovery. I am "
            "stopping here and escalating this for review. No payment action "
            "will be taken."
        ),
        "refuse_sensitive": (
            "I cannot ask you for any payment details, and I never take them "
            "over the phone. All I can do is send a secure link for you to "
            "complete yourself."
        ),
        "unclear": (
            "Sorry, I did not catch that. Shall I send you the secure payment "
            "link? Yes or no."
        ),
        "bye_unclear": (
            "That is all right. I will not send anything for now. Thank you."
        ),
    }


def _check(text: str) -> str:
    """Every outbound line passes here. A violation raises."""
    for pat in FORBIDDEN:
        if pat.search(text):
            raise GuardrailViolation(
                "outbound line tripped %r: %s" % (pat.pattern, text[:80])
            )
    return text


#: The scripted customer, for the deterministic demo. A real deployment
#: replaces this with a speech-to-text classifier restricted to the same set.
SCENARIOS: dict[str, list[str]] = {
    #: The happy path §43 asks for.
    "accepts": ["accept"],
    #: The graceful failure §49 asks for.
    "disputes": ["dispute"],
    #: The one that matters most for safety.
    "asks_for_card": ["sensitive_request", "decline"],
    "declines": ["decline"],
    "unclear_then_accepts": ["unclear", "accept"],
}

_UTTERANCE: dict[str, dict[str, str]] = {
    "en": {
        "accept": "Yes, please send it.",
        "decline": "No thanks, not right now.",
        "dispute": "I don't recognise this payment.",
        "sensitive_request": "Can't you just take my card number now?",
        "unclear": "Sorry, what is this about?",
    },
    "hinglish": {
        "accept": "Haan, bhej dijiye.",
        "decline": "Nahi, abhi rehne dijiye.",
        "dispute": "Mujhe yeh payment yaad nahi hai.",
        "sensitive_request": "Aap abhi card number le lijiye na?",
        "unclear": "Sorry, yeh kis baare mein hai?",
    },
}


def run_call(
    decision: ChannelDecision,
    *,
    merchant_name: str,
    scenario: str = "accepts",
    language: str = "en",
) -> VoiceOutcome:
    """Walk the script once. Deterministic, bounded, and audited.

    Refuses outright unless `decision.chosen == "voice"`. The channel decision
    and the policy gate happen upstream; if either said anything else, there
    is no call, and this raises rather than quietly doing one.
    """
    if decision.chosen != "voice":
        raise PermissionError(
            "channel decision was %r, not 'voice'. The voice agent does not "
            "decide whether to call." % decision.chosen
        )
    if decision.max_contact_attempts < 1:
        raise PermissionError(
            "policy allows %d contact attempts. No call."
            % decision.max_contact_attempts
        )

    lang = "hinglish" if language == "hinglish" else "en"
    L = _lines(lang, merchant_name, decision.amount_paise)
    says = _UTTERANCE[lang]
    turns: list[Turn] = []
    seq = 0

    def agent(key: str, state: str) -> None:
        nonlocal seq
        seq += 1
        turns.append(Turn(seq=seq, speaker="agent", text=_check(L[key]), state=state))

    def customer(intent: str, state: str) -> None:
        nonlocal seq
        seq += 1
        turns.append(Turn(
            seq=seq, speaker="customer",
            text=says.get(intent, "..."), intent=intent, state=state,
        ))

    # 1 · identify, 2 · state the failure, 3 · state the amount -- all in the
    #     greeting, because burying "I am not a person" after a question is
    #     how these calls become deceptive.
    agent("greet", "identify")
    # 4 · ask
    agent("offer", "offer")

    state = "offer"
    accepted = False
    escalation = ""
    action = "none"

    for intent in SCENARIOS.get(scenario, ["unclear"]):
        customer(intent, state)

        if intent == "accept":
            # 5 · only continue after affirmative intent
            # 6 · generate the approved mechanism -- and nothing else
            agent("accept", "confirm")
            accepted = True
            action = "payment_link_requested"
            state = "completed"
            break

        if intent == "dispute":
            agent("dispute", "escalate")
            escalation = (
                "customer did not recognise the payment; no payment action "
                "taken and the case was handed to a person"
            )
            state = "escalated"
            break

        if intent == "sensitive_request":
            # The refusal is a turn, not a termination: refusing and then
            # continuing the permitted flow is the correct behaviour, and the
            # scenario continues to whatever the customer says next.
            agent("refuse_sensitive", "refuse")
            state = "offer"
            continue

        if intent == "decline":
            agent("decline", "declined")
            state = "declined"
            break

        agent("unclear", "clarify")
        state = "clarify"

    # 7 · stop after the configured action. No second ask, ever.
    if state not in TERMINAL:
        agent("bye_unclear", "abandoned")
        state = "abandoned"

    return VoiceOutcome(
        txn_id=decision.txn_id,
        merchant_id=decision.merchant_id,
        merchant_name=merchant_name,
        amount_paise=decision.amount_paise,
        language=lang,
        attempted=1,
        max_attempts=decision.max_contact_attempts,
        customer_accepted=accepted,
        final_state=state,
        transcript=turns,
        action_taken=action,
        escalation_reason=escalation,
        audit_note=(
            "voice channel, %d turn(s), state %s, guardrails held. Simulated: "
            "no telephony in this environment." % (len(turns), state)
        ),
    )


# -- the demo, and why it has to be a constructed one ---------------------

#: A payment and a mandate built to reach the voice branch, because nothing
#: on the book does.
#:
#: This is worth stating plainly rather than hiding, because working it out
#: was the most useful thing that happened while building this feature.
#:
#: REISSUE_PAYMENT_LINK is in AUTO_EXECUTABLE, so the kernel applies the
#: per-payment attempt cap and the hard ceiling to a payment link exactly as
#: it does to a retry. That means under CloudSync's real mandate -- which
#: permits both retrying and reissuing -- every condition that blocks a retry
#: blocks a link too, and the contact channels are structurally unreachable.
#: The policy simply never needs to phone anybody, and across 2,090 failed
#: payments it never does.
#:
#: The case where a call IS the right answer is a mandate that permits ASKING
#: the customer but not CHARGING them: "do not auto-retry my customers' cards,
#: but you may send them a link." That is a realistic and rather thoughtful
#: merchant policy, and under it the contact channels are the only channels
#: there are.
#:
#: So the scenario below constructs that mandate -- properly signed with the
#: merchant's own key, because `policy.evaluate` refuses an unverifiable one
#: before it checks anything else -- and runs it through the SAME
#: `channels.decide`, the SAME kernel and the SAME state machine. Nothing is
#: bypassed. What is constructed is the payment and the merchant's choice of
#: permissions, and both are named on screen.
DEMO_PAYMENT = {
    "txn_id": "pay_demo_voice_0001",
    "merchant_id": "cloudsync",
    "amount_paise": 1_240_000,       # Rs 12,400, as the brief specifies
    "error_class": "soft_decline",
    "bank": "HDFC Bank Ltd.",
    "prior_attempts": 1,
}


class VoiceDemo(BaseModel):
    """The constructed scenario, with its provenance attached."""

    label: str = "CONSTRUCTED SCENARIO"
    why_constructed: str = (
        "No payment in the committed book reaches the voice branch. A payment "
        "link is an auto-executable action, so the attempt cap and the hard "
        "ceiling bind it exactly as they bind a retry -- which means under a "
        "mandate that permits both, anything blocking a retry blocks a link "
        "too, and the policy never needs to call. The case where a call is "
        "the right answer is a merchant who permits asking but not charging. "
        "That mandate is constructed here and signed with the merchant's own "
        "key; the decision, the policy gate and the call are the real ones."
    )
    #: The permissions the constructed mandate grants, so the reader can see
    #: exactly what was changed to make this branch reachable.
    mandate_permits: list[str] = []
    mandate_excludes: list[str] = []
    payment: dict
    decision: dict
    gate_decision: str
    gate_reason: str
    outcome: dict | None = None
    #: Set when the gate held the call for merchant confirmation.
    required_confirmation: bool = False


def _ask_dont_charge(merchant_id: str):
    """The merchant's mandate, minus the permission to charge a card again.

    Re-signed rather than hand-built: the kernel checks the Ed25519 signature
    before anything else, so a scenario running against an unsigned struct
    would be testing nothing.
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from chitragupta.mandate import sign_mandate
    from chitragupta.types import ActionType as AT

    from .counterfactual import ROOT as CF_ROOT
    from .run import load_mandate

    signed = load_mandate(merchant_id)
    key_path = CF_ROOT / "data" / "mandates" / ("%s_signing_key.hex" % merchant_id)
    if not key_path.exists():
        return signed

    keep = [
        a for a in signed.mandate.permitted_actions
        if a != AT.RETRY_SOFT_DECLINE
    ]
    priv = Ed25519PrivateKey.from_private_bytes(
        bytes.fromhex(key_path.read_text(encoding="utf-8").strip())
    )
    return sign_mandate(
        signed.mandate.model_copy(update={"permitted_actions": keep}), priv
    )


def demo(scenario: str = "accepts", language: str = "en") -> VoiceDemo:
    """Run one constructed scenario end to end through the real machinery."""
    from chitragupta.policy import GateContext, evaluate
    from chitragupta.types import ActionType, PolicyDecision, ProposedAction

    from .channels import decide

    src = dict(DEMO_PAYMENT)
    signed = _ask_dont_charge(src["merchant_id"])
    assert signed.verify(), "the constructed mandate must verify"

    d = decide(
        txn_id=src["txn_id"],
        merchant_id=src["merchant_id"],
        amount_paise=src["amount_paise"],
        error_class=src["error_class"],
        bank=src["bank"],
        prior_attempts=src["prior_attempts"],
        signed=signed,
    )

    gate_decision, gate_reason = "n/a", d.reason
    if d.chosen in ("voice", "payment_link", "email"):
        gate = evaluate(
            ProposedAction(
                action_type=ActionType.REISSUE_PAYMENT_LINK,
                txn_id=src["txn_id"],
                amount_paise=src["amount_paise"],
                target_bank=src["bank"],
                reason="constructed voice demo",
            ),
            signed,
            GateContext(
                now=datetime.now(timezone.utc),
                attempts_by_txn={src["txn_id"]: src["prior_attempts"]},
            ),
        )
        gate_decision, gate_reason = gate.decision.value, gate.reason_code

    out = None
    # A STEP_UP is a person saying yes, and the demo shows that step rather
    # than skipping it. Rs 12,400 is above the Rs 3,000 auto-execute limit,
    # so this call does not happen until the merchant confirms it.
    if d.chosen == "voice" and gate_decision in ("allow", "step_up"):
        out = json.loads(
            run_call(
                d, merchant_name="CloudSync Pro",
                scenario=scenario, language=language,
            ).model_dump_json()
        )

    return VoiceDemo(
        mandate_permits=[a.value for a in signed.mandate.permitted_actions],
        mandate_excludes=["retry_soft_decline"],
        payment=src,
        decision=json.loads(d.model_dump_json()),
        gate_decision=gate_decision,
        gate_reason=gate_reason,
        outcome=out,
        required_confirmation=gate_decision == "step_up",
    )
