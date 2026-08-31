"""Questions about the whole system, not about one merchant.

`assistant.py` answers "why is this merchant losing money", grounded in one
run record. This answers the other kind of question a person actually asks
while looking at the product: how does the mandate work, how accurate is the
attribution, what does 'measured' mean here, how much did the book recover,
why is that number smaller than the one above it.

Those questions were previously answerable only by reading the README, which
means they were answerable only by someone who had decided to. A panel that
follows you across the app closes that gap.

The grounding rule is the same one the rest of this project lives by, and it
matters more here, not less. This assistant is asked about the system's own
accuracy, so an invented figure would be a false claim about how honest the
system is -- the worst possible thing to get wrong. Every number in an answer
must appear in the context it was handed, and an answer that cites one that
does not is refused rather than shown with a caveat.

The context is assembled from the same files the pages read: the portfolio
aggregate, the committed eval results, and the mandate rules. Nothing is
written for the model to recite.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from .assistant import Citation, _answer_of, _audit
from .llm import MODEL_FAST, LLMClient

ROOT = Path(__file__).resolve().parents[2]
EVALS = ROOT / "evals" / "results"

SYSTEM = """You answer questions about Revenue Doctor, a payment recovery
system, for someone looking at its screens.

RULES
- Use ONLY the CONTEXT. Every number you write must appear there.
- If the CONTEXT does not answer it, say so plainly in one sentence. Do not
  reason toward a number that is not in front of you.
- Distinguish MEASURED from PROJECTED whenever you quote money. The system
  does, and an answer that blurs them misrepresents it.
- Three sentences at most. No preamble, no restating the question.
- Plain English. The reader is smart and does not know the codebase.

