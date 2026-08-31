"use client";

import { useEffect, useRef, useState } from "react";

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
  refused_reason?: string | null;
  cache_hit?: boolean;
}

interface Turn {
  q: string;
  a: Answer | null;
}

/**
 * A question box that follows you across the app.
 *
 * The per-run assistant answers "why is this merchant losing money". The
 * questions people actually ask while looking at a screen are different and
 * had nowhere to go: what does MEASURED mean here, how accurate is this, why
 * is the recovered figure smaller than the one above it, what can the agent
 * do without me. All of that was answerable only by reading the README, which
 * means it was answerable only by someone who had already decided to.
 *
 * It is grounded the same way everything else here is, and the stakes are
 * higher rather than lower: this panel is asked about the system's own
 * accuracy, so a figure it invented would be a false claim about how honest
 * the system is. Every number in a reply is checked against the context the
 * model was handed, and a reply that cites one that is not there is refused
 * outright instead of shown with a warning under it.
 */

const SUGGESTED = [
  "What does 'measured' mean here?",
  "How accurate is the attribution?",
  "What can the agent do without asking me?",
  "Why is the recovered figure so small?",
];

export function Helpdesk() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  // Escape closes it, because a panel that traps you is worse than no panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const asked = text.trim();
    if (!asked || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: asked, a: null }]);
    try {
      const r = await fetch(`/api/ask?q=${encodeURIComponent(asked)}`, {
        method: "POST",
      });
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
                },
              }
            : x
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 btn-primary h-11 px-5 text-sm
                     shadow-lg rounded-full"
          aria-label="Ask about this system"
        >
          Ask about this system
        </button>
      )}

      {open && (
        <aside
          className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-canvas
                     border-l border-line shadow-2xl flex flex-col animate-rise"
          aria-label="System questions"
        >
          <div className="px-5 h-14 flex items-center gap-3 border-b border-line shrink-0">
            <span className="eyebrow">Ask about this system</span>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto text-muted hover:text-ink transition-colors text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {turns.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted leading-relaxed">
                  Answers come from this system&rsquo;s own records — the book,
                  the committed evals, the mandate rules. Every figure is
                  checked against them, and a reply citing one that is not
                  there is refused rather than shown.
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-[13px] text-brand hover:underline"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="text-sm font-medium">{t.q}</div>

                {t.a === null ? (
                  <div className="text-sm text-muted animate-breathe">
                    checking the records…
                  </div>
                ) : t.a.ok ? (
                  <div>
                    <p className="text-sm text-muted leading-relaxed">
                      {t.a.text}
                    </p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="chip-measured">
                        {t.a.figures_cited} figure
                        {t.a.figures_cited === 1 ? "" : "s"} cited ·{" "}
                        {t.a.figures_verified} verified
                      </span>
                      {t.a.cache_hit && (
                        <span className="chip-neutral">cached</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="card-raised border-l-2 border-l-rose p-3">
                    <span className="chip-warn">refused</span>
                    <p className="text-sm text-muted mt-2 leading-relaxed">
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
              send(q);
            }}
            className="p-4 border-t border-line flex items-center gap-2 shrink-0"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask anything about this system…"
              maxLength={500}
              className="field flex-1 h-9 py-0 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              className="btn-primary h-9 px-4 text-sm shrink-0"
            >
              {busy ? "…" : "Ask"}
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
