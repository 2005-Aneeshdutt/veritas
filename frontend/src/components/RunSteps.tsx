"use client";

import { useEffect, useRef } from "react";
import { Coalition, ShapleyLive } from "@/components/ShapleyLive";
import { FLOW_ORDER, NODE_DOCS } from "@/lib/explain";
import { NodeTrace } from "@/lib/types";

export interface LiveStep {
  node: string;
  message: string;
  i: number;
  n: number;
  detail?: Record<string, any>;
}

/**
 * The agent working, read top to bottom.
 *
 * This replaced a node-and-edge diagram as the primary view. The graph was
 * accurate and looked impressive standing still, but it made watching a run
 * into a spatial search: the eye had to find which of ten boxes had just lit
 * up, while the sub-steps it produced scrolled in a console somewhere else.
 * Narrating that live is hard, and a demo is narrated.
 *
 * A deploy log solves the same problem and everyone already knows how to read
 * one. Finished steps collapse to a single line and a duration, the running
 * step is the one that is open, and its sub-steps appear underneath it where
 * they belong. Order is top to bottom, which is also the order you say it in.
 *
 * The sub-steps are real work, never a progress animation — sixteen lines
 * appear under `decompose` because sixteen coalitions were computed.
 */
export function RunSteps({
  traces,
  steps,
  live,
  onSelect,
  selected,
}: {
  traces: NodeTrace[];
  steps: LiveStep[];
  live: boolean;
  onSelect?: (node: string) => void;
  selected?: string;
}) {
  // The stream emits each node twice -- once as `running`, once with its
  // outcome -- sharing a seq. Keeping the newest per node means a step is
  // marked from what actually happened to it rather than from its position
  // in the list: `human_review` is skipped on most merchants and a green
  // tick there would be a small lie told ten times a demo.
  const byNode = new Map<string, NodeTrace>();
  for (const t of traces) byNode.set(t.node, t);

  const running = live
    ? traces.filter((t) => t.status === "running").slice(-1)[0]?.node ??
      traces[traces.length - 1]?.node
    : undefined;
  const tailRef = useRef<HTMLDivElement>(null);

  // Follow the work while it runs, but never yank the page once it stops.
  useEffect(() => {
    if (live) tailRef.current?.scrollIntoView({ block: "nearest" });
  }, [steps.length, live]);

  // Only the node that is running gets its sub-steps shown. Every node's
  // worth of lines on screen at once is the console this replaced.
  const liveSteps = steps.filter((s) => s.node === running).slice(-14);

  return (
    <div className="divide-y divide-line/60">
      {FLOW_ORDER.map((node) => {
        const t = byNode.get(node);
        const doc = NODE_DOCS[node];
        const isRunning = (live && running === node) || t?.status === "running";
        const skipped = t?.status === "skipped";
        const failed = t?.status === "error";
        const done = !!t && !isRunning && !skipped && !failed;
        const open = isRunning || selected === node;

        return (
          <div key={node}>
            <button
              onClick={() => onSelect?.(node)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3
                          transition-colors hover:bg-raised/60 ${
                            open ? "bg-raised/40" : ""
                          }`}
            >
              <Dot
                done={done}
                running={isRunning}
                skipped={skipped}
                failed={failed}
                pending={!t}
              />

              <span
                className={`text-sm shrink-0 ${
                  t ? "text-ink" : "text-faint"
                } ${isRunning ? "font-medium" : ""}`}
              >
                {doc?.title ?? node}
              </span>

              <span className="text-[11px] text-faint truncate hidden sm:block">
                {doc?.tagline}
              </span>

              <span className="ml-auto flex items-center gap-2 shrink-0">
                {doc?.kind === "llm" && (
                  <span className="chip-neutral text-[10px]">model</span>
                )}
                {skipped && (
                  <span className="text-[11px] text-faint">not needed</span>
                )}
                {t && !skipped && (
                  <span className="num text-[11px] text-faint tabular-nums">
                    {t.duration_ms < 1000
                      ? `${Math.round(t.duration_ms)}ms`
                      : `${(t.duration_ms / 1000).toFixed(1)}s`}
                  </span>
                )}
              </span>
            </button>

            {/* The decomposition gets shown rather than logged. Sixteen
                lines of "v(bank+hour) = +3.893" scrolling past is the most
                interesting computation in the product rendered as noise. */}
            {isRunning && node === "decompose" && (
              <div className="px-4 pb-4 pl-11">
                <ShapleyLive
                  coalitions={steps
                    .filter(
                      (x) =>
                        x.node === "decompose" &&
                        x.detail?.coalition !== undefined &&
                        typeof x.detail?.value === "number"
                    )
                    .map((x) => ({
                      label: String(x.detail!.coalition),
                      value: Number(x.detail!.value),
                    })) as Coalition[]}
                />
              </div>
            )}

            {isRunning && node !== "decompose" && liveSteps.length > 0 && (
              <div className="px-4 pb-3 pl-11 font-mono text-[11px] space-y-0.5">
                {liveSteps.map((s, i) => (
                  <div
                    key={`${s.node}-${s.i}-${i}`}
                    className={`truncate ${tone(s)} animate-rise`}
                  >
                    {s.message}
                  </div>
                ))}
                <div ref={tailRef} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Colour a sub-step by what it did, so a denial is not the same grey as a hit. */
function tone(s: LiveStep): string {
  const d = s.detail ?? {};
  if (d.decision === "deny") return "text-rose";
  if (d.decision === "step_up") return "text-amber";
  if (d.decision === "allow" || d.succeeded === true) return "text-mint";
  if (d.succeeded === false) return "text-faint";
  if (d.source === "model") return "text-iris";
  return "text-muted";
}

function Dot({
  done,
  running,
  skipped,
  failed,
  pending,
}: {
  done: boolean;
  running: boolean;
  skipped?: boolean;
  failed?: boolean;
  pending: boolean;
}) {
  if (failed)
    return (
      <span
        className="w-4 h-4 shrink-0 rounded-full bg-rose/15 text-rose grid
                   place-items-center text-[10px] leading-none"
      >
        !
      </span>
    );
  if (skipped)
    return (
      <span className="w-4 h-4 shrink-0 grid place-items-center text-faint text-[11px]">
        –
      </span>
    );
  if (running)
    return (
      <span className="w-4 h-4 shrink-0 grid place-items-center">
        <span className="w-2 h-2 rounded-full bg-brand animate-breathe" />
      </span>
    );
  if (done)
    return (
      <span
        className="w-4 h-4 shrink-0 rounded-full bg-mint/15 text-mint grid
                   place-items-center text-[10px] leading-none"
      >
        ✓
      </span>
    );
  return (
    <span className="w-4 h-4 shrink-0 grid place-items-center">
      <span
        className={`w-2 h-2 rounded-full border ${
          pending ? "border-line" : "border-muted"
        }`}
      />
    </span>
  );
}
