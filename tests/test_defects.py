"""The write-off aggregated across the book, and what makes that a new fact.

`fault.attribute` answers "whose move is it?" for one merchant. Summing that
over the book is arithmetic; the thing that is not arithmetic is the claim the
page makes on top of it -- that a code hitting several merchants at once is
evidence about the rail rather than about any merchant.

So the properties under test are the ones that would make that claim false:

  * the aggregate must not double-count. A payment appears in exactly one
    owner's bucket and exactly one code within it, and the totals have to
    reconcile against the per-run reports they were built from
  * `systemic` must mean what the page says it means. A code that only one
    merchant saw is that merchant's bad month, and calling it a platform
    defect would send an engineer after nothing
  * the platform's slice must contain only codes Razorpay's own guidance
    points at Razorpay. The moment we start deciding that ourselves, the
    backlog is our opinion with their name on it
"""

import json

import pytest

from doctor.defects import SYSTEMIC_MERCHANTS, build_backlog
from doctor.fault import CUSTOMER, MERCHANT, PLATFORM, UNKNOWN, owner_of


@pytest.fixture(scope="module")
def backlog():
    return build_backlog()


@pytest.fixture(scope="module")
def runs():
    from doctor.defects import RUNS

    out = {}
    for p in RUNS.glob("run_*.json"):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if rec.get("used_stubs") or not rec.get("merchant_id"):
            continue
        mt = p.stat().st_mtime
        mid = rec["merchant_id"]
        if mid not in out or mt > out[mid][0]:
            out[mid] = (mt, rec)
    return [v[1] for v in out.values()]


def test_there_is_a_book_to_aggregate(backlog, runs):
    assert backlog.merchants == len(runs) >= 2
    assert backlog.total_paise > 0


def test_the_total_reconciles_against_the_runs_it_came_from(backlog, runs):
    """No payment counted twice, none dropped."""
    expect_paise = expect_count = 0
    for rec in runs:
        for g in rec["report"]["exceptions"].get("unrecoverable_by_fault", []):
            expect_paise += g["total_paise"]
            expect_count += g["count"]
    assert backlog.total_paise == expect_paise
    assert backlog.total_count == expect_count


def test_the_owner_groups_partition_the_total(backlog):
    assert sum(g.total_paise for g in backlog.groups) == backlog.total_paise
    assert sum(g.count for g in backlog.groups) == backlog.total_count
    # Shares are rounded for display, so they only have to add up to about 100.
    assert abs(sum(g.share_pct for g in backlog.groups) - 100) < 0.5


def test_each_group_s_codes_partition_that_group(backlog):
    for g in backlog.groups:
        assert sum(c.total_paise for c in g.codes) == g.total_paise
        assert sum(c.count for c in g.codes) == g.count


def test_a_code_belongs_to_exactly_one_owner(backlog):
    """Two owners claiming the same code would double-count the money."""
    seen: dict[str, str] = {}
    for g in backlog.groups:
        for c in g.codes:
            assert c.code not in seen, (
                "%s attributed to both %s and %s" % (c.code, seen.get(c.code), g.owner)
            )
            seen[c.code] = g.owner


def test_the_platform_slice_is_razorpay_s_own_verdict(backlog):
    """Not ours. Every platform code's guidance has to point at Razorpay."""
    from doctor.fault import _taxonomy

    tax = _taxonomy()
    assert backlog.platform_codes, "no platform-attributed codes to check"
    for c in backlog.platform_codes:
        row = tax.get(c.code, {})
        # Their wording, re-read from the published file -- not a stored
        # verdict copied along with the row. "Contact our Support Team" is
        # Razorpay addressing itself just as much as "reach out to Razorpay",
        # so the test asks owner_of rather than grepping for the brand.
        assert owner_of(row.get("next_steps")) == PLATFORM
        assert c.next_steps == (row.get("next_steps") or "").strip()


def test_systemic_means_more_than_one_merchant(backlog):
    for g in backlog.groups:
        for c in g.codes:
            assert c.merchants == len(c.merchant_names)
            assert c.systemic == (c.merchants >= SYSTEMIC_MERCHANTS)
            if c.merchants < 2:
                assert not c.systemic, (
                    "%s was seen by one merchant and still called systemic" % c.code
                )


def test_the_systemic_count_only_counts_platform_codes(backlog):
    assert backlog.systemic_codes == sum(1 for c in backlog.platform_codes if c.systemic)
    assert backlog.systemic_codes <= len(backlog.platform_codes)


def test_codes_are_ranked_by_money_not_by_volume(backlog):
    """An engineer's afternoon should go where the rupees are."""
    for g in backlog.groups:
        amounts = [c.total_paise for c in g.codes]
        assert amounts == sorted(amounts, reverse=True)


def test_the_headline_platform_figure_matches_its_own_group(backlog):
    group = next((g for g in backlog.groups if g.owner == PLATFORM), None)
    assert group is not None
    assert backlog.platform_paise == group.total_paise
    assert backlog.platform_share_pct == group.share_pct
    assert sum(c.total_paise for c in backlog.platform_codes) == backlog.platform_paise


def test_the_merchant_s_own_share_is_kept_separate(backlog):
    """The only slice a reader can act on today has to stay findable."""
    owners = {g.owner for g in backlog.groups}
    assert owners <= {MERCHANT, PLATFORM, CUSTOMER, UNKNOWN}
    order = [g.owner for g in backlog.groups]
    if MERCHANT in owners and CUSTOMER in owners:
        assert order.index(MERCHANT) < order.index(CUSTOMER)


def test_nothing_here_is_projected(backlog):
    """These payments already failed. A forecast would need an error bar."""
    fields = set(type(backlog).model_fields) | {
        f for g in backlog.groups for f in type(g).model_fields
    }
    for name in fields:
        assert not any(
            w in name for w in ("projected", "forecast", "recoverable", "error_pts")
        ), "%s reads like a forecast, and nothing on this page forecasts" % name
