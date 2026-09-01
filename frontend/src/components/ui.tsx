"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * The shared vocabulary.
 *
 * This was a set of marketing primitives — bordered, rounded, shadowed cards;
 * 2xl headings over 12px tables; filled pills in five colours, up to fifteen
 * on one page. Good information, packaged as a poster.
 *
 * The rules it follows now:
 *
 *   * a page is ONE surface. Sections are separated by whitespace and a
 *     hairline above their heading, not by six floating boxes
 *   * one accent colour. Mint and amber are spent entirely on MEASURED versus
 *     PROJECTED, which is the one distinction worth a hue; rose is spent on
 *     refusals. Everything else is neutral
 *   * one large number per page. Everything else is 13px
 *   * one sentence of prose under a heading. The rest goes in `Notes` at the
 *     foot of the page, where it is still one click from anyone who wants it
 *
 * The old names are kept and re-pointed rather than deleted, so seventy-three
 * call sites changed appearance without being edited, and structure could
 * then be fixed one page at a time.
 */

/* ------------------------------------------------------------------ atoms */

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/**
 * A section of a page. No chrome — the page is the surface.
 *
 * Still called Card because seventy-three places say `<Card>`; what it draws
 * is a plain block.
 */
export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  glow?: "brand" | "mint" | "rose";
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`card ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** The rare genuinely-enclosed thing: a callout, a scrolling picker. */
export function Panel({
  children,
  className = "",
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "brand" | "warn" | "good" | "note";
}) {
  const edge = {
    brand: "border-l-2 border-l-brand",
    warn: "border-l-2 border-l-rose",
    good: "border-l-2 border-l-mint",
    note: "border-l-2 border-l-amber",
  }[tone ?? "brand"];
  return (
    <div className={`panel p-4 ${tone ? edge : ""} ${className}`}>{children}</div>
  );
}

/** The page's own heading. One per page, and the only h1. */
export function PageHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 pb-5">
      <div className="min-w-0">
        <h1>{title}</h1>
        {sub && (
          <p className="text-[13px] text-muted mt-1 max-w-3xl leading-relaxed">
            {sub}
          </p>
        )}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** Roughly a line and a half at this measure. Past it a subtitle is an essay. */
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
  // A long subtitle collapses instead of shouting. Eighteen of these on one
  // screen is how a page ends up with 427 words of explanation standing in
  // front of the measurements it exists to show.
  const long = typeof sub === "string" && sub.length > SUB_INLINE_LIMIT;

  return (
    <div className="flex items-start justify-between gap-6 border-t border-line pt-5 mb-4">
      <div className="min-w-0">
        {/* The eyebrow is kept in the signature so call sites need no edit,
            but it is drawn as part of the heading line rather than as a
            second row of shouting above it. */}
        <h2>{title}</h2>
        {sub && !long && (
          <p className="text-[13px] text-muted mt-1 max-w-3xl leading-relaxed">
            {sub}
          </p>
        )}
        {eyebrow && !sub && (
          <p className="text-[13px] text-muted mt-1">{eyebrow}</p>
        )}
        {long && <Detail summary="why this is measured this way">{sub}</Detail>}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- the numbers */

/**
 * The one large number on a page.
 *
 * Everything else is 13px, so this is the thing the eye lands on and the
 * thing a presenter points at. `kind` is required for the same reason it is
 * required on Metric: a figure with no provenance is the failure mode this
 * whole product argues against.
 */
export function Hero({
  label,
  value,
  kind,
  sub,
  error,
  right,
}: {
  label: string;
  value: ReactNode;
  kind: "measured" | "projected";
  sub?: ReactNode;
  error?: number | null;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{label}</span>
          <Tag kind={kind} />
        </div>
        <div className="num text-[34px] font-semibold leading-none mt-2 tracking-tight">
          {value}
          {error != null && (
            <span className="text-base num font-normal text-faint ml-2">
              ± {error.toFixed(2)}
            </span>
          )}
        </div>
        {sub && (
          <div className="text-[12px] text-muted mt-2 leading-relaxed max-w-2xl">
            {sub}
          </div>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/**
 * The metric strip: label over value, hairline between, no boxes.
 *
 * This replaces the four-bordered-cards-in-a-grid pattern that appeared on
 * every page. Boxes around numbers add a frame and no information, and four
 * of them read as four separate claims rather than one row of facts.
 */
export function Figures({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4
                 divide-y divide-line sm:divide-y-0 sm:divide-x"
    >
      {children}
    </div>
  );
}

export function Figure({
  label,
  value,
  sub,
  kind,
  tone,
  error,
  info,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Omit only where provenance genuinely does not apply (a count of rows). */
  kind?: "measured" | "projected";
  tone?: "good" | "bad" | "brand";
  error?: number | null;
  info?: string;
  onClick?: () => void;
}) {
  const toneCls =
    tone === "good"
      ? "text-mint"
      : tone === "bad"
      ? "text-rose"
      : tone === "brand"
      ? "text-brand"
      : "";
  return (
    <div
      onClick={onClick}
      className={`pt-5 sm:pt-0 sm:pl-8 sm:first:pl-0 ${
        onClick ? "cursor-pointer group" : ""
      }`}
    >
      <div className="eyebrow flex items-center gap-1.5">
        <span className={onClick ? "group-hover:text-muted transition-colors" : ""}>
          {label}
        </span>
        {kind && <Tag kind={kind} />}
        {info && <Info text={info} />}
      </div>
      <div className={`num text-[22px] font-semibold leading-none mt-1.5 ${toneCls}`}>
        {value}
        {error != null && (
          <span className="text-[13px] num font-normal text-faint ml-1.5">
            ± {error.toFixed(2)}
          </span>
        )}
      </div>
      {sub && (
        <div className="text-[11px] text-faint mt-1.5 leading-snug">{sub}</div>
      )}
    </div>
  );
}

/**
 * Provenance, in two characters of colour.
 *
 * The one place a hue is still spent on something that is not a decision,
 * because a reader who cannot tell a measurement from a forecast cannot use
 * anything else on the page.
 */
export function Tag({ kind }: { kind: "measured" | "projected" }) {
  return (
    <span className={kind === "measured" ? "chip-measured" : "chip-projected"}>
      {kind}
    </span>
  );
}

/* --------------------------------------------------------------- tooltip */

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
          className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full
                     border border-line text-[9px] text-faint hover:text-brand
                     hover:border-brand/50 transition-colors cursor-help"
        >
          ?
        </span>
      )}
      {open && (
        <span
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72
                     panel p-3 text-xs leading-relaxed text-muted
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
 * Counts up on mount.
 *
 * Kept for the one hero figure on a page. It used to be on every number,
 * which made a dashboard arrive like a slot machine — motion is for the
 * thing you want watched, and if everything moves nothing is watched.
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
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(value * e);
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

/* ------------------------------------------------------------ compatibility */

/** The old metric card, drawn as a Figure. Call sites unchanged. */
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
  kind: "measured" | "projected";
  error?: number | null;
  tone?: "default" | "good" | "bad";
  info?: string;
  onClick?: () => void;
}) {
  return (
    <Figure
      label={label}
      value={value}
      sub={sub}
      kind={kind}
      error={error}
      tone={tone === "default" ? undefined : tone}
      info={info}
      onClick={onClick}
    />
  );
}

/** The measured/projected split, as two labelled columns rather than a wall. */
export function Wall({
  measured,
  projected,
}: {
  measured: ReactNode;
  projected: ReactNode;
}) {
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <section>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-line">
          <Tag kind="measured" />
          <span className="text-[11px] text-faint">
            against ground truth, or cryptographically verified
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">{measured}</div>
      </section>
      <section>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-line">
          <Tag kind="projected" />
          <span className="text-[11px] text-faint">
            modelled — assumptions stated in the repo
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">{projected}</div>
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

/** A quiet segmented control. Lenses on one object, not separate pages. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; tag?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-raised border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 rounded text-[13px] transition-colors flex items-center gap-1.5 ${
            value === o.value
              ? "bg-surface text-ink shadow-xs"
              : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
          {o.tag && <span className="chip-warn">{o.tag}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="py-12 text-center text-[13px] text-faint font-mono">
      {label}
    </div>
  );
}

export function Loading({ label = "loading" }: { label?: string }) {
  return (
    <div className="space-y-5 animate-rise">
      <div className="shimmer h-6 w-56" />
      <div className="grid grid-cols-4 gap-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-14" />
        ))}
      </div>
      <div className="shimmer h-40" />
      <div className="eyebrow">{label}…</div>
    </div>
  );
}

/** Staggered entrance so a dense page arrives in readable order. */
export function Stagger({ children, i = 0 }: { children: ReactNode; i?: number }) {
  return (
    <div className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
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
        className="cursor-pointer list-none text-[12px] text-faint hover:text-ink
                   transition-colors inline-flex items-center gap-1.5 select-none"
      >
        <span
          className="transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2.5 text-[13px] text-muted leading-relaxed max-w-[68ch] space-y-2.5">
        {children}
      </div>
    </details>
  );
}

/**
 * The one place at the foot of a page where the reasoning lives.
 *
 * Scattering eight disclosures through a page still leaves eight things
 * inviting a click between the reader and the numbers. Collecting them here
 * means the page above is only measurements, and anyone who wants the method
 * knows exactly where it is.
 */
export function Notes({
  children,
  title = "Notes on method",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="border-t border-line pt-5 mt-2">
      <div className="eyebrow mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
