/**
 * Wire types for the separate, frozen VERITAS backend.
 *
 * Every field here was read off a live response during the backend audit. If a
 * field is not in this file it is because the backend does not send it -- these
 * are transcriptions, not a wish list, and the frontend must never invent one.
 *
 * Two conventions carried straight through from the backend:
 *
 *   * money is ALWAYS integer paise, and every such field is named `*_paise`.
 *     The domain `Money.minor` is also paise, so the mapping is a copy, never
 *     a multiply. Reach for `paise()` in money.ts, never `inr()`, which takes
 *     rupees and would inflate every figure a hundredfold.
 *
 *   * the backend distinguishes two state machines that share a payment id.
 *     `JourneyResponse` is HISTORY -- what happened inside a committed
 *     diagnosis run. `RecoveryResponse` is the LIVE loop -- what the planner
 *     would do now. They disagree on purpose: pay_cloudsync_0502 is
 *     `executed` with 1707 paise recovered in its journey and `awaiting_outcome`
 *     with 0 in the live loop. Mixing them on one screen would be a lie about
 *     which question was answered.
 */

/* ------------------------------------------------------------------ common */

/** Provenance stamped onto most money-bearing responses. */
export interface ModeStamp {
  mode: string;
  mode_label: string;
}

/* ---------------------------------------------------------------- overview */

/** GET /api/portfolio */
export interface PortfolioResponse {
  merchants: PortfolioMerchant[];
  /** The headline. NOT `total_gap_value_paise`, which is a smaller, different figure. */
  total_at_risk_paise: number;
  total_gap_value_paise: number;
  total_recoverable_central_paise: number;
  total_recoverable_low_paise: number;
  total_recoverable_high_paise: number;
  total_recovered_paise: number;
  /** The only figure on this response that is money that moved. */
  total_measured_paise: number;
  total_attempted: number;
  total_converted: number;
  total_projected_for_attempted_paise: number;
  merchants_scored: number;
  total_held_paise: number;
  total_denied_paise: number;
  acted_on: number;
  awaiting: number;
  refused: number;
  escalated: number;
  total_transactions: number;
  total_failures: number;
  weighted_observed_pct: number;
  weighted_achievable_pct: number;
  by_cause: Record<string, number>;
}

export interface PortfolioMerchant {
  merchant_id: string;
  name: string;
  mcc: string;
  run_id: string;
  transactions: number;
  failures: number;
  observed_pct: number;
  gap_pts: number;
  gap_value_paise: number;
  recoverable_central_paise: number;
  measured_paise: number;
  attempted: number;
  converted: number;
  scored: boolean;
  primary_cause: string;
  band: string;
}

/** GET /api/merchants */
export interface MerchantSummary {
  merchant_id: string;
  name: string;
  mcc: string;
  mcc_description: string;
  transactions: number;
  failures: number;
  at_risk_paise: number;
  avg_ticket_paise: number;
}

/** GET /api/mode */
export interface ModeResponse {
  mode: string;
  label: string;
  blurb: string;
  razorpay_configured: boolean;
  razorpay_reachable: boolean | null;
  webhook_secret_configured: boolean;
  reason: string;
}

/* ----------------------------------------------------------------- journey */

/** One rule of the twelve, exactly as the kernel recorded it. */
export interface JourneyCheck {
  n: number;
  key: string;
  label: string;
  /** The two values the rule actually compared, in words. */
  compared: string;
  status: "pass" | "stopped" | "not_reached";
}

export interface ProposedAction {
  action_type: string;
  txn_id: string;
  amount_paise: number;
  target_bank: string | null;
  scheduled_time: string | null;
  reason: string;
  requires_merchant_approval: boolean;
}

/** The ledger row this payment produced, if it produced one. */
export interface JourneyLedgerEntry {
  sequence?: number;
  timestamp?: string;
  txn_id?: string;
  proposed_action?: ProposedAction;
  gate_decision?: "allow" | "step_up" | "deny";
  gate_reason?: string;
  outcome?: JourneyOutcome;
  actor?: string;
  prev_hash?: string;
}

/**
 * The ledger's five outcomes. `allow` does NOT imply execution: across the
 * committed runs 169 allowed actions ended `exception` and 28 `escalated`.
 */
