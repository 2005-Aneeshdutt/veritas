"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Citation {
  value: number;
  grounded: boolean;
}

interface ChainLink {
  sequence: number;
  txn_id: string;
  action_type: string;
  gate_decision: string;
  gate_reason: string;
  actor: string;
  prev_hash: string;
  entry_hash: string;
}

interface Answer {
  ok: boolean;
  text: string;
  citations: Citation[];
  figures_cited: number;
  figures_verified: number;
  refused_reason?: string | null;
  cache_hit?: boolean;
  chain?: ChainLink[];
  chain_note?: string;
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

/* ── where the button sits ───────────────────────────────────────────────
 *
 * It floats above the page, so wherever it is parked it covers something.
 * Bottom-right collided with the top bar's own controls on a short viewport,
 * and no single default avoids every page. So it is draggable and remembers,
 * which is the only answer that works for a layout nobody has seen yet.
 *
 * Dragging and clicking share one pointer, so movement past a few pixels is
 * what separates them -- otherwise every drag would also open the panel on
 * release.
 */
const DOCK_KEY = "rd.helpdesk.dock";
const PANEL_KEY = "rd.helpdesk.panel";
//: The conversation itself. It used to die on every navigation, which meant
//: the answer somebody just asked for was gone the moment they clicked
//: through to look at what it said -- and re-asking costs a model call for a
//: question that has already been answered.
const TURNS_KEY = "rd.helpdesk.turns";
//: Enough to hold a demo's worth of questions without the panel becoming an
//: archive, and small enough that a full localStorage is not a risk.
const TURNS_KEPT = 30;
const EDGE = 16;
const DRAG_SLOP = 4;
const PANEL_W = 400;
const PANEL_H = 560;

function clampToViewport(x: number, y: number, w: number, h: number) {
  const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
  return { x: Math.min(Math.max(EDGE, x), maxX), y: Math.min(Math.max(EDGE, y), maxY) };
}

const SUGGESTED = [
  "What does 'measured' mean here?",
  "How accurate is the attribution?",
  "What can the agent do without asking me?",
  "Why is the recovered figure so small?",
];

/**
 * The same four questions, ordered for the screen you are on.
 *
 * Only the ORDER changes, never the set: all four are pre-warmed in the
 * committed cache, so every suggestion answers on a deployment with no API
 * key. Adding page-specific questions would have looked more contextual and
 * quietly broken that guarantee, which is the one property this panel is
 * for.
 *
 * Nothing about grounding, context, refusal, caching or prompts is touched.
 */
function suggestionsFor(path: string): string[] {
  const first = (q: string) => [q, ...SUGGESTED.filter((x) => x !== q)];
  if (path.includes("/authorise") || path.includes("/journey"))
    return first("What can the agent do without asking me?");
  if (path.startsWith("/evidence") || path.startsWith("/impact"))
    return first("How accurate is the attribution?");
  if (path.startsWith("/portfolio") || path.startsWith("/platform"))
    return first("Why is the recovered figure so small?");
  return SUGGESTED;
}

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
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  //: Nothing is written until the stored conversation has been read, or the
  //: first render would save its own empty state over it.
  const loaded = useRef(false);
  const [busy, setBusy] = useState(false);

  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [canHear, setCanHear] = useState(false);
  const [speakBack, setSpeakBack] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRec | null>(null);

  //: null until measured on the client -- the server has no viewport, and
  //: guessing one would flash the button into the wrong corner on load.
  const [dock, setDock] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  //: The window itself moves too. It was pinned to the right edge, full
  //: height, which is fine until it covers the thing you opened it to ask
  //: about -- and on this app that is most of the page.
  const [win, setWin] = useState<{ x: number; y: number } | null>(null);
  const winRef = useRef<HTMLElement>(null);
  const winLive = useRef<{ x: number; y: number } | null>(null);
  const winDrag = useRef<{ dx: number; dy: number } | null>(null);

