export type NodeStatus = "running" | "ok" | "skipped" | "error";
export type NodeKind = "llm" | "deterministic";

export interface NodeTrace {
  run_id: string;
  seq: number;
  node: string;
  kind: NodeKind;
  status: NodeStatus;
  started_at: number;
  duration_ms: number;
  input_summary: Record<string, any>;
  output_summary: Record<string, any>;
  branch_taken: string | null;
  model?: string | null;
  prompt?: string | null;
  raw_response?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cache_hit?: boolean | null;
  stub?: boolean | null;
  confidence?: number | null;
  reason_codes: string[];
  intermediates: Record<string, any>;
}

export interface FactorRow {
  factor: string;
  points: number;
  mae: number | null;
  inside_error_bar: boolean;
  identified: boolean;
  value_paise: number;
}

export interface RunRecord {
  run_id: string;
  merchant_id: string;
  merchant_name: string;
  mcc: string;
  seed: number;
  duration_ms: number;
  commit: string;
  models: Record<string, any>;
  cache_hit_rate: number;
  llm_calls: number;
  llm_cost_inr: number;
  used_stubs: boolean;
  traces: NodeTrace[];
  report: any;
  /** Fixes proposed but not yet run. The merchant approves these one at a time. */
  pending_actions?: FixGroup[];
  applied?: any[];
}

export interface FixGroup {
  group_id: string;
  action_type: string;
  title: string;
  why: string;
  count: number;
  total_paise: number;
  auto: boolean;
}

export interface Merchant {
  merchant_id: string;
  name: string;
  mcc: string;
  mcc_description: string;
  transactions: number;
  failures: number;
  at_risk_paise: number;
  avg_ticket_paise: number;
  observed_success_pct: number;
}

/** Integer paise in, human rupees out. Never format money by hand. */
export function inr(paise: number, opts: { compact?: boolean } = {}): string {
  const rupees = (paise ?? 0) / 100;
  if (opts.compact) {
    if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)}Cr`;
    if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(2)}L`;
    if (Math.abs(rupees) >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}k`;
  }
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function pts(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

export const FACTOR_LABELS: Record<string, string> = {
  bank: "Bank concentration",
  method: "Payment method mix",
  hour: "Billing window",
  amount_band: "Ticket size",
  residual: "Unexplained residual",
  process_gap: "No soft-decline retry",
};

export const NODE_KIND: Record<string, NodeKind> = {
  ingest: "deterministic",
  classify: "llm",
  human_review: "deterministic",
  bank_health: "deterministic",
  decompose: "deterministic",
  hypothesise: "llm",
  plan: "llm",
  gate: "deterministic",
  execute: "deterministic",
  report: "deterministic",
};
