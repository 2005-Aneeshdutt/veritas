from chitragupta.ledger import GENESIS, Ledger
from chitragupta.types import ActionType, PolicyDecision, ProposedAction


def action(txn: str = "pay_1", amount: int = 15000) -> ProposedAction:
    return ProposedAction(
        action_type=ActionType.RETRY_SOFT_DECLINE,
        txn_id=txn,
        amount_paise=amount,
        reason="soft decline, retry after funding window",
    )


def filled(n: int = 5) -> Ledger:
    led = Ledger()
    for i in range(n):
        led.append(
            txn_id="pay_%d" % i,
            proposed_action=action("pay_%d" % i, 10000 + i),
            gate_decision=PolicyDecision.ALLOW,
            gate_reason="OK_WITHIN_MANDATE",
            outcome="executed",
            timestamp="2026-08-25T10:%02d:00+00:00" % i,
        )
    return led


def test_empty_chain_verifies():
    led = Ledger()
    v = led.verify()
    assert v.ok and v.entries == 0
    assert led.head_hash == GENESIS


def test_chain_links_and_verifies():
    led = filled()
    assert led.verify().ok
    entries = led.entries
    assert entries[0].prev_hash == GENESIS
    for prev, cur in zip(entries, entries[1:]):
        assert cur.prev_hash == prev.entry_hash
    assert led.head_hash == entries[-1].entry_hash


def test_tampering_with_a_record_breaks_the_chain():
    # This is the "Tamper with entry 4" button on the audit page.
    led = filled()
    tampered = led.entries
    tampered[3] = tampered[3].model_copy(
        update={"proposed_action": action("pay_3", 999_999_99)}
    )
    forged = Ledger()
    forged._entries = tampered
    v = forged.verify()
    assert not v.ok
    assert v.broken_at == 3
    assert "modified" in v.detail


def test_recomputing_the_hash_after_tampering_still_breaks_the_next_link():
    # A smarter attacker repairs the entry's own hash. The chain still fails,
    # because entry 4 commits to entry 3's ORIGINAL hash.
    led = filled()
    entries = led.entries
    bad = entries[3].model_copy(
        update={"proposed_action": action("pay_3", 999_999_99)}
    )
    entries[3] = bad.model_copy(update={"entry_hash": bad.recompute_hash()})
    forged = Ledger()
    forged._entries = entries
    v = forged.verify()
    assert not v.ok
    assert v.broken_at == 4
    assert "prev_hash" in v.detail


def test_reordering_entries_is_detected():
    led = filled()
    entries = led.entries
    entries[1], entries[2] = entries[2], entries[1]
    forged = Ledger()
    forged._entries = entries
    assert not forged.verify().ok


def test_round_trips_through_disk(tmp_path):
    led = filled()
    p = tmp_path / "ledger.jsonl"
    led.save(p)
    again = Ledger.load(p)
    assert again.verify().ok
    assert [e.entry_hash for e in again.entries] == [e.entry_hash for e in led.entries]


def test_append_is_deterministic_given_the_same_inputs():
    # RULE 3: two runs of the same batch must produce the same audit trail.
    a, b = filled(), filled()
    assert [e.entry_hash for e in a.entries] == [e.entry_hash for e in b.entries]
