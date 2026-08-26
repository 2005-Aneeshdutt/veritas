"""Hash-chained, append-only audit trail.

Every gate decision -- allowed, stepped up, denied, or errored -- lands here.
Each entry commits to the previous entry's hash, so altering any historical
record invalidates every hash after it. `verify()` recomputes the chain from
genesis and reports the first sequence number that breaks, which is what the
frontend's "Verify chain" and "Tamper with entry 4" buttons drive.

The chain proves integrity, not authenticity: it shows the log has not been
edited after the fact. Signing the head with the merchant key would add
authenticity; that is deliberately out of scope and stated rather than implied.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from .canonical import sha256_hex
from .types import PolicyDecision, ProposedAction

GENESIS = "0" * 64

#: "escalated" is deliberately distinct from "executed". Flagging a payment
#: for a human is permitted by the mandate but is not the agent acting on the
#: payment, and conflating the two would make the mandate-violation count
#: report a violation every time the agent correctly escalated.
Outcome = Literal[
    "executed", "escalated", "merchant_action", "denied", "exception"
]


class LedgerEntry(BaseModel):
    model_config = {"frozen": True}

    sequence: int
    timestamp: str  # ISO 8601
    txn_id: str
    proposed_action: ProposedAction
    gate_decision: PolicyDecision
    gate_reason: str
    outcome: Outcome
    prev_hash: str
    entry_hash: str

    def recompute_hash(self) -> str:
        """Hash of this entry with `entry_hash` itself excluded.

        Excluding the field is what makes the hash well defined -- it cannot
        commit to itself.
        """
        payload = self.model_dump(mode="json")
        payload.pop("entry_hash", None)
        return sha256_hex(payload)


class ChainVerification(BaseModel):
    ok: bool
    entries: int
    #: First sequence number that fails, or None if the chain is intact.
    broken_at: int | None = None
    detail: str = ""


class Ledger:
    """Append-only in memory, persisted as JSON lines."""

    def __init__(self) -> None:
        self._entries: list[LedgerEntry] = []

    def __len__(self) -> int:
        return len(self._entries)

    @property
    def entries(self) -> list[LedgerEntry]:
        return list(self._entries)

    @property
    def head_hash(self) -> str:
        return self._entries[-1].entry_hash if self._entries else GENESIS

    def append(
        self,
        *,
        txn_id: str,
        proposed_action: ProposedAction,
        gate_decision: PolicyDecision,
        gate_reason: str,
        outcome: Outcome,
        timestamp: str | None = None,
    ) -> LedgerEntry:
        seq = len(self._entries)
        draft = LedgerEntry(
            sequence=seq,
            timestamp=timestamp or datetime.now(timezone.utc).isoformat(),
            txn_id=txn_id,
            proposed_action=proposed_action,
            gate_decision=gate_decision,
            gate_reason=gate_reason,
            outcome=outcome,
            prev_hash=self.head_hash,
            entry_hash="",
        )
        entry = draft.model_copy(update={"entry_hash": draft.recompute_hash()})
        self._entries.append(entry)
        return entry

    def verify(self) -> ChainVerification:
        """Recompute the whole chain from genesis."""
        prev = GENESIS
        for i, e in enumerate(self._entries):
            if e.sequence != i:
                return ChainVerification(
                    ok=False, entries=len(self._entries), broken_at=i,
                    detail="sequence out of order: expected %d, found %d" % (i, e.sequence),
                )
            if e.prev_hash != prev:
                return ChainVerification(
                    ok=False, entries=len(self._entries), broken_at=i,
                    detail="prev_hash mismatch at entry %d" % i,
                )
            if e.recompute_hash() != e.entry_hash:
                return ChainVerification(
                    ok=False, entries=len(self._entries), broken_at=i,
                    detail="entry %d has been modified since it was written" % i,
                )
            prev = e.entry_hash
        return ChainVerification(
            ok=True, entries=len(self._entries),
            detail="chain verified from genesis to head",
        )

    # --- persistence ------------------------------------------------------

    def save(self, path: str | Path) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as f:
            for e in self._entries:
                f.write(json.dumps(e.model_dump(mode="json"), sort_keys=True) + "\n")

    @classmethod
    def load(cls, path: str | Path) -> Ledger:
        led = cls()
        p = Path(path)
        if not p.exists():
            return led
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                led._entries.append(LedgerEntry.model_validate_json(line))
        return led
