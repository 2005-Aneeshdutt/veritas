"use client";

import { useEffect, useRef, useState } from "react";
import { FLOW_ORDER, NODE_DOCS } from "@/lib/explain";
import { NodeTrace } from "@/lib/types";

/**
 * One visual language for the system doing work.
 *
 * Every stage on screen is a node the graph really executed: the component
 * consumes `/api/run/{merchant}/stream`, which emits a NodeTrace when a node
 * starts and again when it finishes, plus sub-steps carrying their own i-of-n.
 * `pace_ms` throttles the DRAIN and never the work, so what you watch is the
 * real run arriving at a readable speed rather than an animation timed to
 * look like one.
 *
 * The consequence worth stating: nothing here can show a stage the engine did
 * not run, or a count it did not produce. `human_review` is skipped on most
 * merchants and renders as skipped, because pretending otherwise would be a
 * small lie told once per demo.
 */

export type Phase = "queued" | "running" | "ok" | "skipped" | "failed";

export interface Stage {
  key: string;
  label: string;
  /** What the node is for, in one line. */
  blurb: string;
  phase: Phase;
  ms?: number;
  /** The node's own output, as it reported it. */
  facts?: [string, string][];
  /** Sub-step progress, when the node emits it. */
  i?: number;
  n?: number;
  step?: string;
  kind?: "deterministic" | "llm";
}

/** The pipeline, named the way the walkthrough names it. */
const STAGE_LABEL: Record<string, string> = {
  ingest: "Ingest",
  classify: "Classify",
  human_review: "Human review",
  bank_health: "Baseline",
  decompose: "Decompose",
  hypothesise: "Attribute",
  plan: "Plan",
  gate: "Policy gate",
  execute: "Execute",
  report: "Score",
};

const STAGE_BLURB: Record<string, string> = {
  ingest: "Read the month of payments",
  classify: "Sort every error code",
  human_review: "Escalate anything the model was unsure of",
  bank_health: "Establish what this category achieves",
  decompose: "Sixteen coalitions, four factors",
  hypothesise: "Name the cause, with its error bar",
  plan: "Choose the intervention",
  gate: "Twelve rules against the signed mandate",
  execute: "Act, but only inside the mandate",
  report: "Mark it against ground truth",
};

/** Numbers a node reports that are worth putting on screen. */
const FACT_LABEL: Record<string, string> = {
  transactions: "payments",
  failures: "failures",
  observed_success_pct: "success rate",
  wilson_halfwidth_pts: "± interval",
  cohort_s_star_pct: "category achieves",
  gap_pts: "gap",
  primary: "primary cause",
  primary_cause: "primary cause",
  residual_pts: "residual",
  coalitions: "coalitions",
  actions: "actions",
  allowed: "allowed",
  stepped_up: "held",
  denied: "denied",
  recovered_paise: "recovered",
  ledger_entries: "ledger entries",
  classified: "codes classified",
  withheld: "withheld",
};

function fmt(k: string, v: unknown): string {
  if (typeof v === "number") {
    if (k.endsWith("_paise")) return "₹" + Math.round(v / 100).toLocaleString("en-IN");
    if (k.endsWith("_pct") || k.endsWith("_pts")) return v.toFixed(2);
    return v.toLocaleString("en-IN");
  }
  return String(v);
}

/** Build the display stages from whatever the stream has emitted so far. */
export function stagesFrom(
  traces: NodeTrace[],
  steps: { node: string; message: string; i: number; n: number }[],
  live: boolean
): Stage[] {
  const byNode = new Map<string, NodeTrace>();
  for (const t of traces) byNode.set(t.node, t);
  const lastStep = new Map<string, { message: string; i: number; n: number }>();
  for (const s of steps) lastStep.set(s.node, s);

  return FLOW_ORDER.map((key) => {
    const t = byNode.get(key);
    const st = lastStep.get(key);

    let phase: Phase = "queued";
    if (t) {
      if (t.status === "running") phase = "running";
      else if (t.status === "skipped") phase = "skipped";
      else if (t.status === "error") phase = "failed";
      else phase = "ok";
    } else if (!live && traces.length) {
      // A finished record that never mentions this node means it was skipped.
      phase = "skipped";
    }

    const out = (t?.output_summary ?? {}) as Record<string, unknown>;
    const mid = (t?.intermediates ?? {}) as Record<string, unknown>;
    const facts: [string, string][] = [];
    for (const [k, v] of [...Object.entries(out), ...Object.entries(mid)]) {
      if (v === null || v === undefined || typeof v === "object") continue;
      const label = FACT_LABEL[k];
      if (!label) continue;
      facts.push([label, fmt(k, v)]);
      if (facts.length >= 4) break;
    }

    return {
      key,
      label: STAGE_LABEL[key] ?? key,
      blurb: STAGE_BLURB[key] ?? NODE_DOCS[key]?.what ?? "",
      phase,
      ms: t?.duration_ms,
      facts,
      i: st?.i,
      n: st?.n,
      step: st?.message,
      kind: t?.kind as "deterministic" | "llm" | undefined,
    };
  });
}

