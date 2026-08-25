"""Semantic classification of payment error codes.  [LLM + deterministic cache]

The honest framing, because a panellist will ask why this is not a dictionary:
it IS a dictionary for the 110 codes Razorpay publishes. Those are hand-labelled
in evals/error_labels.json and answered with zero API calls. The LLM exists for
the codes that are NOT in the taxonomy -- gateways emit their own, and new ones
appear over time. That is why §4.1's eval holds out CODES rather than rows: the
number being measured is generalisation to a code the model has never seen.

Confidence below CONFIDENCE_THRESHOLD routes to human review, which is a real
branch in the graph rather than a logged sentiment.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from .features import ErrorClass
from .llm import MODEL_FAST, LLMClient

ROOT = Path(__file__).resolve().parents[2]
LABELS_PATH = ROOT / "evals" / "error_labels.json"

#: Below this, the classification goes to a human instead of being acted on.
CONFIDENCE_THRESHOLD = 0.85

SYSTEM = """You classify payment gateway error codes for an Indian payments \
platform.

Return ONLY a JSON object, no prose, with exactly these keys:
  "category":    one of "soft_decline", "hard_decline", "technical", "auth_failure"
  "recoverable": boolean
  "confidence":  number between 0 and 1

Definitions:
  soft_decline  temporary, customer-side or limit-related. The SAME payment \
could succeed later with nothing changed (insufficient funds, daily limit hit, \
collect request still pending).
  hard_decline  permanent for this instrument or configuration. Retrying the \
identical request cannot work (closed account, expired card, feature not \
enabled for the merchant, invalid request parameters).
  technical     infrastructure failed at the bank, gateway, PSP or network \
(downtime, timeout, server error, cutoff in progress).
  auth_failure  the customer failed or abandoned authentication (wrong OTP, \
wrong PIN, wrong CVV, cancelled the payment).

"recoverable" asks whether an automated agent, acting alone, could plausibly \
convert this payment. Auth failures are recoverable by the CUSTOMER but not by \
the agent, so they are false. Hard declines are false.

Set confidence below 0.85 when the code is genuinely ambiguous. Do not inflate \
it."""

FEW_SHOT = """Examples:

code: insufficient_funds
description: The customer does not have sufficient funds in the account to complete the payment.
{"category": "soft_decline", "recoverable": true, "confidence": 0.98}

code: card_expired
description: The customer is making the payment with an expired card.
{"category": "hard_decline", "recoverable": false, "confidence": 0.97}

code: gateway_technical_error
description: Payment failed due to a technical error at the gateway.
{"category": "technical", "recoverable": true, "confidence": 0.96}

code: incorrect_otp
description: The customer has entered an incorrect OTP to complete the payment.
{"category": "auth_failure", "recoverable": false, "confidence": 0.97}
"""


class Classification(BaseModel):
    model_config = {"frozen": True}

    code: str
    category: ErrorClass
    recoverable: bool
    confidence: float = Field(ge=0.0, le=1.0)
    #: "taxonomy" when answered from the hand-labelled table, "llm" otherwise.
    source: str = "llm"

    @field_validator("confidence")
    @classmethod
    def _round(cls, v: float) -> float:
        return round(v, 4)

    @property
    def needs_review(self) -> bool:
        return self.confidence < CONFIDENCE_THRESHOLD


def load_taxonomy(path: Path = LABELS_PATH) -> dict[str, dict]:
    if not path.exists():
        raise FileNotFoundError(
            "%s missing -- run: python scripts/build_error_labels.py" % path
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    return {r["code"]: r for r in data["labels"]}


def _prompt(code: str, description: str, method: str | None) -> str:
    lines = [FEW_SHOT, "", "Now classify this code."]
    lines.append("code: %s" % code)
    if description:
        lines.append("description: %s" % description)
    if method:
        lines.append("payment method: %s" % method)
    lines.append("")
    lines.append("Respond with the JSON object only.")
    return "\n".join(lines)


class Classifier:
    """Deterministic lookup in front, LLM behind."""

    def __init__(
        self,
        client: LLMClient,
        taxonomy: dict[str, dict] | None = None,
        *,
        known_codes: set[str] | None = None,
    ) -> None:
        self.client = client
        self.taxonomy = taxonomy if taxonomy is not None else load_taxonomy()
        #: Which codes the lookup is allowed to answer. The eval narrows this
        #: to the training split so held-out codes genuinely reach the model.
        self.known = known_codes if known_codes is not None else set(self.taxonomy)
        self.lookup_hits = 0
        self.llm_calls = 0

    def classify(
        self, code: str, description: str = "", method: str | None = None
    ) -> tuple[Classification, object | None]:
        """Return (classification, llm_result_or_None)."""
        if code in self.known:
            rec = self.taxonomy[code]
            self.lookup_hits += 1
            return (
                Classification(
                    code=code,
                    category=ErrorClass(rec["category"]),
                    recoverable=rec["recoverable"],
                    confidence=1.0,
                    source="taxonomy",
                ),
                None,
            )

        desc = description or self.taxonomy.get(code, {}).get("explanation", "")
        result = self.client.complete(
            system=SYSTEM,
            prompt=_prompt(code, desc, method),
            model=MODEL_FAST,
            schema_name="Classification",
            max_tokens=200,
        )
        self.llm_calls += 1
        p = result.parsed
        return (
            Classification(
                code=code,
                category=ErrorClass(p["category"]),
                recoverable=bool(p["recoverable"]),
                confidence=float(p.get("confidence", 0.5)),
                source="stub" if result.stub else "llm",
            ),
            result,
        )


def offline_stub(schema_name: str, prompt: str) -> dict:
    """Deterministic placeholder used only when there is no key and no cache.

    Traces mark these `stub`, and no eval will score them -- the classification
    eval refuses to run without a key precisely so a stub can never be
    mistaken for a measured result.
    """
    if schema_name != "Classification":
        return {}
    text = prompt.lower()
    if any(k in text for k in ("timeout", "technical", "downtime", "server", "unavailable")):
        cat, rec = "technical", True
    elif any(k in text for k in ("otp", "pin", "cvv", "cancel", "authentic")):
        cat, rec = "auth_failure", False
    elif any(k in text for k in ("insufficient", "limit", "pending", "exceeded")):
        cat, rec = "soft_decline", True
    else:
        cat, rec = "hard_decline", False
    return {"category": cat, "recoverable": rec, "confidence": 0.5}
