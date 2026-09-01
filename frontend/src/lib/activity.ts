/**
 * What the system is doing, reported once and readable anywhere.
 *
 * The requirement is that the app feels like one live system without every
 * page becoming a wall of agent cards. So work is announced through a single
 * tiny bus, and exactly one always-visible element in the sidebar listens to
 * it. Foreground stays the task; background carries the pulse.
 *
 * Deliberately not React context: the publishers are stream handlers inside
 * effects, and threading a provider through the tree would mean restructuring
 * a layout that currently works. Twenty lines of pub/sub does the same job
 * and cannot re-render anything that did not ask to listen.
 *
 * Nothing here invents activity. A publisher reports work that is genuinely
 * happening — an open SSE connection, a node the engine finished — and when
 * the work stops the bus goes quiet.
 */

export interface Activity {
  /** What is running, in the product's own words. */
  label: string;
  /** Which pipeline stage, when the work maps to one. */
  stage?: string;
  /** Progress within the current unit of work, when it is known. */
  i?: number;
  n?: number;
  /** How many of the engine's ten nodes have finished. */
  done?: number;
  total?: number;
  active: boolean;
}

const IDLE: Activity = { label: "Idle", active: false };

let current: Activity = IDLE;
const listeners = new Set<(a: Activity) => void>();

export function reportActivity(a: Partial<Activity> & { active: boolean }) {
  current = { ...IDLE, ...a };
  for (const fn of listeners) fn(current);
}

export function clearActivity() {
  current = IDLE;
  for (const fn of listeners) fn(current);
}

export function getActivity(): Activity {
  return current;
}

export function onActivity(fn: (a: Activity) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

/** The engine's stages, in the order the graph runs them. */
export const PIPELINE = [
  "ingest",
  "classify",
  "human_review",
  "bank_health",
  "decompose",
  "hypothesise",
  "plan",
  "gate",
  "execute",
  "report",
] as const;
