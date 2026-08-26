"use client";

import { FACTOR_LABELS, FactorRow, inr, pts } from "@/lib/types";

/** Factor colours, as CSS variables so they follow the theme. */
const COLORS: Record<string, string> = {
  bank: "rgb(var(--sky))",
  method: "rgb(var(--iris))",
  hour: "rgb(var(--brand))",
  amount_band: "rgb(var(--mint))",
};

/**
 * The stacked bar. Two things it does that a normal chart does not:
 *  - the residual segment is HATCHED, so "we don't know what this is" reads
 *    without a caption;
 *  - each segment carries its measured error bar from the validation sweep.
 */
export function DecompositionStrip({
  factors,
  residual,
  onSelect,
}: {
  factors: FactorRow[];
  residual: number;
  onSelect?: (factor: string) => void;
}) {
  const positive = factors.filter((f) => f.points > 0);
  const total =
    positive.reduce((a, f) => a + f.points, 0) + Math.max(residual, 0);
  if (total <= 0) {
    return (
      <div className="text-sm text-muted font-mono">
        no positive attribution — this merchant is at or above its cohort
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-10 w-full rounded overflow-hidden border border-border">
        {positive.map((f) => (
          <button
            key={f.factor}
            onClick={() => onSelect?.(f.factor)}
            title={`${FACTOR_LABELS[f.factor] ?? f.factor}: ${pts(f.points)} pts`}
            className="relative group transition-opacity hover:opacity-80"
            style={{
              width: `${(f.points / total) * 100}%`,
              background: COLORS[f.factor] ?? "rgb(var(--faint))",
              opacity: f.identified ? 1 : 0.35,
            }}
          >
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-medium text-canvas">
              {f.points >= 0.4 ? f.points.toFixed(1) : ""}
            </span>
          </button>
        ))}
        {residual > 0 && (
          <div
            className="hatched bg-faint/30 border-l border-border"
            style={{ width: `${(residual / total) * 100}%` }}
            title={`Unexplained residual: ${pts(residual)} pts`}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-muted">
        {positive.map((f) => (
          <span key={f.factor} className="flex items-center gap-1.5">
            <i
              className="w-2.5 h-2.5 rounded-sm inline-block"
              style={{ background: COLORS[f.factor] ?? "rgb(var(--faint))" }}
            />
            {FACTOR_LABELS[f.factor] ?? f.factor} {pts(f.points)}
            {f.mae != null && <span className="text-faint">± {f.mae.toFixed(2)}</span>}
          </span>
        ))}
        {residual > 0 && (
          <span className="flex items-center gap-1.5">
            <i className="w-2.5 h-2.5 rounded-sm inline-block hatched bg-faint/30 border border-border" />
            residual {pts(residual)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The full table. Every row states its own uncertainty and whether it is
 * identified at all -- a factor with no overlap gets a NOT IDENTIFIED tag
 * rather than a confident small number.
 */
export function DecompositionTable({
  factors,
  residual,
  processGap,
  gap,
}: {
  factors: FactorRow[];
  residual: number;
  processGap: number;
  gap: number;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-muted font-mono border-b border-border">
          <th className="text-left py-2 font-normal">Factor</th>
          <th className="text-right py-2 font-normal">Points</th>
          <th className="text-right py-2 font-normal">± measured</th>
          <th className="text-right py-2 font-normal">Value / month</th>
          <th className="text-left py-2 pl-4 font-normal">Status</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {factors.map((f) => (
          <tr key={f.factor} className="border-b border-border/50">
            <td className="py-2 font-body">{FACTOR_LABELS[f.factor] ?? f.factor}</td>
            <td className="text-right tabular-nums">{pts(f.points)}</td>
            <td className="text-right tabular-nums text-muted">
              {f.mae != null ? `± ${f.mae.toFixed(2)}` : "—"}
            </td>
            <td className="text-right tabular-nums text-amber">
              {inr(f.value_paise, { compact: true })}
            </td>
            <td className="pl-4 text-[11px]">
              {!f.identified ? (
                <span className="text-red">NOT IDENTIFIED</span>
              ) : f.inside_error_bar ? (
                <span className="text-amber">inside its own error bar</span>
              ) : (
                <span className="text-green">resolved</span>
              )}
            </td>
          </tr>
        ))}

        {/* The residual gets its own visually distinct row. Hiding it in a
            footnote would be the single easiest way to look more confident
            than the method deserves. */}
        <tr className="border-b border-border/50 hatched">
          <td className="py-2 font-body text-muted">Unexplained residual</td>
          <td className="text-right tabular-nums text-muted">{pts(residual)}</td>
          <td className="text-right text-faint">—</td>
          <td className="text-right text-faint">—</td>
          <td className="pl-4 text-[11px] text-muted">not attributed to any factor</td>
        </tr>

        {/* Process gap sits ALONGSIDE the Shapley rows, never inside them --
            it is computed directly and would break the efficiency property. */}
        <tr className="border-b border-border/50 bg-raised/40">
          <td className="py-2 font-body">
            No soft-decline retry
            <span className="ml-2 text-[10px] text-muted font-mono">
              process gap — computed directly, not decomposed
            </span>
          </td>
          <td className="text-right tabular-nums">{pts(processGap)}</td>
          <td className="text-right text-faint">—</td>
          <td className="text-right text-faint">—</td>
          <td className="pl-4 text-[11px] text-muted">measured from the batch</td>
        </tr>

        <tr className="font-semibold">
          <td className="py-2 font-body">Total gap</td>
          <td className="text-right tabular-nums">{pts(gap)}</td>
          <td colSpan={3} />
        </tr>
      </tbody>
    </table>
  );
}
