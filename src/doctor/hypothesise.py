"""Root-cause reasoning over the decomposition.  [LLM]

Shapley says WHICH factor carries the gap. It cannot say WHY. Going from
"2.1 points on hour-of-day" to "your subscription cron fires at midnight, and
your customers' issuing banks decline more in that window; move it to
10:00-14:00" needs reasoning over MCC, method mix, ticket distribution and the
NPCI bank context. That is a genuine judgement task, which is why it is the
one place a large model earns its cost.

Two design choices make it evaluable rather than vibes:

  * `root_cause_label` is drawn from the SAME closed enum the generator injects
    from, so scoring is exact match against ground truth -- ordinary
    forced-choice classification, not keyword-matching free text.
  * NONE_OF_THE_ABOVE is a real option. A model that never uses it on an
    ambiguous merchant is overconfident, and the eval reports that rate.

The system prompt forbids numbers that are not in the supplied context. That
is the guard against the failure mode where a model invents a plausible-looking
statistic, which in a project about honest measurement would be fatal.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import AllowInfNan, BaseModel, Field

from .baseline import Baseline
from .features import MerchantProfile
import json

from .tools import MAX_CALLS, ToolContext, call, describe_tools
from .llm import MODEL_REASONING, LLMClient
from .shapley import Decomposition
from .verify import VerificationResult, repair_prompt, verify


class RootCauseLabel(str, Enum):
    MIDNIGHT_BILLING_PENALTY = "midnight_billing_penalty"
    BANK_CONCENTRATION = "bank_concentration"
    NO_SOFT_DECLINE_RETRY = "no_soft_decline_retry"
    AMOUNT_BAND_RISK = "amount_band_risk"
    METHOD_MIX_MISMATCH = "method_mix_mismatch"
    NONE_OF_THE_ABOVE = "none_of_the_above"


#: A float a MODEL supplied, which therefore may not be NaN or infinite.
#:
#: `json.loads` accepts the bare tokens NaN, Infinity and -Infinity as a JSON
#: extension, so a model can emit one and it parses. A plain `float` field
#: then accepts it, and every downstream comparison against it is False --
#: which is the wrong direction for a safety gate. `plan._tier_for` computed
#: `ratio = abs(attribution_pts) / mae`, found `nan < WITHHOLD_RATIO` and
#: `nan < AUTO_RATIO` both False, and fell through to auto_execute.
#:
#: The effect was that a model emitting garbage got MORE autonomy than one
#: emitting an honest weak signal: 0.2 points against a 0.57 error bar is
#: correctly withheld to investigation, while NaN was auto-executed.
#:
#: Rejected at the boundary rather than sanitised, because there is no
#: sensible finite value to substitute for "the model did not give us a
#: number" -- and silently substituting one would put a fabricated
#: attribution into the audit trail.
FiniteFloat = Annotated[float, AllowInfNan(False)]


class Hypothesis(BaseModel):
    model_config = {"frozen": True}

    factor: str
    attribution_pts: FiniteFloat
    root_cause_label: RootCauseLabel
    hypothesis: str
    evidence: list[str] = Field(default_factory=list)
    recommended_action: str
    action_type: Literal["auto_execute", "merchant_action", "investigation"]


class Diagnosis(BaseModel):
    model_config = {"frozen": True}

    hypotheses: list[Hypothesis]
    primary_label: RootCauseLabel
    summary: str

    def by_label(self) -> dict[str, Hypothesis]:
        return {h.root_cause_label.value: h for h in self.hypotheses}


INVESTIGATOR_SYSTEM = """You are diagnosing why one merchant's payment
success rate is below what their category achieves. Before answering, you
may look things up.

Ask for ONE lookup at a time. You will be shown the result, then may ask
again. The budget is small, so ask for what would actually change your
mind rather than for what confirms what you already believe.

Stop as soon as you have enough. Stopping early is a good outcome.

