import math

import pytest

from chitragupta.canonical import canonical_json, sha256_hex
from chitragupta.types import ActionType, ProposedAction


def test_key_order_does_not_change_bytes():
    a = {"z": 1, "a": {"n": 2, "m": 3}}
    b = {"a": {"m": 3, "n": 2}, "z": 1}
    assert canonical_json(a) == canonical_json(b)
    assert sha256_hex(a) == sha256_hex(b)


def test_no_insignificant_whitespace():
    assert canonical_json({"a": 1, "b": [1, 2]}) == b'{"a":1,"b":[1,2]}'


def test_pydantic_model_and_equivalent_dict_agree():
    action = ProposedAction(
        action_type=ActionType.RETRY_SOFT_DECLINE,
        txn_id="pay_1",
        amount_paise=15000,
        reason="soft decline, insufficient funds",
    )
    assert sha256_hex(action) == sha256_hex(action.model_dump(mode="json"))


def test_enum_serialises_by_value():
    assert b'"retry_soft_decline"' in canonical_json(
        {"t": ActionType.RETRY_SOFT_DECLINE}
    )


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_floats_are_rejected(bad):
    # json.dumps would happily emit an unparseable NaN token; a hash over that
    # is worthless because nothing else can read it back.
    assert not math.isfinite(bad)
    with pytest.raises(ValueError):
        canonical_json({"x": bad})


def test_unicode_is_not_escaped_but_is_stable():
    payload = {"bank": "Bank of Baroda ₹"}
    assert canonical_json(payload) == canonical_json(dict(payload))
    assert "₹" in canonical_json(payload).decode("utf-8")
