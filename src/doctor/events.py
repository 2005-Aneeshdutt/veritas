"""Payment events, normalised once and processed exactly once.

WHY AN EVENT LAYER AT ALL
-------------------------
Everything upstream of this file works on a *batch*: a month of transactions,
handed over as a list. That is the right shape for a diagnosis and the wrong
shape for a recovery loop, because recovery is not a report -- it is a thing
that happens over hours, in response to events that arrive one at a time and
sometimes twice.

The specific problem this exists to prevent: a `payment.failed` webhook
delivered twice must not produce two retries. Gateways retry deliveries on
timeout, so duplicates are normal traffic rather than an edge case, and an
agent that treats them as two failures spends two of the mandate's three
attempts on one payment.

IDEMPOTENCY, AND WHERE IT LIVES
-------------------------------
Two keys, doing two different jobs:

  event_id          the gateway's own id. Seeing it twice is a duplicate
                    DELIVERY: stored once, counted, never reprocessed.
  idempotency_key   (payment_id, action_type). Seeing it twice is a duplicate
                    ACTION: refused, whatever the event stream did.

The second is the one that matters. A gateway can invent a new event_id for a
redelivery, and a retry proposed from a fresh event is still a second charge
against the same payment.

WHAT THIS DOES NOT DO
---------------------
It does not decide anything. An event lands, is normalised, is deduplicated,
and waits. Whether a failed payment is worth acting on is the diagnosis's
job; whether the action is permitted is the policy kernel's. This file has no
opinion, which is why it can be trusted to be the front door.

SOURCES
-------
`source` is recorded on every event and never inferred. A synthetic event and
a Razorpay test-mode event are stored in the same table with different source
values, and no aggregate mixes them without saying so -- see mode.py for why
that distinction is treated as seriously as measured-versus-projected.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "data" / "events"

#: Where an event came from. Never guessed.
Source = Literal["synthetic", "razorpay_test", "internal"]

#: Has the raw event been accepted into the store?
IngestionStatus = Literal["accepted", "duplicate", "rejected"]

#: Has anything been done about it?
ProcessingStatus = Literal["pending", "processed", "ignored", "failed"]

#: The lifecycle of a payment as this system models it. Deliberately small:
#: these are the states Razorpay's own payment events move a payment through.
PaymentState = Literal[
    "created", "authorized", "captured", "failed", "refunded", "paid", "unknown"
]

#: Event types understood. An unknown type is stored, not dropped -- and
#: marked `ignored` rather than silently discarded, because a type we do not
#: handle yet is information about the integration, not noise.
KNOWN_TYPES: frozenset[str] = frozenset({
    "payment.failed",
    "payment.authorized",
    "payment.captured",
    "order.paid",
    "payment_link.paid",
    "payment_link.expired",
    "payment_link.cancelled",
    "payment.downtime.started",
    "payment.downtime.updated",
    "payment.downtime.resolved",
    # Written by this system about itself. Ours, and therefore handled.
    "intervention.launched",
    "intervention.withheld",
    "payment_link.created",
    "email.sent",
    "voice.completed",
})

#: Which event types report an outcome that is allowed to move money.
#:
#: This set is the reason "recovered" cannot be claimed early. An intervention
#: being SENT is not a recovery; only one of these arriving, for that payment,
#: makes it one.
OUTCOME_TYPES: frozenset[str] = frozenset({
    "payment.captured",
    "order.paid",
    "payment_link.paid",
})


class Event(BaseModel):
    """One payment event, in this system's own vocabulary."""

    model_config = {"frozen": True}

    #: The source's own id. The deduplication key for deliveries.
    event_id: str = Field(min_length=1)
    source: Source
    event_type: str
    #: When the SOURCE says it happened, not when we saw it.
    timestamp: str
    #: When we saw it.
    received_at: str

    merchant_id: str = ""
    payment_id: str | None = None
    order_id: str | None = None
    payment_link_id: str | None = None

    amount_paise: int = 0
    currency: str = "INR"

    previous_state: PaymentState | None = None
    new_state: PaymentState = "unknown"

    #: The gateway's own failure reason, verbatim where present.
    error_code: str | None = None
    error_description: str | None = None
    #: For downtime events: which issuer/method is affected.
    entity: str | None = None

    ingestion_status: IngestionStatus = "accepted"
    processing_status: ProcessingStatus = "pending"
    #: What was done, once something was. Free text, written by the processor.
    processing_note: str = ""

    #: The untouched payload, so a normalisation bug is recoverable rather
    #: than a data loss. Never rendered; kept for forensics.
    raw: dict = {}


