/**
 * VERITAS live recovery journey model.
 * Pure types + pure helpers. No fetching, no framework code, no backend.
 */

import type { ClaimState, Money } from "./types";

export type StageId =
  | "payment"
  | "investigation"
  | "diagnosis"
  | "plan"
  | "policy"
  | "execution"
  | "outcome"
  | "ledger"
  | "evidence"
  | "prove";

export const STAGE_ORDER: StageId[] = [
  "payment",
  "investigation",
  "diagnosis",
  "plan",
  "policy",
  "execution",
  "outcome",
  "ledger",
  "evidence",
  "prove",
];

export const STAGE_LABEL: Record<StageId, string> = {
  payment: "Payment",
  investigation: "Agent investigates",
  diagnosis: "Diagnosis",
  plan: "Plan",
  policy: "Policy kernel",
  execution: "Execution",
  outcome: "Outcome",
  ledger: "Ledger",
  evidence: "Evidence",
  prove: "Prove",
};

/** Status of a stage as rendered in the timeline. */
export type StageStatus =
  | "current"
  | "completed"
  | "pending"
  | "not-reached"
  | "abstained"
  | "exception"
  | "denied";

/** Live status shown in the journey header. */
export type LiveStatus =
  | "READY"
  | "INVESTIGATING"
  | "DIAGNOSING"
  | "PLANNING"
  | "EVALUATING POLICY"
  | "EXECUTING"
  | "OBSERVING OUTCOME"
  | "RECORDING LEDGER"
  | "ASSEMBLING EVIDENCE"
  | "PROOF READY"
  | "PAUSED"
  | "STOPPED BY POLICY"
  | "OPEN EXCEPTION";

export type EvidenceStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "UNCLAIMED"
  | "VERIFIED"
  | "NOT REACHED";

export interface SignalRow {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "good";
}

export interface PolicyCheck {
  /** 1-based check number. */
  n: number;
  label: string;
  pass: boolean;
  detail?: string;
  /** Value observed for this rule in the demo record. */
  evaluated?: string;
  /** Threshold or expected value the rule compares against. */
  threshold?: string;
}

export interface PlanChannel {
  id: string;
  label: string;
  expected: Money;
  cost: Money;
  net: Money;
  eligible: boolean;
  risk: "low" | "medium" | "high";
  recommended?: boolean;
}

export interface JourneyAttempt {
  n: number;
  at: string;
  result: string;
  code: string;
}

export interface JourneyStepSpec {
  stage: StageId;
  /** Milliseconds this step takes during a live run. */
  ms: number;
  /** Structured event appended to the live event log. */
  event: string;
  eventDetail?: string;
  /** Status this stage settles into once the step completes. */
  settles: Exclude<StageStatus, "current" | "pending">;
  /** Live status while this step is running. */
  status: LiveStatus;
}

export interface JourneyCase {
  id: string;
  index: number;
  kind: "DENIAL" | "SUCCESS" | "UNVERIFIED";
  kindLabel: string;
  title: string;
  merchant: string;
  amount: Money;
  method: string;
  paymentStatus: string;
  failureReason: string;
  detectedAt: string;
  attempts: JourneyAttempt[];

  investigation: SignalRow[];
  diagnosis: {
    gapPts: number;
    observedSuccess: number;
    topFactor: { label: string; effect: string };
    reliability: string;
    uncertainty: string;
    actionability: string;
    note: string;
  };
  plan: {
    recommended: string;
    channels: PlanChannel[];
    note: string;
  };
  policy: {
    version: string;
    checks: PolicyCheck[];
    decision: "DENY" | "ALLOW" | "AUTO-ALLOW";
    firstFailure?: string;
    note: string;
  };
  execution: {
    state: "EXECUTED" | "NOT EXECUTED" | "EXCEPTION" | "ESCALATED" | "NOT REACHED";
    actor: string;
    action: string;
    at?: string;
    note: string;
  };
  outcome: {
    state: "MEASURED" | "OBSERVED" | "UNVERIFIED" | "ABSTAINED" | "NOT REACHED";
    amount: Money;
    note: string;
  };
  ledger: {
    entry: string;
    actor: string;
    action: string;
    at: string;
    prevHash: string;
    hash: string;
    verification: string;
  };
  evidence: { label: string; status: EvidenceStatus; note: string }[];
  gateway: EvidenceStatus;
  claim: ClaimState;
  claimAmount: Money;
  claimLine: string;
  principle?: string;

  /** Ordered live run. Stages absent from this list are never reached. */
  sequence: JourneyStepSpec[];
  /** Status for stages that never enter the sequence. */
  unreachedStatus: Extract<StageStatus, "not-reached">;
  /** Terminal live status after the sequence finishes. */
  finalStatus: LiveStatus;
  /** Completion headline. */
  completion: {
    title: string;
    tone: "measured" | "denied" | "unverified";
    rows: { label: string; value: string }[];
    cta: { label: string; target: "prove" | "policy" | "evidence" };
  };
}

export function stageIndex(stage: StageId): number {
  return STAGE_ORDER.indexOf(stage);
}

/** Stages actually reached during a full run of this case. */
export function reachedCount(c: JourneyCase): number {
  return c.sequence.length;
}
