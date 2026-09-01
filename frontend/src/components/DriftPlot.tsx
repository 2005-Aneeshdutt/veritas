"use client";

import { useEffect, useState } from "react";

/**
 * Every bank's move, on one axis.
 *
 * A list of banks with a delta column tells you the numbers. It does not
 * show the one thing that matters here, which is that most of the rail held
 * still and a handful of issuers moved — so the movement is drawn as
 * movement: a dot where the bank was, a dot where it is, and a line between
 * them. Length is the drift, direction is the sign, and the eye finds the
 * long red lines without being told to.
 *
 * The lines draw in on mount because a drift view whose whole claim is "this
 * changed" should show the change happening. It is one transition on a width,
 * not an animation loop, and it is skipped entirely under reduced motion.
 *
 * Every value is the API's own. Nothing is rescaled to look more dramatic:
 * the axis spans the observed range and says so.
 */

export interface Bank {
  bank: string;
  prior_pct: number;
  recent_pct: number;
  delta_pts: number;
  direction: string;
  volume_mn: number;
  severity: string;
  national_impact_paise: number;
  technical_share_delta: number;
}

export function DriftPlot({
  banks,
  onSelect,
  selected,
}: {
  banks: Bank[];
  onSelect?: (b: Bank) => void;
  selected?: string;
}) {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDrawn(true);
      return;
    }
    const t = setTimeout(() => setDrawn(true), 60);
    return () => clearTimeout(t);
  }, [banks]);

  if (!banks.length) return null;

  // The axis spans what the data occupies, rounded outward to whole points,
  // and the bounds are printed so nobody has to guess the zoom.
  const vals = banks.flatMap((b) => [b.prior_pct, b.recent_pct]);
  const lo = Math.floor(Math.min(...vals));
  const hi = Math.ceil(Math.max(...vals));
  const x = (v: number) => ((v - lo) / Math.max(0.001, hi - lo)) * 100;

  return (
    <div>
      <div className="space-y-0.5">
        {banks.map((b) => {
          const worse = b.delta_pts > 0;
          const from = x(b.prior_pct);
          const to = x(b.recent_pct);
          const left = Math.min(from, to);
          const width = Math.abs(to - from);
          const on = selected === b.bank;

          return (
            <button
              key={b.bank}
              onClick={() => onSelect?.(b)}
              className={`w-full text-left grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5.5rem]
                          items-center gap-3 px-2 py-1.5 rounded-md transition-colors ${
                            on ? "bg-raised" : "hover:bg-raised/60"
                          }`}
            >
              <span className="text-[12px] truncate">{b.bank}</span>

              <span className="relative h-4">
                {/* the ground the banks sit on */}
                <span className="absolute inset-x-0 top-1/2 h-px bg-line" />

                {/* where it was */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-edge"
                  style={{ left: `${from}%` }}
                  title={`was ${b.prior_pct.toFixed(2)}%`}
                />

                {/* the move itself */}
                <span
                  className={`absolute top-1/2 -translate-y-1/2 h-[2px] rounded-full
                              transition-[width] duration-700 ease-out ${
                                worse ? "bg-rose" : "bg-mint"
                              }`}
                  style={{
                    left: `${left}%`,
                    width: drawn ? `${width}%` : "0%",
                  }}
                />

                {/* where it is now */}
                <span
                  className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full
                              transition-[left] duration-700 ease-out ${
                                worse ? "bg-rose" : "bg-mint"
                              }`}
                  style={{ left: `${drawn ? to : from}%` }}
                  title={`now ${b.recent_pct.toFixed(2)}%`}
                />
              </span>

              <span
                className={`num text-[12px] text-right ${
                  worse ? "text-rose" : "text-mint"
                }`}
              >
                {b.delta_pts > 0 ? "+" : ""}
                {b.delta_pts.toFixed(2)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-faint num mt-2 pt-2 border-t border-line px-2">
        <span>{lo}% failures</span>
        <span className="ui tracking-[0.1em] uppercase">
          worse to the right
        </span>
        <span>{hi}%</span>
      </div>
    </div>
  );
}

/** What the selected bank moved, in full. */
export function DriftDetail({ b }: { b: Bank }) {
  const worse = b.delta_pts > 0;
  return (
    <div className={`panel p-4 border-l-2 ${worse ? "border-l-rose" : "border-l-mint"}`}>
      <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
        {worse ? "Bank drift detected" : "Improving"}
      </div>
      <div className="text-[15px] font-semibold mt-1">{b.bank}</div>

      <div className="flex items-end gap-6 mt-4 flex-wrap">
        <Pair k="previous" v={`${b.prior_pct.toFixed(2)}%`} />
        <span className="text-faint pb-1">→</span>
        <Pair
          k="current"
          v={`${b.recent_pct.toFixed(2)}%`}
          tone={worse ? "text-rose" : "text-mint"}
        />
        <Pair
          k="delta"
          v={`${b.delta_pts > 0 ? "+" : ""}${b.delta_pts.toFixed(2)} pts`}
          tone={worse ? "text-rose" : "text-mint"}
        />
        <Pair k="volume" v={`${b.volume_mn.toFixed(0)} Mn/mo`} />
      </div>

      {worse && (
        <p className="text-[12px] text-muted mt-3 leading-relaxed max-w-2xl">
          Worth{" "}
          <span className="num text-amber">
            ₹{(b.national_impact_paise / 100 / 1e7).toFixed(1)} Cr
          </span>{" "}
          a month across every merchant in India on this issuer.
          {Math.abs(b.technical_share_delta) > 0.08 && (
            <>
              {" "}
              The technical share of its failures{" "}
              {b.technical_share_delta > 0 ? "rose" : "fell"}{" "}
              {Math.abs(b.technical_share_delta * 100).toFixed(0)} points, so this
              looks like{" "}
              {b.technical_share_delta > 0
                ? "an incident rather than customers with less money"
                : "business declines rather than infrastructure"}
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Pair({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">{k}</div>
      <div className={`num text-lg font-semibold mt-0.5 ${tone ?? ""}`}>{v}</div>
    </div>
  );
}
