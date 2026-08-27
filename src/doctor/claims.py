"""Reading what the merchant thinks is wrong, and checking it against the data.

Every other input to this system is structured: NPCI's CSVs, the Razorpay
error taxonomy, a batch of typed transactions. That is a real gap, because the
one job a language model is genuinely irreplaceable for is turning messy human
sentences into structured signal, and nothing here was asking it to.

Merchants always have a theory. "We moved billing to 2 AM last month." "Our
gateway is flaky on weekends." "It started when we added UPI Autopay." Those
sentences carry real information -- often the single most useful information
available, because the merchant knows what they CHANGED and the data only
shows what happened afterwards. They are also frequently wrong, and nobody
ever checks them.

So: the model extracts typed claims from free text, quoting the span each came
from, and then the decomposition ADJUDICATES them. The model proposes; the
arithmetic disposes. Same shape as the verifier, pointed at the merchant's own
words instead of the model's.

Two things this is careful about:

  * The claim vocabulary is the same closed enum the hypothesiser uses, so a
    claim can be compared against an attribution directly rather than through
    a mapping invented for the occasion. A sentence that does not fit any of
    them is UNCLASSIFIED, which is a real answer.
  * A verdict is only as strong as the attribution behind it. Corroborating a
    claim on a factor sitting inside its own error bar would be telling a
    merchant their theory is confirmed by noise, so that case gets its own
    verdict rather than being rounded to agreement.
"""

from __future__ import annotations

from pydantic import BaseModel

from .hypothesise import RootCauseLabel
from .llm import MODEL_FAST, LLMClient
from .plan import AUTO_RATIO, WITHHOLD_RATIO

#: Which factor's attribution speaks to each claim.
#:
#: `no_soft_decline_retry` is deliberately absent: it is not a Shapley factor
#: and is computed directly, so it is adjudicated against the process gap
#: instead. Quietly mapping it onto a factor would compare it against a number
#: that is not about it.
CLAIM_FACTOR: dict[str, str] = {
    RootCauseLabel.MIDNIGHT_BILLING_PENALTY.value: "hour",
    RootCauseLabel.BANK_CONCENTRATION.value: "bank",
    RootCauseLabel.AMOUNT_BAND_RISK.value: "amount_band",
    RootCauseLabel.METHOD_MIX_MISMATCH.value: "method",
}

SYSTEM = """You read a merchant's own description of what they think is wrong
with their payments, and extract the claims they are making.

Extract ONLY claims that match one of these labels:
  midnight_billing_penalty  charging at night / late / after hours / cron at 2am
  bank_concentration        too much volume on one bank or issuer
  amount_band_risk          large or high-value payments failing
  method_mix_mismatch       a payment method being wrong or overused (UPI, card,
                            netbanking, autopay/mandate)
  no_soft_decline_retry     failures not being retried, no dunning, giving up

Rules:
1. Quote the exact span of the merchant's text each claim came from. Do not
   paraphrase the quote.
2. A sentence that fits none of the labels is NOT a claim. Leave it out. Saying
   the merchant made no extractable claim is a good answer.
3. Do not infer a claim the merchant did not make. "Revenue is down" is not a
   claim about a cause.
4. Never invent numbers. You are extracting what they said, not analysing it.

Reply with JSON and nothing else:
{"claims": [{"label": "...", "quote": "...", "paraphrase": "..."}]}
"""


class Claim(BaseModel):
    label: str
    #: The merchant's own words, so a reader can check the extraction.
    quote: str
    paraphrase: str


class Verdict(BaseModel):
    claim: Claim
    #: corroborated | not_supported | inside_error_bar | unmeasurable | unclassified
    status: str
    factor: str | None = None
    attribution_pts: float | None = None
    mae: float | None = None
    ratio: float | None = None
    detail: str


class Adjudication(BaseModel):
    ok: bool
    note: str
    verdicts: list[Verdict]
    corroborated: int
    refuted: int
    refused_reason: str | None = None


def extract(note: str, client: LLMClient | None = None) -> tuple[list[Claim], bool]:
    """Pull typed claims out of free text. Returns (claims, was_stubbed)."""
    note = (note or "").strip()
    if not note:
        return [], False

    client = client or LLMClient()
    res = client.complete(
        system=SYSTEM,
        prompt="MERCHANT NOTE\n%s" % note,
        model=MODEL_FAST,
        schema_name="merchant_claims",
        max_tokens=600,
    )
    if res.stub:
        return [], True

    parsed = res.parsed if isinstance(res.parsed, dict) else {}
    valid = {l.value for l in RootCauseLabel}
    out: list[Claim] = []
    for c in parsed.get("claims") or []:
        if not isinstance(c, dict):
            continue
        label = str(c.get("label") or "")
        if label not in valid or label == RootCauseLabel.NONE_OF_THE_ABOVE.value:
            # A label outside the enum is not a claim this system can check.
            # Accepting it would let the model widen its own vocabulary.
            continue
        quote = str(c.get("quote") or "").strip()
        # The quote has to actually be the merchant's words. A paraphrase
        # presented as a quotation is how a reader stops being able to audit
        # the extraction.
        if quote and quote.lower() not in note.lower():
            quote = ""
        out.append(
            Claim(
                label=label,
                quote=quote,
                paraphrase=str(c.get("paraphrase") or "")[:200],
            )
        )
    return out, False


