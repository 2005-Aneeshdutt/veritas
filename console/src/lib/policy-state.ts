import { useEffect, useState } from "react";

/**
 * Frontend-only record of which demo cases have had their Policy Kernel
 * evaluation run in this session. The Plan workspace reads this so it can
 * show POLICY PENDING before evaluation and the Kernel's own decision after.
 * The Plan page never decides authorization itself.
 */
export type PolicyRecord = "AUTHORIZED" | "DENIED";

const KEY = "veritas.policy.evaluated";
const listeners = new Set<() => void>();
let cache: Record<string, PolicyRecord> = {};
let loaded = false;

function load(): Record<string, PolicyRecord> {
  if (loaded) return cache;
  loaded = true;
  if (typeof window === "undefined") return cache;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) cache = JSON.parse(raw) as Record<string, PolicyRecord>;
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — in-memory record still works for this session */
  }
  listeners.forEach((l) => l());
}

export function recordPolicyDecision(caseId: string, record: PolicyRecord) {
  load();
  if (cache[caseId] === record) return;
  cache = { ...cache, [caseId]: record };
  persist();
}

export function clearPolicyDecision(caseId: string) {
  load();
  if (!(caseId in cache)) return;
  const next = { ...cache };
  delete next[caseId];
  cache = next;
  persist();
}

/** Undefined while the Policy Kernel has not evaluated this case yet. */
export function usePolicyRecord(caseId: string): PolicyRecord | undefined {
  const [value, setValue] = useState<PolicyRecord | undefined>(undefined);

  useEffect(() => {
    const read = () => setValue(load()[caseId]);
    read();
    listeners.add(read);
    return () => {
      listeners.delete(read);
    };
  }, [caseId]);

  return value;
}
