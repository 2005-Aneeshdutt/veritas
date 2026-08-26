"use client";

import { useRef, useState } from "react";
import { Card, Eyebrow } from "@/components/ui";

interface Citation {
  value: number;
  grounded: boolean;
}

interface Answer {
  ok: boolean;
  text: string;
  citations: Citation[];
  figures_cited: number;
  figures_verified: number;
  refused_reason: string | null;
  repaired: boolean;
  cache_hit: boolean;
}

interface Turn {
  q: string;
  a: Answer | null;
}

const SUGGESTED = [
  "Why is my success rate low?",
  "How much can I actually get back?",
  "What should I fix first?",
  "Multiply the gap by 12 for the annual cost",
];

/**
 * Ask about this run — with every figure checked against it.
 *
 * The gate is the point. `verify.py` already extracts figures from a model's
 * output and checks each against the exact context it was handed; this points
 * that at conversation. An answer that still cites an unsupported number after
 * one repair is refused outright rather than shown with a warning, because a
 * caveat under a wrong number is still a wrong number on a screen.
 *
 * The last suggested question is deliberately a trap. It asks for arithmetic
 * the record does not contain, and watching it get refused is the feature.
 */
export function AskPanel({ runId }: { runId: string }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(question?: string) {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: text, a: null }]);

    try {
      const r = await fetch(
        `/api/run/${runId}/ask?q=${encodeURIComponent(text)}`,
        { method: "POST" }
      );
      const a: Answer = await r.json();
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch {
      setTurns((t) =>
        t.map((x, i) =>
          i === t.length - 1
            ? {
                ...x,
                a: {
                  ok: false,
                  text: "",
                  citations: [],
                  figures_cited: 0,
                  figures_verified: 0,
                  refused_reason: "Could not reach the API.",
                  repaired: false,
                  cache_hit: false,
                },
              }
            : x
        )
      );
    }
    setBusy(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center gap-3 flex-wrap">
        <Eyebrow>Ask about this run</Eyebrow>
        <span className="chip-llm">Haiku 4.5</span>
        <span className="text-[11px] text-faint">
          every figure is checked against the record — an unsupported one is
          refused, not captioned
        </span>
      </div>

      <div className="p-5 space-y-4 max-h-[30rem] overflow-y-auto">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((s, i) => (
              <button
                key={s}
                onClick={() => send(s)}
                className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                  i === SUGGESTED.length - 1
                    ? "border-amber/40 text-amber hover:bg-amber-soft"
                    : "border-line text-muted hover:text-ink hover:bg-raised"
                }`}
                title={
                  i === SUGGESTED.length - 1
                    ? "This one asks for a number the record does not contain."
                    : undefined
                }
              >
                {s}
                {i === SUGGESTED.length - 1 && " ⚠"}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="text-sm font-medium">{t.q}</div>

            {t.a === null ? (
              <div className="text-sm text-muted animate-breathe">thinking…</div>
            ) : t.a.ok ? (
              <div>
                <p className="text-sm text-muted leading-relaxed">{t.a.text}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="chip-measured">
                    {t.a.figures_cited} figure
                    {t.a.figures_cited === 1 ? "" : "s"} cited ·{" "}
                    {t.a.figures_verified} verified
                  </span>
                  {t.a.repaired && (
                    <span className="chip-warn">corrected once</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="card-raised border-l-2 border-l-rose p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="chip-warn">refused</span>
                  {t.a.citations.filter((c) => !c.grounded).length > 0 && (
                    <span className="num text-[11px] text-rose">
                      {t.a.citations
                        .filter((c) => !c.grounded)
                        .map((c) => c.value)
                        .join(", ")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted mt-2 leading-relaxed">
                  {t.a.refused_reason}
                </p>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="px-5 py-3 border-t border-line flex items-center gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything about this merchant's diagnosis…"
          maxLength={500}
          className="field h-9 py-0 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="btn-primary h-9 px-4 text-sm shrink-0"
        >
          Ask
        </button>
      </form>
    </Card>
  );
}