export type JourneyOutcome =
  "executed" | "merchant_action" | "escalated" | "denied" | "exception" | "";

export interface JourneyBeat {
  key: string;
  at: string | null;
  title: string;
  detail: string;
  tone: string;
  facts?: { k: string; v: string }[];
}

export interface JourneyMandate {
  mandate_id?: string;
  max_amount_paise?: number;
  auto_execute_limit_paise?: number;
  max_attempts_per_payment?: number;
  not_before?: string;
  not_after?: string;
  permitted_actions?: string[];
  signature_verifies?: boolean;
}

/** GET /api/run/{run_id}/journey/{txn_id} -- HISTORY, not the live loop. */
export interface JourneyResponse {
  found: boolean;
  txn_id: string;
  run_id: string;
  merchant_id: string;
  merchant_name: string;
  amount_paise: number;
  bank: string;
  method: string;
  hour: number;
  error_code: string;
  error_class: string;
  code_explanation: string;
  code_next_steps: string;
  fault_owner: string;
  fault_label: string;
  beats: JourneyBeat[];
  final_outcome: JourneyOutcome;
  final_reason: string;
  recovered_paise: number;
  would_have_converted: boolean;
  truth_note: string;
  detail: string;
  /** Empty when the payment never reached the gate. Empty is NOT twelve failures. */
  checks: JourneyCheck[];
  raw_entry: JourneyLedgerEntry;
  hash_preimage: string;
  mandate: JourneyMandate;
}

/** GET /api/run/{run_id}/journeys */
export interface JourneyListResponse {
  run_id: string;
  payments: JourneyListItem[];
}

export interface JourneyListItem {
  txn_id: string;
  amount_paise: number;
  action_type: string;
  outcome: JourneyOutcome;
  gate_reason: string;
}

/* ------------------------------------------------------------------ run */

export interface RunFactor {
  factor: string;
  points: number;
  mae: number | null;
  inside_error_bar: boolean;
  identified: boolean;
  value_paise: number;
}

/** GET /api/run/{run_id} -- only the parts the journey screens read. */
export interface RunResponse {
  run_id: string;
  merchant_id: string;
  merchant_name: string;
  duration_ms: number;
  commit: string;
  traces: RunTrace[];
  report: {
    measured: {
      observed_success_pct: number;
      transactions: number;
      failures: number;
    };
    projected: { cohort_achievable_pct: number; gap_pts: number };
    decomposition: {
      gap_pts: number;
      reliable: boolean;
      underpowered: boolean;
      degenerate_factors: string[];
      factors: RunFactor[];
    };
    diagnosis: { primary_label: string; summary: string };
  };
}

export interface RunTrace {
  run_id: string;
  seq: number;
  node: string;
  kind: string;
  status: string;
  started_at: number;
  duration_ms: number;
  reason_codes?: string[];
  output_summary?: Record<string, unknown>;
}

/* --------------------------------------------------------------- recovery */

/** GET /api/recovery/{merchant_id}/{txn_id} -- the LIVE loop, not history. */
export interface RecoveryResponse extends ModeStamp {
  txn_id: string;
  merchant_id: string;
  merchant_name: string;
  amount_paise: number;
  error_class: string;
  bank: string;
  gate_decision: string;
  gate_reason: string;
  executed: boolean;
  channel: string;
  recovered_paise: number;
  recovery_confirmed_by: string | null;
  outcome_state: string;
  ledger_entry_hash: string | null;
  idempotent_skip: boolean;
  notes: string[];
}

/* ---------------------------------------------------------- control tower */

export interface ControlTowerOutcome {
  state: string;
  executed_action: string | null;
  recovered_paise: number;
  confirmed_by_event: string | null;
  ledger_entry_hash: string | null;
}

export interface ControlTowerDecision {
  decision_id: string;
  merchant_id: string;
  merchant_name: string;
  payment_id: string;
  run_id: string;
  revenue_at_stake_paise: number;
  error_class: string;
  error_code: string;
  bank: string;
  prior_attempts: number;
  recommended_action: string;
  recommended_channel: string;
  recommendation_reason: string;
  expected_recovery_paise: number;
  expected_recovery_basis: string;
  policy_result: string;
  policy_rule: string;
  mandate_scope: string[];
  auto_execute_limit_paise: number;
  max_amount_paise: number;
  root_cause: string;
  diagnosis_summary: string;
  attribution_pts: number;
  attribution_mae: number;
  confidence: number | null;
  uncertainty: string;
  state: string;
  state_reason: string;
  priority: string;
  priority_score: number;
  priority_reasons: string[];
  human_review_required: boolean;
  requires_attention: boolean;
  not_actionable_reason: string | null;
  /** The ONLY actions the UI may offer. The server refuses anything else. */
  permitted_human_actions: string[];
  override_blocked_reason: string | null;
  outcome: ControlTowerOutcome;
  created_at: string;
}