Reply with JSON and nothing else, one of:
  {"tool": "name", "args": {...}, "why": "what this would tell you"}
  {"done": true, "why": "what you now believe and what convinced you"}
"""

SYSTEM = """You are a payments diagnostician for an Indian payments platform.

You are given a merchant's success-rate gap already decomposed across four \
factors by a Shapley-ordered Oaxaca-Blinder attribution, plus NPCI's published \
bank performance and the merchant's profile. Your job is to explain WHY, and \
to name the underlying cause from a fixed list.

Return ONLY a JSON object, no prose:

{
  "hypotheses": [
    {
      "factor": "<bank|method|hour|amount_band|process_gap>",
      "attribution_pts": <number copied from the context>,
      "root_cause_label": "<one of the labels below>",
      "hypothesis": "<two sentences, plain English, for a merchant>",
      "evidence": ["<each item must cite a number that appears in the context>"],
      "recommended_action": "<one concrete action>",
      "action_type": "<auto_execute|merchant_action|investigation>"
    }
  ],
  "primary_label": "<the label for the largest real cause>",
  "summary": "<one sentence a founder would understand>"
}

Allowed root_cause_label values, and nothing else:
  midnight_billing_penalty  payments cluster in the 23:00-05:59 window, where
                            bank declines run higher
  bank_concentration        too much volume on issuers that decline more than
                            the national mix
  no_soft_decline_retry     recoverable failures are never retried
  amount_band_risk          high-ticket payments fail at a higher rate
  method_mix_mismatch       the payment-method mix is skewed toward rails that
                            perform worse for this category
  none_of_the_above         the evidence does not support any of the above

HARD RULES
1. Do NOT state any number that does not appear in the context you were given.
   No invented percentages, no recalled industry benchmarks, no estimates.
2. Every item in "evidence" must quote a number from the context.
3. A factor flagged NOT IDENTIFIED must be given action_type "investigation",
   and you must say in the hypothesis that it could not be measured.
4. A factor whose attribution is smaller than its own measured error bar must
   be given action_type "investigation".
5. If nothing in the context supports a real cause, use none_of_the_above and
   say so. Choosing it when the evidence is weak is correct behaviour, not a
   failure. Do not reach for a label to seem useful.
