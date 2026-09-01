"""FastAPI backend.  uvicorn doctor.api:app --reload --port 8000

Serves the frontend three things: the merchant catalogue, completed run
reports, and a live SSE stream of NodeTrace objects as the graph executes.

Replay is a first-class mode, not a fallback. Because runs are deterministic
and LLM responses are cached, a saved run replays exactly -- so the demo video
needs no live API calls, and a panellist can open the deployed frontend and
watch a real recorded run with no key. It is labelled REPLAY so nobody can
claim it is pretending to be live.

SSE rather than WebSocket: the stream is one-way, it is far simpler, and it
reconnects for free.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import queue
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from chitragupta.rails.mock_rail import Calibration

from fastapi.responses import PlainTextResponse

from doctor.apply import apply_group
from doctor.approvals import TokenError, read as read_token
from doctor.assistant import ask as assistant_ask
from doctor.authority import draft as authority_draft, review as authority_review
from doctor.claims import read_note
from doctor.baseline import Baseline
from doctor.budget import build_budget
from doctor.defects import build_backlog
from doctor.drift import build_drift_report, simulate_exposure
from doctor.outreach import (
    as_eml,
    compose,
    default_recipient,
    send,
    smtp_configured,
    verify as smtp_verify,
)
from doctor.portfolio import build_portfolio, ledger_csv, portfolio_csv
from doctor.generator import GeneratedMerchant
from doctor.graph import git_commit, run_diagnosis
from doctor.helpdesk import ask as helpdesk_ask
from doctor.journey import build as build_journey, candidates as journey_candidates
from doctor.cohort import build_cohort
from doctor.ingest_npci import Rejected, baseline_from, parse as parse_npci
from doctor.ingest_txns import Rejected as TxnRejected, diagnose as diagnose_txns, parse as parse_txns
from doctor.shapley import ShapleyDecomposer
from doctor.live import LiveMonitor, in_arrival_order
from doctor.prove import (
    CATEGORIES,
    CAUSES,
    blind_batch,
    compose_adversarial,
    load_challenge,
    new_challenge,
    score,
)
from doctor.llm import MODEL_FAST, MODEL_REASONING
from doctor.run import load_mandate, load_merchant
from doctor.trace import RunRecord

SYNTH = ROOT / "data" / "synthetic"
RUNS = ROOT / "data" / "runs"
RESULTS = ROOT / "evals" / "results"
DOCS = ROOT / "docs"

app = FastAPI(title="Revenue Doctor", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MERCHANTS = [
    "quickmart",
    "cloudsync",
    "techbazaar",
    "chaipoint",
    "medisure",
    "voltbill",
    "urbanthread",
    "fuelstop",
]


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "commit": git_commit(),
        "models": {"fast": MODEL_FAST, "reasoning": MODEL_REASONING, "temperature": 0},
        "sweep_present": (RESULTS / "attribution_mae_by_factor.json").exists(),
        "smtp_configured": smtp_configured(),
        # Newest first. Sorting by name would be alphabetical on a random
        # hex id, which is how a demo ends up opening a months-old run.
        "runs_available": [
            p.stem
            for p in sorted(
                RUNS.glob("run_*.json"), key=lambda q: q.stat().st_mtime, reverse=True
            )
        ],
    }


@app.get("/api/merchants")
def merchants() -> list[dict]:
    out = []
    for name in MERCHANTS:
        p = SYNTH / ("merchant_%s.json" % name)
        if not p.exists():
            continue
        m = GeneratedMerchant.model_validate_json(p.read_text(encoding="utf-8"))
        fails = [t for t in m.transactions if not t.succeeded]
        out.append(
            {
                "merchant_id": m.profile.merchant_id,
                "name": m.profile.name,
                "mcc": m.profile.mcc,
                "mcc_description": m.profile.mcc_description,
                "transactions": len(m.transactions),
                "failures": len(fails),
                "at_risk_paise": sum(t.amount_paise for t in fails),
                "avg_ticket_paise": m.profile.avg_ticket_paise,
                "observed_success_pct": round(
                    100 * (len(m.transactions) - len(fails)) / len(m.transactions), 2
                ),
            }
        )
    return out


@app.get("/api/portfolio")
def portfolio() -> dict:
    """Every merchant at once, ranked by money on the table.

    The view a payments platform would actually deploy: not one merchant's
    dashboard, but a work queue across the whole book.
    """
    return json.loads(build_portfolio().model_dump_json())


@app.post("/api/portfolio/approve")
def portfolio_approve(confirm: bool = False) -> dict:
    """Approve every queued action across the whole book.

    This is the step that makes the forecast falsifiable. Before it runs, the
    portfolio carries a projection for the retries sitting in merchants'
    queues; afterwards it carries a marked figure for the same retries, and
    the two can be read side by side.

    It does not widen anything. Every action is re-gated individually against
    the mandate it was proposed under, so what the kernel denied stays denied
    however many times it is approved -- confirming a queue is a person saying
    yes to work already inside the agent's authority, not granting more.
    """
    if not confirm:
        raise HTTPException(400, "pass confirm=true to approve the book")

    out = {"merchants": [], "executed": 0, "denied": 0, "groups": 0}
    for p in sorted(RUNS.glob("*.json")):
        rec = _read_json(p)
        rid, mid = rec.get("run_id"), rec.get("merchant_id")
        if not rid or mid not in MERCHANTS:
            continue
        try:
            signed = load_mandate(mid)
        except (SystemExit, FileNotFoundError):
            continue

        ex = dn = 0
        for i in range(len(rec.get("pending_actions") or [])):
            try:
                res = apply_group(rid, i, signed, confirmed=True)
            except (IndexError, FileNotFoundError, ValueError):
                continue
            out["groups"] += 1
            ex += getattr(res, "executed", 0) or 0
            dn += getattr(res, "denied", 0) or 0

        after = _read_json(p)
        sc = after["report"]["measured"].get("recovery_vs_truth", {}) or {}
        out["merchants"].append(
            {
                "merchant_id": mid,
                "run_id": rid,
                "executed": ex,
                "denied": dn,
                "measured_paise": sc.get("measured_paise", 0),
                "attempted": sc.get("attempted", 0),
                "converted": sc.get("truly_converted", 0),
            }
        )
        out["executed"] += ex
        out["denied"] += dn

    out["total_measured_paise"] = sum(
        m["measured_paise"] for m in out["merchants"]
    )
    return out


@app.get("/api/run/{run_id}/journeys")
def journeys(run_id: str, limit: int = 40) -> dict:
    """Payments in this run worth opening, most interesting first.

    Denied before held before executed. A list that opened on forty identical
    successes would read as a log rather than as a set of decisions.
    """
    if not (RUNS / (run_id + ".json")).exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    return {"run_id": run_id, "payments": journey_candidates(run_id, limit)}


@app.get("/api/run/{run_id}/journey/{txn_id}")
def journey(run_id: str, txn_id: str) -> dict:
    """One payment, from the failure to whatever finally happened to it.

    Assembled entirely from what was already written down, so the page cannot
    disagree with the ledger it is describing.
    """
    j = build_journey(run_id, txn_id)
    if not j.found:
        raise HTTPException(404, j.detail)
    return json.loads(j.model_dump_json())


@app.get("/api/audit")
def audit(limit: int = 60) -> dict:
    """Every decision the system took, across the book, newest first.

    The per-run pages each show their own ledger, which is the right scope for
    a merchant and the wrong one for anybody asking whether this can be
    trusted at all. That question is about the whole book: how many chains,
    whether every one of them still verifies, and what the decisions were.

    The chain check is re-run here rather than read off the stored flag. A
    stored "verified: true" is a claim; recomputing the hashes is a check, and
    the difference is the entire point of keeping a hash chain.
    """
    from chitragupta.ledger import Ledger

    chains: list[dict] = []
    rows: list[dict] = []
    counts: dict[str, int] = {}
    reasons: dict[str, int] = {}
    actors: dict[str, int] = {}
    total = 0

    for path in sorted(RUNS.glob("run_*.json")):
        rec = _read_json(path)
        rid, mid = rec.get("run_id"), rec.get("merchant_id")
        if not rid or rec.get("used_stubs"):
            continue
        entries = rec.get("report", {}).get("ledger", []) or []
        total += len(entries)

        try:
            led = Ledger.from_entries(entries)
            v = led.verify()
            ok, detail = bool(v.ok), getattr(v, "detail", "")
        except Exception as e:  # a malformed ledger is a finding, not a crash
            ok, detail = False, str(e)[:160]

        chains.append(
            {
                "run_id": rid,
                "merchant_id": mid,
                "merchant_name": rec.get("merchant_name") or mid,
                "entries": len(entries),
                "verified": ok,
                "detail": detail,
                "head": entries[-1]["entry_hash"] if entries else None,
            }
        )

        for e in entries:
            counts[e.get("outcome", "?")] = counts.get(e.get("outcome", "?"), 0) + 1
            reasons[e.get("gate_reason", "?")] = reasons.get(e.get("gate_reason", "?"), 0) + 1
            actors[e.get("actor", "agent")] = actors.get(e.get("actor", "agent"), 0) + 1
            rows.append(
                {
                    "run_id": rid,
                    "merchant": rec.get("merchant_name") or mid,
                    "sequence": e.get("sequence"),
                    "timestamp": e.get("timestamp"),
                    "txn_id": e.get("txn_id"),
                    "action_type": (e.get("proposed_action") or {}).get("action_type"),
                    "amount_paise": (e.get("proposed_action") or {}).get("amount_paise", 0),
                    "gate_decision": e.get("gate_decision"),
                    "gate_reason": e.get("gate_reason"),
                    "outcome": e.get("outcome"),
                    "actor": e.get("actor", "agent"),
                    "entry_hash": e.get("entry_hash"),
                }
            )

    rows.sort(key=lambda r: (r["timestamp"] or "", r["sequence"] or 0), reverse=True)
    return {
        "chains": sorted(chains, key=lambda c: -c["entries"]),
        "chains_verified": sum(1 for c in chains if c["verified"]),
        "chains_total": len(chains),
        "entries_total": total,
        "by_outcome": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "by_reason": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        # Who caused each entry. Three different people are answerable for
        # these three numbers, and a ledger that could not separate them would
        # be crediting a console operator with the merchant's own decisions.
        "by_actor": dict(sorted(actors.items(), key=lambda kv: -kv[1])),
        "recent": rows[: max(1, min(limit, 400))],
    }


@app.get("/api/defects")
def defects() -> dict:
    """The write-off, across the book, sorted by who has to act.

    A merchant cannot compute this. They see their own failures and nothing
    else, so a code hitting six of them looks like six unrelated bad months.
    Only the platform can see the same code twice, which makes a defect
    backlog the one artefact here that is worth more to Razorpay than to any
    merchant on it.
    """
    return json.loads(build_backlog().model_dump_json())


@app.get("/api/portfolio.csv")
def portfolio_export() -> PlainTextResponse:
    csv_text = portfolio_csv(build_portfolio())
    return PlainTextResponse(
        csv_text,
        headers={
            "Content-Disposition": "attachment; filename=revenue_doctor_portfolio.csv"
        },
        media_type="text/csv",
    )


@app.get("/api/run/{run_id}/ledger.csv")
def ledger_export(run_id: str) -> PlainTextResponse:
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    rec = json.loads(p.read_text(encoding="utf-8"))
    return PlainTextResponse(
        ledger_csv(rec),
        headers={
            "Content-Disposition": "attachment; filename=ledger_%s.csv" % run_id
        },
        media_type="text/csv",
    )


@app.get("/api/run/{run_id}/email")
def run_email(run_id: str) -> dict:
    """The outreach email, composed deterministically from the diagnosis."""
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    out = json.loads(compose(json.loads(p.read_text(encoding="utf-8"))).model_dump_json())
    # Where a send goes if nobody types an address. Every merchant here is
    # invented, so their addresses are too, and an empty box is something to
    # fill in on stage with a typo.
    out["default_to"] = default_recipient()
    out["smtp_configured"] = smtp_configured()
    return out


@app.get("/api/run/{run_id}/email.eml")
def run_email_file(run_id: str, to: str = "") -> PlainTextResponse:
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    email = compose(json.loads(p.read_text(encoding="utf-8")))
    return PlainTextResponse(
        as_eml(email, to),
        headers={"Content-Disposition": "attachment; filename=%s.eml" % run_id},
        media_type="message/rfc822",
    )


@app.get("/api/drift")
def drift() -> dict:
    """Which issuers are moving, and who on the book is exposed.

    The proactive half of the product. Everything else waits for a merchant to
    have a gap; this watches NPCI's published series and says so first.
    """
    return json.loads(build_drift_report().model_dump_json())


@app.post("/api/run/{run_id}/ask")
def run_ask(run_id: str, q: str) -> dict:
    """Ask about one run. Every figure in the reply is checked against it.

    The reply is REFUSED rather than shown with a warning when a figure
    survives that cannot be found in the record -- a caveat under a wrong
    number is still a wrong number on a screen.
    """
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    if len(q or "") > 500:
        raise HTTPException(400, "question too long")
    rec = json.loads(p.read_text(encoding="utf-8"))
    return json.loads(assistant_ask(rec, q).model_dump_json())


@app.post("/api/run/{run_id}/note")
def run_note(run_id: str, note: str) -> dict:
    """Read the merchant's own account of the problem, and rule on it.

    The model extracts typed claims and quotes the span each came from; the
    decomposition decides whether each one holds. Stored on the run, so the
    assistant answers follow-ups from the verdict rather than from its memory
    of the conversation.
    """
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    if len(note or "") > 2000:
        raise HTTPException(400, "note too long")

    rec = json.loads(p.read_text(encoding="utf-8"))
    adj = read_note(note, rec)
    if adj.ok:
        rec["merchant_note"] = json.loads(adj.model_dump_json())
        p.write_text(json.dumps(rec, indent=2), encoding="utf-8", newline=chr(10))
    return json.loads(adj.model_dump_json())


@app.get("/api/drift/simulate")
def drift_simulate(merchant: str, bank: str, delta_pts: float = 2.0) -> dict:
    """What would the agent do if this issuer moved by this much?

    A labelled hypothetical. Everything it touches is real -- the merchant's
    actual bank mix and volume, the real action type, the real signed mandate.
    Only the movement is supposed, because on the current data no merchant on
    this book is materially exposed and re-weighting them until the feature had
    something to show would be dishonest.
    """
    if merchant not in MERCHANTS:
        raise HTTPException(400, "unknown merchant: %s" % merchant)
    if not -10.0 <= delta_pts <= 25.0:
        raise HTTPException(400, "delta_pts out of range")
    try:
        exposure = simulate_exposure(merchant, bank, delta_pts)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "hypothetical": True,
        "note": (
            "Supposed movement, real everything else: this merchant's own bank "
            "mix and volume, the real action type, and their real signed "
            "mandate."
        ),
        "exposure": json.loads(exposure.model_dump_json()),
    }


@app.get("/api/decide/{token}")
def decide_preview(token: str) -> dict:
    """What this link would do. Reads only.

    Separate from acting on purpose. Mail scanners fetch every URL in a
    message before a person sees it, so a GET that applied a fix would fire
    on delivery with nobody having decided anything.
    """
    try:
        merchant_id, grant = read_token(token)
    except TokenError as e:
        raise HTTPException(400, str(e))

    p = RUNS / (grant.run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "That run is no longer on file.")
    rec = _read_json(p)
    groups = rec.get("pending_actions") or []
    if not (0 <= grant.group_index < len(groups)):
        raise HTTPException(404, "That fix is no longer part of this run.")
    g = groups[grant.group_index]
    applied = {a["group_id"] for a in (rec.get("applied") or [])}

    return {
        "merchant_id": merchant_id,
        "merchant_name": rec.get("merchant_name", merchant_id),
        "run_id": grant.run_id,
        "intent": grant.intent,
        "group_index": grant.group_index,
        "title": g["title"],
        "why": g.get("why", ""),
        "count": g["count"],
        "total_paise": g["total_paise"],
        "already_applied": g["group_id"] in applied,
        "expires_at": grant.expires_at,
    }


@app.post("/api/decide/{token}")
def decide(token: str) -> dict:
    """Act on the merchant's answer.

    Approving lands in apply_group, the same call the button in the app makes,
    which re-gates every action against the signed mandate. Email is a channel
    for the merchant's yes -- it is not a way round the policy that governs
    what that yes can authorise.
    """
    try:
        merchant_id, grant = read_token(token)
    except TokenError as e:
        raise HTTPException(400, str(e))

    p = RUNS / (grant.run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "That run is no longer on file.")

    if grant.intent == "reject":
        rec = _read_json(p)
        groups = rec.get("pending_actions") or []
        title = (
            groups[grant.group_index]["title"]
            if 0 <= grant.group_index < len(groups)
            else "that fix"
        )
        # Recorded, not executed. A rejection that changed nothing and left no
        # trace would make the button decoration.
        rec.setdefault("rejected", [])
        if grant.group_index not in rec["rejected"]:
            rec["rejected"].append(grant.group_index)
            p.write_text(json.dumps(rec, indent=2), encoding="utf-8", newline=chr(10))
        return {
            "ok": True,
            "intent": "reject",
            "headline": "Noted. %s will not run." % title,
            "detail": "Nothing was sent to any payment rail.",
        }

    try:
        res = apply_group(
            grant.run_id,
            grant.group_index,
            load_mandate(merchant_id),
            confirmed=True,
            # This link was mailed to the merchant and signed for them alone.
            # It is the one path in the product where the merchant is the one
            # deciding, and the ledger records that rather than crediting the
            # console operator with it.
            actor="merchant",
        )
    except (IndexError, FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))

    return {
        "ok": res.ok,
        "intent": "approve",
        "headline": res.headline,
        "executed": res.executed,
        "allowed": res.allowed,
        "stepped_up": res.stepped_up,
        "denied": res.denied,
        "recovered_paise": res.recovered_paise,
        "ledger_added": res.ledger_added,
        "chain_verified": res.chain_verified,
        "detail": "Every action was checked against your signed mandate again.",
    }


@app.post("/api/email/verify")
def email_verify() -> dict:
    """Check the mail credentials without mailing anyone.

    The alternative is discovering they are wrong by sending a real merchant
    a real email mid-demo, and a typo fails in exactly the same way a missing
    App Password does unless something says which.
    """
    return json.loads(smtp_verify().model_dump_json())


@app.post("/api/run/{run_id}/email/send")
def run_email_send(run_id: str, to: str) -> dict:
    """Send for real, if SMTP is configured. Says so plainly when it is not."""
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    rec = json.loads(p.read_text(encoding="utf-8"))
    # The record goes through so the HTML report can carry a signed Approve
    # and Reject button for each proposed fix.
    return json.loads(send(compose(rec), to, rec).model_dump_json())


@app.post("/api/txns/diagnose")
async def txns_diagnose(
    mcc: str = "5411",
    file: UploadFile = File(...),
) -> dict:
    """Diagnose a month of payments the engine has never seen.

    Returns a diagnosis and nothing else. There is no ground truth for an
    uploaded file, so nothing here can be MEASURED -- and acting on it would
    need a mandate signed by the merchant's own key, which this process does
    not hold. A file upload is not authorisation.

    Nothing is written. The payments live for the length of this request.
    """
    try:
        txns, summary = parse_txns(await file.read(), mcc=mcc)
    except TxnRejected as e:
        raise HTTPException(400, str(e))

    return {
        "summary": json.loads(summary.model_dump_json()),
        "diagnosis": diagnose_txns(txns, mcc),
        "mcc": mcc,
        "note": (
            "Projected only. Recovery cannot be measured on an uploaded file "
            "because there is no known outcome to mark against, and no action "
            "is proposed because a file is not a signed mandate."
        ),
    }


#: Files shipped in samples/, so "run it on your own data" can be tried by
#: somebody who has not brought any. Names are matched against this list
#: rather than joined onto a path -- a filename off the wire must never be
#: able to read anything the repository did not intend to publish.
SAMPLES = {
    "northwind": (
        "northwind_payments.csv",
        "5411",
        "2,400 payments from a ninth merchant the engine has never seen, "
        "written the way somebody else's system would write it.",
    ),
    "too_small": (
        "too_small_to_diagnose.csv",
        "5411",
        "140 payments, which is not enough. This one is meant to be refused.",
    ),
}


@app.get("/api/samples")
def samples() -> dict:
    """What a visitor can try without bringing a file of their own."""
    root = ROOT / "samples"
    return {
        "samples": [
            {
                "key": key,
                "filename": name,
                "mcc": mcc,
                "about": about,
                "bytes": (root / name).stat().st_size if (root / name).exists() else 0,
            }
            for key, (name, mcc, about) in SAMPLES.items()
        ]
    }


@app.post("/api/txns/diagnose/sample")
def txns_diagnose_sample(name: str = "northwind", mcc: str = "") -> dict:
    """Run a bundled sample through the upload path.

    Deliberately the same parse and the same decomposition the upload takes,
    reached by a different door. A demo button that ran a special code path
    would be demonstrating the button.
    """
    if name not in SAMPLES:
        raise HTTPException(404, "no sample called %r" % name)
    filename, default_mcc, _ = SAMPLES[name]
    path = ROOT / "samples" / filename
    if not path.exists():
        raise HTTPException(404, "%s is not in this checkout" % filename)

    use = mcc or default_mcc
    try:
        txns, summary = parse_txns(path.read_bytes(), mcc=use)
    except TxnRejected as e:
        # A refusal is one of the two things the samples exist to show, so it
        # comes back the same way an uploaded file's refusal does.
        raise HTTPException(400, str(e))

    return {
        "sample": name,
        "filename": filename,
        "summary": json.loads(summary.model_dump_json()),
        "diagnosis": diagnose_txns(txns, use),
        "mcc": use,
        "note": (
            "Projected only. Recovery cannot be measured on an uploaded file "
            "because there is no known outcome to mark against, and no action "
            "is proposed because a file is not a signed mandate."
        ),
    }


@app.post("/api/npci/rerun")
async def npci_rerun(
    merchant: str = "cloudsync",
    period: str = "",
    file: UploadFile = File(...),
) -> dict:
    """Re-diagnose one merchant against bank data the engine has never seen.

    The same decomposer, the same cohort, the same priors -- pointed at a
    different measurement of the world. A diagnosis that moves when the
    evidence moves is the only kind that was reading the evidence.

    Nothing is written. The upload lives for the length of this request, so
    the committed tables CI reproduces against are never touched.
    """
    if merchant not in MERCHANTS:
        raise HTTPException(400, "unknown merchant: %s" % merchant)
    try:
        stats, summary = parse_npci(await file.read(), period or None)
    except Rejected as e:
        raise HTTPException(400, str(e))

    m = load_merchant(merchant)
    shipped = Baseline()
    uploaded = baseline_from(stats, summary.period)

    def diagnose(b: Baseline) -> dict:
        cohort = build_cohort(m.profile.mcc, b)
        dec = ShapleyDecomposer(b, cohort).decompose(m.transactions)
        return {
            "achievable_pct": round(100 * cohort.s_star, 3),
            "gap_pts": round(dec.gap_pts, 3),
            "primary_cause": dec.primary_cause(),
            "by_factor": {k: round(v, 3) for k, v in dec.by_factor().items()},
        }

    before, after = diagnose(shipped), diagnose(uploaded)
    moved = {
        k: round(after["by_factor"][k] - before["by_factor"][k], 3)
        for k in after["by_factor"]
    }
    return {
        "merchant_id": merchant,
        "merchant_name": m.profile.name,
        "upload": json.loads(summary.model_dump_json()),
        "shipped_period": shipped.period,
        "before": before,
        "after": after,
        "moved": moved,
        "primary_changed": before["primary_cause"] != after["primary_cause"],
    }


@app.get("/api/evals")
def evals() -> dict:
    """Everything in evals/results/, so the validation page is one fetch."""
    return {
        p.stem: _read_json(p)
        for p in sorted(RESULTS.glob("*.json"))
    } | {
        "failure_cases_md": (RESULTS / "failure_cases.md").read_text(encoding="utf-8")
        if (RESULTS / "failure_cases.md").exists()
        else "",
        "npci_finding_md": (DOCS / "npci_finding.md").read_text(encoding="utf-8")
        if (DOCS / "npci_finding.md").exists()
        else "",
    }


@app.get("/api/budget")
def budget() -> dict:
    """What the model steps cost, and what the cache stops them costing again.

    Spent and saved are returned separately and never netted. A single figure
    would let a fully cached run read as free, and the model steps are not
    free -- somebody bought those answers once, and a platform running this
    nightly would buy them every time.
    """
    return json.loads(build_budget().model_dump_json())


@app.post("/api/ask")
def ask_system(q: str) -> dict:
    """Answer a question about the system itself.

    Grounded the same way every other model output here is: the reply is
    checked against the context it was given, and refused rather than shown
    if it cites a figure that is not in it. That matters more for this
    endpoint than any other -- it is asked about the system's own accuracy,
    so an invented number would be a false claim about how honest the system
    is.
    """
    if len(q or "") > 500:
        raise HTTPException(400, "question too long")
    return json.loads(helpdesk_ask(q).model_dump_json())


@app.get("/api/run-latest")
def run_latest() -> dict:
    """The newest saved run, so the walkthrough is never a dead end.

    Steps 3 and 4 used to be disabled whenever you were not already inside a
    run, which meant landing on Drift or Prove and finding half the product
    unclickable with no way to tell why. There is almost always a run on
    disk; if there is, those steps should go to it.
    """
    best = None
    for p in RUNS.glob("run_*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if rec.get("used_stubs"):
            continue
        at = rec.get("started_at") or 0
        if best is None or at > best[0]:
            best = (at, rec)
    if not best:
        return {"run_id": None, "merchant_id": None}
    return {
        "run_id": best[1].get("run_id"),
        "merchant_id": best[1].get("merchant_id"),
    }


@app.get("/api/run/{run_id}")
def get_run(run_id: str) -> dict:
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/api/run/{run_id}/authority")
def run_authority(run_id: str) -> dict:
    """What this merchant's own limits cost them, and a revised mandate.

    The draft comes back UNSIGNED and that is the point. Signing needs the
    merchant's private key, which this process has never held; an agent that
    could widen its own authority would make the policy kernel decorative.
    The response therefore carries a proposal and the canonical bytes a
    merchant would sign, never a signature.
    """
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    rec = json.loads(p.read_text(encoding="utf-8"))

    try:
        signed = load_mandate(rec["merchant_id"])
    except (SystemExit, FileNotFoundError):
        raise HTTPException(404, "no mandate on file for this merchant")

    rv = authority_review(rec, signed)
    out = json.loads(rv.model_dump_json())
    out["current_mandate"] = json.loads(signed.mandate.model_dump_json())
    if rv.proposals:
        d = authority_draft(signed, rv.proposals)
        out["draft_mandate"] = json.loads(d.model_dump_json())
        # The exact bytes the merchant's key would sign, so the diff they
        # approve on screen is the diff that gets signed.
        out["signing_payload_sha256"] = hashlib.sha256(
            d.signing_payload()
        ).hexdigest()
    return out


@app.post("/api/run")
def start_run(merchant: str = "quickmart", calibration: str = "central") -> dict:
    """Run synchronously and return the record. Fast enough not to need a job."""
    if merchant not in MERCHANTS:
        raise HTTPException(400, "unknown merchant: %s" % merchant)
    m = load_merchant(merchant)
    rec = run_diagnosis(
        m.profile, m.transactions, load_mandate(merchant),
        baseline=Baseline(), calibration=Calibration(calibration),
    )
    return json.loads(rec.model_dump_json())


@app.post("/api/demo/reset")
def reset_demo() -> dict:
    """Put the book back to the state it starts a demo in.

    Approving writes to disk, so the second take of a walkthrough opens on the
    wreckage of the first: queues empty, headline already moved, the one
    moment worth filming already spent. Doing this from a terminal between
    takes is a thing to forget with a camera running.

    It re-runs each merchant's diagnosis rather than deleting the approvals,
    which matters for two reasons. The runs are deterministic and their model
    calls are cached, so a re-run reproduces the original record exactly
    instead of approximating it -- and reusing each merchant's existing run_id
    means every link, bookmark and emailed approval URL still resolves
    afterwards.

    Nothing outside data/runs is touched. The ledger lives inside the run, so
    it is rebuilt with it; the mandates, the NPCI tables and the merchant
    files are read-only here and stay exactly as committed.
    """
    out: list[dict] = []
    for mid in MERCHANTS:
        # Keep the newest run's id so existing links survive, and clear the
        # older ones -- otherwise every reset leaves another orphan behind for
        # the portfolio to sift by mtime.
        mine = sorted(
            (
                (p.stat().st_mtime, p)
                for p in RUNS.glob("run_*.json")
                if _read_json(p).get("merchant_id") == mid
            ),
            reverse=True,
        )
        keep = mine[0][1].stem if mine else None
        for _, stale in mine[1:]:
            stale.unlink(missing_ok=True)

        try:
            m = load_merchant(mid)
            rec = run_diagnosis(
                m.profile,
                m.transactions,
                load_mandate(mid),
                baseline=Baseline(),
                run_id=keep,
            )
        except (FileNotFoundError, SystemExit, ValueError) as e:
            out.append({"merchant_id": mid, "ok": False, "error": str(e)[:120]})
            continue
        out.append({"merchant_id": mid, "ok": True, "run_id": rec.run_id})

    ok = sum(1 for r in out if r["ok"])
    return {
        "ok": ok == len(out),
        "merchants": out,
        "headline": "%d of %d merchants back to their starting state."
        % (ok, len(out)),
    }


@app.post("/api/run/{run_id}/action")
def decide_one_action(run_id: str, txn_id: str, decision: str = "approve") -> dict:
    """Approve or reject a single held payment.

    Deliberately routed through the same apply_group the whole-fix button
    uses, narrowed to one payment. One payment and fifty must be decided by
    identical rules, and the surest way to guarantee that is for there to be
    only one place where deciding happens.
    """
    if decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")

    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    rec = _read_json(p)

    # Which fix this payment belongs to.
    idx = next(
        (
            i
            for i, g in enumerate(rec.get("pending_actions") or [])
            if any(a["txn_id"] == txn_id for a in g["actions"])
        ),
        None,
    )
    if idx is None:
        raise HTTPException(404, "that payment is not in any proposed fix")

    if decision == "reject":
        # Recorded against the payment, not executed. A rejection that left
        # no trace would make the button decoration.
        rec.setdefault("rejected_txns", [])
        if txn_id not in rec["rejected_txns"]:
            rec["rejected_txns"].append(txn_id)
            p.write_text(json.dumps(rec, indent=2), encoding="utf-8", newline=chr(10))
        return {
            "ok": True,
            "decision": "reject",
            "txn_id": txn_id,
            "headline": "Rejected. Nothing was sent for this payment.",
        }

    try:
        res = apply_group(
            run_id,
            idx,
            load_mandate(rec["merchant_id"]),
            confirmed=True,
            only_txns={txn_id},
        )
    except (IndexError, FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))

    return {
        "ok": res.ok,
        "decision": "approve",
        "txn_id": txn_id,
        "headline": res.headline,
        "executed": res.executed,
        "denied": res.denied,
        "recovered_paise": res.recovered_paise,
        "chain_verified": res.chain_verified,
        "actions": [json.loads(a.model_dump_json()) for a in res.actions],
    }


@app.post("/api/run/{run_id}/apply")
def apply_fix(
    run_id: str,
    group_index: int = 0,
    confirmed: bool = False,
    calibration: str = "central",
) -> dict:
    """Approve one proposed fix and watch the mandate being checked.

    Deliberately re-resolves the action from the stored run and re-evaluates it
    against the signed mandate. A client cannot smuggle a different amount
    through -- it would simply be denied, which is the property worth showing.
    """
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    merchant = json.loads(p.read_text(encoding="utf-8"))["merchant_id"]
    try:
        res = apply_group(
            run_id,
            group_index,
            load_mandate(merchant),
            confirmed=confirmed,
            calibration=Calibration(calibration),
        )
    except IndexError as e:
        raise HTTPException(400, str(e))
    return json.loads(res.model_dump_json())


def _sse(event: str, data) -> str:
    return "event: %s\ndata: %s\n\n" % (
        event, json.dumps(data, default=str, ensure_ascii=False)
    )


@app.get("/api/run/{merchant}/stream")
async def stream(merchant: str, calibration: str = "central", pace_ms: float = 0.0):
    """Live SSE of NodeTrace objects and sub-steps as the graph executes.

    `pace_ms` throttles the DRAIN, never the work. The graph runs at full speed
    on its own thread and the queue holds everything it emits; pacing only
    decides how fast the browser is fed. Nothing is invented, delayed or
    reordered -- a 130-step run genuinely produced 130 steps, and at pace_ms=0
    they all arrive at once, as they did before.
    """
    if merchant not in MERCHANTS:
        raise HTTPException(400, "unknown merchant: %s" % merchant)

    q: queue.Queue = queue.Queue()
    m = load_merchant(merchant)
    mandate = load_mandate(merchant)

    def worker():
        # The tracer emits from the graph thread; the generator below drains
        # the queue on the event loop. A queue rather than an async callback
        # keeps the node functions synchronous and identical to the CLI path.
        try:
            def listen(t):
                q.put(("trace", json.loads(t.model_dump_json())))

            def listen_step(p):
                q.put(("step", p))

            from doctor.trace import Tracer

            orig_init = Tracer.__init__

            def patched(self, run_id):
                orig_init(self, run_id)
                self.listeners.append(listen)
                self.step_listeners.append(listen_step)

            Tracer.__init__ = patched  # type: ignore[method-assign]
            try:
                rec = run_diagnosis(
                    m.profile, m.transactions, mandate,
                    baseline=Baseline(), calibration=Calibration(calibration),
                )
                q.put(("done", json.loads(rec.model_dump_json())))
            finally:
                Tracer.__init__ = orig_init  # type: ignore[method-assign]
        except Exception as e:  # surface it to the UI rather than hanging
            q.put(("error", {"detail": str(e)}))
        q.put((None, None))

    threading.Thread(target=worker, daemon=True).start()

    step_delay = max(0.0, min(pace_ms, 400.0)) / 1000.0
    # A node needs to be visibly its own beat, or ten of them arrive in one
    # frame and the graph looks like it never ran. Pacing only the sub-steps
    # -- which is what this did -- left every node transition instantaneous.
    node_delay = step_delay * 8

    async def gen():
        yield _sse("start", {"merchant": merchant, "commit": git_commit()})
        while True:
            try:
                kind, payload = q.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.03)
                continue
            if kind is None:
                break
            yield _sse(kind, payload)
            if not step_delay:
                continue
            if kind == "step":
                await asyncio.sleep(step_delay)
            elif kind == "trace" and payload.get("status") != "running":
                # After a node finishes, not when it starts -- so the pause
                # reads as the node having done work rather than stalling
                # before it.
                await asyncio.sleep(node_delay)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/prove/options")
def prove_options() -> dict:
    """What a challenger may choose. Same vocabulary the validation sweep uses."""
    return {
        "categories": CATEGORIES,
        "causes": CAUSES,
        "note": (
            "Offering causes the validation sweep never covers would be quietly "
            "setting an easier exam, so the vocabulary here is identical to it."
        ),
    }


@app.post("/api/prove/adversarial")
def prove_adversarial() -> dict:
    """Let the model design the exam it thinks will break the engine.

    It picks a point inside a fixed space -- batch size, causes, magnitude,
    correlation -- and every value is clamped to what the generator accepts.
    The model is choosing an input, never handing over a payload.
    """
    spec = compose_adversarial()
    return json.loads(spec.model_dump_json())


@app.post("/api/prove/new")
def prove_new(
    mcc: str = "5411",
    n_txns: int = 900,
    causes: str = "midnight_billing_penalty",
    magnitude_pts: float = 2.0,
    rho: float = 0.0,
    seed: int = 0,
) -> dict:
    """Step 1 of 3. Generate the merchant and publish the hash of its answer.

    The response deliberately carries no ground truth -- only the seal, the
    shape of what was asked for, and the batch facts the engine also sees.
    """
    import random as _random

    wanted = [c.strip() for c in causes.split(",") if c.strip()]
    unknown = [c for c in wanted if c not in CAUSES]
    if unknown:
        raise HTTPException(400, "unknown cause(s): %s" % ", ".join(unknown))
    if not 40 <= n_txns <= 8000:
        raise HTTPException(400, "n_txns must be between 40 and 8000")

    challenge, _ = new_challenge(
        mcc=mcc,
        n_txns=n_txns,
        causes=wanted,
        magnitude_pts=magnitude_pts,
        seed=seed or _random.randint(1, 10_000_000),
        rho=rho,
    )
    return json.loads(challenge.model_dump_json())


@app.get("/api/prove/{challenge_id}/diagnose")
async def prove_diagnose(challenge_id: str, pace_ms: float = 18.0):
    """Step 2 of 3. Run the engine on the batch alone, streaming every step.

    What is handed in is `blind_batch` -- the payments and nothing else. There
    is no ground truth on the object the engine receives, which is a stronger
    guarantee than promising not to read one.
    """
    try:
        challenge, m = load_challenge(challenge_id)
    except FileNotFoundError:
        raise HTTPException(404, "no such challenge: %s" % challenge_id)

    from doctor.cohort import build_cohort
    from doctor.plan import load_mae
    from doctor.shapley import ShapleyDecomposer
    from doctor.stats import is_underpowered

    baseline = Baseline()
    txns = blind_batch(m)
    delay = max(0.0, min(pace_ms, 200.0)) / 1000.0

    async def gen():
        yield _sse(
            "start",
            {"challenge_id": challenge_id, "seal": challenge.seal,
             "n": len(txns), "blind": True},
        )

        steps: list = []
        cohort = build_cohort(m.profile.mcc, baseline)
        dec = ShapleyDecomposer(baseline, cohort).decompose(
            txns,
            mae_by_factor=load_mae(),
            on_coalition=lambda i, n, label, val: steps.append(
                {"i": i, "n": n, "label": label, "value": round(val, 4)}
            ),
        )
        # Emitted after the fact rather than from inside the callback because
        # the decomposition is synchronous; the values are the real ones.
        for st in steps:
            yield _sse("coalition", st)
            if delay:
                await asyncio.sleep(delay)

        succ = sum(1 for t in txns if t.succeeded)
        yield _sse(
            "estimate",
            {
                "gap_pts": round(dec.gap_pts, 4),
                "attributions": {k: round(v, 4) for k, v in dec.by_factor().items()},
                "residual_pts": round(dec.residual_pts, 4),
                "primary": dec.primary_cause(),
                "underpowered": is_underpowered(succ, len(txns), dec.gap_pts),
                "degenerate_factors": dec.degenerate_factors,
                "clamp_rate": round(dec.clamp_rate, 4),
            },
        )
        yield _sse("done", {"challenge_id": challenge_id})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/prove/{challenge_id}/reveal")
def prove_reveal(challenge_id: str) -> dict:
    """Step 3 of 3. Break the seal and mark the paper.

    Returns the truth AND the exact bytes that were hashed, so anyone can
    recompute the digest and check it against the one published in step 1.
    """
    try:
        challenge, m = load_challenge(challenge_id)
    except FileNotFoundError:
        raise HTTPException(404, "no such challenge: %s" % challenge_id)

    from doctor.cohort import build_cohort
    from doctor.plan import load_mae
    from doctor.prove import canonical_bytes
    from doctor.shapley import ShapleyDecomposer
    from doctor.stats import is_underpowered

    baseline = Baseline()
    txns = blind_batch(m)
    dec = ShapleyDecomposer(baseline, build_cohort(m.profile.mcc, baseline)).decompose(
        txns, mae_by_factor=load_mae()
    )
    succ = sum(1 for t in txns if t.succeeded)
    result = score(
        m, dec, load_mae(),
        underpowered=is_underpowered(succ, len(txns), dec.gap_pts),
    )
    out = json.loads(result.model_dump_json())
    out["published_seal"] = challenge.seal
    out["matches_published_seal"] = result.seal == challenge.seal
    out["canonical_bytes"] = canonical_bytes(result.sealed_payload)
    return out


@app.get("/api/validate/stream")
async def validate_stream(limit: int = 200, rate: int = 25):
    """Re-score the validation sweep, one merchant at a time, live.

    Not a re-read of the committed JSON: this runs the real decomposer over
    each sweep merchant and compares against the analytic ground truth that
    merchant was constructed with. The MAE you watch converge is being
    computed in front of you, and it lands on the committed figure because
    it is the same computation that produced it.

    The point is that the error bar is a measurement anyone can repeat, not a
    number on a slide.
    """
    from doctor.cohort import build_cohort
    from doctor.features import FACTORS
    from doctor.generator import GeneratedMerchant
    from doctor.shapley import ShapleyDecomposer

    sweep = sorted((SYNTH / "validation_sweep").glob("merchant_*.json"))
    if not sweep:
        raise HTTPException(404, "no validation sweep generated")
    sweep = sweep[: max(1, min(limit, len(sweep)))]
    baseline = Baseline()
    delay = 1.0 / max(1, min(rate, 500))

    async def gen():
        yield _sse("start", {"total": len(sweep)})
        abs_err: dict[str, list[float]] = {f: [] for f in FACTORS}
        primary_hits = 0
        primary_scored = 0

        for i, path in enumerate(sweep, 1):
            m = GeneratedMerchant.model_validate_json(
                path.read_text(encoding="utf-8")
            )
            cohort = build_cohort(m.profile.mcc, baseline)
            dec = ShapleyDecomposer(baseline, cohort).decompose(m.transactions)
            est = dec.by_factor()
            true = m.ground_truth.true_attribution

            errs = {f: est[f] - true[f] for f in FACTORS}
            for f in FACTORS:
                abs_err[f].append(abs(errs[f]))

            true_primary = (
                max(true, key=lambda k: true[k])
                if any(abs(v) > 1e-9 for v in true.values())
                else None
            )
            hit = None
            if true_primary is not None:
                primary_scored += 1
                hit = dec.primary_cause() == true_primary
                if hit:
                    primary_hits += 1

            yield _sse(
                "merchant",
                {
                    "i": i,
                    "merchant_id": m.profile.merchant_id,
                    "mcc": m.profile.mcc,
                    "n": len(m.transactions),
                    "injected": m.ground_truth.injected_causes,
                    "true_primary": true_primary,
                    "found_primary": dec.primary_cause(),
                    "correct": hit,
                    "worst_err": round(max(abs(v) for v in errs.values()), 4),
                    "running_mae": {
                        f: round(sum(abs_err[f]) / len(abs_err[f]), 4)
                        for f in FACTORS
                    },
                    "running_primary_pct": round(
                        100.0 * primary_hits / primary_scored, 2
                    )
                    if primary_scored
                    else None,
                },
            )
            await asyncio.sleep(delay)

        yield _sse(
            "done",
            {
                "scored": len(sweep),
                "mae": {
                    f: round(sum(abs_err[f]) / len(abs_err[f]), 4) for f in FACTORS
                },
                "primary_cause_pct": round(100.0 * primary_hits / primary_scored, 2)
                if primary_scored
                else None,
                "committed": _read_json(RESULTS / "attribution_mae_by_factor.json"),
            },
        )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/live/{merchant}/stream")
async def live_feed(merchant: str, rate: int = 60, limit: int = 0):
    """Payments arriving one at a time, with an online detector watching.

    The batch pages explain a month after it has happened. This is the same
    month replayed in payment order with a rolling-window detector running over
    it, so a bank going bad is something you watch rather than read about.

    `rate` is payments per second, purely a playback speed. The detector state
    does not depend on it: the same stream at any rate produces the same alerts
    at the same payment numbers, which is worth checking on camera.
    """
    if merchant not in MERCHANTS:
        raise HTTPException(400, "unknown merchant: %s" % merchant)

    m = load_merchant(merchant)
    monitor = LiveMonitor(Baseline())
    txns = list(in_arrival_order(m.transactions))
    if limit > 0:
        txns = txns[:limit]
    delay = 1.0 / max(1, min(rate, 2000))

    async def gen():
        yield _sse(
            "start",
            {
                "merchant": merchant,
                "merchant_name": m.profile.name,
                "total": len(txns),
                "rate": rate,
            },
        )
        for t in txns:
            alert = monitor.observe(t)
            yield _sse(
                "payment",
                {
                    "txn_id": t.txn_id,
                    "bank": t.bank,
                    "method": t.method.value,
                    "hour": t.hour,
                    "amount_paise": t.amount_paise,
                    "succeeded": t.succeeded,
                    "error_code": t.error_code,
                    "error_class": t.error_class.value if t.error_class else None,
                },
            )
            if alert is not None:
                # The interesting event. Sent as its own type so the UI can
                # stop the feed and put the evidence on screen.
                yield _sse("alert", alert.__dict__)
            if monitor.n_seen % 25 == 0:
                yield _sse("stats", monitor.snapshot())
            await asyncio.sleep(delay)
        yield _sse("stats", monitor.snapshot())
        yield _sse(
            "done",
            {
                **monitor.snapshot(),
                "alerts_detail": [a.__dict__ for a in monitor.alerted.values()],
            },
        )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/replay/{run_id}")
async def replay(run_id: str, speed: float = 1.0):
    """Replay a saved run with its original inter-node timings.

    Honest because it is a genuine recorded run rather than a mock -- the
    frontend labels it REPLAY. This is what lets the demo need no API calls.
    """
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    rec = RunRecord.model_validate_json(p.read_text(encoding="utf-8"))

    async def gen():
        yield _sse("start", {"run_id": run_id, "replay": True})
        for t in rec.traces:
            delay = min(t.duration_ms / 1000.0 / max(speed, 0.01), 2.0)
            await asyncio.sleep(delay)
            yield _sse("trace", json.loads(t.model_dump_json()))
        yield _sse("done", json.loads(rec.model_dump_json()))

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
