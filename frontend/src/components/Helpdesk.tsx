"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/* ── the browser's own speech engine ──────────────────────────────────────
 *
 * Not typed in lib.dom, and not present in every browser: Chrome and Edge
 * have it, Firefox does not, Safari is partial. So it is feature-detected and
 * the microphone simply is not offered when it is missing — an button that
 * does nothing is worse than no button, especially on a stage.
 */
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function speechEngine(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const r: SpeechRec = new Ctor();
  // Indian English: the questions are about rupees, NPCI and merchant names.
  r.lang = "en-IN";
  r.continuous = false;
  r.interimResults = true;
  return r;
}

const SUGGESTED = [
  "What does 'measured' mean here?",
  "How accurate is the attribution?",
  "What can the agent do without asking me?",
  "Why is the recovered figure so small?",
];

/**
 * The assistant, on every page.
 *
 * It answers questions about the system itself — what MEASURED means here,
 * how accurate the attribution is, what the agent may do unattended — from
 * the same committed files the pages read. Every figure in a reply is checked
 * against that context, and a reply citing one that is not there is refused
 * rather than shown with a caveat. This panel gets asked how honest the
 * system is, so an invented number would be a false claim about exactly that.
 *
 * Two things about the voice input are deliberate. It fills the box and lets
 * you see the transcript before it sends, because a mis-heard question that
 * submits itself is a demo going wrong in front of people. And speaking the
 * answer back is off until you turn it on, since a panel that starts talking
 * over a presenter is a panel nobody opens twice.
 */
export function Helpdesk() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [canHear, setCanHear] = useState(false);
  const [speakBack, setSpeakBack] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    setCanHear(speechEngine() !== null);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  // Escape closes it. A panel that traps you is worse than no panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Never leave the microphone running behind a closed panel.
  useEffect(() => {
    if (!open && recRef.current) {
      recRef.current.abort();
      recRef.current = null;
      setListening(false);
    }
  }, [open]);

  const say = useCallback(
    (text: string) => {
      if (!speakBack || typeof window === "undefined") return;
      const s = window.speechSynthesis;
      if (!s) return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-IN";
      u.rate = 1.02;
      s.speak(u);
    },
    [speakBack]
  );

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
      if (a.ok) say(a.text);
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

  function listen() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = speechEngine();
    if (!rec) return;
    setMicError(null);
    setQ("");
    recRef.current = rec;

    rec.onresult = (e: any) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      // Shown as it is heard, and left in the box to correct. Nothing is
      // sent until a person presses Ask.
      setQ(said.trim());
    };
    rec.onerror = (e: any) => {
      const k = e?.error;
      setMicError(
        k === "not-allowed" || k === "service-not-allowed"
          ? "Microphone blocked. Allow it in the address bar and try again."
          : k === "no-speech"
          ? "Did not catch that."
          : "Speech input is unavailable right now."
      );
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      inputRef.current?.focus();
    };

    try {
      rec.start();
      setListening(true);
    } catch {
      setMicError("Speech input is unavailable right now.");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`fixed bottom-5 right-5 z-[60] h-11 px-5 text-sm rounded-full
                    shadow-lg transition-all ${
                      open
                        ? "btn-secondary"
                        : "btn-primary"
                    }`}
      >
        {open ? "Close assistant" : "Ask about this system"}
      </button>

      {open && (
        <aside
          className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-canvas
                     border-l border-line shadow-2xl flex flex-col animate-rise"
          aria-label="System questions"
        >
          <div className="px-5 h-14 flex items-center gap-3 border-b border-line shrink-0">
            <span className="w-2 h-2 rounded-full bg-brand shrink-0" />
            <span className="text-sm font-medium">Your assistant</span>

            {canHear && (
              <button
                onClick={() => setSpeakBack((v) => !v)}
                className={`ml-auto text-[11px] px-2 py-1 rounded transition-colors ${
                  speakBack
                    ? "bg-brand-soft text-brand"
                    : "text-faint hover:text-muted"
                }`}
                title="Read answers aloud"
              >
                {speakBack ? "speaking" : "silent"}
              </button>
            )}

            <button
              onClick={() => setOpen(false)}
              className={`${canHear ? "" : "ml-auto"} text-muted hover:text-ink
                          transition-colors text-lg leading-none`}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {turns.length === 0 && (
              <div className="space-y-3">
                <p className="text-[15px] leading-relaxed">
                  I&rsquo;m your assistant. What can I help you with?
                </p>
                <p className="text-sm text-muted leading-relaxed">
                  I answer from this system&rsquo;s own records — the book, the
                  committed evals, the mandate rules. Every figure is checked
                  against them, and I refuse rather than guess.
                  {canHear && " You can type or press the microphone."}
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

          {micError && (
            <div className="px-5 pb-2 text-[11px] text-amber">{micError}</div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(q);
            }}
            className="p-4 border-t border-line flex items-center gap-2 shrink-0"
          >
            {canHear && (
              <button
                type="button"
                onClick={listen}
                aria-label={listening ? "Stop listening" : "Ask by voice"}
                className={`h-9 w-9 rounded-lg grid place-items-center shrink-0
                            border transition-colors ${
                              listening
                                ? "bg-rose-soft border-rose/40 text-rose"
                                : "border-line text-muted hover:text-ink"
                            }`}
              >
                <span
                  className={listening ? "animate-breathe" : ""}
                  aria-hidden="true"
                >
                  ●
                </span>
              </button>
            )}

            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                listening ? "listening…" : "Ask anything about this system…"
              }
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
