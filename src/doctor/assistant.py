"""An assistant that cannot invent a number about a merchant's money.

Every product ships a chatbot over its own data now, and every one of them can
quietly make a figure up. That is tolerable when the subject is documentation
and unacceptable when the subject is how much money a merchant is losing and
what to do about it.

So this reuses the machinery `verify.py` already applies to the hypothesiser:
extract every figure from the answer, and check each one appears in the exact
context the model was handed. The difference is what happens on a violation --
the hypothesiser repairs and continues, because a diagnosis has to be produced
either way. Here there is no obligation to answer, so an answer that still
cites an unsupported figure after one repair is REFUSED rather than shown with
a warning next to it. A caveat under a wrong number is still a wrong number on
a screen.

What this does NOT claim: that the prose is true. Grounding a figure proves it
came from the record, not that the sentence around it is a correct reading of
the record. Numbers are checkable and are checked; reasoning is not, and
saying otherwise would be the same overclaim this project keeps refusing to
make elsewhere.

The assistant also holds no tools and takes no actions. It reads one run and
talks about it. Everything that can change state goes through the policy
kernel, which never consults a model.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from .llm import MODEL_FAST, LLMClient
from .verify import _decimals, _grounded, _numbers

SYSTEM = """You are a payments analyst explaining ONE merchant's diagnosis.

Rules, in order of importance:
1. Every number you write MUST appear in the CONTEXT below. Do not compute new
   figures, do not convert between units, do not round to a value that is not
   there, and do not estimate. If the context does not contain a number that
   answers the question, say so in words instead.
2. Prefer quoting a figure exactly as it appears.
3. Be brief. Three or four sentences. No preamble, no bullet lists, no
   markdown headings.
4. If the question cannot be answered from the context, say what is missing.
   That is a good answer, not a failure.
5. You cannot take any action. If asked to fix, retry, send or apply anything,
   say that actions go through the mandate on the Fixes panel, not through you.

