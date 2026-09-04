import type { VeritasAdapter } from "./adapter";
import { inr } from "@/domain/money";
import type { OverviewSnapshot } from "@/domain/types";
import { DEMO_CASES } from "./demo-cases";

/** Static, clearly-labelled demo figures. Never presented as live truth. */
const snapshot: OverviewSnapshot = {
  source: "demo",
  generatedAt: "2026-09-03T09:40:00.000Z",
  headline: [
    {
      id: "at-risk",
      label: "At risk",
      value: inr(6425000),
      displayOverride: "₹64.25L",
      claim: "OBSERVED",
      note: "Payment value currently failing, disputed or stalled.",
      deltaPct: 4.2,
    },
    {
      id: "recoverable",
      label: "Recoverable",
      value: inr(556225),
      claim: "PROJECTED",
      note: "Modelled recovery if authorized plans execute. Not yet money.",
      deltaPct: 2.8,
    },
    {
      id: "recovered",
      label: "Recovered",
      value: inr(39833),
      claim: "MEASURED",
      note: "Gateway-confirmed recovery, reconciled to the ledger.",
      deltaPct: 11.4,
    },
    {
      id: "held",
      label: "Held",
      value: inr(1611536),
      claim: "VERIFIED",
      note: "Retained revenue prevented from churning out, evidence attached.",
      deltaPct: -1.1,
    },
  ],
  risk: [
    { id: "hard-decline", label: "Hard declines", amount: inr(2412000), share: 37.5, claim: "OBSERVED" },
    { id: "soft-decline", label: "Soft declines / retriable", amount: inr(1734000), share: 27.0, claim: "OBSERVED" },
    { id: "mandate", label: "Mandate & auth expiry", amount: inr(1146000), share: 17.8, claim: "OBSERVED" },
    { id: "dispute", label: "Disputes & chargebacks", amount: inr(722000), share: 11.2, claim: "UNVERIFIED" },
    { id: "orphan", label: "Unreconciled / orphan", amount: inr(411000), share: 6.5, claim: "UNVERIFIED" },
  ],
  funnel: [
    { id: "detected", label: "Detected", count: 1842, amount: inr(6425000), claim: "OBSERVED" },
    { id: "diagnosed", label: "Diagnosed", count: 1610, amount: inr(5187000), claim: "OBSERVED" },
    { id: "planned", label: "Plan proposed", count: 1204, amount: inr(1892000), claim: "PROJECTED" },
    { id: "authorized", label: "Policy authorized", count: 861, amount: inr(556225), claim: "PROJECTED" },
    { id: "executed", label: "Executed", count: 604, amount: inr(212400), claim: "OBSERVED" },
    { id: "confirmed", label: "Gateway confirmed", count: 187, amount: inr(39833), claim: "MEASURED" },
  ],
  interventions: [
    { id: "retry", label: "Intelligent retry", share: 41, measured: inr(18420), projected: inr(214300) },
    { id: "mandate", label: "Mandate repair", share: 24, measured: inr(9640), projected: inr(131800) },
    { id: "instrument", label: "Instrument switch", share: 18, measured: inr(6913), projected: inr(96125) },
    { id: "outreach", label: "Customer outreach", share: 11, measured: inr(3260), projected: inr(78000) },
    { id: "dispute", label: "Dispute response", share: 6, measured: inr(1600), projected: inr(36000) },
  ],
  policyOutcomes: [
    { id: "allowed", label: "Authorized", count: 861, tone: "allowed" },
    { id: "conditional", label: "Authorized with conditions", count: 214, tone: "conditional" },
    { id: "denied", label: "Denied by policy", count: 96, tone: "denied" },
    { id: "abstained", label: "Abstained", count: 33, tone: "abstained" },
  ],
  recentActions: [
    {
      id: "a1",
      reference: "pay_9F31KD",
      action: "Retry — issuer window",
      merchantOrCustomer: "Northline Foods",
      amount: inr(12400),
      claim: "MEASURED",
      policy: "RETRY_LIMIT_V4",
      occurredAt: "2026-09-03T09:12:00.000Z",
    },
    {
      id: "a2",
      reference: "pay_7B02LM",
      action: "Mandate repair request",
      merchantOrCustomer: "Aster Labs",
      amount: inr(48200),
      claim: "PROJECTED",
      policy: "MANDATE_REPAIR_V2",
      occurredAt: "2026-09-03T08:55:00.000Z",
    },
    {
      id: "a3",
      reference: "pay_5CC81X",
      action: "Instrument switch offered",
      merchantOrCustomer: "Vertex Retail",
      amount: inr(9100),
      claim: "OBSERVED",
      policy: "INSTRUMENT_SWITCH_V1",
      occurredAt: "2026-09-03T08:31:00.000Z",
    },
    {
      id: "a4",
      reference: "pay_2AD44Q",
      action: "Outreach suppressed",
      merchantOrCustomer: "Kavery Health",
      amount: inr(15600),
      claim: "ABSTAINED",
      policy: "CONTACT_FATIGUE_V3",
      occurredAt: "2026-09-03T08:04:00.000Z",
    },
    {
      id: "a5",
      reference: "pay_8EE10R",
      action: "Dispute evidence filed",
      merchantOrCustomer: "Solace Mobility",
      amount: inr(72500),
      claim: "UNVERIFIED",
      policy: "DISPUTE_PACK_V2",
      occurredAt: "2026-09-03T07:48:00.000Z",
    },
  ],
  exceptions: [
    {
      id: "e1",
      reference: "pay_3KK77T",
      reason: "Gateway confirmation missing after execution",
      amount: inr(86400),
      severity: "high",
      waitingSince: "2026-09-02T19:20:00.000Z",
    },
    {
      id: "e2",
      reference: "pay_1QW09B",
      reason: "Ledger entry without supporting evidence",
      amount: inr(31250),
      severity: "high",
      waitingSince: "2026-09-02T22:05:00.000Z",
    },
    {
      id: "e3",
      reference: "pay_6HG55Z",
      reason: "Policy denial appealed by operator",
      amount: inr(19800),
      severity: "medium",
      waitingSince: "2026-09-03T06:40:00.000Z",
    },
    {
      id: "e4",
      reference: "pay_4NM23C",
      reason: "Amount mismatch against gateway settlement",
      amount: inr(7420),
      severity: "low",
      waitingSince: "2026-09-03T07:15:00.000Z",
    },
  ],
  proofHealth: {
    evidenceCoverage: 94.2,
    ledgerIntegrity: 99.8,
    gatewayReconciliation: 97.1,
    openDisputes: 12,
    lastAudit: "2026-09-03T06:00:00.000Z",
  },
};

/**
 * Demo mode answers only what it can answer honestly.
 *
 * The backend-only surfaces return null rather than a plausible-looking
 * fixture, so a screen without a backend says "not connected" instead of
 * showing invented policy checks or an invented ledger hash. A demo that
 * fabricates evidence is the specific failure this product exists to argue
 * against, and it would be an odd place to start.
 */
export const demoAdapter: VeritasAdapter = {
  kind: "demo",
  async getOverview() {
    return snapshot;
  },
  async getCases() {
    return DEMO_CASES;
  },
  async getCanonicalRunId() {
    return null;
  },
  async listPayments() {
    return [];
  },
  async getJourneyCase() {
    return null;
  },
  async getLab() {
    return null;
  },
  async getLabForPayment() {
    return null;
  },
  async getControlTower() {
    return null;
  },
  async getLineage() {
    return null;
  },
  async getReconcile() {
    return null;
  },
  async getAudit() {
    return null;
  },
  async getMode() {
    return null;
  },
  async getEvents() {
    // No gateway in demo mode, so no gateway events. Never a fixture here:
    // a fabricated webhook is the one thing this surface exists to disprove.
    return null;
  },
};
