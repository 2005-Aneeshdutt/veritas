"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The demo, as a spine.
 *
 * This replaced two competing navigations — a four-item top bar and a
 * six-item tab strip inside every run — that together offered ten
 * destinations and no sense of order. A judge watching a five-minute demo
 * cannot hold ten places in their head, and the walkthrough crossed between
 * the two bars four times.
 *
 * So the product is now the walkthrough: five numbered steps that read left
 * to right in the order the story is told. Drift and Exceptions did not
 * disappear; they became sections of the step they belong to, which is where
 * a reader would look for them anyway.
 *
 * The numbers are not decoration. They encode a real sequence — you cannot
 * authorise a recovery you have not diagnosed — and the current step is the
 * only one that carries its one-line description, because five descriptions
 * on screen at once is the clutter this was built to remove.
 */

export interface Step {
  n: number;
  href: string;
  label: string;
  /** Shown only for the step you are on. */
  hint: string;
  /** Prefixes that should light this step up. */
  match: string[];
}

export const STEPS: Step[] = [
  {
    n: 1,
    href: "/portfolio",
    label: "Book",
    hint: "where the money is leaking, across every merchant",
    match: ["/portfolio", "/drift"],
  },
  {
    n: 2,
    href: "/live",
    label: "Watch",
    hint: "payments arriving, and a bank going bad in real time",
    match: ["/live"],
  },
  {
    n: 3,
    href: "/run",
    label: "Diagnose",
    hint: "the agent works the case and shows its arithmetic",
    match: ["/run"],
  },
  {
    n: 4,
    href: "/run",
    label: "Authorise",
    hint: "what it may do, what it did, and what you approve",
    match: [],
  },
  {
    n: 5,
    href: "/prove",
    label: "Prove",
    hint: "try to break it, on a challenge nobody has seen",
    match: ["/prove"],
  },
];

function activeStep(path: string, runHref: string | null): number {
  if (path.includes("/authorise") || path.includes("/audit")) return 4;
  for (const s of STEPS) {
    if (s.match.some((m) => path.startsWith(m))) return s.n;
  }
  return runHref ? 3 : 1;
}

/**
 * @param runHref  the current run, when there is one. Steps 3 and 4 are dead
 *                 until a run exists — offering them beforehand leads to an
 *                 empty screen, which is worse than a disabled one.
 */
export function Steps({ runHref }: { runHref?: string | null }) {
  const path = usePathname();

  /**
   * Somewhere to go when you are not already inside a run.
   *
   * Steps 3 and 4 were disabled unless the page happened to be a run page,
   * so landing on Drift or Prove showed half the product greyed out with a
   * tooltip nobody hovers. There is almost always a run on disk. If there
   * is, those steps point at the newest one.
   */
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => {
    if (runHref) return;
    fetch("/api/run-latest")
      .then((r) => r.json())
      .then((d) => setFallback(d.run_id ? `/run/${d.run_id}` : null))
      .catch(() => {});
  }, [runHref]);

  const run = runHref ?? fallback;
  const current = activeStep(path, run);

  const hrefFor = (s: Step) => {
    if (s.n === 3) return run ?? null;
    if (s.n === 4) return run ? `${run}/authorise` : null;
    return s.href;
  };

  const hint = STEPS.find((s) => s.n === current)?.hint;

  return (
    <div className="border-b border-line bg-canvas/85 backdrop-blur-xl">
      <div className="max-w-[1400px] mx-auto px-6">
        <nav
          aria-label="Demo steps"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar"
        >
          {STEPS.map((s) => {
            const href = hrefFor(s);
            const on = s.n === current;
            const done = s.n < current;
            const body = (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className={`w-5 h-5 rounded-full grid place-items-center text-[10px]
                              font-semibold shrink-0 transition-colors ${
                    on
                      ? "bg-brand text-brand-ink"
                      : done
                      ? "bg-brand-soft text-brand"
                      : "border border-line text-faint"
                  }`}
                >
                  {s.n}
                </span>
                <span className={on ? "text-ink" : done ? "text-muted" : ""}>
                  {s.label}
                </span>
              </span>
            );
            const cls = `px-3 py-3 text-sm transition-colors border-b-2 -mb-px ${
              on
                ? "border-brand"
                : "border-transparent text-muted hover:text-ink"
            }`;
            return href ? (
              <Link key={s.n} href={href} className={cls}>
                {body}
              </Link>
            ) : (
              <span
                key={s.n}
                className={`${cls} text-faint cursor-not-allowed`}
                title="No runs on disk yet — diagnose a merchant first"
              >
                {body}
              </span>
            );
          })}

          {hint && (
            <span className="ml-4 text-[13px] text-faint hidden lg:block truncate">
              {hint}
            </span>
          )}
        </nav>
      </div>
    </div>
  );
}
