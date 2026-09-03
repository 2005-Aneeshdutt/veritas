import { inr } from "@/domain/money";
import type { Money, ClaimState } from "@/domain/types";

/**
 * Control Tower operational queue. Frontend-only demonstration data.
 * Rows backed by a full demo journey carry `journeyCaseId`.
 */

export type PolicyDecision = "AUTO-ALLOW" | "HOLD" | "DENY" | "ESCALATE" | "HUMAN REVIEW";
export type Priority = "P1" | "P2" | "P3";

export interface QueueRow {
  id: string;
  merchant: string;
  amount: Money;
  method: string;
  methodLabel: "Card" | "UPI" | "Netbanking" | "Wallet";
  failureReason: string;
  recommendation: string;
  decision: PolicyDecision;
  checksPassed: number;
  failedRule?: string;
  execution: string;
  claim: ClaimState;
  claimAmount: Money;
  priority: Priority;
  nextAction: string;
  detectedAt: string;
  journeyCaseId?: string;
}

export const CHECKS_TOTAL = 12;

export const QUEUE_ROWS: QueueRow[] = [
  {
    id: "pay_cloudsync_0060",
    merchant: "CloudSync Systems",
    amount: inr(24817),
    method: "Card · HDFC · **** 4417",
    methodLabel: "Card",
    failureReason: "Hard decline — issuer refused (do not honour)",
    recommendation: "Bounded retry",
    decision: "DENY",
    checksPassed: 4,
    failedRule: "Check 05 — ₹24,816 > ₹15,000 ceiling",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P1",
    nextAction: "Customer action required — no autonomous path",
    detectedAt: "2026-09-03T07:02:00.000Z",
    journeyCaseId: "pay_cloudsync_0060",
  },
  {
    id: "pay_cloudsync_1133",
    merchant: "CloudSync Systems",
    amount: inr(9480),
    method: "Card · Axis · **** 8802",
    methodLabel: "Card",
    failureReason: "Stalled mid-authorization — no terminal processor response",
    recommendation: "Status reconciliation",
    decision: "AUTO-ALLOW",
    checksPassed: 12,
    execution: "EXCEPTION",
    claim: "UNVERIFIED",
    claimAmount: inr(0),
    priority: "P1",
    nextAction: "Reconcile processor state before any further action",
    detectedAt: "2026-09-02T18:44:00.000Z",
    journeyCaseId: "pay_cloudsync_1133",
  },
  {
    id: "pay_cloudsync_0502",
    merchant: "CloudSync Systems",
    amount: inr(1707),
    method: "UPI mandate · ICICI",
    methodLabel: "UPI",
    failureReason: "Soft decline — insufficient funds",
    recommendation: "Retry in issuer window",
    decision: "AUTO-ALLOW",
    checksPassed: 12,
    execution: "RECORDED",
    claim: "MEASURED",
    claimAmount: inr(1707),
    priority: "P3",
    nextAction: "Closed — outcome measured, gateway evidence unclaimed",
    detectedAt: "2026-09-03T06:18:00.000Z",
    journeyCaseId: "pay_cloudsync_0502",
  },
  {
    id: "pay_northbridge_2214",
    merchant: "Northbridge Retail",
    amount: inr(48260),
    method: "Card · SBI · **** 1120",
    methodLabel: "Card",
    failureReason: "Issuer risk hold on recurring mandate",
    recommendation: "Payment link to customer",
    decision: "HOLD",
    checksPassed: 9,
    failedRule: "Check 10 — channel not on merchant allow-list",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P1",
    nextAction: "Merchant must extend channel allow-list",
    detectedAt: "2026-09-03T05:40:00.000Z",
  },
  {
    id: "pay_northbridge_2287",
    merchant: "Northbridge Retail",
    amount: inr(3320),
    method: "UPI collect · Yes Bank",
    methodLabel: "UPI",
    failureReason: "Collect request expired",
    recommendation: "Re-issue collect request",
    decision: "AUTO-ALLOW",
    checksPassed: 12,
    execution: "RECORDED",
    claim: "PROJECTED",
    claimAmount: inr(2410),
    priority: "P2",
    nextAction: "Awaiting outcome observation",
    detectedAt: "2026-09-03T04:11:00.000Z",
  },
  {
    id: "pay_lumenworks_0731",
    merchant: "Lumenworks Labs",
    amount: inr(126400),
    method: "Netbanking · Kotak",
    methodLabel: "Netbanking",
    failureReason: "Session abandoned at bank page",
    recommendation: "Escalate to account manager",
    decision: "ESCALATE",
    checksPassed: 7,
    failedRule: "Check 05 — ₹1,26,400 > ₹15,000 ceiling",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P1",
    nextAction: "Named owner must approve out-of-band recovery",
    detectedAt: "2026-09-02T21:05:00.000Z",
  },
  {
    id: "pay_lumenworks_0744",
    merchant: "Lumenworks Labs",
    amount: inr(7890),
    method: "Wallet · Paytm",
    methodLabel: "Wallet",
    failureReason: "Wallet balance insufficient",
    recommendation: "Email top-up prompt",
    decision: "HUMAN REVIEW",
    checksPassed: 11,
    failedRule: "Check 04 — 2 contacts already sent in 24h",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P2",
    nextAction: "Operator decides whether contact fatigue can be overridden",
    detectedAt: "2026-09-02T20:02:00.000Z",
  },
  {
    id: "pay_verdant_0918",
    merchant: "Verdant Foods",
    amount: inr(15400),
    method: "Card · ICICI · **** 5521",
    methodLabel: "Card",
    failureReason: "Expired card on recurring mandate",
    recommendation: "Request instrument update",
    decision: "DENY",
    checksPassed: 3,
    failedRule: "Check 03 — mandate no longer valid",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P2",
    nextAction: "Instrument update required before any retry",
    detectedAt: "2026-09-02T16:37:00.000Z",
  },
  {
    id: "pay_verdant_0955",
    merchant: "Verdant Foods",
    amount: inr(2140),
    method: "UPI mandate · HDFC",
    methodLabel: "UPI",
    failureReason: "Soft decline — insufficient funds",
    recommendation: "Retry in issuer window",
    decision: "HOLD",
    checksPassed: 10,
    failedRule: "Check 07 — inside 60 min issuer cool-down",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P3",
    nextAction: "Retry becomes eligible when cool-down expires",
    detectedAt: "2026-09-03T08:24:00.000Z",
  },
  {
    id: "pay_orbitpay_1402",
    merchant: "OrbitPay Media",
    amount: inr(33800),
    method: "Card · Axis · **** 3390",
    methodLabel: "Card",
    failureReason: "Processor timeout, state unknown",
    recommendation: "Status reconciliation",
    decision: "AUTO-ALLOW",
    checksPassed: 12,
    execution: "EXCEPTION",
    claim: "UNVERIFIED",
    claimAmount: inr(0),
    priority: "P1",
    nextAction: "Reconcile before any financial action",
    detectedAt: "2026-09-02T23:51:00.000Z",
  },
  {
    id: "pay_orbitpay_1455",
    merchant: "OrbitPay Media",
    amount: inr(980),
    method: "Wallet · PhonePe",
    methodLabel: "Wallet",
    failureReason: "Customer cancelled at approval",
    recommendation: "No action — customer intent negative",
    decision: "DENY",
    checksPassed: 2,
    failedRule: "Check 02 — payment not recovery-eligible",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P3",
    nextAction: "Close without recovery attempt",
    detectedAt: "2026-09-02T14:09:00.000Z",
  },
  {
    id: "pay_stellar_0623",
    merchant: "Stellar Logistics",
    amount: inr(6420),
    method: "Netbanking · Axis",
    methodLabel: "Netbanking",
    failureReason: "Bank gateway unavailable",
    recommendation: "Retry after issuer recovery",
    decision: "ESCALATE",
    checksPassed: 8,
    failedRule: "Check 09 — issuer held at operator level",
    execution: "NOT REACHED",
    claim: "ABSTAINED",
    claimAmount: inr(0),
    priority: "P2",
    nextAction: "Issuer hold must be lifted by operations",
    detectedAt: "2026-09-03T03:18:00.000Z",
  },
];

