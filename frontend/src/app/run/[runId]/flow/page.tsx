"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Eyebrow, Info, Loading, SectionHeader, Stagger } from "@/components/ui";
import { FLOW_ORDER, NODE_DOCS } from "@/lib/explain";
import { NodeTrace, RunRecord } from "@/lib/types";

/** Node positions, matching src/doctor/graph.py exactly. */
const POS: Record<string, { c: number; r: number }> = {
  ingest: { c: 0, r: 1 },
  classify: { c: 1, r: 1 },
  human_review: { c: 1, r: 0 },
  bank_health: { c: 2, r: 1 },
  decompose: { c: 3, r: 1 },
  hypothesise: { c: 4, r: 1 },
  plan: { c: 5, r: 1 },
  gate: { c: 6, r: 1 },
  execute: { c: 7, r: 0 },
  report: { c: 7, r: 2 },
};

const EDGES: [string, string][] = [
  ["ingest", "classify"],
  ["classify", "human_review"],
  ["classify", "bank_health"],
  ["human_review", "bank_health"],
  ["bank_health", "decompose"],
  ["decompose", "hypothesise"],
  ["hypothesise", "plan"],
  ["plan", "gate"],
  ["gate", "execute"],
  ["gate", "report"],
  ["execute", "report"],
];

const COL_W = 132;
const ROW_H = 104;
const NODE_W = 108;
const NODE_H = 58;
const PAD = 16;

const x = (c: number) => PAD + c * COL_W;
const y = (r: number) => PAD + r * ROW_H;

/** A sub-step streamed from a running node. Live only; never persisted. */
interface LiveStep {
  node: string;
  message: string;
  i: number;
  n: number;
  detail?: Record<string, any>;
}

/** Colour a sub-step by what it actually did, so denials stand out. */
function stepTone(x: LiveStep): string {
  const d = x.detail ?? {};
  if (d.decision === "deny") return "text-rose";
  if (d.decision === "step_up") return "text-amber";
  if (d.decision === "allow") return "text-mint";
  if (d.succeeded === true) return "text-mint";
  if (d.succeeded === false) return "text-faint";
  if (d.source === "model") return "text-iris";
  if (d.coalition) return "text-muted";
  return "text-muted";
}

