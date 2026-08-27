"""Whose move is it.

An entire failure class was labelled "permanently unusable -- only the
customer can fix this" while containing `live_mode_not_enabled` and
`invalid_order_id`. Those are the merchant's own integration losing them money
on every affected payment, filed under hopeless.

The property that matters is where the attribution comes from. Reading
Razorpay's published `next_steps` means a code they add tomorrow is classified
by its own guidance; a hardcoded list here would go stale silently and nobody
would notice, which is how the original mislabel survived.

The second property is restraint: wording that genuinely does not say who
should act comes out UNKNOWN. Guessing an owner puts a merchant to work on
something that was never theirs.
"""

import json

import pytest

from doctor.fault import (
    CUSTOMER,
    MERCHANT,
    PLATFORM,
    UNKNOWN,
    attribute,
    merchant_fault_paise,
    owner_of,
)


class T:
    def __init__(self, code, amount=10_000):
        self.error_code = code
        self.amount_paise = amount


@pytest.mark.parametrize(
    "text,expected",
    [
        ("The customer must use a different card or method.", CUSTOMER),
        ("The customer should check the bank account details.", CUSTOMER),
        ("The customer has to approve the collect request.", CUSTOMER),
        ("Please reach out to Razorpay.", PLATFORM),
        ("Contact our Support Team to get international transactions enabled.", PLATFORM),
        ("Please make sure that the payment amount is more than the minimum.", MERCHANT),
        ("Check your integration and payment request.", MERCHANT),
        ("Make sure correct order ID is always passed.", MERCHANT),
        ("", UNKNOWN),
        (None, UNKNOWN),
    ],
)
def test_the_owner_comes_from_razorpays_wording(text, expected):
    assert owner_of(text) == expected


def test_ambiguous_guidance_is_not_guessed():
    """'Retry with a different payment method' does not say who retries."""
    assert owner_of("Please retry with a different payment method.") == UNKNOWN


def test_the_customer_test_wins_over_the_merchant_test():
    """The merchant pattern is broadest and would otherwise swallow this."""
    assert owner_of("The customer must make sure the card is active.") == CUSTOMER


def test_a_merchant_configuration_fault_is_not_filed_under_the_customer():
    """The bug this module exists for."""
    groups = attribute([T("amount_less_than_minimum_amount")])
    assert groups[0].owner == MERCHANT


def test_the_merchants_own_faults_come_first():
    """They are the only ones the reader can fix today. Burying them under the
    customer's is how this was invisible."""
    rows = [T("card_expired")] * 20 + [T("amount_less_than_minimum_amount")]
    owners = [g.owner for g in attribute(rows)]
    assert owners[0] == MERCHANT, "the actionable bucket must lead"


def test_counts_and_money_add_up():
    rows = [T("card_expired", 5_000), T("card_expired", 7_000),
            T("amount_less_than_minimum_amount", 3_000)]
    groups = attribute(rows)
    assert sum(g.count for g in groups) == 3
    assert sum(g.total_paise for g in groups) == 15_000
    assert merchant_fault_paise(groups) == 3_000


def test_codes_within_a_group_are_ordered_by_money():
    rows = [T("card_expired", 1_000)] + [T("card_number_invalid", 90_000)]
    codes = attribute(rows)[0].codes
    assert [c["total_paise"] for c in codes] == sorted(
        [c["total_paise"] for c in codes], reverse=True
    )


def test_razorpays_own_instruction_is_carried_through():
    """The merchant should read Razorpay's words about their own integration,
    not our paraphrase of them."""
    g = attribute([T("amount_less_than_minimum_amount")])[0]
    assert "minimum" in g.codes[0]["next_steps"].lower()


def test_an_unknown_code_does_not_crash_and_is_not_blamed_on_anyone():
    g = attribute([T("some_code_razorpay_added_last_week")])
    assert g[0].owner == UNKNOWN


def test_rows_without_a_code_are_skipped():
    assert attribute([T(None), T("")]) == []


def test_it_reads_the_committed_taxonomy_not_a_hardcoded_list():
    """A list here would go stale the first time Razorpay publishes a code,
    and nobody would notice -- which is how the original mislabel survived."""
    import inspect

    from doctor import fault

    src = inspect.getsource(fault._taxonomy)
    assert "error_labels.json" in src or "LABELS" in src


def test_every_taxonomy_code_gets_an_owner_or_an_honest_unknown():
    rows = json.load(open("evals/error_labels.json", encoding="utf-8"))["labels"]
    owners = {owner_of(r.get("next_steps")) for r in rows}
    assert owners <= {CUSTOMER, MERCHANT, PLATFORM, UNKNOWN}
    unknown = sum(1 for r in rows if owner_of(r.get("next_steps")) == UNKNOWN)
    assert unknown < len(rows) * 0.2, (
        "%d of %d codes unattributable -- the patterns have drifted from the "
        "published wording" % (unknown, len(rows))
    )
