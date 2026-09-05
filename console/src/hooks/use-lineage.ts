import { useQuery } from "@tanstack/react-query";
import { backendConnected, lineageQueryOptions } from "@/data/services";
import type { LineageResponse } from "@/data/api-types";

/**
 * One payment's lineage: batch row through to audit entry.
 *
 * `recovery_basis` is a sentence the backend wrote about its own number — why
 * this payment's recovery figure is what it is. It is rendered verbatim and
 * never paraphrased. The frontend has no independent way to know why a recovery
 * figure holds, so composing its own explanation over the top would be
 * inventing provenance for a number it merely received.
 *
 * The merchant is derived from the payment id, which embeds it in this dataset
 * (`pay_cloudsync_0060`). Unknown ids return null rather than guessing.
 */
export function useLineage(paymentId: string | undefined): {
  lineage: LineageResponse | null;
  isPending: boolean;
  error: Error | null;
} {
  const connected = backendConnected();
  const merchantId = merchantFromPaymentId(paymentId);
  const query = useQuery({
    ...lineageQueryOptions(merchantId, paymentId),
    enabled: connected && Boolean(merchantId && paymentId),
  });

  return {
    lineage: connected ? (query.data ?? null) : null,
    isPending: connected && query.isPending && Boolean(merchantId),
    error: (query.error as Error | null) ?? null,
  };
}

/** `pay_cloudsync_0060` -> `cloudsync`. Null when the id does not carry one. */
export function merchantFromPaymentId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const m = /^pay_([a-z0-9]+)_/i.exec(id);
  return m?.[1];
}
