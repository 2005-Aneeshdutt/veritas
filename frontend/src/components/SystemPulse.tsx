"use client";

import { useEffect, useState } from "react";
import { Activity, PIPELINE, onActivity } from "@/lib/activity";

/**
 * The one place the whole app says it is alive.
 *
 * Ten marks, one per node in the engine's graph, sitting in the sidebar
 * footer. Idle they are a dim rule and read as chrome; while work is
 * streaming they fill left to right as nodes genuinely finish, and the label
 * underneath says what is running.
 *
 * This is the entire answer to "the background should communicate that the
 * system is working". One element, always in the same place, never competing
 * with the page — rather than an agent card stapled to every screen, which is
 * how a console turns into a dashboard about itself.
 *
 * It cannot show activity that is not happening. Nothing publishes to the bus
 * except stream handlers with an open connection.
 */
export function SystemPulse() {
  const [a, setA] = useState<Activity>({ label: "Idle", active: false });
  useEffect(() => onActivity(setA), []);

  const total = a.total ?? PIPELINE.length;
  const done = a.done ?? 0;

  return (
    <div className="px-2.5 pt-2 pb-1.5">
      <div className="flex items-center gap-1" aria-hidden>
        {PIPELINE.slice(0, total).map((node, i) => {
          const finished = i < done;
          const running = a.active && i === done;
          return (
            <span
              key={node}
              title={node.replace(/_/g, " ")}
              className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
                finished
                  ? "bg-brand"
                  : running
                  ? "bg-brand/60 animate-breathe"
                  : "bg-line"
              }`}
            />
          );
        })}
      </div>

      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span
          className={`text-[10.5px] truncate ${
            a.active ? "text-brand" : "text-faint"
          }`}
        >
          {a.active ? a.label : "Engine idle"}
        </span>
        {a.active && a.n ? (
          <span className="num text-[10px] text-faint ml-auto shrink-0">
            {a.i}/{a.n}
          </span>
        ) : a.active ? (
          <span className="num text-[10px] text-faint ml-auto shrink-0">
            {done}/{total}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A hairline across the top of the viewport while anything is streaming.
 *
 * The sidebar mark is easy to miss on a projector from the back of a room.
 * This is two pixels and no layout cost, and it is the only thing in the app
 * that draws over the page.
 */
export function ActivityLine() {
  const [a, setA] = useState<Activity>({ label: "Idle", active: false });
  useEffect(() => onActivity(setA), []);

  if (!a.active) return null;
  const total = a.total ?? PIPELINE.length;
  const pct = a.n ? ((a.i ?? 0) / a.n) * 100 : ((a.done ?? 0) / total) * 100;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] h-[2px] bg-transparent pointer-events-none"
      role="status"
      aria-label={a.label}
    >
      <div
        className="h-full bg-brand transition-[width] duration-200"
        style={{ width: `${Math.max(4, pct)}%` }}
      />
    </div>
  );
}
