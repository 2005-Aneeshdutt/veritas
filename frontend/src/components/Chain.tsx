"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The product is a chain, and each page is one link in it.
 *
 * Every page already answered its own question well and none of them said
 * what question came next, so the system read as a set of related screens
 * rather than one argument. This states the chain once — here — and every
 * page shows the same two facts at its foot: the question it just answered,
 * and the question the next link answers.
 *
 * Deliberately not a new screen, a diagram, or a progress bar. It is a
 * sentence and a link. The relationships were the missing thing, not more
 * surface.
 *
 * On the framing: the engine is ONE agent working under a signed mandate,
 * not a swarm of autonomous ones. The graph has ten nodes and the copy calls
 * them nodes. "Specialised reasoning inside deterministic controls" is both
 * more accurate and harder to attack than "ten autonomous agents", and it is
 * what the product actually does.
 */

export interface Link_ {
  /** Where this link lives. */
  href: string;
  /** Paths that count as being on it. */
  match: (path: string) => boolean;
  /** The question this link answers. */
  answers: string;
  /** How the answer is reached — reasoning, or a rule. */
  kind: "reasoning" | "deterministic" | "measurement";
}

/**
 * The chain, in order.
 *
 * Read top to bottom this is the whole product: a gap, a cause, a plan, a
 * decision that is not the model's to make, a record of it, and finally
 * whether any of it worked.
 */
export const CHAIN: Link_[] = [
  {
    href: "/portfolio",
    match: (p) => p === "/portfolio" || p === "/live" || p === "/drift",
    answers: "Where is revenue leaking, and how much?",
    kind: "measurement",
  },
  {
    href: "/run",
    match: (p) => /^\/run\/[^/]+$/.test(p) || p.endsWith("/flow"),
    answers: "Why is this merchant behind?",
    kind: "reasoning",
  },
  {
    href: "/lab",
    match: (p) => p.startsWith("/lab"),
    answers: "Is this recovery worth doing, next to the alternatives?",
    kind: "measurement",
  },
  {
    href: "/run/authorise",
    match: (p) => p.endsWith("/authorise") || p.endsWith("/journey"),
    answers: "What is the agent allowed to do about it?",
    kind: "deterministic",
  },
  {
    href: "/recover",
    match: (p) => p.startsWith("/recover"),
    answers: "How does the fix reach the customer, and how rarely must it?",
    kind: "deterministic",
  },
  {
    href: "/evidence",
    match: (p) => p.startsWith("/evidence"),
    answers: "Was every decision recorded, and does the record hold?",
    kind: "measurement",
  },
  {
    href: "/impact",
    match: (p) => p.startsWith("/impact"),
    answers: "Did the fixes actually work?",
    kind: "measurement",
  },
];

/** Off the main chain: a question only the platform can ask. */
const BRANCH: Link_ = {
  href: "/platform",
  match: (p) => p.startsWith("/platform"),
  answers: "Of what cannot be recovered, whose is it to fix?",
  kind: "measurement",
};

const KIND_LABEL: Record<Link_["kind"], string> = {
  reasoning: "specialised reasoning",
  deterministic: "deterministic rules, no model",
  measurement: "measured",
};

const KIND_TONE: Record<Link_["kind"], string> = {
  reasoning: "text-iris",
  deterministic: "text-sky",
  measurement: "text-mint",
};

/**
 * @param runHref  the run in view, so the two run-scoped links resolve.
 */
export function ChainFooter({ runHref }: { runHref?: string | null }) {
  const path = usePathname() ?? "";

  /**
   * Resolve the run when the page does not have one.
   *
   * Off a run page the next link was falling back to /portfolio, so the Book
   * offered "Why is this merchant behind?" and sent you back to the Book.
   * The sidebar has already resolved the canonical run and cached it, so this
   * reads the same cache and only fetches if it is empty.
   */
  const [resolved, setResolved] = useState<string | null>(runHref ?? null);

  useEffect(() => {
    if (runHref) {
      setResolved(runHref);
      return;
    }
    try {
      const cached = sessionStorage.getItem("rd.run.canonical");
      if (cached) {
        setResolved(cached);
        return;
      }
    } catch {
      /* private mode: fall through */
    }
    let dead = false;
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => {
        if (dead) return;
        const m = (d.merchants ?? []).find(
          (x: { merchant_id: string }) => x.merchant_id === "cloudsync"
        );
        if (m?.run_id) setResolved(`/run/${m.run_id}`);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [runHref]);

  const all = [...CHAIN, BRANCH];
  const hereIdx = all.findIndex((l) => l.match(path));
  if (hereIdx === -1) return null;
  const here = all[hereIdx];

  // The branch rejoins the chain at the evidence link rather than dead-ending.
  const next =
    here === BRANCH
      ? CHAIN.find((l) => l.href === "/evidence")!
      : CHAIN[hereIdx + 1];

  const resolve = (l: Link_) =>
    l.href === "/run"
      ? resolved ?? "/portfolio"
      : l.href === "/run/authorise"
      ? resolved
        ? `${resolved}/authorise`
        : "/portfolio"
      : l.href;

  return (
    <div className="border-t border-line pt-4 mt-2">
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
        <div>
          <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
            This page answered
          </div>
          <div className="text-[13px] mt-1">{here.answers}</div>
          <div className={`text-[11px] mt-1 ${KIND_TONE[here.kind]}`}>
            {KIND_LABEL[here.kind]}
          </div>
        </div>

        {next && (
          <div>
            <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
              Next in the chain
            </div>
            <Link
              href={resolve(next)}
              className="text-[13px] mt-1 block text-brand hover:underline"
            >
              {next.answers} →
            </Link>
            <div className={`text-[11px] mt-1 ${KIND_TONE[next.kind]}`}>
              {KIND_LABEL[next.kind]}
            </div>
          </div>
        )}
      </div>

      {/* Where you are, in one line. Six marks, not a diagram. */}
      <div className="flex items-center gap-1.5 mt-4">
        {CHAIN.map((l, i) => {
          const on = l === here;
          const passed = hereIdx < CHAIN.length && i < hereIdx;
          return (
            <Link
              key={l.href}
              href={resolve(l)}
              title={l.answers}
              className={`h-[3px] flex-1 rounded-full transition-colors ${
                on ? "bg-brand" : passed ? "bg-edge" : "bg-line"
              }`}
            />
          );
        })}
        <span className="ui text-[10px] uppercase tracking-[0.1em] text-faint ml-2 shrink-0">
          {here === BRANCH
            ? "platform view"
            : `${hereIdx + 1} of ${CHAIN.length}`}
        </span>
      </div>
    </div>
  );
}
