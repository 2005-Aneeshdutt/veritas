"use client";

import { useEffect, useRef, useState } from "react";
import { Stage } from "@/components/AgentPipeline";
import { LiveStep } from "@/components/useDiagnosis";

/**
 * The investigation, as one connected thing.
 *
 * The page this replaces put ten node cards in a column, then the findings a
 * screen and a half further down, so a viewer read a report rather than
 * watched an examination. Here the pipeline is a single rail with the event
 * feed beside it, and both are driven entirely by the real stream: a node
 * shows RUNNING only while the engine says it is running, COMPLETE only when
 * it finished, and SKIPPED when it genuinely skipped.
 *
 * There are no timers, no interpolated percentages and no invented stages. If
 * the stream stops, the rail stops — which is the only honest way to render a
 * process you do not control.
 */

const LABEL: Record<string, string> = {
  ingest: "Ingest",
  classify: "Classify",
  human_review: "Human review",
  bank_health: "Bank health",
  decompose: "Decompose",
  hypothesise: "Hypothesise",
  plan: "Plan",
  gate: "Gate",
  execute: "Execute",
  report: "Report",
};

/** The one line a node shows: what it produced, or what it is doing. */
function line(s: Stage): string {
  if (s.phase === "running") {
    if (s.n) return `${s.i} / ${s.n}`;
    return "working";
  }
  if (s.phase === "skipped") return "not needed";
  if (s.phase === "queued") return "waiting";
  const f = s.facts?.[0];
  return f ? `${f[1]} ${f[0]}` : "done";
}

