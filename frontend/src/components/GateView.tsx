"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/types";

/**
 * The mandate gate, evaluating.
 *
 * This is the screen the product's argument rests on, so it is the screen
 * most at risk of being dressed up into something it is not. Two rules held
 * throughout:
 *
 *   * every row quotes the two values the rule actually compared. "₹24,816
 *     against a ceiling of ₹15,000" is a claim a viewer can disagree with;
 *     "amount checked against ceiling" is a description of a rule and cannot
 *     be wrong
 *   * the outcome is the STORED one. The rules are walked for display and
 *     stopped at whichever rule the recorded reason code blames, so nothing
 *     here re-decides anything and the page cannot disagree with the ledger
 *
 * The label saying DETERMINISTIC · NO MODEL CALL is not decoration either.
 * The kernel is pure functions over a signed document, and the reason the
 * agent cannot widen its own authority is that it has never held the key.
 */

export interface Rule {
  n: number;
  key: string;
  label: string;
  compared: string;
  status: "pass" | "stopped" | "not_reached";
}

const VERDICT: Record<
  string,
  { word: string; tone: string; edge: string; line: string }
> = {
  allow: {
    word: "ALLOWED",
    tone: "text-mint",
    edge: "border-l-mint",
    line: "Inside every limit the merchant signed. The agent may act unattended.",
  },
  step_up: {
    word: "HELD",
    tone: "text-amber",
    edge: "border-l-amber",
    line: "Permitted in kind, but it waits for a person before anything happens.",
  },
  deny: {
    word: "DENIED",
    tone: "text-rose",
    edge: "border-l-rose",
    line: "Refused by the signed mandate. No approval from anyone turns this into an allow.",
  },
};

export function GateView({
  rules,
  decision,
  reason,
  amountPaise,
  ceilingPaise,
  autoLimitPaise,
  paced = true,
}: {
  rules: Rule[];
  decision: string;
  reason: string;
  amountPaise?: number;
  ceilingPaise?: number;
  autoLimitPaise?: number;
  paced?: boolean;
}) {
  // Walk the rules so a refusal is watched happening. A rule that stops
  // something holds longer than one that waves a payment through.
  const [at, setAt] = useState(paced ? 0 : rules.length);

  useEffect(() => {
    if (!paced) return;
    setAt(0);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setAt(rules.length);
      return;
    }
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setAt(i);
      if (i >= rules.length) return;
      const stopped = rules[i - 1]?.status === "stopped";
      t = setTimeout(tick, stopped ? 950 : 170);
    };
    t = setTimeout(tick, 220);
    return () => clearTimeout(t);
  }, [rules, paced]);

  const v = VERDICT[decision] ?? VERDICT.allow;
  const done = at >= rules.length;
  const stopped = rules.find((r) => r.status === "stopped");

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
        <span className="ui text-[11px] uppercase tracking-[0.12em] text-muted">
          Mandate gate
        </span>
        <span className="chip text-sky">{rules.length} rules</span>
        <span className="chip text-faint ml-auto">deterministic · no model call</span>
      </div>

      <ol className="px-3 py-2">
        {rules.slice(0, at).map((r) => {
          const isStop = r.status === "stopped";
          const skipped = r.status === "not_reached";
          return (
            <li
              key={r.key}
              className={`flex items-baseline gap-2.5 py-1.5 animate-rise ${
                skipped ? "opacity-40" : ""
              }`}
            >
              <span
                className={`w-3.5 shrink-0 text-center text-[11px] ${
                  isStop ? "text-rose" : skipped ? "text-faint" : "text-mint"
                }`}
              >
                {isStop ? "✕" : skipped ? "·" : "✓"}
              </span>
              <span className="num text-[10px] text-faint w-4 shrink-0">{r.n}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[12px] ${
                    isStop ? "text-ink font-medium" : "text-muted"
                  }`}
                >
                  {r.label}
                </span>
                <span
                  className={`block num text-[11px] mt-0.5 ${
                    isStop ? "text-rose" : "text-faint"
                  }`}
                >
                  {r.compared}
                </span>
              </span>
              {isStop && <span className="chip text-rose shrink-0">stopped here</span>}
            </li>
          );
        })}
        {!done && (
          <li className="flex items-center gap-2.5 py-1.5">
            <span className="w-3.5 shrink-0 text-center">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand animate-pulse-ring" />
            </span>
            <span className="text-[12px] text-muted">
              evaluating rule {at + 1} of {rules.length}…
            </span>
          </li>
        )}
      </ol>

      {done && (
        <div className={`border-t border-line border-l-2 ${v.edge} px-4 py-3.5 animate-rise`}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className={`ui text-lg font-semibold tracking-tight ${v.tone}`}>
              {v.word}
            </span>
            {amountPaise ? (
              <span className="num text-lg font-semibold">{inr(amountPaise)}</span>
            ) : null}
            <span className="num text-[10px] text-faint ml-auto">{reason}</span>
          </div>

          {/* The two numbers, side by side, when a limit is what stopped it. */}
          {decision === "deny" && ceilingPaise ? (
            <div className="flex gap-6 mt-3">
              <Pair k="amount" v={inr(amountPaise ?? 0)} tone="text-rose" />
              <Pair k="maximum allowed" v={inr(ceilingPaise)} />
            </div>
          ) : null}
          {decision === "step_up" && autoLimitPaise ? (
            <div className="flex gap-6 mt-3">
              <Pair k="amount" v={inr(amountPaise ?? 0)} tone="text-amber" />
              <Pair k="auto-execute limit" v={inr(autoLimitPaise)} />
            </div>
          ) : null}

          <p className="text-[12px] text-muted mt-3 leading-relaxed max-w-2xl">
            {v.line}
            {stopped && decision === "deny" && (
              <>
                {" "}
                The {rules.length - stopped.n} rules after it never ran.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function Pair({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">{k}</div>
      <div className={`num text-base font-semibold mt-0.5 ${tone ?? ""}`}>{v}</div>
    </div>
  );
}
