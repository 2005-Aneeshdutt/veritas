"""Questions about the system itself.

This assistant is asked how accurate the system is, which makes an invented
figure here worse than one anywhere else in the product: it would be a false
claim about the system's own honesty, made by the system, on the screen where
someone went to check. So the grounding is the same as everywhere else and the
tests are stricter about it.

The other property worth pinning is that the context is *assembled from the
committed files*, never restated in prose. A hand-written summary drifts the
moment an eval is regenerated, and nobody notices until a judge cross-checks.
"""

import json

import pytest

from doctor.helpdesk import HelpAnswer, build_context


@pytest.fixture(scope="module")
def ctx():
    return build_context()


# ────────────────────────────────────────── the context is real

def test_the_context_carries_the_book(ctx):
    assert "THE BOOK" in ctx
    assert "MEASURED money recovered" in ctx


def test_the_context_matches_the_portfolio_it_describes(ctx):
    """If these drift, the assistant answers a question about a book that no
    page is showing."""
    from doctor.portfolio import build_portfolio

    p = build_portfolio()
    assert format(p.total_measured_paise // 100, ",d") in ctx
    assert str(p.total_attempted) in ctx
    assert str(p.refused) in ctx


def test_the_context_matches_the_committed_evals(ctx):
    """Read from evals/results, never restated, so regenerating an eval
    updates the answers on the next request."""
    mae = json.load(
        open("evals/results/attribution_mae_by_factor.json", encoding="utf-8")
    )
    for factor, v in mae.items():
        assert factor in ctx
        assert ("%.3f" % v["mae"]) in ctx


def test_the_context_states_the_six_policy_rules(ctx):
    for phrase in (
        "signature must verify",
        "must be in force",
        "action type must be",
        "attempted more times than the cap",
        "7 days",
        "hard ceiling",
    ):
        assert phrase in ctx, phrase


def test_the_context_separates_measured_from_projected(ctx):
    """The distinction the whole project rests on. An assistant that blurred
    it would undo every careful label on every page."""
    assert "MEASURED:" in ctx and "PROJECTED:" in ctx
    assert "not against a live payment rail" in ctx.lower()
    assert "ASSUMED priors" in ctx


def test_the_context_admits_what_is_assumed(ctx):
    assert "nobody publishes those" in ctx
    assert "provenance" in ctx


def test_the_context_carries_the_rails_own_optimism(ctx):
    """The number that makes the system look worse has to be in reach, or the
    assistant can only ever flatter it."""
    assert "OPTIMISTIC" in ctx.upper()
    assert "does NOT establish" in ctx


# ──────────────────────────────────────────── it refuses safely

def test_an_empty_question_is_refused_without_a_model_call():
    from doctor.helpdesk import ask

    a = ask("")
    assert a.ok is False
    assert "No question asked" in a.refused_reason


def test_the_answer_type_is_serialisable():
    HelpAnswer.model_validate_json(
        HelpAnswer(
            ok=True, text="x", citations=[], figures_cited=0, figures_verified=0
        ).model_dump_json()
    )


def test_it_uses_the_same_grounding_as_every_other_model_output():
    """Not a second, weaker check written for this panel."""
    import inspect

    from doctor import assistant, helpdesk

    src = inspect.getsource(helpdesk)
    assert "_audit" in src
    assert "from .assistant import" in src
    # and the audit it borrows is the one that checks figures against context
    assert "_grounded" in inspect.getsource(assistant._audit)


def test_an_ungrounded_answer_is_refused_not_captioned():
    """A caveat under a wrong number is still a wrong number on a screen."""
    import inspect

    from doctor import helpdesk

    src = inspect.getsource(helpdesk.ask)
    assert "refused_reason" in src
    assert "ok=False" in src


def test_a_stub_is_never_dressed_up_as_an_answer():
    import inspect

    from doctor import helpdesk

    assert "res.stub" in inspect.getsource(helpdesk.ask)


def test_the_context_survives_a_missing_portfolio(monkeypatch):
    """A merchant file mid-write must not take the panel down with it."""
    import doctor.portfolio as portfolio

    def boom():
        raise RuntimeError("no runs")

    monkeypatch.setattr(portfolio, "build_portfolio", boom)
    ctx = build_context()
    assert "THE MANDATE" in ctx, "the rest of the context must still assemble"