export const CONTROL_TOWER_COUNTS = [
  { value: 2090, label: "Evaluated" },
  { value: 1718, label: "Not eligible for autonomous action" },
  { value: 950, label: "Attention" },
  { value: 768, label: "Blocked externally" },
  { value: 4, label: "Issuers held" },
];

export const DECISIONS: PolicyDecision[] = [
  "AUTO-ALLOW",
  "HOLD",
  "DENY",
  "ESCALATE",
  "HUMAN REVIEW",
];

export const PRIORITIES: Priority[] = ["P1", "P2", "P3"];

export const MERCHANTS = Array.from(new Set(QUEUE_ROWS.map((r) => r.merchant))).sort();
export const METHODS = Array.from(new Set(QUEUE_ROWS.map((r) => r.methodLabel))).sort();
export const CLAIMS = Array.from(new Set(QUEUE_ROWS.map((r) => r.claim))).sort();
export const REASONS = Array.from(new Set(QUEUE_ROWS.map((r) => r.failureReason))).sort();

export function decisionTone(d: PolicyDecision): string {
  switch (d) {
    case "AUTO-ALLOW":
      return "text-measured";
    case "HOLD":
      return "text-projected";
    case "DENY":
      return "text-denied";
    case "ESCALATE":
      return "text-observed";
    default:
      return "text-foreground";
  }
}
