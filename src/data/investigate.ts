import { inr } from "@/domain/money";
import type { Money } from "@/domain/types";
import { JOURNEY_CASES } from "./journey-cases";

/**
 * INVESTIGATE layer demo data — diagnosis factor attribution and strategy
 * counterfactuals. Frontend-only, derived from the same curated journey cases
 * used everywhere else. The real backend replaces this through the adapter seam.
 */

export interface DiagnosisFactor {
  id: string;
  label: string;
  /** Estimated contribution in percentage points, or null when unavailable. */
  effect: number | null;
  /** ± uncertainty in percentage points, or null when unavailable. */
  uncertainty: number | null;
  note: string;
}

export interface DiagnosisMethodology {
  method: string;
  coalitions: number;
  factors: number;
  comparison: string;
}

export const DIAGNOSIS_METHODOLOGY: DiagnosisMethodology = {
  method: "Shapley–Oaxaca–Blinder",
  coalitions: 16,
  factors: 4,
  comparison: "Observed success comparison against the matched comparable set",
};

const FACTORS: Record<string, DiagnosisFactor[]> = {
  pay_cloudsync_0502: [
    { id: "hour", label: "Hour", effect: 3.79, uncertainty: 0.57, note: "Retry timing relative to the favourable issuer window." },
    { id: "method", label: "Method", effect: 1.42, uncertainty: 0.31, note: "UPI mandate is retry-eligible without customer action." },
    { id: "bank", label: "Bank", effect: 0.98, uncertainty: 0.44, note: "ICICI balance-related refusals resolve at a higher rate." },
    { id: "amount", label: "Amount band", effect: 0.4, uncertainty: 0.22, note: "₹1,000 – ₹2,500 low band, minimal balance pressure." },
  ],
  pay_cloudsync_0060: [
    { id: "bank", label: "Bank", effect: -3.1, uncertainty: 0.86, note: "HDFC terminal refusal code, issuer-side policy." },
    { id: "amount", label: "Amount band", effect: -2.05, uncertainty: 0.61, note: "₹20,000 – ₹25,000 high band above the authorization ceiling." },
    { id: "method", label: "Method", effect: -1.44, uncertainty: 0.39, note: "Card recurring, not eligible for silent retry." },
    { id: "hour", label: "Hour", effect: 0.35, uncertainty: 0.28, note: "Timing offers little leverage against a hard decline." },
  ],
  pay_cloudsync_1133: [
    { id: "bank", label: "Bank", effect: null, uncertainty: null, note: "No terminal processor response — attribution cannot be estimated." },
    { id: "method", label: "Method", effect: null, uncertainty: null, note: "No terminal outcome to attribute." },
    { id: "hour", label: "Hour", effect: null, uncertainty: null, note: "No terminal outcome to attribute." },
    { id: "amount", label: "Amount band", effect: null, uncertainty: null, note: "No terminal outcome to attribute." },
  ],
};

export function diagnosisFactors(caseId: string): DiagnosisFactor[] {
  return FACTORS[caseId] ?? [];
}

export function formatEffect(f: DiagnosisFactor): string {
  if (f.effect === null) return "NOT AVAILABLE";
  const sign = f.effect > 0 ? "+" : "";
  const unc = f.uncertainty === null ? "" : ` ± ${f.uncertainty.toFixed(2)}`;
  return `${sign}${f.effect.toFixed(2)}${unc} pts`;
}

/** Actionability derives from the case's own diagnosis text — never invented. */
export function actionabilityLabel(actionability: string): "RELIABLE" | "LIMITED" | "INDETERMINATE" {
  if (actionability.startsWith("High")) return "RELIABLE";
  if (actionability.startsWith("Medium")) return "LIMITED";
  return "INDETERMINATE";
}

/* ------------------------------------------------------------------ */
/* Counterfactual Lab                                                  */
/* ------------------------------------------------------------------ */

export interface BreachCategory {
  label: string;
  count: number;
}

