"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, stagesFrom } from "@/components/AgentPipeline";
import { NodeTrace, RunRecord } from "@/lib/types";

export interface LiveStep {
  node: string;
  message: string;
  i: number;
  n: number;
  detail?: Record<string, unknown>;
}

/**
 * Watch the engine run, for real.
 *
 * `/api/run/{merchant}/stream` runs the graph on its own thread and emits a
 * NodeTrace when each node starts and again when it finishes, plus sub-steps
 * carrying their own i-of-n. `pace_ms` throttles how fast the browser is fed
 * and never the work itself, so this is the actual run arriving at a readable
 * speed — not a scripted animation that happens to end where the data is.
 *
 * The record that arrives on `done` is the one the engine produced. Nothing in
 * this hook computes a business figure, and the page it feeds lands on exactly
 * the result the synchronous path would have produced.
 *
 * One thing a caller must know: the stream endpoint mints a fresh run_id, so
 * running it leaves a new record on disk. That is the backend's existing
 * behaviour and this hook does not change it — see `onDone`, which hands back
 * the record so a page can navigate to it rather than guessing.
 */
export function useDiagnosis(merchant: string | null, paceMs = 55) {
  const [traces, setTraces] = useState<NodeTrace[]>([]);
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    es.current?.close();
    es.current = null;
    setRunning(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(() => {
    if (!merchant || es.current) return;
    setTraces([]);
    setSteps([]);
    setRecord(null);
    setError(null);
    setRunning(true);

    const src = new EventSource(
      `/api/run/${merchant}/stream?pace_ms=${paceMs}`
    );
    es.current = src;

    src.addEventListener("trace", (e) => {
      const t = JSON.parse((e as MessageEvent).data) as NodeTrace;
      // Keep the newest per node: a node arrives twice, once running and once
      // with its outcome, and the outcome is what should be shown.
      setTraces((prev) => {
        const out = prev.filter((p) => p.node !== t.node);
        return [...out, t];
      });
    });

    src.addEventListener("step", (e) => {
      setSteps((prev) => [...prev, JSON.parse((e as MessageEvent).data)]);
    });

    src.addEventListener("done", (e) => {
      setRecord(JSON.parse((e as MessageEvent).data));
      stop();
    });

    src.addEventListener("error", (e) => {
      const d = (e as MessageEvent).data;
      if (d) {
        try {
          setError(JSON.parse(d).detail ?? "the run failed");
        } catch {
          setError("the run failed");
        }
      }
      stop();
    });

    src.onerror = () => stop();
  }, [merchant, paceMs, stop]);

  const stages: Stage[] = stagesFrom(traces, steps, running);

  return { stages, traces, steps, record, running, error, start, stop };
}