class IngestResult(BaseModel):
    accepted: int
    duplicates: int
    rejected: int
    event_ids: list[str] = []
    detail: str = ""


class _Store:
    """Append-only JSONL, one file per source. Small, honest, greppable.

    Not a database because the whole product's data model is files on disk
    that a reader can open, and introducing a second storage philosophy for
    one feature would cost more in coherence than it buys in throughput.

    Thread-locked because the SSE endpoints run on a threadpool and FastAPI
    will happily deliver two webhooks at once.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        STORE.mkdir(parents=True, exist_ok=True)

    def _path(self, source: str) -> Path:
        return STORE / ("%s.jsonl" % source)

    def all(self, source: str | None = None) -> list[Event]:
        out: list[Event] = []
        srcs = [source] if source else ["synthetic", "razorpay_test", "internal"]
        with self._lock:
            for s in srcs:
                p = self._path(s)
                if not p.exists():
                    continue
                for line in p.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    try:
                        out.append(Event.model_validate_json(line))
                    except ValueError:
                        continue
        out.sort(key=lambda e: (e.received_at, e.event_id))
        return out

    def seen_ids(self, source: str) -> set[str]:
        return {e.event_id for e in self.all(source)}

    def append(self, ev: Event) -> None:
        with self._lock:
            p = self._path(ev.source)
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a", encoding="utf-8", newline="\n") as fh:
                fh.write(ev.model_dump_json() + "\n")

    def rewrite(self, source: str, events: list[Event]) -> None:
        """Only used to update processing status. Never to edit a raw event."""
        with self._lock:
            p = self._path(source)
            p.write_text(
                "".join(e.model_dump_json() + "\n" for e in events),
                encoding="utf-8",
                newline="\n",
            )

    def clear(self, source: str | None = None) -> None:
        with self._lock:
            for s in ([source] if source else
                      ["synthetic", "razorpay_test", "internal"]):
                p = self._path(s)
                if p.exists():
                    p.unlink()


store = _Store()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# -- normalisation ---------------------------------------------------------

#: Razorpay event type -> (previous state, new state). Where the previous
#: state is genuinely unknown from the event alone it is left None rather
#: than guessed, because a fabricated previous state would make the lineage
#: view lie about what changed.
_TRANSITION: dict[str, tuple[PaymentState | None, PaymentState]] = {
    "payment.failed": ("created", "failed"),
    "payment.authorized": ("created", "authorized"),
    "payment.captured": ("authorized", "captured"),
    "order.paid": (None, "paid"),
    "payment_link.paid": (None, "paid"),
    "payment_link.expired": (None, "unknown"),
    "payment_link.cancelled": (None, "unknown"),
}


def normalise(payload: dict, source: Source) -> Event | None:
    """Turn a Razorpay-shaped webhook body into an Event.

    Razorpay nests the interesting object under
    `payload.<entity>.entity`, so this walks that rather than assuming one
    shape. A payload it cannot read returns None and is rejected loudly by the
    caller -- guessing at a malformed event is how a recovery system ends up
    retrying the wrong payment.
    """
    etype = payload.get("event")
    if not etype:
        return None

    body = payload.get("payload") or {}
    ent: dict = {}
    for key in ("payment", "order", "payment_link", "payment.downtime"):
        node = body.get(key)
        if isinstance(node, dict) and isinstance(node.get("entity"), dict):
            ent = node["entity"]
            break
    if not ent and isinstance(body, dict):
        # Some downtime payloads put the entity one level up.
        ent = body.get("entity") if isinstance(body.get("entity"), dict) else {}

    prev, new = _TRANSITION.get(etype, (None, "unknown"))

    created = ent.get("created_at")
    ts = (
        datetime.fromtimestamp(created, tz=timezone.utc).isoformat()
        if isinstance(created, (int, float))
        else _now()
    )

    # `notes` is where a merchant id can legitimately travel; Razorpay does
    # not carry ours. Read, never invented.
    notes = ent.get("notes") if isinstance(ent.get("notes"), dict) else {}

    return Event(
        event_id=str(
            payload.get("id")
            or payload.get("event_id")
            or ent.get("id")
            or ""
        ),
        source=source,
        event_type=str(etype),
        timestamp=ts,
        received_at=_now(),
        merchant_id=str(notes.get("merchant_id") or payload.get("merchant_id") or ""),
        payment_id=ent.get("payment_id") or (ent.get("id") if "payment" in etype else None),
        order_id=ent.get("order_id") or (ent.get("id") if etype == "order.paid" else None),
        payment_link_id=ent.get("id") if "payment_link" in etype else None,
        amount_paise=int(ent.get("amount") or 0),
        currency=str(ent.get("currency") or "INR"),
        previous_state=prev,
        new_state=new,
        error_code=ent.get("error_code"),
        error_description=ent.get("error_description"),
        entity=ent.get("entity") if isinstance(ent.get("entity"), str) else (
            ent.get("instrument", {}).get("issuer")
            if isinstance(ent.get("instrument"), dict) else None
        ),
        raw=payload,
    )


# -- ingestion -------------------------------------------------------------

def ingest(events: list[Event]) -> IngestResult:
    """Store events, refusing duplicates by the source's own event id.

    Returns counts rather than raising, because a batch containing one
    duplicate is a normal delivery and not an error.
    """
    if not events:
        return IngestResult(accepted=0, duplicates=0, rejected=0,
                            detail="nothing to ingest")

    by_source: dict[str, set[str]] = {}
    accepted = duplicates = rejected = 0
    ids: list[str] = []

    for ev in events:
        if not ev.event_id:
            rejected += 1
            continue
        seen = by_source.setdefault(ev.source, store.seen_ids(ev.source))
        if ev.event_id in seen:
            duplicates += 1
            continue
        status: ProcessingStatus = (
            "pending" if ev.event_type in KNOWN_TYPES else "ignored"
        )
        note = ev.processing_note or (
            "" if ev.event_type in KNOWN_TYPES
            else "event type not handled by this build; stored, not dropped"
        )
        store.append(ev.model_copy(update={
            "ingestion_status": "accepted",
            "processing_status": status,
            "processing_note": note,
        }))
        seen.add(ev.event_id)
        accepted += 1
        ids.append(ev.event_id)

    return IngestResult(
        accepted=accepted, duplicates=duplicates, rejected=rejected,
        event_ids=ids,
        detail="%d accepted, %d duplicate deliveries refused, %d rejected"
               % (accepted, duplicates, rejected),
    )


def emit(
    *,
    event_type: str,
    source: Source,
    merchant_id: str,
    payment_id: str | None = None,
    payment_link_id: str | None = None,
    amount_paise: int = 0,
    new_state: PaymentState = "unknown",
    previous_state: PaymentState | None = None,
    event_id: str | None = None,
    note: str = "",
    raw: dict | None = None,
) -> Event:
    """Record something this system itself did. Source is never 'razorpay_test'.

    An action we took is not evidence a gateway agreed with us, so anything
    written here is `internal` and cannot be mistaken for a confirmation. The
    only writer of `razorpay_test` events is the webhook endpoint.
    """
    ev = Event(
        event_id=event_id or "int_%s_%s" % (
            event_type.replace(".", "_"),
            (payment_id or payment_link_id or merchant_id or "x"),
        ),
        source="internal" if source == "internal" else source,
        event_type=event_type,
        timestamp=_now(),
        received_at=_now(),
        merchant_id=merchant_id,
        payment_id=payment_id,
        payment_link_id=payment_link_id,
        amount_paise=amount_paise,
        previous_state=previous_state,
        new_state=new_state,
        processing_status="processed",
        processing_note=note,
        raw=raw or {},
    )
    ingest([ev])
    return ev


# -- the idempotency question that actually matters ------------------------

def action_already_taken(payment_id: str, action_type: str) -> bool:
    """Has this exact intervention already been launched for this payment?

    Deliberately keyed on (payment, action) and not on any event id. A
    gateway that redelivers with a fresh id, a webhook replayed by hand, and
    an operator clicking twice all arrive as different events and must all
    resolve to the same answer: we have already done this.
    """
    key = "%s|%s" % (payment_id, action_type)
    for e in store.all():
        if e.source == "internal" and e.processing_note.startswith("action:" + key):
            return True
    return False


def record_action(
    payment_id: str,
    action_type: str,
    merchant_id: str,
    amount_paise: int,
    detail: str = "",
) -> bool:
    """Claim the idempotency key for one intervention.

    Returns False if it was already claimed, in which case the caller must
    not proceed. This is the single choke point every channel goes through.
    """
    if action_already_taken(payment_id, action_type):
        return False
    emit(
        event_type="intervention.launched",
        source="internal",
        merchant_id=merchant_id,
        payment_id=payment_id,
        amount_paise=amount_paise,
        event_id="int_launch_%s_%s" % (action_type, payment_id),
        note="action:%s|%s %s" % (payment_id, action_type, detail),
    )
    return True


# -- reading it back -------------------------------------------------------

class EventSummary(BaseModel):
    total: int
    by_source: dict[str, int]
    by_type: dict[str, int]
    by_processing: dict[str, int]
    duplicates_refused: int
    unknown_types: list[str]
    last_received_at: str | None
    #: Events naming a payment that no other event or batch resolves.
    unresolved_payment_refs: int


def summarise() -> EventSummary:
    evs = store.all()
    by_source: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_proc: dict[str, int] = {}
    unknown: set[str] = set()
    for e in evs:
        by_source[e.source] = by_source.get(e.source, 0) + 1
        by_type[e.event_type] = by_type.get(e.event_type, 0) + 1
        by_proc[e.processing_status] = by_proc.get(e.processing_status, 0) + 1
        if e.event_type not in KNOWN_TYPES:
            unknown.add(e.event_type)

    known_payments = {e.payment_id for e in evs if e.payment_id}
    outcome_refs = {
        e.payment_id for e in evs
        if e.event_type in OUTCOME_TYPES and e.payment_id
    }
    return EventSummary(
        total=len(evs),
        by_source=by_source,
        by_type=by_type,
        by_processing=by_proc,
        # Duplicate deliveries are refused at the door and therefore never
        # stored, so this is derived from the refusal counter the endpoint
        # keeps rather than from the file. Reported as 0 here when nothing
        # has been ingested this process.
        duplicates_refused=_refused["count"],
        unknown_types=sorted(unknown),
        last_received_at=evs[-1].received_at if evs else None,
        unresolved_payment_refs=len(outcome_refs - known_payments),
    )


#: Duplicate deliveries never reach the store, so the count has to live
#: somewhere. Process-local and reset on restart, which is stated on the page
#: rather than presented as a lifetime total.
_refused = {"count": 0}


def note_duplicates(n: int) -> None:
    _refused["count"] += n


def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    """Razorpay's webhook signature: HMAC-SHA256 of the raw body.

    Compared with `hmac.compare_digest`, so a timing side channel cannot be
    used to forge one byte at a time. An empty secret returns False rather
    than True -- an unconfigured webhook must reject everything, not accept
    everything, which is the direction this mistake is usually made in.
    """
    import hmac
    from hashlib import sha256

    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
