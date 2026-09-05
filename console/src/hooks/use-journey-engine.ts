import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JourneyCase, LiveStatus, StageId, StageStatus } from "@/domain/journey";
import { STAGE_ORDER } from "@/domain/journey";

export interface JourneyEvent {
  id: number;
  time: string;
  label: string;
  detail?: string | undefined;
}

/** Payment is available before the run starts, so progress begins at 1. */
const INITIAL_PROGRESS = 1;

function stamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export interface JourneyEngine {
  activeCase: JourneyCase;
  /** Number of sequence steps completed. */
  progress: number;
  running: boolean;
  finished: boolean;
  started: boolean;
  events: JourneyEvent[];
  liveStatus: LiveStatus;
  activeStage: StageId;
  stageStatus: (stage: StageId) => StageStatus;
  reachedStages: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  replay: () => void;
  selectStage: (stage: StageId) => void;
}

export function useJourneyEngine(activeCase: JourneyCase): JourneyEngine {
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [running, setRunning] = useState(false);
  const [userStage, setUserStage] = useState<StageId | null>(null);
  const [events, setEvents] = useState<JourneyEvent[]>([]);
  const eventId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const seq = activeCase.sequence;
  const finished = progress >= seq.length;

  // Reset everything when the case changes.
  useEffect(() => {
    clear();
    setProgress(INITIAL_PROGRESS);
    setRunning(false);
    setUserStage(null);
    eventId.current = 0;
    const first = seq[0];
    setEvents(
      first
        ? [{ id: 0, time: stamp(), label: first.event, detail: first.eventDetail }]
        : [],
    );
  }, [activeCase.id, seq]);

  // The live run: one timer per step, cleaned up on unmount / pause / case change.
  useEffect(() => {
    if (!running || finished) return;
    const step = seq[progress];
    if (!step) return;
    timer.current = setTimeout(() => {
      eventId.current += 1;
      setEvents((e) => [
        ...e,
        { id: eventId.current, time: stamp(), label: step.event, detail: step.eventDetail },
      ]);
      setProgress((p) => p + 1);
    }, step.ms);
    return clear;
  }, [running, finished, progress, seq]);

  useEffect(() => {
    if (finished) setRunning(false);
  }, [finished]);

  useEffect(() => clear, []);

  const start = useCallback(() => {
    setUserStage(null);
    if (progress >= seq.length) {
      setProgress(INITIAL_PROGRESS);
      eventId.current = 0;
      const first = seq[0];
      setEvents(first ? [{ id: 0, time: stamp(), label: first.event, detail: first.eventDetail }] : []);
    }
    setRunning(true);
  }, [progress, seq]);

  const pause = useCallback(() => {
    clear();
    setRunning(false);
  }, []);

  const resume = useCallback(() => setRunning(true), []);

  const reset = useCallback(() => {
    clear();
    setRunning(false);
    setUserStage(null);
    setProgress(INITIAL_PROGRESS);
    eventId.current = 0;
    const first = seq[0];
    setEvents(first ? [{ id: 0, time: stamp(), label: first.event, detail: first.eventDetail }] : []);
  }, [seq]);

  const replay = useCallback(() => {
    reset();
    setRunning(true);
  }, [reset]);

  const stageStatus = useCallback(
    (stage: StageId): StageStatus => {
      const idx = seq.findIndex((s) => s.stage === stage);
      if (idx === -1) {
        // Never part of this case's run. Pending until the run passes the point
        // where it would have happened, then honestly NOT REACHED.
        const order = STAGE_ORDER.indexOf(stage);
        const lastBefore = seq.reduce(
          (acc, s, i) => (STAGE_ORDER.indexOf(s.stage) < order ? i : acc),
          -1,
        );
        return progress > lastBefore ? activeCase.unreachedStatus : "pending";
      }
      if (idx < progress) return seq[idx]!.settles;
      if (idx === progress && running) return "current";
      return "pending";
    },
    [seq, progress, running, activeCase.unreachedStatus],
  );

  const activeStage: StageId = useMemo(() => {
    if (userStage) return userStage;
    const idx = running ? Math.min(progress, seq.length - 1) : Math.max(progress - 1, 0);
    return seq[idx]?.stage ?? "payment";
  }, [userStage, running, progress, seq]);

  const liveStatus: LiveStatus = useMemo(() => {
    if (finished) return activeCase.finalStatus;
    if (!running) return progress > INITIAL_PROGRESS ? "PAUSED" : "READY";
    return seq[progress]?.status ?? "READY";
  }, [finished, running, progress, seq, activeCase.finalStatus]);

  const selectStage = useCallback((stage: StageId) => setUserStage(stage), []);

  return {
    activeCase,
    progress,
    running,
    finished,
    started: progress > INITIAL_PROGRESS || running,
    events,
    liveStatus,
    activeStage,
    stageStatus,
    reachedStages: progress,
    start,
    pause,
    resume,
    reset,
    replay,
    selectStage,
  };
}