Reply with JSON and nothing else: {"answer": "your reply here"}
"""

#: Figures a model may legitimately use without them being in the context:
#: small integers it needs to count with, and percentages of a whole.
_FREE = {0.0, 1.0, 2.0, 3.0, 4.0, 100.0}


class Citation(BaseModel):
    value: float
    grounded: bool


class Answer(BaseModel):
    ok: bool
    text: str
    #: Every figure in the answer, and whether the record supports it.
    citations: list[Citation]
    figures_cited: int
    figures_verified: int
    #: Set when the answer was refused rather than shown.
    refused_reason: str | None = None
    repaired: bool = False
    cache_hit: bool = False
    model: str = MODEL_FAST


def build_context(rec: dict) -> str:
    """The facts the assistant is allowed to speak from.

    Deliberately a flat list of labelled figures rather than the raw record.
    A model handed 400KB of JSON will quote something from a corner of it that
    nobody can find again, and every number here is one a reader can locate on
    a page of the app.
    """
    r = rec["report"]
    m, p, d, meas = r["merchant"], r["projected"], r["decomposition"], r["measured"]
    gate = r["gate"]["decisions"]

    lines = [
        "MERCHANT",
        "  name: %s" % m["name"],
        "  category: %s (mcc %s)" % (m["mcc_description"], m["mcc"]),
        "  payments this month: %d" % meas["transactions"],
        "  failed payments: %d" % meas["failures"],
        "  average ticket: Rs %d" % (m["avg_ticket_paise"] // 100),
        "  monthly volume: Rs %d" % (p["monthly_gmv_paise"] // 100),
        "",
        "SUCCESS RATE",
        "  observed: %.3f%%" % meas["observed_success_pct"],
        "  confidence interval: %.3f%% to %.3f%%" % tuple(meas["observed_success_ci_pct"]),
        "  what this category achieves: %.3f%%" % p["cohort_achievable_pct"],
        "  gap: %.3f points" % p["gap_pts"],
        "  gap in rupees per month: Rs %d" % (p["gap_value_paise"] // 100),
        "",
        "WHERE THE GAP COMES FROM (points, with the measured error on each)",
    ]
    for f in d["factors"]:
        lines.append(
            "  %-12s %+.3f points  +/- %.4f measured error%s"
            % (
                f["factor"],
                f["points"],
                f.get("mae") or 0.0,
                "  [NOT IDENTIFIED]" if not f.get("identified") else "",
            )
        )
    lines += [
        "  residual     %+.3f points" % d["residual_pts"],
        "  process gap  %+.3f points" % d["process_gap_pts"],
        "",
        "DIAGNOSIS",
        "  primary cause: %s" % r["diagnosis"]["primary_label"],
        "  summary: %s" % r["diagnosis"]["summary"],
        "",
        "MONEY",
        "  recovered in this run: Rs %d (PROJECTED)" % (p["recovered_this_run_paise"] // 100),
        "  still recoverable: Rs %d to Rs %d (PROJECTED range across 3 calibrations)"
        % (p["recoverable"]["low_paise"] // 100, p["recoverable"]["high_paise"] // 100),
        "  unrecoverable: Rs %d across %d payments"
        % (p["unrecoverable_paise"] // 100, p["unrecoverable_count"]),
        "",
        "WHAT THE AGENT DID",
        "  actions proposed: %d" % r["plan"]["actions"],
        "  withheld because the attribution is inside its own error: %d"
        % len(r["plan"]["withheld"]),
        "  allowed: %d, needs merchant approval: %d, denied by mandate: %d"
        % (gate.get("allow", 0), gate.get("step_up", 0), gate.get("deny", 0)),
        "  audit entries: %d, chain verified: %s, mandate violations: %d"
        % (meas["ledger_entries"], meas["chain_verified"], meas["mandate_violations"]),
    ]
    return "\n".join(lines)


def _answer_of(res) -> str:
    """The prose out of a structured reply.

    Every model call in this project returns a validated struct rather than
    free text, and this one is no exception -- the client parses JSON on the
    way back, so an assistant that replied in prose would fail before its
    figures were ever checked.
    """
    parsed = res.parsed if isinstance(res.parsed, dict) else {}
    return str(parsed.get("answer") or "").strip()


def _audit(text: str, context: str) -> list[Citation]:
    """Check every figure in an answer against the context it came from.

    The precision the model wrote each figure at is carried through, so a
    correct rounding passes and an invention still does not. Without it an
    answer where six of seven figures were exact was refused for the one that
    said 58 where the context said 58.5 -- and a refusal that fires on
    rounding teaches a reader that refusals mean nothing.
    """
    ctx = _numbers(context)
    dp = _decimals(text)
    return [
        Citation(
            value=v,
            grounded=v in _FREE or _grounded(v, ctx, dp.get(v)),
        )
        for v in _numbers(text)
    ]


def ask(
    rec: dict,
    question: str,
    client: LLMClient | None = None,
) -> Answer:
    """Answer one question about one run, or refuse."""
    question = (question or "").strip()
    if not question:
        return Answer(
            ok=False, text="", citations=[], figures_cited=0, figures_verified=0,
            refused_reason="No question asked.",
        )

    client = client or LLMClient()
    context = build_context(rec)
    prompt = "CONTEXT\n%s\n\nQUESTION\n%s" % (context, question)

    res = client.complete(
        system=SYSTEM, prompt=prompt, model=MODEL_FAST,
        schema_name="assistant_answer", max_tokens=400,
    )
    if res.stub:
        # A stub is not an answer. Saying "I could not reach a model" is
        # honest; dressing a placeholder up as analysis about money is not.
        return Answer(
            ok=False, text="", citations=[], figures_cited=0, figures_verified=0,
            refused_reason=(
                "No cached answer for this question and no API key configured, "
                "so there is nothing to say. This is reported rather than "
                "filled in with a placeholder."
            ),
        )

    text = _answer_of(res)
    cites = _audit(text, context)
    bad = [c for c in cites if not c.grounded]
    repaired = False

    if bad:
        repaired = True
        retry = client.complete(
            system=SYSTEM,
            prompt=(
                "%s\n\nYour previous answer cited figures that do not appear in "
                "the CONTEXT: %s\nRewrite it using only figures that appear "
                "there, or state the answer in words with no figure at all."
                % (prompt, ", ".join("%g" % c.value for c in bad))
            ),
            model=MODEL_FAST,
            schema_name="assistant_answer_repair",
            max_tokens=400,
        )
        if not retry.stub:
            r_text = _answer_of(retry)
            r_cites = _audit(r_text, context)
            if not [c for c in r_cites if not c.grounded]:
                text, cites, bad = r_text, r_cites, []

    if bad:
        return Answer(
            ok=False, text="", citations=cites,
            figures_cited=len(cites),
            figures_verified=sum(1 for c in cites if c.grounded),
            repaired=repaired,
            cache_hit=res.cache_hit,
            refused_reason=(
                "Refused. The answer cited %d figure%s that do not appear in "
                "this run's record (%s), and it did not correct them when "
                "asked. A caveat under a wrong number is still a wrong number."
                % (
                    len(bad),
                    "" if len(bad) == 1 else "s",
                    ", ".join("%g" % c.value for c in bad),
                )
            ),
        )

    return Answer(
        ok=True, text=text, citations=cites,
        figures_cited=len(cites),
        figures_verified=sum(1 for c in cites if c.grounded),
        repaired=repaired,
        cache_hit=res.cache_hit,
    )