  /**
   * The conversation survives navigation.
   *
   * It lives in this component, which unmounts on every page change, so an
   * answer disappeared the moment somebody clicked through to check what it
   * had told them -- and asking again spends another model call on a question
   * already answered. A pending turn is dropped on the way out: a question
   * whose request died with the page would come back as a spinner that never
   * resolves.
   */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TURNS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) setTurns(saved.filter((t: Turn) => t?.q && t?.a));
      }
    } catch {
      // A blocked or corrupt store is not a reason to lose the panel.
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(
        TURNS_KEY,
        JSON.stringify(turns.filter((t) => t.a).slice(-TURNS_KEPT))
      );
    } catch {
      // Full or private-mode storage: the panel still works for this page.
    }
  }, [turns]);

  useEffect(() => {
    if (!open || win) return;
    let start = {
      x: window.innerWidth - PANEL_W - 20,
      y: Math.max(EDGE, window.innerHeight - PANEL_H - 76),
    };
    try {
      const raw = localStorage.getItem(PANEL_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") start = p;
      }
    } catch {
      // No stored spot is not a failure; it opens where it always does.
    }
    const at = clampToViewport(start.x, start.y, PANEL_W, PANEL_H);
    winLive.current = at;
    setWin(at);
  }, [open, win]);

  useEffect(() => {
    function onResize() {
      if (!win) return;
      const at = clampToViewport(win.x, win.y, PANEL_W, PANEL_H);
      winLive.current = at;
      setWin(at);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [win]);

  function winDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only the header drags. A window that moves when you select an answer
    // is a window you cannot copy text out of.
    const el = winRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    winDrag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function winMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = winDrag.current;
    if (!d) return;
    const at = clampToViewport(e.clientX - d.dx, e.clientY - d.dy, PANEL_W, PANEL_H);
    winLive.current = at;
    setWin(at);
  }

  function winUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!winDrag.current) return;
    winDrag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    try {
      if (winLive.current) {
        localStorage.setItem(PANEL_KEY, JSON.stringify(winLive.current));
      }
    } catch {
      // Then it simply will not be remembered.
    }
  }
  //: The position as of the last move. Reading `dock` on pointerup can be a
  //: render behind, which would save where the button was rather than where
  //: it was dropped.
  const live = useRef<{ x: number; y: number } | null>(null);

  // Restore where it was parked, then keep it on screen.
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    let start = { x: window.innerWidth - w - 20, y: window.innerHeight - h - 20 };
    try {
      const raw = localStorage.getItem(DOCK_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") start = p;
      }
    } catch {
      // A blocked or full localStorage is not a reason to lose the button.
    }
    const at = clampToViewport(start.x, start.y, w, h);
    live.current = at;
    setDock(at);
  }, []);

  // A window that shrinks must not strand it off-screen.
  useEffect(() => {
    function onResize() {
      const el = btnRef.current;
      if (!el || !dock) return;
      const { width: w, height: h } = el.getBoundingClientRect();
      const at = clampToViewport(dock.x, dock.y, w, h);
      live.current = at;
      setDock(at);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dock]);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    const el = btnRef.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - d.dx;
    const y = e.clientY - d.dy;
    if (!d.moved) {
      const far =
        Math.abs(x - r.left) > DRAG_SLOP || Math.abs(y - r.top) > DRAG_SLOP;
      if (!far) return;
      d.moved = true;
      setDragging(true);
    }
    const at = clampToViewport(x, y, r.width, r.height);
    live.current = at;
    setDock(at);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    btnRef.current?.releasePointerCapture(e.pointerId);
    if (d?.moved) {
      setDragging(false);
      try {
        if (live.current) {
          localStorage.setItem(DOCK_KEY, JSON.stringify(live.current));
        }
      } catch {
        // Not worth failing over; it simply will not be remembered.
      }
      return; // a drag is not a click
    }
    setOpen((v) => !v);
  }

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
      // Named causes, because "unavailable right now" tells you nothing and
      // the commonest cause here is the least obvious one: Chrome's speech
      // engine is a network service, so it fails offline with no hint.
      const k = e?.error;
      const msg: Record<string, string> = {
        "not-allowed":
          "Microphone blocked. Allow it in the address bar, then try again.",
        "service-not-allowed":
          "The browser refused the speech service. Check site permissions.",
        network:
          "Speech needs the internet — the browser sends audio to its own service. You are offline or it is blocked.",
        "audio-capture": "No microphone found.",
        aborted: "Stopped.",
        "no-speech": "Did not catch that. Try again.",
      };
      setMicError(msg[k] ?? "Speech input failed (" + (k || "unknown") + ").");
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
        ref={btnRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          // Keyboard users never drag, so space and enter must still open it.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open}
        title="Drag to move"
        style={
          dock
            ? { left: dock.x, top: dock.y, touchAction: "none" }
            : { right: 20, bottom: 20, touchAction: "none", visibility: "hidden" }
        }
        className={`fixed z-[60] h-11 px-5 text-sm rounded-full shadow-lg
                    select-none ${dragging ? "cursor-grabbing scale-105" : "cursor-grab"}
                    ${dragging ? "" : "transition-all"} ${
                      open ? "btn-secondary" : "btn-primary"
                    }`}
      >
        {open ? "Close assistant" : "Ask about this system"}
      </button>

      {open && (
        <aside
          ref={winRef as any}
          style={
            win
              ? { left: win.x, top: win.y, width: PANEL_W, height: PANEL_H }
              : { right: 20, bottom: 76, width: PANEL_W, height: PANEL_H, visibility: "hidden" }
          }
          className="hd fixed z-50 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]
                     rounded-lg shadow-2xl flex flex-col animate-rise overflow-hidden"
          aria-label="System questions"
        >
          <div
            onPointerDown={winDown}
            onPointerMove={winMove}
            onPointerUp={winUp}
            style={{ touchAction: "none" }}
            className="px-5 h-14 flex items-center gap-3 shrink-0 cursor-grab
                       active:cursor-grabbing select-none hd-head"
            title="Drag to move"
          >
            <span className="w-2 h-2 rounded-full shrink-0 hd-dot" />
            <span className="text-sm font-medium text-ink">Revenue Doctor</span>

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

            {/* Answers now outlive the page, so there has to be a way to
                end a conversation rather than only to hide it. */}
            {turns.length > 0 && (
              <button
                onClick={() => setTurns([])}
                className={`${canHear ? "" : "ml-auto"} text-[11px] px-2 py-1
                            rounded text-faint hover:text-muted transition-colors`}
                title="Forget this conversation"
              >
                clear
              </button>
            )}

            <button
              onClick={() => setOpen(false)}
              className={`${canHear || turns.length > 0 ? "" : "ml-auto"}
                          text-muted hover:text-ink
                          transition-colors text-lg leading-none`}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {turns.length === 0 && (
              <div className="space-y-3">
                <p className="text-[15px] leading-relaxed text-ink">
                  I&rsquo;m your assistant. What can I help you with?
                </p>
                <p className="text-sm text-muted leading-relaxed">
                  I answer from this system&rsquo;s own records — the book, the
                  committed evals, the mandate rules. Every figure is checked
                  against them, and I refuse rather than guess.
                  {canHear && " You can type or press the microphone."}
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  {suggestionsFor(path).map((s) => (
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
                <div className="text-sm font-medium text-ink">{t.q}</div>

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

                    {/* Asked about the chain, show the chain. Prose about a
                        hash chain is the one answer a reader cannot check,
                        and checkability is the whole argument. */}
                    {t.a.chain && t.a.chain.length > 0 && (
                      <ChainPreview
                        links={t.a.chain}
                        note={t.a.chain_note ?? ""}
                      />
                    )}
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

/**
 * The chain, inside the answer.
 *
 * Every link shows its prev_hash directly under the previous link's own
 * hash, because the matching pair IS the property — a table with a hash
 * column proves only that hashes exist. The first entry's prev is sixty-four
 * zeros, which is where the chain provably starts.
 */
function ChainPreview({ links, note }: { links: ChainLink[]; note: string }) {
  const TONE: Record<string, string> = {
    allow: "#1b7048",
    step_up: "#8c5e00",
    deny: "#a2382f",
  };
  return (
    <div className="mt-3 pt-3 border-t">
      <div className="text-[10px] uppercase tracking-[0.1em] text-faint">
        the chain itself
      </div>

      <div className="mt-2 space-y-0">
        {links.map((l, i) => (
          <div key={l.entry_hash}>
            <div className="font-mono text-[10px] text-faint pl-2">
              {i === 0 ? "genesis " : "prev "}
              {l.prev_hash.slice(0, 20)}…
            </div>
            <div
              className="pl-2 py-1 border-l-2"
              style={{ borderColor: TONE[l.gate_decision] ?? "#e3e6ec" }}
            >
              <div className="flex items-baseline gap-1.5 text-[11px]">
                <span className="font-mono text-faint">#{l.sequence}</span>
                <span className="font-mono truncate max-w-[8.5rem]">
                  {l.txn_id}
                </span>
                <span
                  className="ml-auto text-[10px]"
                  style={{ color: TONE[l.gate_decision] ?? "#5b6270" }}
                >
                  {l.gate_decision}
                </span>
              </div>
              <div className="font-mono text-[10px] mt-0.5" style={{ color: "#5b5bd6" }}>
                hash {l.entry_hash.slice(0, 20)}…
              </div>
            </div>
          </div>
        ))}
      </div>

      {note && (
        <p className="text-[10px] text-faint mt-2 leading-relaxed">{note}</p>
      )}
    </div>
  );
}