export default function FlowPage({ params }: { params: { runId: string } }) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [traces, setTraces] = useState<NodeTrace[]>([]);
  const [selected, setSelected] = useState<string>("decompose");
  const [playing, setPlaying] = useState(false);
  // Slow by default: this page gets narrated over, and a replay that
  // finishes before you have said the node name is useless.
  const [speed, setSpeed] = useState(1);
  const [step, setStep] = useState<number | null>(null);
  //: Sub-steps streamed from a live run: one line per coalition computed, per
  //: action gated, per payment retried. Real work, not a progress animation.
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [mode, setMode] = useState<"idle" | "replay" | "live">("idle");
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/run/${params.runId}`)
      .then((r) => r.json())
      .then((d: RunRecord) => {
        setRec(d);
        setTraces(d.traces);
      });
    return () => esRef.current?.close();
  }, [params.runId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [traces.length, steps.length]);

  const byNode = useMemo(() => {
    const m: Record<string, NodeTrace> = {};
    // When stepping, only reveal nodes up to the current step.
    const visible = step === null ? traces : traces.slice(0, step + 1);
    for (const t of visible) m[t.node] = t;
    return m;
  }, [traces, step]);

  function replay() {
    if (!rec) return;
    esRef.current?.close();
    setTraces([]);
    setSteps([]);
    setStep(null);
    setPlaying(true);
    setMode("replay");
    const es = new EventSource(`/api/replay/${params.runId}?speed=${speed}`);
    esRef.current = es;
    es.addEventListener("trace", (e: any) => {
      const t: NodeTrace = JSON.parse(e.data);
      setTraces((prev) => [...prev.filter((x) => x.seq !== t.seq), t].sort((a, b) => a.seq - b.seq));
      setSelected(t.node);
    });
    es.addEventListener("done", () => {
      setPlaying(false);
      es.close();
    });
    es.onerror = () => {
      setPlaying(false);
      es.close();
    };
  }

  /**
   * Run the graph for real and watch it work.
   *
   * Not the replay: this executes the pipeline on the server and streams both
   * node transitions and the sub-steps inside them. `pace_ms` throttles how
   * fast the browser is FED, never how fast the work runs -- so nothing here
   * is padding. A 16-coalition decomposition emits 16 lines because it
   * computed 16 values.
   */
  function runLive() {
    if (!rec) return;
    esRef.current?.close();
    setTraces([]);
    setSteps([]);
    setStep(null);
    setPlaying(true);
    setMode("live");
    const pace = Math.round(24 / speed);
    const es = new EventSource(
      `/api/run/${rec.merchant_id}/stream?pace_ms=${pace}`
    );
    esRef.current = es;
    es.addEventListener("trace", (e: any) => {
      const t: NodeTrace = JSON.parse(e.data);
      setTraces((prev) =>
        [...prev.filter((x) => x.seq !== t.seq), t].sort((a, b) => a.seq - b.seq)
      );
      setSelected(t.node);
    });
    es.addEventListener("step", (e: any) => {
      const p: LiveStep = JSON.parse(e.data);
      setSteps((prev) => [...prev.slice(-400), p]);
    });
    es.addEventListener("done", () => {
      setPlaying(false);
      es.close();
    });
    es.onerror = () => {
      setPlaying(false);
      es.close();
    };
  }

  function stopAndReset() {
    esRef.current?.close();
    setPlaying(false);
    setTraces(rec?.traces ?? []);
    setSteps([]);
    setMode("idle");
    setStep(null);
  }

  function stepBy(n: number) {
    if (!rec) return;
    esRef.current?.close();
    setPlaying(false);
    setTraces(rec.traces);
    const total = rec.traces.length;
    const next = Math.max(0, Math.min(total - 1, (step ?? total - 1) + n));
    setStep(next);
    setSelected(rec.traces[next].node);
  }

  if (!rec) return <Loading label="loading trace" />;

  const sel = byNode[selected] ?? rec.traces.find((t) => t.node === selected) ?? null;
  const doc = NODE_DOCS[selected];
  const latest = traces.length ? traces[traces.length - 1] : null;
  const live = latest
    ? { title: NODE_DOCS[latest.node]?.title ?? latest.node, line: narrate(latest) }
    : null;
  const done = traces.filter((t) => t.status !== "running").length;
  // Calls that actually left the process, not the number of nodes allowed
  // to make one. A cached node or one served from the taxonomy makes
  // none, and counting it anyway overstates what ran.
  const modelCalls = rec.llm_calls;

  return (
    <div className="space-y-5">
      <Stagger>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>The agent, actually running</Eyebrow>
            <h1 className="text-2xl font-semibold mt-1">Ten nodes, nothing hidden</h1>
            <p className="text-sm text-muted mt-1.5 max-w-2xl leading-relaxed">
              Purple nodes are where a model makes a judgement call. Blue nodes are
              deterministic — arithmetic, lookups and policy, with a checkable answer.
              Click any node to read what it did, including the verbatim prompt.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="chip-neutral">
              real recorded run · not a mock
            </span>
            <select
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="card-raised px-2 py-1.5 text-xs num"
            >
              {[0.5, 1, 2, 4].map((s) => (
                <option key={s} value={s}>
                  {s}× speed
                </option>
              ))}
            </select>
            <button
              onClick={() => stepBy(-1)}
              className="card-raised px-2.5 py-1.5 text-xs hover:border-brand/40 transition-colors"
              title="previous node"
            >
              ‹
            </button>
            <button
              onClick={() => stepBy(1)}
              className="card-raised px-2.5 py-1.5 text-xs hover:border-brand/40 transition-colors"
              title="next node"
            >
              ›
            </button>
            {playing ? (
              <button
                onClick={stopAndReset}
                className="px-4 py-1.5 rounded-lg bg-rose/20 text-rose border border-rose/40
                           text-xs font-semibold"
              >
                ■ stop
              </button>
            ) : (
              <>
                <button
                  onClick={replay}
                  className="px-3 py-1.5 rounded-lg card-raised text-xs font-semibold
                             hover:border-brand/40 transition-colors"
                  title="Stream the recorded run. No API calls."
                >
                  ▶ replay
                </button>
                <button
                  onClick={runLive}
                  className="px-4 py-1.5 rounded-lg bg-brand text-brand-ink text-xs font-semibold
                             hover:brightness-110 transition-colors shadow-xs"
                  title="Execute the graph now and stream every sub-step as it happens."
                >
                  ● run live
                </button>
              </>
            )}
          </div>
        </div>
      </Stagger>

      {/* what is happening right now, in one sentence */}
      <Stagger i={1}>
        <div
          className={`card px-5 py-3.5 flex items-center gap-4 transition-colors ${
            playing ? "border-brand/40" : ""
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              playing ? "bg-brand animate-breathe" : "bg-faint"
            }`}
          />
          <div className="min-w-0 flex-1 text-sm">
            {live ? (
              <>
                <span className="text-brand font-medium">{live.title}</span>
                <span className="text-muted"> &mdash; {live.line}</span>
              </>
            ) : (
              <span className="text-muted">
                <span className="text-ink">Run live</span> executes the graph now and
                streams every coalition, gate decision and retry as it happens.{" "}
                <span className="text-ink">Replay</span> re-streams the recorded run
                with no API calls.
              </span>
            )}
          </div>
        </div>
      </Stagger>

      {/* progress */}
      <Stagger i={2}>
        <div className="card px-4 py-2.5 flex items-center gap-4">
          <div className="eyebrow shrink-0">
            {step !== null ? `step ${step + 1}` : playing ? "streaming" : "complete"} ·{" "}
            {done}/{rec.traces.length}
          </div>
          <div className="flex-1 h-1 rounded-full bg-raised overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand to-brand transition-[width] duration-500"
              style={{ width: `${(done / rec.traces.length) * 100}%` }}
            />
          </div>
          <div className="num text-xs text-muted shrink-0">
            {rec.duration_ms} ms · {modelCalls} model call
            {modelCalls === 1 ? "" : "s"} · ₹{rec.llm_cost_inr.toFixed(2)}
          </div>
        </div>
      </Stagger>

      <div className="grid xl:grid-cols-[1.55fr_1fr] gap-5">
        {/* ─────────────────────────────────────────────── graph */}
        <Stagger i={2}>
          <Card className="!p-4 overflow-x-auto">
            <svg
              viewBox={`0 0 ${PAD * 2 + 7 * COL_W + NODE_W} ${PAD * 2 + 2 * ROW_H + NODE_H}`}
              className="w-full min-w-[900px]"
              style={{ height: 300 }}
            >
              <defs>
                <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5"
                        orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="rgb(var(--brand))" opacity="0.85" />
                </marker>
                <marker id="arrowDim" markerWidth="7" markerHeight="7" refX="6" refY="3.5"
                        orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="rgb(var(--edge))" />
                </marker>
                <linearGradient id="llmGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--iris) / 0.18)" />
                  <stop offset="100%" stopColor="rgb(var(--iris) / 0.04)" />
                </linearGradient>
                <linearGradient id="detGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--sky) / 0.15)" />
                  <stop offset="100%" stopColor="rgb(var(--sky) / 0.04)" />
                </linearGradient>
              </defs>

              {EDGES.map(([from, to]) => {
                const a = POS[from];
                const b = POS[to];
                const ta = byNode[from];
                const tb = byNode[to];
                const live =
                  ta && ta.status === "ok" && tb && tb.status !== "skipped";
                const x1 = x(a.c) + NODE_W;
                const y1 = y(a.r) + NODE_H / 2;
                const x2 = x(b.c);
                const y2 = y(b.r) + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={`${from}-${to}`}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={live ? "rgb(var(--brand))" : "rgb(var(--line))"}
                    strokeWidth={live ? 1.7 : 1.1}
                    strokeDasharray={live ? "0" : "4 4"}
                    markerEnd={live ? "url(#arrow)" : "url(#arrowDim)"}
                    opacity={live ? 0.9 : 0.55}
                  />
                );
              })}

              {FLOW_ORDER.map((id) => {
                const pos = POS[id];
                const t = byNode[id];
                const d = NODE_DOCS[id];
                const llm = d.kind === "llm";
                const status = t?.status ?? "idle";
                const active = selected === id;
                const stroke =
                  status === "ok"
                    ? llm
                      ? "rgb(var(--iris))"
                      : "rgb(var(--sky))"
                    : status === "running"
                    ? "rgb(var(--brand))"
                    : status === "error"
                    ? "rgb(var(--rose))"
                    : "rgb(var(--line))";
                return (
                  <g
                    key={id}
                    onClick={() => setSelected(id)}
                    className="cursor-pointer"
                    opacity={status === "skipped" ? 0.35 : status === "idle" ? 0.4 : 1}
                  >
                    <rect
                      x={x(pos.c)}
                      y={y(pos.r)}
                      width={NODE_W}
                      height={NODE_H}
                      rx={10}
                      fill={llm ? "url(#llmGrad)" : "url(#detGrad)"}
                      stroke={active ? "rgb(var(--brand))" : stroke}
                      strokeWidth={active ? 2.2 : 1.3}
                      strokeDasharray={status === "skipped" ? "5 4" : "0"}
                      className={status === "running" ? "animate-pulseRing" : ""}
                    />
                    <text
                      x={x(pos.c) + NODE_W / 2}
                      y={y(pos.r) + 24}
                      textAnchor="middle"
                      fill="rgb(var(--ink))"
                      style={{ fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                    >
                      {d.title}
                    </text>
                    <text
                      x={x(pos.c) + NODE_W / 2}
                      y={y(pos.r) + 40}
                      textAnchor="middle"
                      fill={llm ? "rgb(var(--iris))" : "rgb(var(--sky))"}
                      style={{ fontSize: 8.5, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.08em" }}
                    >
                      {llm ? "LLM" : "DETERMINISTIC"}
                    </text>
                    {t && t.status === "ok" && (
                      <text
                        x={x(pos.c) + NODE_W - 8}
                        y={y(pos.r) + 14}
                        textAnchor="end"
                        fill="rgb(var(--faint))"
                        style={{ fontSize: 8, fontFamily: "JetBrains Mono, monospace" }}
                      >
                        {t.duration_ms}ms
                      </text>
                    )}
                    {status === "skipped" && (
                      <text
                        x={x(pos.c) + NODE_W / 2}
                        y={y(pos.r) + 52}
                        textAnchor="middle"
                        fill="rgb(var(--faint))"
                        style={{ fontSize: 7.5, fontFamily: "JetBrains Mono, monospace" }}
                      >
                        not taken
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-line
                            text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded border border-iris/60 bg-iris-soft inline-block" />
                model judgement
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded border border-sky/60 bg-sky-soft inline-block" />
                deterministic
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded border border-dashed border-line inline-block" />
                branch not taken
              </span>
              <span className="ml-auto text-faint">
                click a node · ‹ › to step through
              </span>
            </div>
          </Card>
        </Stagger>

        {/* ─────────────────────────────────────────── inspector */}
        <Stagger i={3}>
          <Card className="!p-0 overflow-hidden flex flex-col" >
            <div className="px-5 py-4 border-b border-line bg-surface">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold">{doc?.title ?? selected}</h3>
                <span className={doc?.kind === "llm" ? "chip-llm" : "chip-det"}>
                  {doc?.kind === "llm" ? doc.model ?? "LLM" : "deterministic"}
                </span>
                {sel && (
                  <span className="num text-[11px] text-muted ml-auto">
                    {sel.duration_ms} ms · {sel.status}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-2 leading-relaxed">{doc?.what}</p>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto" style={{ maxHeight: 520 }}>
              {!sel ? (
                <div className="text-xs text-faint font-mono">
                  this node has not run yet in the current playback
                </div>
              ) : (
                <>
                  <div className="card-raised p-3 border-l-2 border-l-brand/60">
                    <div className="eyebrow mb-1.5">what just happened</div>
                    <p className="text-sm leading-relaxed">{narrate(sel)}</p>
                  </div>

                  <Facts trace={sel} />

                  {sel.branch_taken && (
                    <KV k="branch taken" v={sel.branch_taken} accent />
                  )}
                  {sel.reason_codes?.length > 0 && (
                    <div>
                      <div className="eyebrow mb-1.5">reason codes</div>
                      <div className="flex flex-wrap gap-1.5">
                        {sel.reason_codes.map((c) => (
                          <span key={c} className="chip-neutral">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {sel.kind === "llm" && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="chip-neutral">{sel.model}</span>
                        <span className="chip-neutral">temperature 0</span>
                        {sel.cache_hit && (
                          <span className="chip bg-mint-soft text-mint border-mint/30">
                            served from cache
                          </span>
                        )}
                        {sel.stub && (
                          <span className="chip-warn">stub &mdash; no model called</span>
                        )}
                        {sel.tokens_in != null && (
                          <span className="chip-neutral">
                            {sel.tokens_in}&rarr;{sel.tokens_out} tokens
                          </span>
                        )}
                      </div>
                      {sel.prompt && (
                        <Reveal label="the exact prompt that was sent">
                          {sel.prompt}
                        </Reveal>
                      )}
                      {sel.raw_response && (
                        <Reveal label="the raw response, unedited">
                          {sel.raw_response}
                        </Reveal>
                      )}
                    </>
                  )}

                  <Block label="full output" data={sel.output_summary} />

                  {sel.intermediates && Object.keys(sel.intermediates).length > 0 && (
                    <Block
                      label={
                        selected === "decompose"
                          ? "all 16 coalition values"
                          : "intermediates"
                      }
                      data={sel.intermediates}
                    />
                  )}
                </>
              )}

              <details className="pt-2 border-t border-line">
                <summary className="eyebrow cursor-pointer hover:text-ink transition-colors">
                  why this node exists
                </summary>
                <div className="space-y-3 mt-3">
                  <p className="text-xs text-muted leading-relaxed">{doc?.why}</p>
                  <p className="text-xs text-muted leading-relaxed border-l-2 border-l-brand/40 pl-3">
                    {doc?.inspect}
                  </p>
                </div>
              </details>
            </div>
          </Card>
        </Stagger>
      </div>

      {/* ─────────────────────────────────────────────── log */}
      <Stagger i={4}>
        <Card className="!p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line flex items-center gap-3 flex-wrap">
            <span className="eyebrow">execution log</span>
            <span className="text-[11px] text-faint">
              click a node line to inspect it
            </span>
            {mode === "live" && (
              <span className="chip-warn">
                <span className="w-1.5 h-1.5 rounded-full bg-rose animate-breathe" />
                live
              </span>
            )}
            {steps.length > 0 && (
              <span className="ml-auto text-[11px] text-faint num">
                {steps.length} sub-steps
              </span>
            )}
          </div>
          <div
            ref={logRef}
            className="font-mono text-[11px] p-3 space-y-0.5 h-72 overflow-y-auto"
          >
            {traces.map((t) => {
              // The sub-steps this node emitted while it was working.
              const mine = steps.filter((x) => x.node === t.node);
              return (
                <div key={t.seq}>
                  <button
                    onClick={() => setSelected(t.node)}
                    className={`block w-full text-left px-2 py-1 rounded transition-colors ${
                      selected === t.node ? "bg-brand-soft" : "hover:bg-raised"
                    }`}
                  >
                    <span className="text-faint">
                      {String(t.seq).padStart(2, "0")}
                    </span>{" "}
                    <span className={t.kind === "llm" ? "text-iris" : "text-sky"}>
                      [{t.node.toUpperCase()}]
                    </span>{" "}
                    {t.status === "running" ? (
                      <span className="text-brand animate-breathe">working…</span>
                    ) : (
                      <>
                        <span className="text-faint">{t.duration_ms}ms</span>{" "}
                        <span
                          className={
                            t.status === "skipped"
                              ? "text-faint italic"
                              : "text-muted"
                          }
                        >
                          {t.status === "skipped"
                            ? t.output_summary?.reason
                            : summarise(t)}
                        </span>
                      </>
                    )}
                  </button>

                  {mine.map((x, k) => (
                    <div
                      key={k}
                      className="pl-8 pr-2 py-[1px] text-[10.5px] flex items-baseline gap-2"
                    >
                      <span className="text-faint w-14 shrink-0 text-right">
                        {x.n ? `${x.i}/${x.n}` : ""}
                      </span>
                      <span className={stepTone(x)}>{x.message}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {traces.length === 0 && (
              <div className="text-faint px-2 py-1">
                press <span className="text-ink">run live</span> to execute the graph
                and watch every step, or <span className="text-ink">replay</span> the
                recorded run…
              </div>
            )}
          </div>
        </Card>
      </Stagger>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

/** One plain sentence describing what this node actually did, from its output.
 *
 * The inspector used to lead with "here is what this node is for", which is
 * useful once and useless every time after. What a reader wants while watching
 * a run is what it just did with THEIR data. */
function narrate(t: NodeTrace): string {
  const o: any = t.output_summary ?? {};
  switch (t.node) {
    case "ingest":
      return `Loaded ${fmt(o.transactions)} payments, ${fmt(
        o.failures
      )} of which failed. Observed success ${o.observed_success_pct}%, give or take ${
        o.wilson_halfwidth_pts
      } points.`;
    case "classify":
      return `Sorted ${fmt(
        (o.from_taxonomy ?? 0) + (o.from_llm ?? 0)
      )} distinct error codes. ${fmt(
        o.from_taxonomy
      )} answered from the hand-labelled taxonomy with no API call; ${fmt(
        o.from_llm
      )} needed the model. ${o.low_confidence || "None"} went to human review.`;
    case "human_review":
      return o.reason ?? `${fmt(o.queued)} classifications held for a person.`;
    case "bank_health":
      return `Joined ${fmt(o.banks_examined)} banks against NPCI ${o.npci_period}. ${
        (o.worse_than_npci_baseline?.length ?? 0) > 0
          ? `${o.worse_than_npci_baseline.join(
              ", "
            )} performs materially worse here than it does nationally.`
          : "None performs materially worse here than it does nationally."
      }`;
    case "decompose": {
      const top = Object.entries(o.attributions ?? {}).sort(
        (a: any, b: any) => b[1] - a[1]
      )[0];
      return `Split a ${o.gap_pts}-point gap across 16 coalitions. ${
        top ? `${top[0]} carries ${top[1]} points` : "Nothing carries much"
      }; ${o.residual_pts} left unexplained.${
        o.degenerate_factors?.length
          ? ` ${o.degenerate_factors.join(", ")} could not be identified at all.`
          : ""
      }`;
    }
    case "hypothesise":
      return o.summary || `Named ${o.primary_label} as the primary cause.`;
    case "plan":
      return o.headline ?? `Proposed ${fmt(o.actions)} actions.`;
    case "gate":
      return `Checked every action against the signed mandate: ${fmt(
        o.decisions?.allow
      )} allowed, ${fmt(o.decisions?.step_up)} need the merchant, ${fmt(
        o.decisions?.deny
      )} denied outright.`;
    case "execute":
      return `Ran ${fmt(o.executed)} actions and recovered Rs ${fmt(
        o.recovered_inr
      )}. Wrote ${fmt(o.ledger_entries)} ledger entries; chain ${
        o.chain_verified ? "verified" : "BROKEN"
      }.`;
    case "report":
      return "Separated what is measured from what is modelled, and refused to mix them.";
    default:
      return summarise(t);
  }
}

function fmt(n: any): string {
  return typeof n === "number" ? n.toLocaleString("en-IN") : String(n ?? "0");
}

/** The handful of numbers from this node worth reading at a glance. */
function Facts({ trace }: { trace: NodeTrace }) {
  const o: any = trace.output_summary ?? {};
  const pick = Object.entries(o).filter(
    ([, v]) => typeof v === "number" || typeof v === "boolean"
  ) as [string, any][];
  if (!pick.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {pick.slice(0, 6).map(([k, v]) => (
        <div key={k} className="card-raised px-3 py-2">
          <div className="eyebrow truncate">{k.replace(/_/g, " ")}</div>
          <div className="num text-sm mt-0.5">
            {typeof v === "boolean" ? (v ? "yes" : "no") : fmt(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

function summarise(t: NodeTrace): string {
  const o = t.output_summary ?? {};
  return Object.keys(o)
    .slice(0, 3)
    .map((k) => `${k}=${JSON.stringify(o[k])}`)
    .join("  ")
    .slice(0, 170);
}

function KV({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="eyebrow">{k}</span>
      <span className={`num ${accent ? "text-brand" : "text-ink"}`}>{v}</span>
    </div>
  );
}

function Reveal({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="eyebrow text-brand hover:text-brand transition-colors flex items-center gap-1"
      >
        <span>{open ? "▾" : "▸"}</span> {label}
      </button>
      {open && (
        <pre className="mt-2 p-3 bg-subtle rounded-lg border border-line font-mono
                        text-[10px] leading-relaxed whitespace-pre-wrap
                        max-h-72 overflow-y-auto text-muted animate-rise">
          {children}
        </pre>
      )}
    </div>
  );
}

function Block({
  label,
  data,
  open = false,
}: {
  label: string;
  data: any;
  open?: boolean;
}) {
  const [show, setShow] = useState(open);
  return (
    <div>
      <button
        onClick={() => setShow(!show)}
        className="eyebrow hover:text-ink transition-colors flex items-center gap-1"
      >
        <span>{show ? "▾" : "▸"}</span> {label}
      </button>
      {show && (
        <pre className="mt-2 p-3 bg-subtle rounded-lg border border-line font-mono
                        text-[10px] leading-relaxed whitespace-pre-wrap
                        max-h-64 overflow-y-auto text-muted animate-rise">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
