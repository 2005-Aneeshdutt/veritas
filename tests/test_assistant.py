"""The assistant that cannot invent a number about a merchant's money.

These use a fake client rather than a live model, because what is being pinned
is the GATE, not the model's manners. A model that behaves well today and
badly after a version bump must still be unable to put an unsupported figure
on screen, and that property belongs to the check, not to the prompt.

The behaviour that matters most is the refusal. Showing a wrong number with a
warning beside it is not a safer version of showing a wrong number.
"""

import json
import glob

import pytest

from doctor.assistant import build_context, ask


class FakeResult:
    def __init__(self, answer=None, stub=False):
        self.text = json.dumps({"answer": answer}) if answer is not None else ""
        self.parsed = {"answer": answer} if answer is not None else None
        self.stub = stub
        self.cache_hit = False


class FakeClient:
    """Returns scripted answers in order, and records what it was asked."""

    def __init__(self, *answers, stub=False):
        self.answers = list(answers)
        self.stub = stub
        self.prompts = []

    def complete(self, *, system, prompt, model, schema_name, max_tokens=400):
        self.prompts.append(prompt)
        if self.stub:
            return FakeResult(stub=True)
        return FakeResult(self.answers.pop(0) if self.answers else "")


@pytest.fixture(scope="module")
def rec():
    return json.load(
        open(sorted(glob.glob("data/runs/*.json"))[0], encoding="utf-8")
    )


def test_a_grounded_answer_is_shown(rec):
    ctx = build_context(rec)
    gap = rec["report"]["projected"]["gap_pts"]
    a = ask(rec, "what is my gap", FakeClient("Your gap is %.3f points." % gap))
    assert a.ok
    assert a.figures_cited == a.figures_verified
    assert str(abs(gap))[:4] in a.text


def test_an_invented_figure_is_refused_not_captioned(rec):
    client = FakeClient(
        "Your gap is 987.654 points.",
        "Your gap is 987.654 points.",  # refuses to correct
    )
    a = ask(rec, "what is my gap", client)
    assert a.ok is False
    assert a.text == "", "a refused answer must not reach the screen at all"
    assert "987.654" in a.refused_reason
    assert a.repaired is True


def test_one_repair_is_attempted_before_refusing(rec):
    gap = rec["report"]["projected"]["gap_pts"]
    client = FakeClient(
        "Your gap is 987.654 points.",
        "Your gap is %.3f points." % gap,  # corrects itself
    )
    a = ask(rec, "what is my gap", client)
    assert a.ok is True
    assert a.repaired is True
    assert "987.654" not in a.text
    assert len(client.prompts) == 2


def test_the_repair_prompt_quotes_the_offending_figure(rec):
    client = FakeClient("It is 987.654 points.", "It is unclear.")
    ask(rec, "what is my gap", client)
    assert "987.654" in client.prompts[1]


def test_an_answer_with_no_figures_is_fine(rec):
    a = ask(rec, "what should I do", FakeClient("Reschedule your billing window."))
    assert a.ok
    assert a.figures_cited == 0


def test_a_stub_is_refused_rather_than_presented(rec):
    a = ask(rec, "what is my gap", FakeClient(stub=True))
    assert a.ok is False
    assert a.text == ""
    assert "no API key" in a.refused_reason


def test_an_empty_question_is_refused_without_calling_the_model(rec):
    client = FakeClient("should never be used")
    a = ask(rec, "   ", client)
    assert a.ok is False
    assert client.prompts == [], "an empty question must not reach the model"


def test_small_counting_integers_do_not_count_as_citations(rec):
    """Otherwise "the 4 factors" is flagged and every answer is refused."""
    a = ask(rec, "how many factors", FakeClient("There are 4 factors."))
    assert a.ok


def test_the_context_carries_no_raw_record(rec):
    """A model handed the whole record quotes from corners nobody can find."""
    ctx = build_context(rec)
    assert "coalition_values" not in ctx
    assert "entry_hash" not in ctx
    assert len(ctx) < 4000, "context is a briefing, not a dump"


def test_the_context_labels_projected_money(rec):
    ctx = build_context(rec)
    assert "PROJECTED" in ctx, (
        "the assistant must be able to see which figures are modelled"
    )


def test_the_system_prompt_forbids_acting(rec):
    from doctor.assistant import SYSTEM

    assert "cannot take any action" in SYSTEM
    assert "mandate" in SYSTEM
