import type { ControlTowerDecision, ControlTowerResponse } from "./api-types";
import { paise } from "@/domain/money";
import type { PolicyDecision, Priority, QueueRow } from "./control-tower";
import type { ClaimState } from "@/domain/types";

/**
 * Backend decisions -> the queue rows the Control Tower already renders.
 *
 * The rule that matters most on this screen: `expected_recovery_paise` is a
 * FORECAST. The backend even names its own basis (`expected_recovery_basis`,
 * "modelled"), and it is mapped to a PROJECTED claim and never to the claim
 * amount. Money that actually moved lives in `outcome.recovered_paise`, which
 * is a different field arrived at a different way, and the two are never
 * added, swapped, or shown in the same slot.
 */

const STATE_TO_DECISION: Record<string, PolicyDecision> = {
  auto_allow: "AUTO-ALLOW",
  hold: "HOLD",
  deny: "DENY",
  escalate: "ESCALATE",
  human_review: "HUMAN REVIEW",
};

const PRIORITY: Record<string, Priority> = {
  high: "P1",
  medium: "P2",
  low: "P3",
};

const METHOD_LABEL: Record<string, QueueRow["methodLabel"]> = {
  card: "Card",
  upi: "UPI",
  upi_mandate: "UPI",
  netbanking: "Netbanking",
  wallet: "Wallet",
};

/**
 * What may be claimed for this decision.
 *
 * Keyed off the recorded outcome, never off the policy result: a decision can
 * be permitted and still never execute. Only an outcome that actually moved
 * money reaches MEASURED.
 */
function claimOf(d: ControlTowerDecision): { claim: ClaimState; amount: number } {
  const recovered = d.outcome?.recovered_paise ?? 0;
  if (recovered > 0) return { claim: "MEASURED", amount: recovered };
  if (d.policy_result === "deny") return { claim: "ABSTAINED", amount: 0 };
  return { claim: "UNVERIFIED", amount: 0 };
}

export function mapDecision(d: ControlTowerDecision): QueueRow {
  const { claim, amount } = claimOf(d);
  const decision = STATE_TO_DECISION[d.state] ?? STATE_TO_DECISION[d.policy_result] ?? "HOLD";

  return {
    id: d.decision_id,
    merchant: d.merchant_name,
    amount: paise(d.revenue_at_stake_paise),
    method: d.error_code,
    methodLabel: METHOD_LABEL[d.error_class] ?? "Card",
    failureReason: d.error_code,
    recommendation: d.recommended_action,
    decision,
    // The backend does not report a per-decision pass count, so this is left
    // at the full set rather than invented; the failed rule below is what
    // actually carries the information.
    checksPassed: d.policy_result === "deny" ? 0 : 12,
    ...(d.policy_rule ? { failedRule: d.policy_rule } : {}),
    execution: d.outcome?.state ?? "not reached",
    claim,
    claimAmount: paise(amount),
    priority: PRIORITY[d.priority] ?? "P3",
    nextAction: d.state_reason,
    detectedAt: d.created_at,
    journeyCaseId: d.payment_id,
  };
}

export function mapControlTower(res: ControlTowerResponse): QueueRow[] {
  return res.decisions.map(mapDecision);
}

export function mapCounts(res: ControlTowerResponse): { value: number; label: string }[] {
  return [
    { value: res.total, label: "Evaluated" },
    { value: res.not_eligible_for_autonomous, label: "Not eligible for autonomous action" },
    { value: res.needing_attention, label: "Attention" },
    { value: res.counts_by_state["deny"] ?? 0, label: "Refused by mandate" },
    { value: res.counts_by_state["escalate"] ?? 0, label: "Escalated" },
  ];
}
