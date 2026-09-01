"""Diagnose a month of payments the engine has never seen.

`ingest_npci` swaps the bank baseline the engine measures against. This does
the other half: it takes a merchant's own payments and runs the decomposition
over them.

The scope is deliberately narrower than a demo merchant's. An upload gets a
DIAGNOSIS -- the gap, what is causing it, how big each cause is -- and nothing
else. It gets no recovery figure and no proposed actions, for two reasons that
are worth stating rather than discovering:

  * there is no ground truth for uploaded payments, so nothing here can be
    MEASURED. Every figure is projected, and quoting a recovery number beside
    the marked ones on the rest of the app would blur the one distinction the
    whole project rests on
  * acting needs a mandate signed by the merchant's own key, which this
    process does not hold and must never hold. A file upload is not
    authorisation, and treating it as one would make the policy kernel
    decorative

Error codes are classified from the hand-labelled taxonomy of Razorpay's 110
published codes -- a dictionary lookup, no model call, no cost, no latency. A
code outside that list is carried as unclassified rather than guessed at.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from pydantic import BaseModel

from .classify import LABELS_PATH
from .features import ErrorClass, Method, Transaction

#: Names people actually use for the same column, lowercased.
ALIASES: dict[str, tuple[str, ...]] = {
    "bank": ("bank", "issuer", "bank_name", "issuing_bank", "remitter_bank"),
    "method": ("method", "payment_method", "mode", "instrument"),
    "amount": ("amount_paise", "amount", "amount_inr", "value", "txn_amount"),
    "succeeded": ("succeeded", "success", "status", "is_success", "result"),
    "error_code": ("error_code", "error", "failure_reason", "reason", "error_reason"),
    "hour": ("hour", "hour_of_day", "created_hour"),
    "day": ("day", "day_of_month"),
    "txn_id": ("txn_id", "id", "payment_id", "transaction_id", "order_id"),
}

METHODS = {
    "upi": Method.UPI,
    "card": Method.CARD,
    "cards": Method.CARD,
    "credit_card": Method.CARD,
    "debit_card": Method.CARD,
    "netbanking": Method.NETBANKING,
    "net_banking": Method.NETBANKING,
    "nb": Method.NETBANKING,
    "upi_mandate": Method.UPI_MANDATE,
    "autopay": Method.UPI_MANDATE,
    "emandate": Method.UPI_MANDATE,
}

TRUE = {"1", "true", "yes", "y", "success", "captured", "paid", "authorized", "authorised"}
FALSE = {"0", "false", "no", "n", "failed", "failure", "declined", "error"}

#: Enough payments for the decomposition to say anything. Below this the
#: Wilson interval is wider than the effects being attributed, and the honest
#: answer is that the data cannot resolve a cause.
MIN_ROWS = 200
MAX_BYTES = 12_000_000


class Rejected(Exception):
    """A refusal that names the row and the reason."""


class TxnSummary(BaseModel):
    rows: int
    used: int
    skipped: int
    failures: int
    success_pct: float
    banks: int
    methods: dict[str, int]
    classified: dict[str, int]
    unclassified_codes: list[str]
    notes: list[str]


def _taxonomy() -> dict[str, str]:
    """code -> error class, from the hand-labelled file. No model involved."""
    try:
        d = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {row["code"]: row["category"] for row in d.get("labels", [])}


def _pick(header: list[str]) -> dict[str, str]:
    """Map our field names onto whatever this file happens to call them."""
    lower = {h.strip().lower(): h for h in header}
    found: dict[str, str] = {}
    for field, names in ALIASES.items():
        for n in names:
            if n in lower:
                found[field] = lower[n]
                break
    return found


def _truthy(raw: str) -> bool | None:
    v = (raw or "").strip().lower()
    if v in TRUE:
        return True
    if v in FALSE:
        return False
    return None


def parse(raw: bytes, merchant_id: str = "uploaded", mcc: str = "5411") -> tuple[list[Transaction], TxnSummary]:
    """Read a merchant's payments into the engine's own transaction type."""
    if len(raw) > MAX_BYTES:
        raise Rejected("file is larger than %d MB" % (MAX_BYTES // 1_000_000))
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise Rejected("file is not UTF-8 text -- export it as CSV, not XLSX")

    reader = csv.DictReader(io.StringIO(text))
    header = list(reader.fieldnames or [])
    if not header:
        raise Rejected("that file has no header row")

    cols = _pick(header)
    missing = [f for f in ("bank", "method", "amount", "succeeded") if f not in cols]
    if missing:
        raise Rejected(
            "could not find a column for: %s. Found: %s"
            % (", ".join(missing), ", ".join(header[:10]))
        )

    tax = _taxonomy()
    txns: list[Transaction] = []
    notes: list[str] = []
    skipped = 0
    rows = 0
    methods: dict[str, int] = {}
    classified: dict[str, int] = {}
    unknown: set[str] = set()

    for n, row in enumerate(reader, start=2):
        rows += 1
        try:
            method_raw = (row.get(cols["method"]) or "").strip().lower()
            method = METHODS.get(method_raw)
            if method is None:
                raise ValueError("unknown method %r" % method_raw)

            ok = _truthy(row.get(cols["succeeded"], ""))
            if ok is None:
                raise ValueError("cannot read %r as success/failure" % row.get(cols["succeeded"]))

            amt = float(row.get(cols["amount"]) or 0)
            # A column named for rupees is in rupees. Everything else is
            # assumed to be paise, which is how this engine stores money.
            if "inr" in cols["amount"].lower() or cols["amount"].lower() == "amount":
                amt *= 100
            amount_paise = max(1, int(round(amt)))

            hour = int(float(row.get(cols.get("hour", ""), "") or 12)) % 24
            day = int(float(row.get(cols.get("day", ""), "") or 1))
            day = min(max(day, 1), 31)

            code = (row.get(cols.get("error_code", ""), "") or "").strip() or None
            ecls = None
            if not ok and code:
                cat = tax.get(code)
                if cat:
                    ecls = ErrorClass(cat)
                    classified[cat] = classified.get(cat, 0) + 1
                else:
                    unknown.add(code)

            txns.append(
                Transaction(
                    txn_id=(row.get(cols.get("txn_id", ""), "") or "row_%d" % n).strip()
                    or "row_%d" % n,
                    merchant_id=merchant_id,
                    mcc=mcc,
                    bank=(row.get(cols["bank"]) or "").strip() or "Unknown Bank",
                    method=method,
                    hour=hour,
                    day=day,
                    amount_paise=amount_paise,
                    succeeded=ok,
                    error_code=code,
                    error_class=ecls,
                )
            )
            methods[method.value] = methods.get(method.value, 0) + 1
        except Exception as e:
            skipped += 1
            if len(notes) < 4:
                notes.append("row %d: %s" % (n, str(e)[:90]))

    if len(txns) < MIN_ROWS:
        raise Rejected(
            "only %d usable payment%s. Below about %d the uncertainty on a "
            "success rate is wider than the effects being attributed, so a "
            "diagnosis would be noise. %s"
            % (
                len(txns),
                "" if len(txns) == 1 else "s",
                MIN_ROWS,
                ("Skipped rows: " + "; ".join(notes)) if notes else "",
            )
        )

    failures = sum(1 for t in txns if not t.succeeded)
    summary = TxnSummary(
        rows=rows,
        used=len(txns),
        skipped=skipped,
        failures=failures,
        success_pct=round(100 * (len(txns) - failures) / len(txns), 3),
        banks=len({t.bank for t in txns}),
        methods=methods,
        classified=classified,
        unclassified_codes=sorted(unknown)[:8],
        notes=notes,
    )
    return txns, summary


def diagnose(txns: list[Transaction], mcc: str) -> dict[str, Any]:
    """The decomposition, and nothing that would need authority to do.

    No recovery figure and no proposed actions: there is no ground truth for
    an uploaded file, so nothing here can be measured, and acting would need a
    mandate this process does not hold.
    """
    from .baseline import Baseline
    from .cohort import build_cohort
    from .shapley import ShapleyDecomposer

    b = Baseline()
    cohort = build_cohort(mcc, b)
    dec = ShapleyDecomposer(b, cohort).decompose(txns)

    identified = {a.factor for a in dec.identified()}
    factors = sorted(
        (
            {
                "factor": name,
                "points": round(pts, 3),
                "identified": name in identified,
            }
            for name, pts in dec.by_factor().items()
        ),
        key=lambda x: -abs(x["points"]),
    )
    return {
        "observed_pct": round(100 * dec.s_obs, 3),
        "achievable_pct": round(100 * dec.s_star, 3),
        "gap_pts": round(dec.gap_pts, 3),
        "process_gap_pts": round(dec.process_gap_pts, 3),
        "primary_cause": dec.primary_cause(),
        "factors": factors,
        "coalition_values": {k: round(v, 4) for k, v in dec.coalition_values.items()},
        "reliable": dec.reliable,
        "degenerate_factors": dec.degenerate_factors,
        "cohort_family": cohort.family,
    }
