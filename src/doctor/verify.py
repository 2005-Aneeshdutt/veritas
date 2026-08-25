"""A deterministic verifier for the model's diagnosis.

The root-cause eval decomposed its own 60% accuracy and found the bottleneck
was not the attribution but the model: shown a decomposition, it followed what
it was shown only 63% of the time. That is a fixable failure, and this is the
fix.

WHY THE VERIFIER IS NOT AN LLM. An LLM judging an LLM produces a number nobody
can check, and it fails in correlated ways -- the judge tends to accept exactly
the confident-sounding errors the author produced. Every rule here is a string
or arithmetic check against the context the model was handed, so a violation is
a fact rather than an opinion, and the whole pass costs nothing and cannot
hallucinate.

Five rules, each targeting a failure actually observed in the eval output:

  R1  every number cited as evidence must appear in the context
  R2  the primary label must match the largest IDENTIFIED cause
  R3  a factor the overlap check rejected cannot be given an action
  R4  an attribution inside its own error bar cannot be auto-executed
  R5  no two hypotheses may claim the same factor

On a violation the diagnosis is regenerated once with the violations quoted
back. If the second attempt still violates, the result is kept and the
violations are recorded -- suppressing the output would hide a real failure,
and this project reports those.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel

#: Numbers below this are too common to be meaningful evidence of grounding
#: (a model writing "1 bank" should not count as citing a figure).
_TRIVIAL = {0.0, 1.0, 2.0, 3.0, 100.0}
#: Rounding tolerance when matching a cited number against the context.
_TOL = 0.055

_NUM = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")


class Violation(BaseModel):
    rule: str
    detail: str
    factor: str | None = None


class VerificationResult(BaseModel):
    ok: bool
    violations: list[Violation]
    attempts: int = 1

    @property
    def summary(self) -> str:
        if self.ok:
            return "all checks passed"
        return "; ".join("%s: %s" % (v.rule, v.detail) for v in self.violations)


def _numbers(text: str) -> list[float]:
    out: list[float] = []
    for m in _NUM.finditer(text or ""):
        try:
            out.append(float(m.group(0).replace(",", "")))
        except ValueError:
            continue
    return out


def _grounded(value: float, context_numbers: list[float]) -> bool:
    """Is this figure present in what the model was shown?

    Absolute tolerance, so 2.76 matches a context 2.7551. Also accepts the
    value's own negation, because a model quoting "a 2.76 point shortfall" for
    a context figure of -2.76 is describing the same quantity.
    """
    for c in context_numbers:
        if abs(c - value) <= _TOL or abs(abs(c) - abs(value)) <= _TOL:
            return True
    return False


def verify(diagnosis: Any, context: str, dec: Any) -> VerificationResult:
    """Check a diagnosis against the context it was produced from."""
    violations: list[Violation] = []
    ctx_nums = _numbers(context)

    # ---- R1: cited numbers must exist in the context ---------------------
    for h in diagnosis.hypotheses:
        for ev in h.evidence:
            for n in _numbers(ev):
                if n in _TRIVIAL:
                    continue
                if not _grounded(n, ctx_nums):
                    violations.append(
                        Violation(
                            rule="R1_ungrounded_number",
                            factor=h.factor,
                            detail=(
                                "evidence cites %g, which does not appear in the "
                                "data you were given: %r" % (n, ev[:90])
                            ),
                        )
                    )

    # ---- R2: primary label must match the largest identified cause -------
    by_factor = {a.factor: a for a in dec.attributions}
    identified = [
        a for a in dec.attributions
        if a.factor not in dec.degenerate_factors and a.points > 0
    ]
    top = max(identified, key=lambda a: a.points, default=None)
    use_process = dec.process_gap_pts > (top.points if top else 0.0)

    expected = (
        "no_soft_decline_retry"
        if use_process
        else {
            "bank": "bank_concentration",
            "hour": "midnight_billing_penalty",
            "amount_band": "amount_band_risk",
            "method": "method_mix_mismatch",
        }.get(top.factor if top else "", "none_of_the_above")
    )
    # If nothing is identified and there is no process gap, none_of_the_above
    # is not merely allowed, it is the only correct answer.
    if top is None and not use_process:
        expected = "none_of_the_above"

    actual = diagnosis.primary_label.value
    if actual != expected:
        biggest = "%.2f pts on %s" % (
            (dec.process_gap_pts if use_process else (top.points if top else 0.0)),
            ("the process gap" if use_process else (top.factor if top else "nothing")),
        )
        violations.append(
            Violation(
                rule="R2_primary_label_mismatch",
                detail=(
                    "you named %r as the primary cause, but the largest "
                    "identified cause in the decomposition is %s, which is %r"
                    % (actual, biggest, expected)
                ),
            )
        )

    # ---- R3 / R4: unusable factors cannot be acted on ---------------------
    for h in diagnosis.hypotheses:
        a = by_factor.get(h.factor)
        if h.factor in dec.degenerate_factors and h.action_type != "investigation":
            violations.append(
                Violation(
                    rule="R3_acted_on_unidentified_factor",
                    factor=h.factor,
                    detail=(
                        "%s is flagged NOT IDENTIFIED, so it must be "
                        "'investigation', not %r" % (h.factor, h.action_type)
                    ),
                )
            )
        elif (
            a is not None
            and a.mae is not None
            and abs(a.points) < a.mae
            and h.action_type == "auto_execute"
        ):
            violations.append(
                Violation(
                    rule="R4_auto_executed_inside_error_bar",
                    factor=h.factor,
                    detail=(
                        "%s is %.2f pts against a measured error of +/-%.2f, so it "
                        "cannot be auto_execute" % (h.factor, a.points, a.mae)
                    ),
                )
            )

    # ---- R5: no duplicate factors ---------------------------------------
    seen: set[str] = set()
    for h in diagnosis.hypotheses:
        if h.factor in seen:
            violations.append(
                Violation(
                    rule="R5_duplicate_factor",
                    factor=h.factor,
                    detail="%s appears in more than one hypothesis" % h.factor,
                )
            )
        seen.add(h.factor)

    return VerificationResult(ok=not violations, violations=violations)


def repair_prompt(base_prompt: str, result: VerificationResult) -> str:
    """Re-ask, quoting the violations back.

    Deliberately states the rule that was broken rather than the answer we
    want. Telling the model the expected label would make the metric
    meaningless -- it would be scoring the verifier, not the model.
    """
    lines = [base_prompt, "", "---", ""]
    lines.append(
        "Your previous answer broke %d rule(s) that are checked automatically. "
        "Correct them and produce the JSON again." % len(result.violations)
    )
    lines.append("")
    for v in result.violations:
        lines.append("  - %s" % v.detail)
    lines.append("")
    lines.append(
        "Do not invent figures. Every number you cite must appear in the data "
        "above, and the primary cause must be the largest cause the "
        "decomposition actually identified."
    )
    return "\n".join(lines)
