"use client";

import { useMemo } from "react";

const FACTORS = ["bank", "method", "hour", "amount_band"] as const;
const SHORT: Record<string, string> = {
  bank: "bank",
  method: "method",
  hour: "hour",
  amount_band: "amount",
};

export interface Coalition {
  label: string;
  value: number;
}

/**
 * The decomposition, while it is being computed.
 *
 * This is the mathematical heart of the project and it was rendered as log
 * spam: sixteen lines of "v(bank+hour) = +3.893 pts" scrolling past, then a
 * finished table of four numbers. Everything interesting happened between
 * those two things and none of it was on screen.
 *
 * So the lattice fills in as each coalition is evaluated, and the four
 * attributions build from it. Nothing here is animated for effect — every
 * cell appears when the server actually finished computing that subset, and
 * the arithmetic below is done on the values that arrived, not on a stored
 * answer fetched in advance.
 *
 * The efficiency check at the bottom is the point of using Shapley at all.
 * Naive attribution ranks the same factors and its magnitudes do not add up
 * to the whole, which makes them unconvertible to rupees. Watching the parts
 * land exactly on v(N) is the argument for the method, made in one line.
 */
export function ShapleyLive({
  coalitions,
  gapPts,
}: {
  coalitions: Coalition[];
  gapPts?: number;
}) {
  const seen = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of coalitions) m.set(c.label, c.value);
    return m;
  }, [coalitions]);

  // Every subset of four factors, smallest first — the order the decomposer
  // walks them, so the grid fills the way the work happens.
  const lattice = useMemo(() => {
    const out: { label: string; size: number }[] = [];
    for (let mask = 0; mask < 16; mask++) {
      const parts = FACTORS.filter((_, i) => mask & (1 << i));
      out.push({ label: parts.length ? parts.join("+") : "{}", size: parts.length });
    }
    return out.sort((a, b) => a.size - b.size);
  }, []);

  const vN = seen.get(FACTORS.join("+"));
  const done = coalitions.length;

  /**
   * Shapley values from the coalitions that have arrived.
   *
   * Recomputed in the browser from the streamed subset values rather than
   * read off the finished record, so what is drawn is provably a function of
   * what has been shown. A partial lattice gives partial bars, which is the
   * honest thing for a computation still in flight.
   */
  const phi = useMemo(() => {
    const fact = [1, 1, 2, 6, 24];
    const out: Record<string, number | null> = {};
    for (let i = 0; i < FACTORS.length; i++) {
      let total = 0;
      let complete = true;
      for (let mask = 0; mask < 16; mask++) {
        if (mask & (1 << i)) continue;
        const without = FACTORS.filter((_, j) => mask & (1 << j));
        const withF = FACTORS.filter((_, j) => (mask | (1 << i)) & (1 << j));
        const a = seen.get(without.length ? without.join("+") : "{}");
        const b = seen.get(withF.join("+"));
        if (a === undefined || b === undefined) {
          complete = false;
          break;
        }
        const s = without.length;
        const w = (fact[s] * fact[3 - s]) / fact[4];
        total += w * (b - a);
      }
      out[FACTORS[i]] = complete ? total : null;
    }
    return out;
  }, [seen]);

  const sum = FACTORS.reduce((a, f) => a + (phi[f] ?? 0), 0);
  const allDone = FACTORS.every((f) => phi[f] !== null) && vN !== undefined;
  const residual = allDone ? sum - (vN as number) : null;

  const max = Math.max(
    0.001,
    ...[...seen.values()].map((v) => Math.abs(v)),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="eyebrow">coalition values</span>
        <span className="num text-[11px] text-faint">{done} of 16</span>
        <div className="flex-1 h-0.5 bg-raised rounded-full overflow-hidden min-w-[60px]">
          <div
            className="h-full bg-brand transition-[width] duration-300"
            style={{ width: `${(done / 16) * 100}%` }}
          />
        </div>
      </div>

      {/* ── the lattice, filling in as each subset is evaluated ── */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
        {lattice.map((c) => {
          const v = seen.get(c.label);
          const has = v !== undefined;
          const share = has ? Math.abs(v) / max : 0;
          return (
            <div
              key={c.label}
              className={`rounded-md px-2 py-1.5 border transition-all duration-300 ${
                has
                  ? "border-brand/40 bg-brand-soft animate-rise"
                  : "border-line bg-raised/40"
              }`}
              title={c.label}
            >
              <div className="text-[9px] text-faint truncate leading-tight">
                {c.label === "{}"
                  ? "∅"
                  : c.label
                      .split("+")
                      .map((p) => SHORT[p] ?? p)
                      .join("+")}
              </div>
              <div
                className={`num text-[11px] font-semibold leading-tight mt-0.5 ${
                  has ? "" : "text-faint"
                }`}
                style={has ? { opacity: 0.45 + 0.55 * share } : undefined}
              >
                {has ? v.toFixed(2) : "·"}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── the attributions those coalitions imply ── */}
      <div className="space-y-1.5 pt-1">
        <div className="eyebrow">what each factor is worth</div>
        {FACTORS.map((f) => {
          const v = phi[f];
          const pending = v === null;
          const w = pending ? 0 : Math.min(100, (Math.abs(v) / Math.max(0.001, Math.abs(sum) || 1)) * 100);
          return (
            <div key={f} className="flex items-center gap-3">
              <span className="text-[11px] text-muted w-16 shrink-0">
                {SHORT[f]}
              </span>
              <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                <div
                  className="h-full bg-brand transition-[width] duration-500"
                  style={{ width: `${w}%` }}
                />
              </div>
              <span
                className={`num text-[11px] w-16 text-right shrink-0 ${
                  pending ? "text-faint" : ""
                }`}
              >
                {pending ? "…" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── the reason the method earns its place ── */}
      {allDone && (
        <div className="card-raised p-3 animate-rise">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-muted">
              Σφᵢ = v(all four)
            </span>
            <span className="num text-[11px]">
              {sum.toFixed(4)} = {(vN as number).toFixed(4)}
            </span>
          </div>
          <p className="text-[11px] text-faint mt-1.5 leading-relaxed">
            The parts add up to the whole, to{" "}
            <span className="num">{Math.abs(residual ?? 0).toExponential(1)}</span>{" "}
            points. That is what makes these convertible to rupees — naive
            attribution ranks the same factors and its magnitudes average 2.2×
            the real gap, which cannot be spent.
          </p>
        </div>
      )}
    </div>
  );
}
