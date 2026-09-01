"use client";

import { AgentPipeline, Stage } from "@/components/AgentPipeline";
import { EventFeed, PipelineRail } from "@/components/Investigation";
import { LiveStep } from "@/components/useDiagnosis";

/**
 * The first screen: who, how far behind, and what the system is doing.
 *
 * Measured on the page this replaces, the gap figures sat at y=669 inside a
 * mid-page comparison while the hero was given to a recovery total. The story
 * was inverted — a viewer met the answer before the question. So the gap is
 * the hero now, and the investigation sits directly under it, both inside the
 * first 768px.
 *
 * The right-hand column reports the engine's current state and nothing else.
 * It says RUNNING only while a node is running, and the node it names is the
 * one the stream says is running.
 */
export function DiagnoseHead({
  merchant,
  observedPct,
  achievablePct,
  gapPts,
  stages,
  steps,
  live,
  finished,
  onRun,
  onStop,
  everRan,
}: {
  merchant: string;
  observedPct: number;
  achievablePct: number;
  gapPts: number;
  stages: Stage[];
  steps: LiveStep[];
  live: boolean;
  finished: boolean;
  onRun: () => void;
  onStop: () => void;
  everRan: boolean;
}) {
  const running = stages.find((s) => s.phase === "running");
  const done = stages.filter(
    (s) => s.phase === "ok" || s.phase === "skipped"
  ).length;
  const coalitions = steps.filter((s) => s.node === "decompose").slice(-1)[0];

  return (
    <div className="space-y-5">
      {/* ── who, and how far behind ── */}
      <div className="flex items-end justify-between gap-8 flex-wrap">
        <div className="min-w-0">
          <div className="ui text-[10px] uppercase tracking-[0.14em] text-brand">
            {live ? "Diagnosing" : finished ? "Diagnosis complete" : "Diagnosis"}
          </div>
          <h1 className="mt-1">{merchant}</h1>

          <div className="flex items-end gap-6 mt-3 flex-wrap">
            <Fig label="your success" value={`${observedPct.toFixed(2)}%`} />
            <span className="text-faint pb-1.5 text-lg">→</span>
            <Fig
              label="category"
              value={`${achievablePct.toFixed(2)}%`}
              tone="text-amber"
            />
            <Fig
              label="gap"
              value={`${gapPts.toFixed(2)} pts`}
              tone="text-rose"
              big
            />
          </div>
        </div>

        {/* ── what the engine is doing, right now ── */}
        <div className="panel px-4 py-3 min-w-[16rem]">
          <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
            System state
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                live ? "bg-brand animate-pulse-ring" : "bg-mint"
              }`}
            />
            <span
              className={`text-[13px] font-medium ${
                live ? "text-brand" : "text-mint"
              }`}
            >
              {live ? "Running" : finished ? "Ready" : "Idle"}
            </span>
            <span className="num text-[11px] text-faint ml-auto">
              {done}/{stages.length}
            </span>
          </div>
          <div className="text-[11.5px] text-muted mt-1.5 truncate">
            {live && running
              ? running.label +
                (running.n ? ` — ${running.i} / ${running.n}` : "")
              : finished
              ? `${done} nodes${
                  coalitions ? `, ${coalitions.n} coalitions` : ""
                }`
              : "waiting to be asked"}
          </div>

          <div className="mt-3">
            {live ? (
              <button onClick={onStop} className="btn-secondary w-full h-8 text-[12px]">
                ■ Stop
              </button>
            ) : (
              <button onClick={onRun} className="btn-primary w-full h-8 text-[12px]">
                {everRan ? "↺ Run it again" : "▶ Run diagnosis"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── the investigation ── */}
      <div>
        <div className="flex items-baseline gap-3 flex-wrap mb-2.5">
          <h2>Live investigation</h2>
          <span className="text-[12px] text-muted">
            Every node below is one the engine really ran. Pacing throttles the
            feed, never the work.
          </span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] gap-4 items-stretch">
          <PipelineRail stages={stages} />
          <EventFeed steps={steps} stages={stages} live={live} />
        </div>
      </div>
    </div>
  );
}

function Fig({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: string;
  big?: boolean;
}) {
  return (
    <div>
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
      <div
        className={`num font-semibold leading-none mt-1 tracking-tight ${
          big ? "text-[34px]" : "text-[24px]"
        } ${tone ?? ""}`}
      >
        {value}
      </div>
    </div>
  );
}
