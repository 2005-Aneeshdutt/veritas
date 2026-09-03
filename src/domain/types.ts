/**
 * VERITAS domain models.
 * Pure types only — no fetching, no framework code.
 */

export type ClaimState =
  | "VERIFIED"
  | "MEASURED"
  | "PROJECTED"
  | "OBSERVED"
  | "UNVERIFIED"
  | "ABSTAINED";

export type CurrencyCode = "INR";

export interface Money {
  /** Amount in minor units (paise for INR). */
  minor: number;
  currency: CurrencyCode;
}

export interface HeadlineMetric {
  id: string;
  label: string;
  value: Money;
  claim: ClaimState;
  /** Short explanation of what this number counts. */
  note: string;
  deltaPct?: number;
  /** Pre-formatted compact display (e.g. "₹64.25L") when the source reports it that way. */
  displayOverride?: string;
}

export interface RiskSegment {
  id: string;
  label: string;
  amount: Money;
  share: number;
  claim: ClaimState;
}

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  amount: Money;
  claim: ClaimState;
}

export interface InterventionSlice {
  id: string;
  label: string;
  share: number;
  measured: Money;
  projected: Money;
}

export interface PolicyOutcome {
  id: string;
  label: string;
  count: number;
  tone: "allowed" | "conditional" | "denied" | "abstained";
}

export interface GovernedAction {
  id: string;
  reference: string;
  action: string;
  merchantOrCustomer: string;
  amount: Money;
  claim: ClaimState;
  policy: string;
  occurredAt: string;
}

export interface ExceptionItem {
  id: string;
  reference: string;
  reason: string;
  amount: Money;
  severity: "high" | "medium" | "low";
  waitingSince: string;
}

export interface ProofHealth {
  evidenceCoverage: number;
  ledgerIntegrity: number;
  gatewayReconciliation: number;
  openDisputes: number;
  lastAudit: string;
}

export interface OverviewSnapshot {
  source: "demo" | "backend";
  generatedAt: string;
  headline: HeadlineMetric[];
  risk: RiskSegment[];
  funnel: FunnelStage[];
  interventions: InterventionSlice[];
  policyOutcomes: PolicyOutcome[];
  recentActions: GovernedAction[];
  exceptions: ExceptionItem[];
  proofHealth: ProofHealth;
}