def adjudicate(claims: list[Claim], rec: dict) -> list[Verdict]:
    """Check each claim against the decomposition. Purely arithmetic."""
    d = rec["report"]["decomposition"]
    by_factor = {f["factor"]: f for f in d["factors"]}
    process_gap = d.get("process_gap_pts", 0.0)

    verdicts: list[Verdict] = []
    for c in claims:
        # The process gap is computed directly rather than decomposed, so it
        # is checked against its own number.
        if c.label == RootCauseLabel.NO_SOFT_DECLINE_RETRY.value:
            supported = process_gap > 0.5
            verdicts.append(
                Verdict(
                    claim=c,
                    status="corroborated" if supported else "not_supported",
                    factor="process_gap",
                    attribution_pts=round(process_gap, 3),
                    detail=(
                        "Unretried recoverable failures cost %.2f points. The "
                        "merchant is right." % process_gap
                        if supported
                        else "Unretried failures account for only %.2f points "
                        "here, so this is not what is costing them." % process_gap
                    ),
                )
            )
            continue

        factor = CLAIM_FACTOR.get(c.label)
        f = by_factor.get(factor) if factor else None
        if f is None:
            verdicts.append(
                Verdict(claim=c, status="unclassified",
                        detail="No factor in this decomposition speaks to that.")
            )
            continue

        pts, mae = float(f["points"]), f.get("mae")

        if not f.get("identified", True):
            verdicts.append(
                Verdict(
                    claim=c, status="unmeasurable", factor=factor,
                    attribution_pts=round(pts, 3), mae=mae,
                    detail=(
                        "This merchant has effectively one value for %s, so "
                        "there is nothing to compare against. The claim is "
                        "unmeasurable here rather than wrong." % factor
                    ),
                )
            )
            continue

        ratio = abs(pts) / mae if mae else None

        if pts <= 0:
            status, detail = "not_supported", (
                "%s is carrying %+.2f points -- it is not costing them "
                "anything, so the data disagrees." % (factor, pts)
            )
        elif ratio is not None and ratio < WITHHOLD_RATIO:
            status, detail = "inside_error_bar", (
                "%s carries %+.2f points, inside its own %.2f-point measured "
                "error. Calling that agreement would be confirming a theory "
                "with noise." % (factor, pts, mae)
            )
        else:
            strength = (
                "the single largest cause"
                if pts == max(x["points"] for x in d["factors"])
                else "a real cost"
            )
            status, detail = "corroborated", (
                "%s carries %+.2f points, %.1fx its own measured error -- %s."
                % (factor, pts, ratio or 0.0, strength)
            )

        verdicts.append(
            Verdict(
                claim=c, status=status, factor=factor,
                attribution_pts=round(pts, 3), mae=mae,
                ratio=round(ratio, 2) if ratio is not None else None,
                detail=detail,
            )
        )
    return verdicts


def read_note(
    note: str, rec: dict, client: LLMClient | None = None
) -> Adjudication:
    """Extract the merchant's claims and rule on each one."""
    note = (note or "").strip()
    if not note:
        return Adjudication(
            ok=False, note="", verdicts=[], corroborated=0, refuted=0,
            refused_reason="Nothing to read.",
        )

    claims, stubbed = extract(note, client)
    if stubbed:
        return Adjudication(
            ok=False, note=note, verdicts=[], corroborated=0, refuted=0,
            refused_reason=(
                "No cached extraction for this note and no API key configured. "
                "Reported rather than guessed at."
            ),
        )

    verdicts = adjudicate(claims, rec)
    return Adjudication(
        ok=True,
        note=note,
        verdicts=verdicts,
        corroborated=sum(1 for v in verdicts if v.status == "corroborated"),
        refuted=sum(1 for v in verdicts if v.status == "not_supported"),
    )


def context_lines(adj: Adjudication | None) -> list[str]:
    """The adjudication, rendered for the assistant's context.

    This is what makes the note queryable: once it has been ruled on, it is
    part of the record the assistant is grounded in, so a follow-up like "was
    I right about the billing window?" is answered from the verdict rather
    than from the model's memory of the conversation.
    """
    if adj is None or not adj.ok or not adj.verdicts:
        return []
    lines = ["", "WHAT THE MERCHANT SAID, AND WHETHER THE DATA AGREES"]
    for v in adj.verdicts:
        lines.append(
            '  claim: "%s" (%s) -> %s'
            % (v.claim.quote or v.claim.paraphrase, v.claim.label, v.status.upper())
        )
        lines.append("    %s" % v.detail)
    return lines