/* ─────────────────────────────────────────────────────── the display */

const DOT: Record<Phase, string> = {
  queued: "bg-line",
  running: "bg-brand",
  ok: "bg-mint",
  skipped: "bg-edge",
  failed: "bg-rose",
};

const WORD: Record<Phase, string> = {
  queued: "queued",
  running: "running",
  ok: "complete",
  skipped: "not needed",
  failed: "failed",
};

export function AgentPipeline({
  stages,
  live,
  compact = false,
}: {
  stages: Stage[];
  live: boolean;
  compact?: boolean;
}) {
  const done = stages.filter((s) => s.phase === "ok" || s.phase === "skipped").length;
  const running = stages.find((s) => s.phase === "running");
  const tail = useRef<HTMLDivElement>(null);

  // Follow the work while it runs; never yank the page once it stops.
  useEffect(() => {
    if (live && running && !compact) {
      tail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [running?.key, live, compact]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            live ? "bg-brand animate-pulse-ring" : "bg-mint"
          }`}
        />
        <span className="ui text-[11px] uppercase tracking-[0.12em] text-muted">
          Revenue Doctor
        </span>
        <span
          className={`chip ${live ? "text-brand" : "text-mint"}`}
        >
          {live ? "active" : "idle"}
        </span>
        <span className="ml-auto num text-[11px] text-faint">
          {done}/{stages.length}
        </span>
      </div>

      {/* the progress hairline — the only chrome that moves when nothing else does */}
      <div className="h-px bg-line">
        <div
          className="h-px bg-brand transition-[width] duration-500"
          style={{ width: `${(done / Math.max(1, stages.length)) * 100}%` }}
        />
      </div>

      <ol className="p-2">
        {stages.map((s) => (
          <li key={s.key} className="relative">
            <div
              className={`flex items-baseline gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                s.phase === "running" ? "bg-brand-soft" : ""
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${DOT[s.phase]} ${
                  s.phase === "running" ? "animate-pulse-ring" : ""
                }`}
              />

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className={`text-[13px] ${
                      s.phase === "queued"
                        ? "text-faint"
                        : s.phase === "running"
                        ? "text-ink font-medium"
                        : "text-ink"
                    }`}
                  >
                    {s.label}
                  </span>
                  {s.kind === "llm" && <span className="chip text-iris">model</span>}
                  {s.phase === "running" && s.n ? (
                    <span className="num text-[11px] text-brand">
                      {s.i}/{s.n}
                    </span>
                  ) : null}
                  <span className="ml-auto num text-[10px] text-faint shrink-0">
                    {s.phase === "ok" && s.ms !== undefined
                      ? `${s.ms} ms`
                      : WORD[s.phase]}
                  </span>
                </span>

                {!compact && s.phase === "queued" && (
                  <span className="block text-[11px] text-faint mt-0.5">{s.blurb}</span>
                )}

                {/* the sub-step the node is on right now — real work, never a spinner */}
                {s.phase === "running" && s.step && !compact && (
                  <span className="block num text-[10px] text-muted mt-1 truncate">
                    {s.step}
                  </span>
                )}
                {s.phase === "running" && s.n ? (
                  <span className="block h-0.5 rounded-full bg-line mt-1.5 overflow-hidden">
                    <span
                      className="block h-full bg-brand transition-[width] duration-200"
                      style={{ width: `${((s.i ?? 0) / s.n) * 100}%` }}
                    />
                  </span>
                ) : null}

                {/* what the node reported when it finished */}
                {s.phase === "ok" && s.facts && s.facts.length > 0 && !compact && (
                  <span className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {s.facts.map(([k, v]) => (
                      <span key={k} className="text-[11px]">
                        <span className="text-faint">{k} </span>
                        <span className="num text-muted">{v}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div ref={tail} />
    </div>
  );
}
