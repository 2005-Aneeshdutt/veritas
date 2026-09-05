import type { LabResponse, LabStrategy } from "./api-types";
import { paise } from "@/domain/money";
import type { Strategy } from "./investigate";

/**
 * Backend counterfactual strategies -> the `Strategy` rows the Lab already renders.
 *
 * Every figure on this screen is COUNTERFACTUAL: what a different policy would
 * have done to the same batch, marked against a truth the engine could not see.
 * That is a fourth thing, distinct from measured, projected and observed, and
 * the backend says so itself with `label: "SYNTHETIC EVALUATION"`. Nothing here
 * may be relabelled into one of the other three — a counterfactual recovery is
 * not a forecast of anything, and it is certainly not money.
 *
 * The one number that carries the argument is `mandate_violations`, which is
 * why it is mapped straight across and broken down rather than summarised: the
 * point of the page is that the strategy recovering the most money is also the
 * one breaking the most rules.
 */
export function mapLabStrategy(s: LabStrategy): Strategy {
  const breaches = s.mandate_violations;
  const breakdown = [
    { label: "Retry cap breaches", count: s.cap_violations },
    { label: "Authorization ceiling breaches", count: s.ceiling_violations },
  ].filter((b) => b.count > 0);

  return {
    id: s.key,
    label: s.name,
    recovery: paise(s.recovered_paise),
    cost: paise(s.friction_paise),
    net: paise(s.net_paise),
    breaches,
    ...(breakdown.length ? { breachBreakdown: breakdown } : {}),
    governance:
      s.attempts === 0 ? "NO ACTION" : breaches > 0 ? "BREACHES AUTHORITY" : "WITHIN AUTHORITY",
    difference: s.blurb,
  };
}

export function mapLab(lab: LabResponse): Strategy[] {
  return lab.strategies.map(mapLabStrategy);
}
