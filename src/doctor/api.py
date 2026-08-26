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
import json
import queue
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from chitragupta.rails.mock_rail import Calibration

from fastapi.responses import PlainTextResponse

from doctor.apply import apply_group
from doctor.baseline import Baseline
from doctor.drift import build_drift_report
from doctor.outreach import as_eml, compose, send, smtp_configured
from doctor.portfolio import build_portfolio, ledger_csv, portfolio_csv
from doctor.generator import GeneratedMerchant
from doctor.graph import git_commit, run_diagnosis
from doctor.live import LiveMonitor, in_arrival_order
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
    return json.loads(compose(json.loads(p.read_text(encoding="utf-8"))).model_dump_json())


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


@app.post("/api/run/{run_id}/email/send")
def run_email_send(run_id: str, to: str) -> dict:
    """Send for real, if SMTP is configured. Says so plainly when it is not."""
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    email = compose(json.loads(p.read_text(encoding="utf-8")))
    return json.loads(send(email, to).model_dump_json())


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


@app.get("/api/run/{run_id}")
def get_run(run_id: str) -> dict:
    p = RUNS / (run_id + ".json")
    if not p.exists():
        raise HTTPException(404, "no such run: %s" % run_id)
    return json.loads(p.read_text(encoding="utf-8"))


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

    delay = max(0.0, min(pace_ms, 200.0)) / 1000.0

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
            if delay and kind == "step":
                await asyncio.sleep(delay)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