export interface ControlTowerResponse extends ModeStamp {
  decisions: ControlTowerDecision[];
  total: number;
  not_eligible_for_autonomous: number;
  needing_attention: number;
  counts_by_state: Record<string, number>;
  counts_by_filter: Record<string, number>;
  note: string;
}

/* --------------------------------------------------------------------- lab */

export interface LabStrategy {
  key: string;
  name: string;
  blurb: string;
  basis: string;
  eligible: number;
  attempted_payments: number;
  attempts: number;
  held: number;
  denied: number;
  escalated: number;
  abstained: number;
  converted: number;
  recovered_paise: number;
  recovery_rate: number;
  wasted_attempts: number;
  exposed_paise: number;
  unsupervised_paise: number;
  mandate_violations: number;
  cap_violations: number;
  ceiling_violations: number;
  double_charges: number;
  friction_paise: number;
  net_paise: number;
  yield_per_attempt_paise: number;
  held_paise: number;
  denied_paise: number;
  abstained_paise: number;
}

/** GET /api/lab/{merchant_id} */
export interface LabResponse {
  merchant_id: string;
  merchant_name: string;
  batch_failures: number;
  at_risk_paise: number;
  recoverable_failures: number;
  convertible: number;
  convertible_paise: number;
  strategies: LabStrategy[];
  friction_paise_per_attempt: number;
  p_floor: number;
  /** The backend's own label. Counterfactual figures are neither measured nor projected. */
  label: string;
  notes: string[];
}

/* ----------------------------------------------------- evidence and audit */

export interface LineageStep {
  stage: string;
  label: string;
  detail: string;
  source: string;
  ref: string;
  at: string | null;
}

/** GET /api/lineage/{merchant_id}/{txn_id} */
export interface LineageResponse extends ModeStamp {
  txn_id: string;
  merchant_id: string;
  amount_paise: number;
  steps: LineageStep[];
  recovered_paise: number;
  /** Render verbatim. Do not compose your own explanation over it. */
  recovery_basis: string;
}

export interface ReconcileCheck {
  key: string;
  label: string;
  ok: boolean;
  claimed: number | string;
  recomputed: number | string;
  detail: string;
}

export interface ReconcileBucket {
  key: string;
  label: string;
  payments: number;
  paise: number;
  trace: string;
}

/** GET /api/reconcile/{run_id} */
export interface ReconcileResponse {
  run_id: string;
  merchant_id: string;
  merchant_name: string;
  at_risk_paise: number;
  at_risk_payments: number;
  buckets: ReconcileBucket[];
  gate_decisions_now: Record<string, number>;
  gate_decisions_at_diagnosis: Record<string, number>;
  checks: ReconcileCheck[];
  ok: boolean;
  chain_verified: boolean;
}

export interface AuditChain {
  run_id: string;
  merchant_id: string;
  merchant_name: string;
  entries: number;
  verified: boolean;
  detail: string;
  head: string;
}

export interface AuditEntry {
  run_id: string;
  merchant: string;
  sequence: number;
  timestamp: string;
  txn_id: string;
  action_type: string;
  amount_paise: number;
  gate_decision: string;
  gate_reason: string;
  outcome: string;
  actor: string;
  entry_hash: string;
}

/** GET /api/audit */
export interface AuditResponse {
  chains: AuditChain[];
  chains_verified: number;
  chains_total: number;
  entries_total: number;
  by_outcome: Record<string, number>;
  by_reason: Record<string, number>;
  by_actor: Record<string, number>;
  recent: AuditEntry[];
}

/* ------------------------------------------------------------------ prove */

/** GET /api/prove/options */
export interface ProveOptions {
  categories: { mcc: string; label: string }[];
  causes: string[];
  note: string;
}