export interface Strategy {
  id: string;
  label: string;
  /** PROJECTED recovery across the demo cohort. Never recovered money. */
  recovery: Money;
  cost: Money;
  net: Money;
  breaches: number;
  /** Undefined when the demo data does not break the total down by category. */
  breachBreakdown?: BreachCategory[];
  governance: "WITHIN AUTHORITY" | "BREACHES AUTHORITY" | "NO ACTION";
  difference: string;
}

export const STRATEGIES: Strategy[] = [
  {
    id: "none",
    label: "No intervention",
    recovery: inr(0),
    cost: inr(0),
    net: inr(0),
    breaches: 0,
    governance: "NO ACTION",
    difference: "Baseline. Nothing is attempted, so nothing is recovered and no rule can be violated.",
  },
  {
    id: "naive",
    label: "Naive retry",
    recovery: inr(211258),
    cost: inr(96430),
    net: inr(114828),
    breaches: 247,
    breachBreakdown: [
      { label: "Retry cap breaches", count: 198 },
      { label: "Authorization ceiling breaches", count: 49 },
    ],
    governance: "BREACHES AUTHORITY",
    difference:
      "Retries every failed payment regardless of ceiling, cool-down or contact fatigue. High raw recovery obtained outside the authority boundary.",
  },
  {
    id: "static",
    label: "Static rules",
    recovery: inr(211258),
    cost: inr(71204),
    net: inr(140054),
    breaches: 142,
    governance: "BREACHES AUTHORITY",
    difference:
      "Fixed heuristics reduce wasted attempts but still act outside policy on high-band and cool-down cases.",
  },
  {
    id: "doctor",
    label: "Revenue Doctor",
    recovery: inr(16026),
    cost: inr(1180),
    net: inr(14846),
    breaches: 0,
    governance: "WITHIN AUTHORITY",
    difference:
      "Acts only where the Policy Kernel authorizes. Lower raw recovery, every rupee inside the authority boundary.",
  },
  {
    id: "doctor-merchant",
    label: "Revenue Doctor + merchant",
    recovery: inr(78781),
    cost: inr(6902),
    net: inr(71879),
    breaches: 0,
    governance: "WITHIN AUTHORITY",
    difference:
      "Adds merchant-approved channels within the same policy envelope. Higher controlled recovery with no breach.",
  },
];

export const OPTIMIZATION_STATEMENT =
  "More recovery is not better recovery if the strategy violates the authority boundary.";

export interface ComparisonStep {
  label: string;
  /** Strategy marked EVALUATED once this step completes, when the step is a strategy pass. */
  strategyId?: string;
}

export const COMPARISON_STEPS: ComparisonStep[] = [
  { label: "Loading baseline", strategyId: "none" },
  { label: "Evaluating naive retry", strategyId: "naive" },
  { label: "Evaluating static rules", strategyId: "static" },
  { label: "Evaluating Revenue Doctor", strategyId: "doctor" },
  { label: "Evaluating Revenue Doctor + merchant", strategyId: "doctor-merchant" },
  { label: "Checking policy breaches" },
  { label: "Comparison ready" },
];

export const COUNTERFACTUAL_DISCLAIMER =
  "Counterfactual values model what could have happened under each strategy; they are not measured recovery.";

/** Highest modelled recovery, ignoring governance. */
export function highestRawRecovery(): Strategy {
  return STRATEGIES.reduce((a, b) => (b.recovery.minor > a.recovery.minor ? b : a));
}

/** Highest recovery among strategies with zero policy breaches. */
export function bestGovernedRecovery(): Strategy {
  const governed = STRATEGIES.filter((s) => s.breaches === 0 && s.recovery.minor > 0);
  return governed.reduce((a, b) => (b.recovery.minor > a.recovery.minor ? b : a));
}

/** Fewest breaches; ties resolve toward the higher modelled recovery. */
export function lowestBreaches(): Strategy {
  return STRATEGIES.reduce((a, b) => {
    if (b.breaches !== a.breaches) return b.breaches < a.breaches ? b : a;
    return b.recovery.minor > a.recovery.minor ? b : a;
  });
}

export function findStrategy(id: string | undefined): Strategy {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[3]!;
}

export const INVESTIGATE_CASES = JOURNEY_CASES;
