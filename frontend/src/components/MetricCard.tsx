"use client";

import { ReactNode } from "react";

/**
 * The only component allowed to render a headline metric.
 *
 * RULE 2 is enforced by construction: `kind` is required, so it is impossible
 * to add a metric to this UI without deciding whether it is measured against
 * ground truth or modelled from assumptions. Projected cards carry the amber
 * hatch; measured cards are solid green.
 */
export function MetricCard({
  label,
  value,
  sub,
  kind,
  error,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  kind: "measured" | "projected";
  /** Rendered as "± n", sourced from the validation sweep. Never a guess. */
  error?: number | null;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-green" : tone === "bad" ? "text-red" : "text-ink";
  return (
    <div
      className={`${
        kind === "measured" ? "measured-panel" : "projected-panel"
      } p-4 flex flex-col gap-1`}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted font-mono">
        {label}
      </div>
      <div className={`text-2xl font-display font-bold ${toneClass}`}>
        {value}
        {error != null && (
          <span className="text-sm font-mono font-normal text-muted ml-1.5">
            ± {error.toFixed(2)}
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-muted leading-snug">{sub}</div>}
    </div>
  );
}

/**
 * The labelled divider between the two groups. This wall IS the thesis,
 * rendered -- so it gets a real caption on each side rather than a badge.
 */
export function MeasuredProjectedWall({
  measured,
  projected,
}: {
  measured: ReactNode;
  projected: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip-measured">measured</span>
          <span className="text-xs text-muted">
            computed against ground truth, or cryptographically verified
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">{measured}</div>
      </section>

      <div className="hidden lg:flex flex-col items-center justify-center px-1">
        <div className="w-px flex-1 bg-border" />
        <div className="py-3 text-[10px] font-mono text-faint [writing-mode:vertical-rl] rotate-180 tracking-widest">
          THE WALL
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip-projected">projected</span>
          <span className="text-xs text-muted">
            modelled — assumptions in priors.py and mock_rail.py
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">{projected}</div>
      </section>
    </div>
  );
}