Return JSON: {"answer": "..."}"""


class HelpAnswer(BaseModel):
    ok: bool
    text: str
    citations: list[Citation]
    figures_cited: int
    figures_verified: int
    refused_reason: str | None = None
    cache_hit: bool = False
    model: str | None = None


def _eval(name: str) -> dict:
    try:
        return json.loads((EVALS / (name + ".json")).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def build_context() -> str:
    """Everything the system can be asked about, assembled from what it ships.

    Read from the committed files rather than restated in prose, so an answer
    cannot drift from what the pages show. If a figure changes in the evals,
    it changes here on the next request.
    """
    from .portfolio import build_portfolio

    out: list[str] = []

    # ── what the book did
    try:
        p = build_portfolio()
        rupees = lambda x: "Rs %s" % format(x // 100, ",d")  # noqa: E731
        out.append(
            "THE BOOK (%d merchants, %d payments, %d failures)\n"
            "  identified as recoverable: %s central, range %s to %s [PROJECTED]\n"
            "  MEASURED money recovered: %s from %d of %d executed retries\n"
            "  the rail forecast %s for those same retries, so it runs "
            "optimistic\n"
            "  actions proposed %d: %d acted on, %d awaiting a person, %d "
            "refused by the mandate\n"
            "  still queued: %d retries, forecast %s to %s [PROJECTED]"
            % (
                len(p.merchants), p.total_transactions, p.total_failures,
                rupees(p.total_recoverable_central_paise),
                rupees(p.total_recoverable_low_paise),
                rupees(p.total_recoverable_high_paise),
                rupees(p.total_measured_paise), p.total_converted, p.total_attempted,
                rupees(p.total_projected_for_attempted_paise),
                p.acted_on + p.awaiting + p.refused + p.escalated,
                p.acted_on, p.awaiting, p.refused,
                p.pending_retry_actions,
                rupees(p.pending_projected_low_paise),
                rupees(p.pending_projected_high_paise),
            )
        )
    except Exception:  # a missing run must not take the panel down
        pass

    # ── how accurate it is
    mae = _eval("attribution_mae_by_factor")
    if mae:
        rows = "\n".join(
            "  %-12s MAE %.3f pts, p90 %.3f, within +/-0.5 on %.1f%% of %d merchants"
            % (k, v["mae"], v["p90_abs_err"], 100 * v["coverage_0p5"], v["n"])
            for k, v in mae.items()
        )
        out.append("ATTRIBUTION ACCURACY (200 merchants, known answers)\n" + rows)

    nvs = _eval("naive_vs_shapley")
    if nvs:
        c = nvs.get("coherence", {})
        out.append(
            "SHAPLEY VS NAIVE\n"
            "  both pick the right primary cause %.1f%% of the time, "
            "disagreement rate %.1f%%\n"
            "  Shapley's parts sum to the whole exactly (ratio 1.0); naive "
            "averages %.3f and overstates on %.1f%% of merchants"
            % (
                100 * nvs.get("shapley_primary_accuracy", 0),
                100 * nvs.get("disagreement_rate", 0),
                c.get("naive_mean_ratio", 0),
                c.get("naive_overstates_pct", 0),
            )
        )

    rc = _eval("root_cause_accuracy")
    if rc:
        ed = rc.get("error_decomposition", {})
        out.append(
            "ROOT CAUSE, THE MODEL STEP\n"
            "  %.1f%% exact match on %d merchants against the injected cause\n"
            "  the attribution pointed at the right cause %.1f%% of the time, "
            "the model followed what it was shown %.1f%%, and it was right "
            "%.1f%% of the time when the attribution was right"
            % (
                100 * rc.get("accuracy", 0), rc.get("n", 0),
                100 * ed.get("attribution_pointed_at_the_right_cause", 0),
                100 * ed.get("model_faithful_to_what_it_saw", 0),
                100 * ed.get("accuracy_when_attribution_was_right", 0),
            )
        )

    ra = _eval("recovery_accuracy")
    if ra:
        out.append(
            "HOW OPTIMISTIC THE RETRY MODEL IS\n"
            "  %s\n"
            "  what this does NOT establish: %s"
            % (ra.get("headline", ""), ra.get("what_this_does_NOT_establish", ""))
        )

    bp = _eval("batch_size_power")
    if bp:
        rows = "\n".join(
            "  %s payments/month: MAE %.3f pts, Wilson half-width %.2f pts"
            % (k, v["mae_all_factors"], v["mean_wilson_halfwidth_pts"])
            for k, v in bp.items()
        )
        out.append("PRECISION VS BATCH SIZE\n" + rows)

    # ── what the agent may do
    out.append(
        "THE MANDATE AND THE POLICY KERNEL\n"
        "  The merchant signs a mandate with an Ed25519 key the agent has "
        "never held, so the agent cannot widen its own authority.\n"
        "  Six rules run on every action, deterministically, with no model "
        "consulted:\n"
        "    1 the signature must verify before anything else\n"
        "    2 the mandate must be in force at the moment of the action\n"
        "    3 the action type must be one the merchant authorised\n"
        "    4 no payment may be attempted more times than the cap allows\n"
        "    5 nothing is remediated more than 7 days after it failed\n"
        "    6 every amount is checked against the auto-execute limit and "
        "the hard ceiling\n"
        "  Outcomes: ALLOW runs unattended, STEP_UP waits for the merchant, "
        "DENY is refused outright and stays refused however many times it is "
        "approved.\n"
        "  Every decision is appended to a SHA-256 hash-chained ledger that "
        "the browser re-verifies from genesis."
    )

    # ── what the words mean here
    out.append(
        "WHAT THE WORDS MEAN HERE\n"
        "  MEASURED: marked after the fact against the distribution that "
        "generated the book, by a scorer that reads the merchant file and not "
        "the run. Not against a live payment rail.\n"
        "  PROJECTED: produced by the retry model in mock_rail.py, which is an "
        "assumption, so it ships as a range across three calibrations.\n"
        "  Bank failure rates are MEASURED from NPCI's published remitter "
        "tables. Method, hour and amount-band effects are ASSUMED priors, "
        "because nobody publishes those; every coefficient carries its "
        "provenance and the sensitivity analysis sweeps them.\n"
        "  The agent may also be pointed at an uploaded NPCI table, which "
        "re-derives every baseline from that file without writing it to disk."
    )

    return "\n\n".join(out)


def ask(question: str, client: LLMClient | None = None) -> HelpAnswer:
    """Answer a question about the system, or refuse."""
    question = (question or "").strip()
    if not question:
        return HelpAnswer(
            ok=False, text="", citations=[], figures_cited=0, figures_verified=0,
            refused_reason="No question asked.",
        )

    client = client or LLMClient()
    context = build_context()
    res = client.complete(
        system=SYSTEM,
        prompt="CONTEXT\n%s\n\nQUESTION\n%s" % (context, question),
        model=MODEL_FAST,
        schema_name="helpdesk_answer",
        max_tokens=400,
    )
    if res.stub:
        return HelpAnswer(
            ok=False, text="", citations=[], figures_cited=0, figures_verified=0,
            refused_reason=(
                "No cached answer for this question and no API key configured. "
                "That is reported rather than filled in with a placeholder."
            ),
        )

    text = _answer_of(res)
    cites = _audit(text, context)
    bad = [c for c in cites if not c.grounded]

    if bad:
        # One chance to correct itself, then it is refused. Being asked about
        # your own accuracy and inventing the figure is the worst available
        # failure, so it does not get shown with a warning attached.
        retry = client.complete(
            system=SYSTEM,
            prompt=(
                "CONTEXT\n%s\n\nQUESTION\n%s\n\nYour previous answer cited "
                "figures that are not in the CONTEXT: %s\nRewrite it using "
                "only figures that appear there, or answer in words with no "
                "figure at all."
                % (context, question, ", ".join("%g" % c.value for c in bad))
            ),
            model=MODEL_FAST,
            schema_name="helpdesk_answer_repair",
            max_tokens=400,
        )
        if not retry.stub:
            r_text = _answer_of(retry)
            r_cites = _audit(r_text, context)
            if not [c for c in r_cites if not c.grounded]:
                text, cites, bad = r_text, r_cites, []

    if bad:
        return HelpAnswer(
            ok=False, text="", citations=cites,
            figures_cited=len(cites),
            figures_verified=sum(1 for c in cites if c.grounded),
            cache_hit=res.cache_hit,
            refused_reason=(
                "Refused. The answer cited %d figure%s that do not appear "
                "anywhere in this system's own records (%s). A caveat under a "
                "wrong number is still a wrong number."
                % (
                    len(bad),
                    "" if len(bad) == 1 else "s",
                    ", ".join("%g" % c.value for c in bad),
                )
            ),
        )

    return HelpAnswer(
        ok=True, text=text, citations=cites,
        figures_cited=len(cites),
        figures_verified=sum(1 for c in cites if c.grounded),
        cache_hit=res.cache_hit,
        model=MODEL_FAST,
    )