6. action_type "auto_execute" is only for retrying soft declines, rescheduling
   a billing window, or reissuing a payment link. Anything requiring the
   merchant to change configuration is "merchant_action"."""


def build_context(
    profile: MerchantProfile,
    dec: Decomposition,
    baseline: Baseline,
    top_banks: list[tuple[str, float]],
) -> str:
    """Everything the model is allowed to reason from, and nothing else."""
    L: list[str] = []
    L.append("MERCHANT")
    L.append("  name: %s" % profile.name)
    L.append("  mcc: %s (%s)" % (profile.mcc, profile.mcc_description))
    L.append("  transactions this month: %d" % profile.monthly_txn_count)
    L.append("  average ticket: Rs %.2f" % (profile.avg_ticket_paise / 100.0))
    L.append("")
    L.append("SUCCESS RATE")
    L.append("  observed:            %.2f%%" % (dec.s_obs * 100))
    L.append("  cohort achievable:   %.2f%%" % (dec.s_star * 100))
    L.append("  gap:                 %.2f points" % dec.gap_pts)
    L.append("")
    L.append("DECOMPOSITION (Shapley, points of the gap)")
    for a in dec.attributions:
        flags = []
        if a.factor in dec.degenerate_factors:
            flags.append("NOT IDENTIFIED - merchant has effectively one value here")
        if a.mae is not None and abs(a.points) < a.mae:
            flags.append("INSIDE ITS OWN ERROR BAR")
        bar = (" +/- %.2f measured error" % a.mae) if a.mae is not None else ""
        L.append(
            "  %-12s %+6.2f pts%s%s"
            % (a.factor, a.points, bar, ("   [" + "; ".join(flags) + "]") if flags else "")
        )
    L.append("  %-12s %+6.2f pts   [unexplained residual]" % ("residual", dec.residual_pts))
    L.append(
        "  %-12s %+6.2f pts   [process gap, computed directly, NOT decomposed]"
        % ("process_gap", dec.process_gap_pts)
    )
    L.append("")
    L.append("MERCHANT BANK MIX vs NPCI NATIONAL DATA (period %s)" % baseline.period)
    L.append("  bank                              share   NPCI BD%%  NPCI TD%%  approved%%")
    for bank, share in top_banks[:6]:
        st = baseline.bank_stats(bank)
        if st:
            L.append(
                "  %-32s %5.1f%%   %6.2f   %6.2f    %6.2f"
                % (bank[:32], share * 100, st.bd_pct, st.td_pct, st.approved_pct)
            )
        else:
            L.append("  %-32s %5.1f%%   (not in NPCI top-50)" % (bank[:32], share * 100))
    L.append("")
    L.append("HOUR DISTRIBUTION (share of payments)")
    return "\n".join(L)


def _prompt(context: str, hour_mix: dict[str, float], method_mix: dict[str, float],
            amount_mix: dict[str, float]) -> str:
    L = [context]
    for name, mix in (("hour", hour_mix), ("method", method_mix), ("amount band", amount_mix)):
        if name != "hour":
            L.append("")
            L.append("%s DISTRIBUTION (share of payments)" % name.upper())
        for k, v in sorted(mix.items(), key=lambda kv: -kv[1]):
            L.append("  %-14s %5.1f%%" % (k, v * 100))
    L.append("")
    L.append("Produce the JSON object now.")
    return "\n".join(L)


class Hypothesiser:
    """Produces a diagnosis, then checks it against the data it was given.

    The root-cause eval showed the model followed the decomposition it was
    shown only 63% of the time. So the output is verified deterministically
    (see verify.py) and, on a violation, re-asked once with the broken rules
    quoted back. The repair prompt states the RULE, never the expected answer
    -- handing over the answer would make the metric measure the verifier.
    """

    def __init__(
        self, client: LLMClient, baseline: Baseline, *, verify_output: bool = True
    ) -> None:
        self.client = client
        self.baseline = baseline
        self.verify_output = verify_output
        #: Populated per run so the trace and the eval can report it.
        self.last_verification: VerificationResult | None = None
        #: The lookups the last diagnosis was built on.
        self.last_calls: list = []

    def investigate(
        self,
        dec: Decomposition,
        marginals: dict,
        transactions: list,
        context: str,
        on_call=None,
    ) -> list:
        """Let the model gather its own evidence before it answers.

        A bounded loop: it asks for one lookup, sees the result, and either
        asks again or says it has enough. The toolset is closed and
        read-only, so the worst an unhelpful turn can do is spend one of
        its MAX_CALLS budget.

        Returns the calls it made, which go into the trace -- so the flow
        page shows which questions it actually asked rather than asserting
        that it reasoned.
        """
        ctx = ToolContext(
            marginals=marginals,
            decomposition=dec,
            baseline=self.baseline,
            transactions=list(transactions),
        )
        made: list = []
        transcript: list[str] = []

        for _ in range(MAX_CALLS):
            asked = chr(10).join(transcript) or '  (nothing yet)'
            try:
                res = self.client.complete(
                    system=INVESTIGATOR_SYSTEM,
                    prompt=(
                        'CONTEXT%s%s%sTOOLS%s%s%sASKED SO FAR%s%s'
                        % (
                            chr(10), context, chr(10) * 2,
                            chr(10), describe_tools(), chr(10) * 2,
                            chr(10), asked,
                        )
                    ),
                    model=MODEL_REASONING,
                    schema_name="investigate_step",
                    max_tokens=500,
                )
            except Exception:
                # A turn that will not parse ends the investigation; it does
                # not end the diagnosis. This loop is enrichment -- the
                # decomposition is already computed and the answer can be
                # given without it, so a chatty model must not be able to
                # take the run down.
                break
            if res.stub:
                break

            step = res.parsed if isinstance(res.parsed, dict) else {}
            if step.get("done") or not step.get("tool"):
                break

            got = call(ctx, str(step["tool"]), step.get("args") or {}, made)
            made.append(got)
            if on_call is not None:
                on_call(got)

            transcript.append(
                '  %s(%s) -> %s'
                % (
                    got.name,
                    json.dumps(got.args, separators=(",", ":")),
                    got.error
                    or json.dumps(got.result, separators=(",", ":"))[:400],
                )
            )
        return made

    def run(
        self,
        profile: MerchantProfile,
        dec: Decomposition,
        marginals: dict[str, dict[str, float]],
        transactions: list | None = None,
        on_call=None,
    ) -> tuple[Diagnosis, object]:
        top_banks = sorted(marginals["bank"].items(), key=lambda kv: -kv[1])
        context = build_context(profile, dec, self.baseline, top_banks)

        # Let it look things up for itself first. What it chose to ask is
        # appended below, so the answer has to rest on evidence it went and
        # got rather than on a briefing it was handed.
        self.last_calls = (
            self.investigate(dec, marginals, transactions, context, on_call)
            if transactions
            else []
        )

        prompt = _prompt(
            context, marginals["hour"], marginals["method"], marginals["amount_band"]
        )
        if self.last_calls:
            prompt += chr(10) * 2 + 'WHAT YOU LOOKED UP' + chr(10) + chr(10).join(
                '  %s(%s) -> %s'
                % (
                    c.name,
                    json.dumps(c.args, separators=(",", ":")),
                    c.error or json.dumps(c.result, separators=(",", ":"))[:400],
                )
                for c in self.last_calls
            )
        result = self.client.complete(
            system=SYSTEM,
            prompt=prompt,
            model=MODEL_REASONING,
            schema_name="Diagnosis",
            max_tokens=2000,
        )
        diag = self._parse(result.parsed)

        checked = verify(diag, prompt, dec) if self.verify_output else None
        if checked and not checked.ok:
            # One repair attempt. If it still violates we keep the answer and
            # record the violations -- suppressing them would hide a real
            # failure, and this project reports those.
            retry = self.client.complete(
                system=SYSTEM,
                prompt=repair_prompt(prompt, checked),
                model=MODEL_REASONING,
                schema_name="Diagnosis",
                max_tokens=2000,
            )
            repaired = self._parse(retry.parsed)
            after = verify(repaired, prompt, dec)
            after = after.model_copy(update={"attempts": 2})
            # Only accept the repair if it is genuinely no worse.
            if len(after.violations) <= len(checked.violations):
                diag, result, checked = repaired, retry, after
            else:
                checked = checked.model_copy(update={"attempts": 2})

        self.last_verification = checked
        return diag, result

    def _parse(self, p: dict) -> Diagnosis:
        hyps = [
            Hypothesis(
                factor=h.get("factor", "unknown"),
                attribution_pts=float(h.get("attribution_pts", 0.0)),
                root_cause_label=RootCauseLabel(h["root_cause_label"]),
                hypothesis=h.get("hypothesis", ""),
                evidence=list(h.get("evidence", [])),
                recommended_action=h.get("recommended_action", ""),
                action_type=h.get("action_type", "investigation"),
            )
            for h in p.get("hypotheses", [])
        ]
        return Diagnosis(
            hypotheses=hyps,
            primary_label=RootCauseLabel(p.get("primary_label", "none_of_the_above")),
            summary=p.get("summary", ""),
        )


#: Maps the factor carrying the most of the gap onto the label that factor
#: would imply. Used ONLY by the offline stub, never to grade the model.
FACTOR_TO_LABEL = {
    "hour": RootCauseLabel.MIDNIGHT_BILLING_PENALTY,
    "bank": RootCauseLabel.BANK_CONCENTRATION,
    "amount_band": RootCauseLabel.AMOUNT_BAND_RISK,
    "method": RootCauseLabel.METHOD_MIX_MISMATCH,
}
