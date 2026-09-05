import { inr } from "@/domain/money";
import type { Money, ClaimState } from "@/domain/types";
import type { EvidenceStatus, JourneyCase } from "@/domain/journey";
import { JOURNEY_CASES } from "./journey-cases";

/**
 * Proof layer data. Frontend-only demonstration records derived from the
 * existing typed journey cases plus a small set of clearly-labelled demo
 * ledger entries. Nothing here is generated at runtime and nothing here
 * asserts a claim the underlying record does not support.
 */

export interface LedgerEntry {
  /** Sequence number in the append-only chain. */
  n: number;
  entry: string;
  at: string;
  actor: string;
  payment: string;
  action: string;
  decision: string;
  outcome: string;
  amount: Money;
  claim: ClaimState;
  prevHash: string;
  hash: string;
  status: string;
  caseId?: string;
}

function caseEntry(c: JourneyCase, n: number): LedgerEntry {
  return {
    n,
    entry: c.ledger.entry,
    at: c.ledger.at,
    actor: c.ledger.actor,
    payment: c.id,
    action: c.ledger.action,
    decision: c.policy.decision,
    outcome: c.outcome.state,
    amount: c.claimAmount,
    claim: c.claim,
    prevHash: c.ledger.prevHash,
    hash: c.ledger.hash,
    status: c.ledger.verification,
    caseId: c.id,
  };
}

const [DENIAL_CASE, SUCCESS_CASE, UNVERIFIED_CASE] = JOURNEY_CASES as [
  JourneyCase,
  JourneyCase,
  JourneyCase,
];

/** Append-only governance record. Demo entries, ordered newest first in the UI. */
export const LEDGER_ENTRIES: LedgerEntry[] = [
  {
    n: 15,
    entry: "ENTRY #15",
    at: "2026-09-02T16:20:11.000Z",
    actor: "policy-kernel",
    payment: "pay_northbridge_2214",
    action: "DECISION RECORDED — HOLD",
    decision: "HOLD",
    outcome: "NOT REACHED",
    amount: inr(0),
    claim: "ABSTAINED",
    prevHash: "c02f…9a11",
    hash: "9f31…c40a",
    status: "CHAIN VERIFIED",
  },
  {
    n: 16,
    entry: "ENTRY #16",
    at: "2026-09-02T18:12:03.000Z",
    actor: "recovery-runner",
    payment: "pay_verdant_0918",
    action: "ACTION RECORDED — payment link issued",
    decision: "AUTO-ALLOW",
    outcome: "OBSERVED",
    amount: inr(0),
    claim: "PROJECTED",
    prevHash: "9f31…c40a",
    hash: "51ab…7c33",
    status: "CHAIN VERIFIED",
  },
  caseEntry(UNVERIFIED_CASE, 22),
  {
    n: 26,
    entry: "ENTRY #26",
    at: "2026-09-03T04:02:55.000Z",
    actor: "policy-kernel",
    payment: "pay_lumenworks_0731",
    action: "DECISION RECORDED — ESCALATE",
    decision: "ESCALATE",
    outcome: "NOT REACHED",
    amount: inr(0),
    claim: "ABSTAINED",
    prevHash: "77c9…0d41",
    hash: "4c81…7a20",
    status: "CHAIN VERIFIED",
  },
  caseEntry(DENIAL_CASE, 17),
  caseEntry(SUCCESS_CASE, 30),
  {
    n: 31,
    entry: "ENTRY #31",
    at: "2026-09-03T09:14:02.000Z",
    actor: "ledger-writer",
    payment: "pay_stellar_0623",
    action: "ACTION RECORDED — retry deferred",
    decision: "HOLD",
    outcome: "NOT REACHED",
    amount: inr(0),
    claim: "ABSTAINED",
    prevHash: "e10d…93bb",
    hash: "2b6a…44f7",
    status: "CHAIN VERIFIED",
  },
  {
    n: 32,
    entry: "ENTRY #32",
    at: "2026-09-03T10:41:19.000Z",
    actor: "operator · a.dutt",
    payment: "pay_orbitpay_1402",
    action: "HUMAN REVIEW OPENED",
    decision: "HUMAN REVIEW",
    outcome: "UNVERIFIED",
    amount: inr(0),
    claim: "UNVERIFIED",
    prevHash: "2b6a…44f7",
    hash: "8d05…61ca",
    status: "CHAIN VERIFIED · settlement absent",
  },
];

