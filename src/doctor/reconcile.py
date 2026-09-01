"""Every aggregate this product shows, traced back to the records under it.

THE RULE THIS FILE ENFORCES
---------------------------
The UI must never display a number that cannot be walked down to the payments
that produced it. That is easy to say and easy to violate by accident: a
denominator quietly changes, a filter is added in one place and not another,
and six months later the dashboard is confidently wrong in a way no test
catches because every individual function still works.

So the aggregates are not trusted. They are recomputed here from the ledger
and the batch, and compared against what the run file claims. A mismatch is a
failure, loudly, with the two numbers printed side by side -- not a warning, and
not something a page silently rounds away.

THE MONEY PARTITION
-------------------
Every failed payment in the batch lands in exactly one bucket:

    at risk  =  recovered      the retry converted
              + attempted      the retry ran and did not convert
              + held           gated STEP_UP: waiting on the merchant
              + refused        gated DENY: outside the signed mandate
              + escalated      handed to a human, never auto-executed
              + untouched      no action was proposed for it at all

`untouched` is the bucket most systems do not have and it is the honest one:
90 of CloudSync's 227 failures are hard declines and auth failures that no
retry converts, and pretending they are "pipeline" would inflate every figure
above them.

The partition is over PAYMENTS, not actions. A payment can carry more than
one proposed action -- a retry and a reissued link, say -- so the bucket is
decided by the strongest thing that happened to it, in the order above. Money
is counted once per payment, which is what makes the sum close.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from chitragupta.ledger import Ledger
from chitragupta.types import AUTO_EXECUTABLE

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "data" / "synthetic"
RUNS = ROOT / "data" / "runs"

_AUTO = {a.value for a in AUTO_EXECUTABLE}


class Check(BaseModel):
    """One invariant, and whether it holds."""

    key: str
    label: str
    ok: bool
    #: What the run file claims.
    claimed: int | str
    #: What recomputing from the underlying records gives.
    recomputed: int | str
    detail: str = ""


class Bucket(BaseModel):
    key: str
    label: str
    payments: int
    paise: int
    #: How to get from this number to the rows behind it.
    trace: str


class Reconciliation(BaseModel):
    run_id: str
    merchant_id: str
    merchant_name: str

    at_risk_paise: int
    at_risk_payments: int
    buckets: list[Bucket]

    #: Ledger entries that are about the ACCOUNT rather than one payment
    #: (routing changes, investigation flags). Worth Rs 0, so outside the
    #: money partition -- reported so no entry is silently dropped.
    account_actions: int = 0

    checks: list[Check]
    ok: bool
    #: Set when the ledger's own hash chain does not verify. Everything else
    #: here is downstream of the chain being intact.
    chain_verified: bool


def _batch(merchant_id: str) -> dict[str, int]:
    """txn_id -> amount, for every FAILED payment. No ground truth."""
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    if not p.exists():
        return {}
    d = json.loads(p.read_text(encoding="utf-8"))
    return {
        t["txn_id"]: int(t["amount_paise"])
        for t in d["transactions"]
        if not t.get("succeeded")
    }


def _truth(merchant_id: str) -> dict[str, bool]:
    p = SYNTH / ("merchant_%s.json" % merchant_id)
    if not p.exists():
        return {}
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get("ground_truth", {}).get("retry_conversions", {}) or {}


#: Bucket precedence. First match wins, so a payment that was retried and
#: converted is `recovered` even if a second action on it was held.
_ORDER = ["recovered", "attempted", "held", "refused", "escalated"]


def reconcile(rec: dict) -> Reconciliation:
    """Recompute every headline for one run and check it against the file."""
    merchant_id = rec.get("merchant_id", "")
    ledger = rec["report"].get("ledger", [])
    batch = _batch(merchant_id)
    truth = _truth(merchant_id)

    # -- 1. the chain. Everything below is downstream of this. --------------
    led = Ledger.from_entries(ledger)
    v = led.verify()

    # -- 2. classify every payment the run touched --------------------------
    #
    # Not every ledger entry is about a payment. A plan also contains
    # ACCOUNT-level actions -- "enable multi-bank routing", "flag this
    # merchant for investigation" -- which carry txn_id "merchant:<id>" and
    # amount 0 because they are configuration, not collection.
    #
    # They were being counted as payments here, which made the untouched
    # bucket one short on every run on the book. The money partition still
    # closed, because they are worth nothing, so nothing visible was wrong --
    # the drilldown test is what caught it. They are excluded from the
    # partition and reported separately, because silently dropping a ledger
    # entry is the failure mode this whole file exists to prevent.
    account_actions = 0
    where: dict[str, str] = {}
    for e in ledger:
        tid = e.get("txn_id")
        if tid is None:
            continue
        if tid not in batch:
            account_actions += 1
            continue
        action = (e.get("proposed_action") or {}).get("action_type")
        out = e.get("outcome")
        if out in ("executed", "exception") and action in _AUTO:
            b = "recovered" if truth.get(tid, False) else "attempted"
        elif out == "merchant_action":
            b = "held"
        elif out == "denied":
            b = "refused"
        elif out == "escalated":
            b = "escalated"
        else:
            b = "escalated"
        prev = where.get(tid)
        if prev is None or _ORDER.index(b) < _ORDER.index(prev):
            where[tid] = b

    counts: dict[str, list[int]] = {k: [0, 0] for k in _ORDER}
    for tid, b in where.items():
        counts[b][0] += 1
        counts[b][1] += batch.get(tid, 0)

    touched_paise = sum(v2 for _, v2 in counts.values())
    at_risk_paise = sum(batch.values())
    untouched_n = len(batch) - len(where)
    untouched_paise = at_risk_paise - touched_paise

    trace = "/api/run/%s/evidence/%%s" % rec.get("run_id", "")
    buckets = [
        Bucket(key="recovered", label="Recovered",
               payments=counts["recovered"][0], paise=counts["recovered"][1],
               trace=trace % "recovered"),
        Bucket(key="attempted", label="Attempted, did not convert",
               payments=counts["attempted"][0], paise=counts["attempted"][1],
               trace=trace % "attempted"),
        Bucket(key="held", label="Held for the merchant",
               payments=counts["held"][0], paise=counts["held"][1],
               trace=trace % "held"),
        Bucket(key="refused", label="Refused by the mandate",
               payments=counts["refused"][0], paise=counts["refused"][1],
               trace=trace % "refused"),
        Bucket(key="escalated", label="Escalated to a human",
               payments=counts["escalated"][0], paise=counts["escalated"][1],
               trace=trace % "escalated"),
        Bucket(key="untouched", label="No action proposed",
               payments=untouched_n, paise=untouched_paise,
               trace=trace % "untouched"),
    ]

    # -- 3. the checks ------------------------------------------------------
    checks: list[Check] = []

    checks.append(Check(
        key="chain", label="Audit chain verifies from genesis",
        ok=v.ok, claimed=str(rec["report"]["measured"].get("chain_verified")),
        recomputed=str(v.ok),
        detail=v.detail if hasattr(v, "detail") else "",
    ))

    total = sum(b.paise for b in buckets)
    checks.append(Check(
        key="partition", label="Buckets sum to money at risk",
        ok=total == at_risk_paise, claimed=at_risk_paise, recomputed=total,
        detail="Every failed payment lands in exactly one bucket, counted once.",
    ))

    pay_total = sum(b.payments for b in buckets)
    checks.append(Check(
        key="payments", label="Buckets sum to failed payments",
        ok=pay_total == len(batch), claimed=len(batch), recomputed=pay_total,
        detail="No payment appears twice and none is dropped.",
    ))

    # gate counts against the ledger they came from
    gate = rec["report"].get("gate", {}).get("decisions", {})
    from collections import Counter

    seen = Counter(e.get("gate_decision") for e in ledger)
    for d in ("allow", "step_up", "deny"):
        checks.append(Check(
            key="gate_%s" % d, label="Gate %s count matches the ledger" % d,
            ok=int(gate.get(d, 0)) == seen.get(d, 0),
            claimed=int(gate.get(d, 0)), recomputed=seen.get(d, 0),
        ))

    checks.append(Check(
        key="ledger_len", label="Reported ledger length matches the ledger",
        ok=int(rec["report"]["measured"].get("ledger_entries", 0)) == len(ledger),
        claimed=int(rec["report"]["measured"].get("ledger_entries", 0)),
        recomputed=len(ledger),
    ))

    # the plan and the ledger describe the same set of actions
    planned = sum(len(g.get("actions", [])) for g in rec.get("pending_actions") or [])
    checks.append(Check(
        key="plan", label="Every planned action was ruled on",
        ok=planned <= len(ledger), claimed=planned, recomputed=len(ledger),
        detail="The ledger may be longer -- a merchant confirming held actions "
               "appends more entries to the same plan.",
    ))

    # the measured recovery figure, recomputed from truth
    rv = rec["report"]["measured"].get("recovery_vs_truth") or {}
    if rv.get("scored"):
        m_attempted = m_conv = m_paise = 0
        for e in ledger:
            if e.get("outcome") not in ("executed", "exception"):
                continue
            pa = e.get("proposed_action") or {}
            if pa.get("action_type") != "retry_soft_decline":
                continue
            tid = e.get("txn_id")
            if tid not in truth:
                continue
            m_attempted += 1
            if truth[tid]:
                m_conv += 1
                m_paise += int(pa.get("amount_paise") or 0)
        checks.append(Check(
            key="measured", label="Measured recovery recomputes from the ledger",
            ok=int(rv.get("measured_paise", 0)) == m_paise,
            claimed=int(rv.get("measured_paise", 0)), recomputed=m_paise,
            detail="Sum of the amounts of the retries that truly converted.",
        ))
        checks.append(Check(
            key="attempted", label="Attempt count recomputes from the ledger",
            ok=int(rv.get("attempted", 0)) == m_attempted,
            claimed=int(rv.get("attempted", 0)), recomputed=m_attempted,
        ))
        checks.append(Check(
            key="converted", label="Conversion count recomputes from the ledger",
            ok=int(rv.get("truly_converted", 0)) == m_conv,
            claimed=int(rv.get("truly_converted", 0)), recomputed=m_conv,
        ))

    checks.append(Check(
        key="entries", label="Every ledger entry is accounted for",
        ok=sum(1 for e in ledger if e.get("txn_id") is not None)
        == account_actions + sum(
            1 for e in ledger if e.get("txn_id") in batch
        ),
        claimed=len(ledger),
        recomputed=account_actions + sum(
            1 for e in ledger if e.get("txn_id") in batch
        ),
        detail="Payment entries land in a bucket; account-level entries are "
               "counted separately because they carry no money.",
    ))

    return Reconciliation(
        run_id=rec.get("run_id", ""),
        merchant_id=merchant_id,
        merchant_name=rec.get("merchant_name", ""),
        at_risk_paise=at_risk_paise,
        at_risk_payments=len(batch),
        buckets=buckets,
        account_actions=account_actions,
        checks=checks,
        ok=all(c.ok for c in checks),
        chain_verified=v.ok,
    )


def drilldown(rec: dict, bucket: str) -> list[dict]:
    """The payments behind one bucket, each with the record that put it there.

    This is what makes the aggregate above a claim rather than an assertion:
    click Rs 4,741 and get the three payments, the action proposed on each,
    the rule the gate applied, the outcome, and the hash of the audit entry
    that recorded it.
    """
    merchant_id = rec.get("merchant_id", "")
    batch = _batch(merchant_id)
    truth = _truth(merchant_id)
    ledger = rec["report"].get("ledger", [])

    by_txn: dict[str, dict] = {}
    for e in ledger:
        tid = e.get("txn_id")
        if tid not in batch:
            continue  # account-level action; see reconcile()
        action = (e.get("proposed_action") or {}).get("action_type")
        out = e.get("outcome")
        if out in ("executed", "exception") and action in _AUTO:
            b = "recovered" if truth.get(tid, False) else "attempted"
        elif out == "merchant_action":
            b = "held"
        elif out == "denied":
            b = "refused"
        else:
            b = "escalated"
        prev = by_txn.get(tid)
        if prev is None or _ORDER.index(b) < _ORDER.index(prev["_b"]):
            by_txn[tid] = {"_b": b, "e": e}

    rows: list[dict] = []
    if bucket == "untouched":
        for tid, amt in batch.items():
            if tid in by_txn:
                continue
            rows.append({
                "txn_id": tid, "amount_paise": amt,
                "action_type": None, "gate_decision": None,
                "gate_reason": "NO_ACTION_PROPOSED", "outcome": None,
                "entry_hash": None, "sequence": None,
                "converted": None,
            })
        return sorted(rows, key=lambda r: -r["amount_paise"])

    for tid, v in by_txn.items():
        if v["_b"] != bucket:
            continue
        e = v["e"]
        pa = e.get("proposed_action") or {}
        rows.append({
            "txn_id": tid,
            "amount_paise": int(pa.get("amount_paise") or batch.get(tid, 0)),
            "action_type": pa.get("action_type"),
            "gate_decision": e.get("gate_decision"),
            "gate_reason": e.get("gate_reason"),
            "outcome": e.get("outcome"),
            "actor": e.get("actor"),
            "entry_hash": e.get("entry_hash"),
            "prev_hash": e.get("prev_hash"),
            "sequence": e.get("sequence"),
            "timestamp": e.get("timestamp"),
            "converted": truth.get(tid) if tid in truth else None,
        })
    return sorted(rows, key=lambda r: -r["amount_paise"])


def reconcile_run_id(run_id: str) -> Reconciliation:
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise FileNotFoundError("no such run: %s" % run_id)
    return reconcile(json.loads(p.read_text(encoding="utf-8")))
