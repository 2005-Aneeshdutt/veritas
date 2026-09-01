"""The write-off, aggregated across the book, sorted by who has to act.

`fault.py` answers "whose move is it?" for one merchant's unrecoverable
payments. This asks it of every merchant at once, and the change of scope
changes what the answer is FOR.

One merchant seeing twelve `beneficiary_account_does_not_exist` sees noise --
a dozen bad account numbers, nothing to do. The same code across six merchants
in one month is a signal about the rail, and the only party who can see it is
the platform, because no merchant can see anyone else's failures. That is the
asymmetry this page exists to exploit: a defect backlog is a thing only
Razorpay can build, and it falls out of data the report already computes.

Three properties worth stating, because they are what make it usable rather
than merely interesting:

  * every rupee here is MEASURED, not projected. These are payments that
    already failed for a reason the taxonomy says is not retryable. The rest
    of the product carries an error bar because it forecasts what a retry
    would do; nothing here forecasts anything, so nothing here has one
  * the attribution is Razorpay's own. `owner_of` reads the published
    `next_steps` wording, so a code whose guidance says "reach out to
    Razorpay" is the platform's by Razorpay's account, not ours
  * codes whose wording is ambiguous come out `unknown` and are reported as
    unknown. A backlog padded with maybes is a backlog nobody works

The merchant's own share is separated for the same reason it is in `fault`:
it is the only part a reader can go and fix this afternoon.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from .fault import OWNER_LABEL, PLATFORM

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data" / "runs"

#: A code has to hit more than one merchant before it is evidence about the
#: rail rather than about a merchant. Below this it stays in the totals but is
#: not called systemic -- one merchant's integration is not a platform defect,
#: and shipping a backlog that says otherwise wastes an engineer's afternoon.
SYSTEMIC_MERCHANTS = 2


class DefectCode(BaseModel):
    code: str
    owner: str
    count: int
    total_paise: int
    #: How many merchants in the book saw it. The number that separates a
    #: platform defect from a merchant's bad month.
    merchants: int
    merchant_names: list[str]
    #: Razorpay's own words, so nobody is reading our paraphrase of their API.
    next_steps: str
    explanation: str
    systemic: bool


class OwnerGroup(BaseModel):
    owner: str
    label: str
    count: int
    total_paise: int
    share_pct: float
    codes: list[DefectCode]


class Backlog(BaseModel):
    merchants: int
    #: Every unrecoverable payment across the book, and what it was worth.
    total_count: int
    total_paise: int
    groups: list[OwnerGroup]
    #: The platform's slice, pulled out because it is the one nobody else in
    #: the ecosystem is in a position to compute.
    platform_paise: int
    platform_share_pct: float
    platform_codes: list[DefectCode]
    systemic_codes: int


def _runs() -> list[dict]:
    """Newest saved run per merchant, stubs excluded."""
    best: dict[str, tuple[float, dict]] = {}
    for p in RUNS.glob("run_*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if rec.get("used_stubs") or not rec.get("merchant_id"):
            continue
        mt = p.stat().st_mtime
        mid = rec["merchant_id"]
        if mid not in best or mt > best[mid][0]:
            best[mid] = (mt, rec)
    return [v[1] for v in best.values()]


def build_backlog() -> Backlog:
    """Aggregate every run's fault attribution into one queue."""
    runs = _runs()

    owners: dict[str, dict] = {}
    codes: dict[tuple[str, str], dict] = {}
    total_paise = total_count = 0

    for rec in runs:
        name = rec.get("merchant_name") or rec.get("merchant_id", "?")
        groups = rec.get("report", {}).get("exceptions", {}).get(
            "unrecoverable_by_fault", []
        )
        for g in groups:
            who = g.get("owner", "unknown")
            o = owners.setdefault(who, {"count": 0, "paise": 0})
            o["count"] += int(g.get("count", 0))
            o["paise"] += int(g.get("total_paise", 0))
            total_count += int(g.get("count", 0))
            total_paise += int(g.get("total_paise", 0))

            for c in g.get("codes", []):
                key = (who, c["code"])
                row = codes.setdefault(
                    key,
                    {
                        "count": 0,
                        "paise": 0,
                        "merchants": set(),
                        "next_steps": (c.get("next_steps") or "").strip(),
                        "explanation": (c.get("explanation") or "").strip(),
                    },
                )
                row["count"] += int(c.get("count", 0))
                row["paise"] += int(c.get("total_paise", 0))
                row["merchants"].add(name)

    def code_rows(who: str) -> list[DefectCode]:
        rows = [
            DefectCode(
                code=code,
                owner=owner,
                count=v["count"],
                total_paise=v["paise"],
                merchants=len(v["merchants"]),
                merchant_names=sorted(v["merchants"]),
                next_steps=v["next_steps"],
                explanation=v["explanation"],
                systemic=len(v["merchants"]) >= SYSTEMIC_MERCHANTS,
            )
            for (owner, code), v in codes.items()
            if owner == who
        ]
        rows.sort(key=lambda r: -r.total_paise)
        return rows

    def share(paise: int) -> float:
        return round(100 * paise / total_paise, 2) if total_paise else 0.0

    # Same order as the per-merchant view: what the reader can fix, then what
    # the platform can fix, then what neither can.
    order = {"merchant": 0, "platform": 1, "customer": 2, "unknown": 3}
    groups = sorted(
        (
            OwnerGroup(
                owner=who,
                label=OWNER_LABEL.get(who, who),
                count=o["count"],
                total_paise=o["paise"],
                share_pct=share(o["paise"]),
                codes=code_rows(who),
            )
            for who, o in owners.items()
        ),
        key=lambda g: (order.get(g.owner, 9), -g.total_paise),
    )

    platform = code_rows(PLATFORM)
    return Backlog(
        merchants=len(runs),
        total_count=total_count,
        total_paise=total_paise,
        groups=groups,
        platform_paise=owners.get(PLATFORM, {}).get("paise", 0),
        platform_share_pct=share(owners.get(PLATFORM, {}).get("paise", 0)),
        platform_codes=platform,
        systemic_codes=sum(1 for c in platform if c.systemic),
    )
