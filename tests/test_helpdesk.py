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
import os

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


#: The questions the panel offers as buttons. Kept here so the test fails
#: loudly if the UI list and the warmed cache drift apart.
SUGGESTED = [
    "What does 'measured' mean here?",
    "How accurate is the attribution?",
    "What can the agent do without asking me?",
    "Why is the recovered figure so small?",
]


def _is_cached(question: str) -> bool:
    from doctor.helpdesk import SYSTEM, build_context
    from doctor.llm import CACHE_DIR, MODEL_FAST, _key

    prompt = "CONTEXT\n%s\n\nQUESTION\n%s" % (build_context(), question)
    return (CACHE_DIR / (_key(MODEL_FAST, SYSTEM, prompt, "helpdesk_answer") + ".json")).exists()


def test_the_panels_own_suggestions_answer_without_an_api_key():
    """The deployed build sets no API key, deliberately.

    So a suggested question that is not pre-cached refuses when a judge
    clicks it -- and one of these four did exactly that, because it had been
    warmed with slightly different wording than the button sends.
    """
    missing = [q for q in SUGGESTED if not _is_cached(q)]
    assert not missing, "not cached: %s" % missing


def test_the_suggestions_here_match_the_ones_in_the_ui():
    """If someone edits a button's wording, the warmed answer stops matching
    and the panel refuses on the deployed build. The cache key is the exact
    string."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    for q in SUGGESTED:
        assert q.replace("'", "&apos;") in ui or q in ui, q


def test_approving_the_book_does_not_silence_the_panel(tmp_path):
    """The context carries live book figures, so approving changes the cache
    key for every question at once. Both states the demo can be in are
    warmed; this proves the second one still is.
    """
    import glob
    import json
    import shutil

    from doctor.apply import apply_group
    from doctor.run import load_mandate

    files = sorted(glob.glob("data/runs/*.json"))
    if not files:
        pytest.skip("no runs")
    for f in files:
        shutil.copy(f, tmp_path / os.path.basename(f))
    try:
        for f in files:
            rec = json.load(open(f, encoding="utf-8"))
            try:
                signed = load_mandate(rec["merchant_id"])
            except (SystemExit, FileNotFoundError):
                continue
            for i in range(len(rec.get("pending_actions") or [])):
                try:
                    apply_group(rec["run_id"], i, signed, confirmed=True)
                except (IndexError, FileNotFoundError, ValueError):
                    pass

        missing = [q for q in SUGGESTED if not _is_cached(q)]
        assert not missing, "silent after approval: %s" % missing
    finally:
        for f in files:
            shutil.copy(tmp_path / os.path.basename(f), f)


def test_voice_input_is_feature_detected_not_assumed():
    """Speech recognition exists in Chrome and Edge, not Firefox, and only
    partly in Safari. A microphone button that does nothing is worse than no
    button, especially on a stage, so it is only rendered when the engine is
    actually there."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    assert "webkitSpeechRecognition" in ui
    assert "canHear" in ui, "the button must be gated on detection"
    assert "not-allowed" in ui, "a blocked microphone must say so"


def test_voice_does_not_submit_what_it_only_thinks_it_heard():
    """A mis-heard question that sends itself is a demo going wrong in front
    of people. The transcript fills the box; a person still presses Ask."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    rec = ui[ui.index("rec.onresult") : ui.index("rec.onerror")]
    assert "setQ(" in rec
    assert "send(" not in rec, "onresult must not submit on its own"


def test_the_microphone_stops_when_the_panel_closes():
    """A recogniser left running behind a closed panel keeps the tab's
    microphone indicator lit, which reads as spyware."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    assert "abort()" in ui


def test_the_button_can_be_moved_and_remembers_where():
    """It floats above the page, so wherever it parks it covers something --
    bottom-right sat on the top bar's own controls on a short viewport. No
    fixed default is right for every page, so it is draggable and persisted."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    assert "onPointerDown" in ui and "onPointerMove" in ui and "onPointerUp" in ui
    assert "localStorage.setItem(DOCK_KEY" in ui, "the position must survive a reload"
    assert "setPointerCapture" in ui, "the drag must survive leaving the button"


def test_a_drag_is_not_read_as_a_click():
    """Dragging and clicking share one pointer. Without a movement threshold
    every drag would also open the panel on release."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    up = ui[ui.index("function onPointerUp") : ui.index("useEffect(() => {\n    setCanHear")]
    assert "d?.moved" in up and "return;" in up, "a moved pointer must not toggle"


def test_the_button_cannot_be_dragged_off_screen():
    """A control dropped past the edge is a control you cannot get back."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    assert "clampToViewport" in ui
    assert 'window.addEventListener("resize"' in ui, "a shrinking window must not strand it"


def test_the_saved_position_is_the_one_it_was_dropped_at():
    """Reading React state on pointerup can be a render behind the last move,
    which would persist where the button was rather than where it landed."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    assert "live.current" in ui
    assert "JSON.stringify(live.current)" in ui


def test_keyboard_users_can_still_open_it():
    """They never drag, so the pointer handlers must not be the only way in."""
    ui = open("frontend/src/components/Helpdesk.tsx", encoding="utf-8").read()
    assert "onKeyDown" in ui and '"Enter"' in ui
