"""What the diagnosing agent is allowed to look up for itself.

Until now the hypothesiser was handed a finished two-thousand-character
briefing and asked to label it. That is a model doing paperwork, not an agent:
it could not ask a question, could not follow a lead, and could not tell you
which evidence changed its mind, because it never chose any.

This is the toolset it can call instead. The model decides what to look at,
in what order, and when it has seen enough.

WHAT MAKES THIS SAFE RATHER THAN OPEN-ENDED
Four properties, and every one of them is enforced here rather than requested
in a prompt:

  * the toolset is CLOSED -- a name outside this registry is refused, so the
    model cannot reach for something nobody reviewed
  * every tool is READ-ONLY -- nothing here writes, sends, retries or spends;
    the only things that change state still go through the policy kernel,
    which never consults a model
  * arguments are VALIDATED against the merchant's actual data, so a
    hallucinated bank name comes back as "no such bank" instead of an empty
    result the model can misread as evidence of absence
  * the loop is BOUNDED -- a fixed call budget, so an agent that cannot make
    up its mind stops rather than spending someone's money thinking

The point is not that the model is trusted with more. It is that it now has
to justify its answer with evidence it went and got, and the trace shows
exactly which questions it asked.
"""

from __future__ import annotations

from typing import Any, Callable

from pydantic import BaseModel


def _value_of(t, factor: str) -> str | None:
    """The transaction's value for one factor, in the decomposition's own terms.

    Transaction.factor_value exists precisely for this. Reading the attribute
    directly instead returns the raw hour (an int) where the decomposition
    works in bands, so every comparison misses and the tool reports an empty
    breakdown as a success -- which is worse than an error, because the model
    reads it as evidence of absence.
    """
    try:
        return t.factor_value(factor)
    except (KeyError, AttributeError):
        return None

#: How many lookups one diagnosis may make. Enough to follow two or three
#: leads, few enough that an indecisive run terminates.
MAX_CALLS = 6


class ToolCall(BaseModel):
    """One question the agent asked, and what came back."""

    name: str
    args: dict
    ok: bool
    result: dict
    #: Why a refused call was refused, in words the model can act on.
    error: str | None = None


class ToolContext(BaseModel):
    """Everything the tools may read. Assembled once, never mutated."""

    model_config = {"arbitrary_types_allowed": True}

    marginals: dict
    decomposition: Any
    baseline: Any
    transactions: list


def _factor_breakdown(ctx: ToolContext, factor: str) -> dict:
    """How this merchant's volume splits across one factor, and how each
    value actually performed."""
    share = ctx.marginals.get(factor)
    if not share:
        return {"error": "unknown factor: %s" % factor}

    rows = []
    for value, weight in sorted(share.items(), key=lambda kv: -kv[1]):
        seen = [t for t in ctx.transactions if _value_of(t, factor) == str(value)]
        if not seen:
            continue
        failed = [t for t in seen if not t.succeeded]
        rows.append(
            {
                "value": str(value),
                "share_pct": round(weight * 100, 2),
                "payments": len(seen),
                "failure_pct": round(100 * len(failed) / len(seen), 2),
            }
        )
    if not rows:
        return {"error": "no payments matched any value of %s" % factor}
    return {"factor": factor, "breakdown": rows[:12]}


def _bank_vs_npci(ctx: ToolContext, bank: str) -> dict:
    """This merchant's experience of one issuer against what NPCI publishes."""
    seen = [t for t in ctx.transactions if t.bank == bank]
    if not seen:
        known = sorted({t.bank for t in ctx.transactions})[:8]
        return {
            "error": "this merchant has no payments on %r" % bank,
            "banks_they_do_use": known,
        }
    stats = ctx.baseline.bank_stats(bank)
    failed = [t for t in seen if not t.succeeded]
    return {
        "bank": bank,
        "payments": len(seen),
        "share_pct": round(100 * len(seen) / max(len(ctx.transactions), 1), 2),
        "merchant_failure_pct": round(100 * len(failed) / len(seen), 2),
        "npci_business_decline_pct": getattr(stats, "bd_pct", None),
        "npci_technical_decline_pct": getattr(stats, "td_pct", None),
        "npci_technical_share_of_failures": getattr(stats, "technical_share", None),
        "in_npci_top50": stats is not None,
    }


