"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ atoms */

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Card({
  children,
  className = "",
  glow,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  glow?: "brand" | "mint" | "rose";
  onClick?: () => void;
}) {
  const glowCls = glow ? "hover:shadow-card" : "";
  return (
    <div
      onClick={onClick}
      className={`card p-5 transition-shadow duration-200 ${glowCls} ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Roughly a line and a half at this measure. Past it, prose stops being a
 *  subtitle and starts being an essay standing between a reader and a number. */
const SUB_INLINE_LIMIT = 105;

export function SectionHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow?: string;
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  // A long subtitle collapses instead of shouting.
  //
  // Every one of these was worth saying and none was worth saying first --
  // eighteen of them on one screen is how a page ends up with 427 words of
  // explanation above the measurements it exists to show. Long ones become a
  // disclosure; short ones stay inline, because hiding six words behind a
  // click is its own kind of rude.
  const long = typeof sub === "string" && sub.length > SUB_INLINE_LIMIT;

  return (
    <div className="flex items-start justify-between gap-6 mb-4">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="text-lg font-semibold mt-1">{title}</h2>
        {sub && !long && (
          <p className="text-sm text-muted mt-1.5 max-w-2xl leading-relaxed">{sub}</p>
        )}
        {long && <Detail summary="why this is measured this way">{sub}</Detail>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- tooltip */

/**
 * Hover explanation. Used everywhere a term would otherwise need the reader to
 * already know the method.
 */
export function Info({ text, children }: { text: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children ?? (
        <span
          className="ml-1 w-3.5 h-3.5 inline-flex items-center justify-center rounded-full
                     border border-line text-[9px] text-faint hover:text-brand
                     hover:border-brand/50 transition-colors cursor-help"
        >
          ?
        </span>
      )}
      {open && (
        <span
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72
                     card-raised p-3 text-xs leading-relaxed text-muted
                     font-body normal-case tracking-normal animate-rise shadow-card"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------- animated number */

/**
 * Counts up on mount. Purely presentational — the value is exact, the motion
 * just gives the eye something to follow so a dashboard of figures does not
 * land all at once.
 */
export function Ticker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 900,
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo
      const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(from + (value - from) * e);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return (
    <span className={`num ${className}`}>
      {prefix}
      {shown.toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------- metric card */

export function Metric({
  label,
  value,
  sub,
  kind,
  error,
  tone = "default",
  info,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Required: RULE 2 is enforced by the type, not by discipline. */
  kind: "measured" | "projected";
  /** Rendered as "± n", sourced from the validation sweep. Never a guess. */
  error?: number | null;
  tone?: "default" | "good" | "bad";
  info?: string;
  onClick?: () => void;
}) {
  const toneCls =
    tone === "good" ? "text-mint" : tone === "bad" ? "text-rose" : "text-ink";
  return (
    <div
      onClick={onClick}
      className={`${
        kind === "measured" ? "panel-measured" : "panel-projected"
      } p-4 flex flex-col gap-1 transition-transform duration-300 ${
        onClick ? "cursor-pointer hover:-translate-y-0.5" : ""
      }`}
    >
      <div className="eyebrow flex items-center">
        {label}
        {info && <Info text={info} />}
      </div>
      <div className={`text-2xl font-display font-bold leading-none mt-1 ${toneCls}`}>
        {value}
        {error != null && (
          <span className="text-sm num font-normal text-muted ml-1.5">
            ± {error.toFixed(2)}
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-muted leading-snug mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * The labelled divider. This wall IS the thesis, rendered — so it gets a real
 * caption on each side rather than a small badge nobody reads.
 */
export function Wall({
  measured,
  projected,
}: {
  measured: ReactNode;
  projected: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-5">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="chip-measured">measured</span>
          <span className="text-xs text-muted">
            against ground truth, or cryptographically verified
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">{measured}</div>
      </section>

      <div className="hidden xl:flex flex-col items-center px-2">
        <div className="w-px flex-1 bg-line" />
        <div className="py-4 eyebrow [writing-mode:vertical-rl] rotate-180">
          the wall
        </div>
        <div className="w-px flex-1 bg-line" />
      </div>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="chip-projected">projected</span>
          <span className="text-xs text-muted">
            modelled — assumptions stated in the repo
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">{projected}</div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- misc atoms */

export function Bar({
  value,
  max,
  color = "rgb(var(--brand))",
  hatched,
}: {
  value: number;
  max: number;
  color?: string;
  hatched?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${
          hatched ? "hatched" : ""
        }`}
        style={{ width: `${pct}%`, background: hatched ? undefined : color }}
      />
    </div>
  );
}

export function Spark({
  values,
  color = "rgb(var(--brand))",
  height = 28,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * 100;
      const y = height - ((v - min) / span) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none"
         className="w-full" style={{ height }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-sm text-muted font-mono">{label}</div>
    </div>
  );
}

export function Loading({ label = "loading" }: { label?: string }) {
  return (
    <div className="space-y-4 animate-rise">
      <div className="shimmer h-8 w-64" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-24" />
        ))}
      </div>
      <div className="shimmer h-48" />
      <div className="eyebrow">{label}…</div>
    </div>
  );
}

/** Staggered entrance so a dense page arrives in readable order. */
export function Stagger({
  children,
  i = 0,
}: {
  children: ReactNode;
  i?: number;
}) {
  return (
    <div className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
      {children}
    </div>
  );
}

/**
 * A paragraph that is not on screen until someone wants it.
 *
 * The UI carried 1,813 words of explanatory prose — 427 on a single page —
 * because the README's voice leaked into the product. None of it was wrong
 * and almost none of it was needed at a glance, which is the definition of
 * clutter: true things competing with the number you came to read.
 *
 * So the reasoning stays, one click away. A judge who wants to know why we
 * report a Wilson bound can still find out; a judge watching a demo is not
 * made to read it first.
 */
export function Detail({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-3">
      <summary
        className="cursor-pointer list-none text-[13px] text-muted hover:text-ink
                   transition-colors inline-flex items-center gap-1.5 select-none"
      >
        <span
          className="text-faint transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2.5 text-sm text-muted leading-relaxed max-w-[68ch] space-y-2.5">
        {children}
      </div>
    </details>
  );
}
