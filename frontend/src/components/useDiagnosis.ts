"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, stagesFrom } from "@/components/AgentPipeline";
import { clearActivity, reportActivity } from "@/lib/activity";
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
  //: Nodes that have finished, counted outside React state so the activity
  //: bus can be told without doing work inside an updater.
  const doneRef = useRef<Set<string>>(new Set());

  const stop = useCallback(() => {
    es.current?.close();
    es.current = null;
    setRunning(false);
    clearActivity();
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(() => {
    if (!merchant || es.current) return;
    doneRef.current = new Set();
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
      //
      // The running tally is kept in a ref rather than derived inside the
      // updater. A state updater has to be pure -- React may call it more than
      // once -- and publishing to the activity bus from inside one meant
      // setting state on another component mid-update, which lost the traces
      // entirely and left every node showing "queued" under an ACTIVE header.
      if (t.status !== "running") doneRef.current.add(t.node);
      setTraces((prev) => [...prev.filter((p) => p.node !== t.node), t]);

      reportActivity({
        active: true,
        label: `${t.node.replace(/_/g, " ")} — ${merchant}`,
        stage: t.node,
        done: doneRef.current.size,
        total: 10,
      });
    });

    src.addEventListener("step", (e) => {
      const st = JSON.parse((e as MessageEvent).data) as LiveStep;
      setSteps((prev) => [...prev, st]);
      // Same rule: publish after the update is queued, never from inside it.
      // The bus carries only what the engine reported: the node it is inside
      // and that node's own i-of-n.
      reportActivity({
        active: true,
        label: `${st.node.replace(/_/g, " ")} — ${merchant}`,
        stage: st.node,
        i: st.i,
        n: st.n,
      });
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
