import { useQuery } from "@tanstack/react-query";
import { STRATEGIES, type Strategy } from "@/data/investigate";
import { mapLab } from "@/data/map-lab";
import { backendConnected, labForPaymentQueryOptions } from "@/data/services";

/**
 * The counterfactual comparison, from the backend when there is one.
 *
 * `sourceLabel` is the backend's own words — it labels this data
 * "SYNTHETIC EVALUATION" and that label is passed through rather than
 * paraphrased. These figures are COUNTERFACTUAL: what a different policy would
 * have done to the same batch. Not measured, not projected, not observed, and
 * relabelling them as any of those would be the exact error the page exists to
 * argue against.
 */
export function useStrategies(paymentId: string | undefined): {
  strategies: Strategy[];
  sourceLabel: string;
  isFixture: boolean;
  isPending: boolean;
} {
  const connected = backendConnected();
  const query = useQuery({
    ...labForPaymentQueryOptions(paymentId),
    enabled: connected && Boolean(paymentId),
  });

  if (connected && query.data) {
    return {
      strategies: mapLab(query.data),
      sourceLabel: query.data.label,
      isFixture: false,
      isPending: false,
    };
  }
  return {
    strategies: STRATEGIES,
    sourceLabel: "DEMO FIXTURE",
    isFixture: true,
    isPending: connected && query.isPending,
  };
}
