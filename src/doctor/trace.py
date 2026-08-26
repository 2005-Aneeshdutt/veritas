"""One trace record per node, defined once because three things consume it.

The flow page renders it, the streaming log prints it, and the audit page
cross-references it. Defining it in three places would guarantee they drift.

LLM nodes carry the prompt and the raw response verbatim. Most submissions
hide the prompt; showing it is the point here -- a panellist who wants to know
whether the model was led to its answer can read exactly what it was asked.
"""

from __future__ import annotations

import time
from typing import Literal

from pydantic import BaseModel, Field

NodeStatus = Literal["running", "ok", "skipped", "error"]
NodeKind = Literal["llm", "deterministic"]


class NodeTrace(BaseModel):
    run_id: str
    seq: int
    node: str
    kind: NodeKind = "deterministic"
    status: NodeStatus = "running"
    started_at: float = Field(default_factory=time.time)
    duration_ms: int = 0
    input_summary: dict = Field(default_factory=dict)
    output_summary: dict = Field(default_factory=dict)
    #: Which edge was taken out of a branching node.
    branch_taken: str | None = None

    # --- LLM nodes only ---------------------------------------------------
    model: str | None = None
    prompt: str | None = None
    raw_response: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cache_hit: bool | None = None
    #: True when there was no key and no cache entry. Never a real answer.
    stub: bool | None = None
    confidence: float | None = None

    # --- deterministic nodes only ----------------------------------------
    reason_codes: list[str] = Field(default_factory=list)
    #: e.g. all 16 coalition values, so the coalition explorer can show the
    #: arithmetic rather than asserting it.
    intermediates: dict = Field(default_factory=dict)


class RunRecord(BaseModel):
    """A complete run, persisted so it can be replayed with no API calls."""

    run_id: str
    merchant_id: str
    merchant_name: str
    mcc: str
    seed: int
    started_at: float
    duration_ms: int
    commit: str = ""
    models: dict = Field(default_factory=dict)
    cache_hit_rate: float = 0.0
    llm_calls: int = 0
    llm_cost_inr: float = 0.0
    used_stubs: bool = False
    traces: list[NodeTrace] = Field(default_factory=list)
    #: The whole diagnosis payload the frontend renders.
    report: dict = Field(default_factory=dict)
    #: Fixes the agent proposed but has NOT run. The merchant applies these
    #: one at a time from the UI, which is what makes this a control plane
    #: rather than a report.
    pending_actions: list = Field(default_factory=list)
    #: What has been applied so far, so re-applying hits the attempt cap.
    applied: list = Field(default_factory=list)


class Tracer:
    """Collects traces in order and hands them to the SSE stream."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.traces: list[NodeTrace] = []
        self._seq = 0
        self.listeners: list = []

    def start(self, node: str, kind: NodeKind = "deterministic", **kw) -> NodeTrace:
        t = NodeTrace(
            run_id=self.run_id, seq=self._seq, node=node, kind=kind, status="running", **kw
        )
        self._seq += 1
        self.traces.append(t)
        self._emit(t)
        return t

    def finish(self, t: NodeTrace, status: NodeStatus = "ok", **fields) -> NodeTrace:
        updated = t.model_copy(
            update={
                "status": status,
                "duration_ms": int((time.time() - t.started_at) * 1000),
                **fields,
            }
        )
        self.traces[t.seq] = updated
        self._emit(updated)
        return updated

    def skip(self, node: str, why: str) -> NodeTrace:
        """Record a node that was deliberately not run.

        Rendering skipped nodes rather than omitting them is what makes the
        branching visible: `human_review` sitting dashed and dimmed says the
        confidence gate was evaluated and passed.
        """
        t = self.start(node)
        return self.finish(t, status="skipped", output_summary={"reason": why})

    def _emit(self, t: NodeTrace) -> None:
        for fn in self.listeners:
            fn(t)
