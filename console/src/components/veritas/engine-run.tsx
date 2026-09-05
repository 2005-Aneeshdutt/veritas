import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, RotateCcw } from "lucide-react";
import { streamUrl } from "@/data/http";
import { cn } from "@/lib/utils";

/**
 * The engine, actually running.
 *
 * This is the one place in the product where something moves because work is
 * happening, not because a timer says so. It opens `/api/run/{merchant}/stream`
 * and renders the trace events the pipeline emits as it executes: real node
 * durations, the real model on the two LLM nodes, and whether the answer came
 * from cache.
 *
 * Nothing here is choreographed. If a node is slow the bar sits on it; if the
 * stream fails the panel says so and stops. `pace_ms` is the backend's own
 * throttle, used so a 0.7s run is watchable rather than a flicker — it slows
 * the emission, it does not invent the timings, which are measured server-side
 * and displayed as reported.
 *
 * Why it earns its place on an overview: eight of the ten nodes are
 * deterministic. Seeing that is the governance argument in one glance — the
 * model proposes, and code decides.
 */

interface Trace {
  seq: number;
  node: string;
  kind: string;
  status: string;
  duration_ms: number;
  model: string | null;
  cache_hit: boolean | null;
  output_summary: Record<string, unknown>;
}

type Phase = "idle" | "running" | "done" | "error";

// The backend paces EVERY emitted event, and a run emits ~198 of them (mostly
// per-payment steps), not 10. 20ms lands the whole run at about 7s: slow enough
// to watch a node land, short enough to re-run while answering a question.
const PACE_MS = 20;

export function EngineRun({ merchant = "cloudsync" }: { merchant?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [nodes, setNodes] = useState<Trace[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const src = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    src.current?.close();
    src.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(() => {
    stop();
    setNodes([]);
    setCurrent(null);
    setTotal(null);
    setError(null);
    setPhase("running");

    const es = new EventSource(
      streamUrl(`/api/run/${merchant}/stream`, { pace_ms: PACE_MS })
    );
    src.current = es;

    es.addEventListener("start", (e) => {
      try {
        setCommit(String(JSON.parse((e as MessageEvent).data).commit ?? ""));
      } catch {
        /* the run is what matters, not the banner */
      }
    });

    es.addEventListener("trace", (e) => {
      let t: Trace;
      try {
        t = JSON.parse((e as MessageEvent).data) as Trace;
      } catch {
        return;
      }
      if (t.status === "running") {
        setCurrent(t.node);
        return;
      }
      // A node reports twice: once starting, once settled. Only the settled
      // event carries a real duration, so only that one is kept.
      setNodes((prev) => (prev.some((p) => p.node === t.node) ? prev : [...prev, t]));
    });

    es.addEventListener("done", (e) => {
      try {
        setTotal(Number(JSON.parse((e as MessageEvent).data).duration_ms));
      } catch {
        /* ignore */
      }
      setCurrent(null);
      setPhase("done");
      stop();
    });

    es.onerror = () => {
      // EventSource fires onerror on normal close too; only an unfinished run
      // is a real failure.
      setPhase((p) => {
        if (p === "done") return p;
        setError("The engine stream ended before the run finished.");
        return "error";
      });
      stop();
    };
  }, [merchant, stop]);

  const llm = nodes.filter((n) => n.kind === "llm").length;
  const det = nodes.length - llm;

  return (
    <section aria-label="Engine run" className="rounded-lg border border-hairline">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <div className="min-w-0">
          <p className="label-meta text-[10px] tracking-[0.16em]">Live engine</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            The diagnosis pipeline, executed now — not a replay.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {phase === "done" && total !== null && (
            <span className="numeral text-[11px] tabular-nums text-muted-foreground">
              {det} deterministic · {llm} model · {total}ms
            </span>
          )}
          <button
            type="button"
            onClick={run}
            disabled={phase === "running"}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] transition-colors",
              phase === "running"
                ? "cursor-wait border-hairline text-muted-foreground"
                : "border-hairline text-foreground hover:border-foreground/30"
            )}
          >
            {phase === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : phase === "done" ? (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            {phase === "running" ? "Running" : phase === "done" ? "Run again" : "Run the engine"}
          </button>
        </div>
      </header>

      {phase === "idle" ? (
        <p className="px-5 py-3 text-[12px] text-muted-foreground">
          Ten nodes, eight of them deterministic — run it to see which parts a model
          is allowed to touch.
        </p>
      ) : error ? (
        <p className="px-5 py-6 text-[13px] text-denied">{error}</p>
      ) : (
        <ol className="divide-y divide-hairline">
          {nodes.map((n) => (
            <Row key={n.node} node={n} />
          ))}
          {current && !nodes.some((n) => n.node === current) && (
            <li className="flex items-center gap-3 px-5 py-2.5">
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-observed"
                aria-hidden
              />
              <span className="text-[13px] text-foreground">{current}</span>
            </li>
          )}
        </ol>
      )}

      {phase === "done" && commit && (
        <p className="border-t border-hairline px-5 py-2.5 font-mono text-[10px] text-muted-foreground">
          commit {commit} · temperature 0 · timings measured server-side
        </p>
      )}
    </section>
  );
}

function Row({ node: n }: { node: Trace }) {
  const isLlm = n.kind === "llm";
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <Check className="h-3 w-3 shrink-0 text-measured" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{n.node}</span>
      <span
        className={cn(
          "shrink-0 text-[10px] uppercase tracking-[0.12em]",
          isLlm ? "text-projected" : "text-muted-foreground"
        )}
      >
        {isLlm ? "model" : "deterministic"}
      </span>
      {isLlm && n.model && (
        <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
          {n.model}
          {n.cache_hit ? " · cached" : ""}
        </span>
      )}
      <span className="numeral w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {n.duration_ms}ms
      </span>
    </li>
  );
}