export const LEDGER_DECISIONS = ["AUTO-ALLOW", "HOLD", "DENY", "ESCALATE", "HUMAN REVIEW"] as const;
export const LEDGER_OUTCOMES = ["MEASURED", "OBSERVED", "UNVERIFIED", "NOT REACHED"] as const;
export const LEDGER_CLAIMS: ClaimState[] = [
  "MEASURED",
  "PROJECTED",
  "OBSERVED",
  "UNVERIFIED",
  "ABSTAINED",
];

export function ledgerNeighbours(
  e: LedgerEntry,
  list: LedgerEntry[] = LEDGER_ENTRIES,
): {
  prev: LedgerEntry | undefined;
  next: LedgerEntry | undefined;
} {
  const sorted = [...list].sort((a, b) => a.n - b.n);
  const i = sorted.findIndex((x) => x.n === e.n);
  return { prev: sorted[i - 1], next: sorted[i + 1] };
}

/* ---------------------------------------------------------------- evidence */

export type EvidenceCategory =
  | "PAYMENT"
  | "DIAGNOSIS"
  | "POLICY"
  | "EXECUTION"
  | "OUTCOME"
  | "LEDGER"
  | "GATEWAY";

export interface EvidenceItem {
  category: EvidenceCategory;
  status: EvidenceStatus;
  note: string;
  source: string;
  reference: string;
  at: string;
  /** The claim this artifact supports, in plain language. */
  supports: string;
  caseId: string;
  payment: string;
}

const NOT_AVAILABLE = "—";

/** Evidence for a case, derived strictly from the case record. */
export function evidenceFor(c: JourneyCase): EvidenceItem[] {
  const meta: Record<string, { source: string; reference: string; at: string; supports: string }> = {
    Payment: {
      source: "Payment processor record",
      reference: c.id,
      at: c.detectedAt,
      supports: "That the payment exists and failed for the stated reason",
    },
    Diagnosis: {
      source: "Diagnosis engine snapshot",
      reference: `dx_${c.id.replace("pay_", "")}`,
      at: c.detectedAt,
      supports: "Why the payment failed and what could change it",
    },
    Policy: {
      source: `Policy kernel · ${c.policy.version}`,
      reference: `${c.policy.checks.filter((x) => x.pass).length}/12 · ${c.policy.decision}`,
      at: c.ledger.at,
      supports: "Whether the recovery action was authorized",
    },
    Execution: {
      source: c.execution.actor === "—" ? "No executor" : `Executor · ${c.execution.actor}`,
      reference: c.execution.at ?? NOT_AVAILABLE,
      at: c.execution.at ?? c.ledger.at,
      supports: "That an action was carried out — not that it succeeded",
    },
    Outcome: {
      source: "Settlement observation",
      reference: c.outcome.state,
      at: c.ledger.at,
      supports: "What was actually observed after execution",
    },
    Ledger: {
      source: "Append-only governance ledger",
      reference: `${c.ledger.entry} · ${c.ledger.hash}`,
      at: c.ledger.at,
      supports: "That the decision and action were recorded immutably",
    },
    Gateway: {
      source: "Payment gateway",
      reference: NOT_AVAILABLE,
      at: NOT_AVAILABLE,
      supports: "Independent confirmation of money movement",
    },
  };

  return c.evidence.map((e) => {
    const m = meta[e.label]!;
    return {
      category: e.label.toUpperCase() as EvidenceCategory,
      status: e.status,
      note: e.note,
      source: m.source,
      reference: m.reference,
      at: m.at,
      supports: m.supports,
      caseId: c.id,
      payment: c.id,
    };
  });
}

export const ALL_EVIDENCE: EvidenceItem[] = JOURNEY_CASES.flatMap(evidenceFor);