def _failure_examples(ctx: ToolContext, factor: str, value: str) -> dict:
    """Actual failed payments matching a factor value, with their codes.

    Returned so a claim about a factor can be checked against the individual
    payments underneath it rather than asserted from an aggregate.
    """
    matched = [
        t
        for t in ctx.transactions
        if not t.succeeded and _value_of(t, factor) == str(value)
    ]
    if not matched:
        # Say what the real values are. A model that guessed a value name
        # otherwise reads the empty result as "this factor is clean".
        seen = sorted({v for v in (_value_of(t, factor) for t in ctx.transactions) if v})
        return {
            "error": "no failed payments with %s=%s" % (factor, value),
            "values_that_exist": seen[:12],
            "note": "an empty result here means the value was wrong, not that the factor is clean",
        }
    codes: dict[str, int] = {}
    for t in matched:
        codes[t.error_code or "unknown"] = codes.get(t.error_code or "unknown", 0) + 1
    return {
        "factor": factor,
        "value": str(value),
        "failed_payments": len(matched),
        "error_codes": dict(sorted(codes.items(), key=lambda kv: -kv[1])[:8]),
        "example_amounts_paise": [t.amount_paise for t in matched[:5]],
    }


def _attribution_with_error(ctx: ToolContext, factor: str) -> dict:
    """What the decomposition attributes to a factor, next to its own
    measured error -- so the model can see whether a number is signal."""
    for f in ctx.decomposition.attributions:
        if f.factor == factor:
            mae = getattr(f, "mae", None)
            pts = f.points
            return {
                "factor": factor,
                "attribution_pts": round(pts, 4),
                "measured_error_pts": round(mae, 4) if mae else None,
                "ratio_to_own_error": round(abs(pts) / mae, 2) if mae else None,
                "identified": getattr(f, "identified", True),
                "reading": (
                    "inside its own error bar -- not distinguishable from noise"
                    if mae and abs(pts) < mae
                    else "clears its own error bar"
                ),
            }
    return {
        "error": "unknown factor: %s" % factor,
        "valid_factors": ["bank", "method", "hour", "amount_band"],
        "note": "process_gap is computed directly, not decomposed, so it has "
                "no Shapley attribution to look up",
    }


#: The closed registry. A name outside this cannot be called.
TOOLS: dict[str, dict] = {
    "factor_breakdown": {
        "fn": _factor_breakdown,
        "args": ["factor"],
        "doc": "Volume share and failure rate for every value of a factor. "
               "factor: bank | method | hour | amount_band",
    },
    "bank_vs_npci": {
        "fn": _bank_vs_npci,
        "args": ["bank"],
        "doc": "This merchant's failure rate on one issuer against NPCI's "
               "published national figures for it. bank: exact bank name",
    },
    "failure_examples": {
        "fn": _failure_examples,
        "args": ["factor", "value"],
        "doc": "Real failed payments matching a factor value, with their "
               "error codes. factor: bank|method|hour|amount_band, value: the value",
    },
    "attribution_with_error": {
        "fn": _attribution_with_error,
        "args": ["factor"],
        "doc": "What the decomposition attributes to a factor, beside its own "
               "measured error. factor: bank | method | hour | amount_band",
    },
}


def describe_tools() -> str:
    """The toolset, rendered for the prompt."""
    return "\n".join(
        "  %s(%s) -- %s" % (name, ", ".join(spec["args"]), spec["doc"])
        for name, spec in TOOLS.items()
    )


def call(
    ctx: ToolContext, name: str, args: dict, already: list | None = None
) -> ToolCall:
    """Run one tool. Refuses anything outside the registry.

    A repeat of a call already made in this investigation is answered from the
    first result and told so, rather than re-run. Models loop on the same
    lookup when a result does not say what they hoped, and spending the
    budget three times on one question is how an agent runs out of turns
    without having learned anything.
    """
    for prior in already or []:
        if prior.name == name and prior.args == args:
            return ToolCall(
                name=name, args=args, ok=False, result=prior.result,
                error=(
                    "you already asked this; the answer has not changed. Ask "
                    "something different, or say you are done."
                ),
            )

    spec = TOOLS.get(name)
    if spec is None:
        return ToolCall(
            name=name, args=args, ok=False, result={},
            error="no such tool: %s. Available: %s"
            % (name, ", ".join(sorted(TOOLS))),
        )

    missing = [a for a in spec["args"] if a not in args]
    if missing:
        return ToolCall(
            name=name, args=args, ok=False, result={},
            error="missing argument(s): %s" % ", ".join(missing),
        )

    fn: Callable = spec["fn"]
    try:
        out = fn(ctx, *[args[a] for a in spec["args"]])
    except Exception as e:  # a tool must never take the diagnosis down
        return ToolCall(
            name=name, args=args, ok=False, result={},
            error="%s: %s" % (type(e).__name__, str(e)[:160]),
        )

    if "error" in out:
        return ToolCall(name=name, args=args, ok=False, result=out, error=out["error"])
    return ToolCall(name=name, args=args, ok=True, result=out)