export function PipelineRail({ stages }: { stages: Stage[] }) {
  return (
    <ol className="grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-2.5">
      {stages.map((s) => {
        const on = s.phase === "running";
        const done = s.phase === "ok";
        const skip = s.phase === "skipped";
        return (
          <li
            key={s.key}
            className={`relative rounded-lg border px-2.5 py-2 transition-all duration-300 ${
              on
                ? "border-brand bg-brand-soft shadow-[0_0_0_3px_rgb(var(--brand)/0.12)]"
                : done
                ? "border-line bg-surface"
                : "border-line/60 bg-transparent"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  on
                    ? "bg-brand animate-pulse-ring"
                    : done
                    ? "bg-mint"
                    : skip
                    ? "bg-edge"
                    : "bg-line"
                }`}
              />
              <span
                className={`ui text-[10px] uppercase tracking-[0.1em] truncate ${
                  on ? "text-brand" : done ? "text-ink" : "text-faint"
                }`}
              >
                {LABEL[s.key] ?? s.key}
              </span>
            </div>
            <div
              className={`num text-[11px] mt-1 truncate ${
                on ? "text-ink" : done ? "text-muted" : "text-faint"
              }`}
            >
              {line(s)}
            </div>
            {on && s.n ? (
              <span className="block h-0.5 rounded-full bg-line mt-1.5 overflow-hidden">
                <span
                  className="block h-full bg-brand transition-[width] duration-200"
                  style={{ width: `${((s.i ?? 0) / s.n) * 100}%` }}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What just happened, newest first.
 *
 * An event feed rather than a log: capped at seven rows so it stays a glance
 * instead of a wall, and every line is something the engine emitted.
 */
export function EventFeed({
  steps,
  stages,
  live,
}: {
  steps: LiveStep[];
  stages: Stage[];
  live: boolean;
}) {
  const [events, setEvents] = useState<{ t: string; text: string; tone: string }[]>([]);
  const seen = useRef<Set<string>>(new Set());

  // A node finishing is an event; so is every tenth sub-step, which keeps a
  // 61-step classify from flooding the feed with its own progress.
  useEffect(() => {
    const now = () =>
      new Date().toLocaleTimeString("en-GB", { hour12: false });
    const add: { t: string; text: string; tone: string }[] = [];

    for (const s of stages) {
      const key = `${s.key}:${s.phase}`;
      if (s.phase === "queued" || s.phase === "running") continue;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      add.push({
        t: now(),
        text:
          s.phase === "skipped"
            ? `${LABEL[s.key] ?? s.key} not needed`
            : `${LABEL[s.key] ?? s.key} complete${
                s.facts?.[0] ? ` — ${s.facts[0][1]} ${s.facts[0][0]}` : ""
              }`,
        tone: s.phase === "skipped" ? "text-faint" : "text-mint",
      });
    }

    const last = steps[steps.length - 1];
    if (last && last.n && (last.i % 10 === 0 || last.i === last.n)) {
      const key = `${last.node}:${last.i}`;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        add.push({
          t: now(),
          text: `${LABEL[last.node] ?? last.node} ${last.i} / ${last.n}`,
          tone: "text-brand",
        });
      }
    }

    if (add.length) setEvents((prev) => [...add.reverse(), ...prev].slice(0, 7));
  }, [stages, steps]);

  useEffect(() => {
    if (!live) return;
    seen.current = seen.current;
  }, [live]);

  return (
    <div className="panel h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line shrink-0">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            live ? "bg-brand animate-pulse-ring" : "bg-mint"
          }`}
        />
        <span className="ui text-[10px] uppercase tracking-[0.12em] text-muted">
          {live ? "Live" : "Event log"}
        </span>
      </div>
      <div className="flex-1 overflow-hidden px-3 py-1.5">
        {events.length === 0 ? (
          <p className="text-[11px] text-faint py-1.5">
            Nothing yet. Press Run diagnosis.
          </p>
        ) : (
          events.map((e, i) => (
            <div
              key={`${e.t}-${i}`}
              className="flex items-baseline gap-2 py-[3px] animate-rise"
            >
              <span className="num text-[10px] text-faint shrink-0">{e.t}</span>
              <span className={`text-[11px] truncate ${e.tone}`}>{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The root cause, once there is one.
 *
 * The strongest element on the page after the investigation, because it is
 * the answer the whole thing exists to produce. The error bar is beside the
 * figure rather than in a footnote: whether a cause clears twice its own
 * measured error is what decides if the agent may act on it unattended, so
 * hiding it would hide the decision.
 */
export function RootCause({
  factor,
  points,
  mae,
  summary,
  onEvidence,
}: {
  factor: string;
  points: number;
  mae?: number;
  summary?: string;
  onEvidence?: () => void;
}) {
  const actionable = mae ? Math.abs(points) > 2 * mae : false;
  return (
    <div className="panel border-l-2 border-l-brand p-5">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
          Root cause
        </span>
        <span className={actionable ? "chip-measured" : "chip-projected"}>
          {actionable ? "actionable" : "inside its own error bar"}
        </span>
      </div>

      <div className="flex items-end gap-6 flex-wrap mt-2.5">
        <div>
          <div className="text-[24px] font-semibold tracking-tight leading-none">
            {factor.replace(/_/g, " ")}
          </div>
        </div>
        <div className="num text-[24px] font-semibold leading-none text-brand">
          {points >= 0 ? "+" : ""}
          {points.toFixed(2)}
          {mae !== undefined && (
            <span className="text-[15px] text-faint font-normal">
              {" "}
              ± {mae.toFixed(2)}
            </span>
          )}
          <span className="text-[13px] text-faint font-normal"> pts</span>
        </div>
      </div>

      {summary && (
        <p className="text-[13px] text-muted mt-3 leading-relaxed max-w-2xl">
          {summary}
        </p>
      )}

      {onEvidence && (
        <button onClick={onEvidence} className="text-[12px] text-brand mt-3">
          View evidence →
        </button>
      )}
    </div>
  );
}

/**
 * The four factors, with the bar each has to clear drawn on it.
 *
 * The pale band is the factor's own measured error. A bar that does not
 * clear twice its band is not acted on, so drawing the bar without the band
 * would show the conclusion and hide the test.
 */
export function Attribution({
  factors,
  gapPts,
  residual,
}: {
  factors: { factor: string; points: number; mae?: number; identified?: boolean }[];
  gapPts?: number;
  residual?: number;
}) {
  if (!factors.length) return null;
  const max = Math.max(...factors.map((f) => Math.abs(f.points)), 0.01);

  return (
    <div>
      <div className="space-y-2.5">
        {factors.map((f) => {
          const w = (Math.abs(f.points) / max) * 100;
          const err = f.mae ? (f.mae / max) * 100 : 0;
          const acts = f.mae ? Math.abs(f.points) > 2 * f.mae : false;
          return (
            <div key={f.factor} className="flex items-center gap-3">
              <span className="text-[12px] text-muted w-28 shrink-0 truncate">
                {f.factor.replace(/_/g, " ")}
              </span>
              <span className="relative flex-1 h-2.5 rounded-full bg-raised overflow-hidden min-w-[60px]">
                <span
                  className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ${
                    acts ? "bg-brand" : "bg-edge"
                  }`}
                  style={{ width: `${w}%` }}
                />
                {err > 0 && (
                  <span
                    className="absolute inset-y-0 bg-ink/20 border-x border-ink/30"
                    style={{
                      left: `${Math.max(0, w - err)}%`,
                      width: `${Math.min(100, err * 2)}%`,
                    }}
                    title={`± ${f.mae?.toFixed(2)} pts measured error`}
                  />
                )}
              </span>
              <span className="num text-[12px] w-24 text-right shrink-0">
                {f.points >= 0 ? "+" : ""}
                {f.points.toFixed(2)}
                {f.mae ? <span className="text-faint"> ±{f.mae.toFixed(2)}</span> : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-5 flex-wrap mt-3.5 pt-3 border-t border-line">
        <span className="text-[11px] text-muted">
          <span className="num">Σφ</span> reconciles to{" "}
          <span className="num text-mint">v(N)</span>
          {residual !== undefined && (
            <span className="text-faint">
              {" "}
              — residual {Math.abs(residual).toFixed(4)} pts
            </span>
          )}
        </span>
        <span className="chip-measured">16 coalitions</span>
        <span className="text-[11px] text-faint">
          the pale band is each factor&rsquo;s own measured error
        </span>
      </div>
    </div>
  );
}