export const EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  "PAYMENT",
  "DIAGNOSIS",
  "POLICY",
  "EXECUTION",
  "OUTCOME",
  "LEDGER",
  "GATEWAY",
];

export const EVIDENCE_STATUSES: EvidenceStatus[] = [
  "AVAILABLE",
  "VERIFIED",
  "UNAVAILABLE",
  "UNCLAIMED",
  "NOT REACHED",
];

/* ------------------------------------------------------------------- proof */

export type ProofVerdict = "RECOVERY CONFIRMED" | "RECOVERY NOT AUTHORIZED" | "RECOVERY UNVERIFIED";

export interface ProofRecord {
  proofId: string;
  verdict: ProofVerdict;
  /** True only when every supporting artifact the claim needs is present. */
  complete: boolean;
  missing: { label: string; state: EvidenceStatus }[];
  seal: string;
  sealedAt: string;
}

export function proofFor(c: JourneyCase): ProofRecord {
  const verdict: ProofVerdict =
    c.claim === "MEASURED"
      ? "RECOVERY CONFIRMED"
      : c.policy.decision === "DENY"
        ? "RECOVERY NOT AUTHORIZED"
        : "RECOVERY UNVERIFIED";

  const missing = c.evidence
    .filter((e) => e.status === "UNAVAILABLE" || e.status === "UNCLAIMED")
    .map((e) => ({ label: e.label, state: e.status }));

  const short = c.id.slice(-4);
  return {
    proofId: `VRT-PRF-${short}-${c.ledger.entry.replace(/\D/g, "")}`,
    verdict,
    complete: missing.length === 0,
    missing,
    seal: `sha256:${c.ledger.hash.replace("…", "")}${short}`,
    sealedAt: c.ledger.at,
  };
}

/** Chain steps used by the proof assembly sequence and the passport strip. */
export interface ProofStep {
  key: "payment" | "diagnosis" | "policy" | "execution" | "outcome" | "ledger" | "evidence";
  label: string;
  checkingLabel: string;
  value: string;
  state: "ok" | "absent" | "caution";
}

export function proofSteps(c: JourneyCase): ProofStep[] {
  const ev = (label: string) => c.evidence.find((e) => e.label === label)?.status;
  const st = (s: EvidenceStatus | undefined): ProofStep["state"] =>
    s === "VERIFIED" || s === "AVAILABLE" ? "ok" : s === "UNCLAIMED" ? "caution" : "absent";

  return [
    {
      key: "payment",
      label: "Payment record",
      checkingLabel: "Verifying payment record",
      value: c.id,
      state: st(ev("Payment")),
    },
    {
      key: "diagnosis",
      label: "Diagnosis",
      checkingLabel: "Checking diagnosis",
      value: c.plan.recommended,
      state: st(ev("Diagnosis")),
    },
    {
      key: "policy",
      label: `Policy ${c.policy.decision === "DENY" ? "denied" : "authorized"}`,
      checkingLabel: "Checking policy",
      value: `${c.policy.decision} · ${c.policy.checks.filter((x) => x.pass).length}/12`,
      state: c.policy.decision === "DENY" ? "caution" : st(ev("Policy")),
    },
    {
      key: "execution",
      label: "Execution",
      checkingLabel: "Checking execution",
      value: c.execution.state,
      state: st(ev("Execution")),
    },
    {
      key: "outcome",
      label: "Outcome",
      checkingLabel: "Checking outcome",
      value: c.outcome.state,
      state: st(ev("Outcome")),
    },
    {
      key: "ledger",
      label: "Ledger",
      checkingLabel: "Verifying ledger",
      value: `${c.ledger.entry} · ${c.ledger.verification}`,
      state: st(ev("Ledger")),
    },
    {
      key: "evidence",
      label: "Evidence",
      checkingLabel: "Assembling evidence",
      value: `${c.evidence.filter((e) => e.status === "AVAILABLE" || e.status === "VERIFIED").length} of ${c.evidence.length} artifacts`,
      state: "ok",
    },
  ];
}

export function ledgerEntryForCase(caseId: string): LedgerEntry | undefined {
  return LEDGER_ENTRIES.find((e) => e.caseId === caseId);
}
