import { queryOptions } from "@tanstack/react-query";
import { getAdapter } from "./index";
import { apiConfigured } from "./http";

/**
 * One retry, not the default three.
 *
 * The fixture fallback is honest only if the screen says so quickly. With
 * three retries and exponential backoff a dead backend left fixture figures
 * on screen, unlabelled, for about thirty seconds -- long enough to read a
 * number and believe it.
 */
const RETRY = 1;

/**
 * Every screen's data, declared in one place.
 *
 * `backendConnected()` is what pages branch on, and it deliberately checks
 * configuration rather than a successful response: a page needs to say
 * "no backend configured" and "the backend is down" differently, and the query
 * error carries the second.
 */
export function backendConnected(): boolean {
  return apiConfigured() && getAdapter().kind === "backend";
}

export const overviewQueryOptions = queryOptions({
  queryKey: ["overview"],
  queryFn: ({ signal }) => getAdapter().getOverview(signal),
  staleTime: 30_000,
  retry: RETRY,
});

export const casesQueryOptions = queryOptions({
  queryKey: ["demo-cases"],
  queryFn: () => getAdapter().getCases(),
  staleTime: Infinity,
  retry: RETRY,
});

export const canonicalRunQueryOptions = queryOptions({
  queryKey: ["canonical-run"],
  queryFn: ({ signal }) => getAdapter().getCanonicalRunId(signal),
  staleTime: Infinity,
  retry: RETRY,
});

export function paymentsQueryOptions(limit = 60) {
  return queryOptions({
    queryKey: ["payments", limit],
    queryFn: ({ signal }) => getAdapter().listPayments(limit, signal),
    staleTime: 60_000,
    retry: RETRY,
  });
}

/**
 * HISTORY for one payment. This is the Recovery Journey's only source.
 * Never combine it with the live recovery loop on the same screen: the two
 * answer different questions about the same payment id and will disagree.
 */
export function journeyCaseQueryOptions(txnId: string | undefined) {
  return queryOptions({
    queryKey: ["journey-case", txnId],
    queryFn: ({ signal }) =>
      txnId ? getAdapter().getJourneyCase(txnId, signal) : Promise.resolve(null),
    enabled: Boolean(txnId),
    staleTime: 5 * 60_000,
    retry: RETRY,
  });
}

export function labQueryOptions(merchantId: string | undefined) {
  return queryOptions({
    queryKey: ["lab", merchantId],
    queryFn: ({ signal }) =>
      merchantId ? getAdapter().getLab(merchantId, signal) : Promise.resolve(null),
    enabled: Boolean(merchantId),
    staleTime: 5 * 60_000,
    retry: RETRY,
  });
}

export function labForPaymentQueryOptions(txnId: string | undefined) {
  return queryOptions({
    queryKey: ["lab-for-payment", txnId],
    queryFn: ({ signal }) =>
      txnId ? getAdapter().getLabForPayment(txnId, signal) : Promise.resolve(null),
    enabled: Boolean(txnId),
    staleTime: 5 * 60_000,
    retry: RETRY,
  });
}

export function controlTowerQueryOptions(filter = "attention", limit = 40) {
  return queryOptions({
    queryKey: ["control-tower", filter, limit],
    queryFn: ({ signal }) => getAdapter().getControlTower(filter, limit, signal),
    staleTime: 30_000,
    retry: RETRY,
  });
}

export function lineageQueryOptions(
  merchantId: string | undefined,
  txnId: string | undefined
) {
  return queryOptions({
    queryKey: ["lineage", merchantId, txnId],
    queryFn: ({ signal }) =>
      merchantId && txnId
        ? getAdapter().getLineage(merchantId, txnId, signal)
        : Promise.resolve(null),
    enabled: Boolean(merchantId && txnId),
    staleTime: 5 * 60_000,
    retry: RETRY,
  });
}

export function reconcileQueryOptions(runId: string | undefined | null) {
  return queryOptions({
    queryKey: ["reconcile", runId],
    queryFn: ({ signal }) =>
      runId ? getAdapter().getReconcile(runId, signal) : Promise.resolve(null),
    enabled: Boolean(runId),
    staleTime: 5 * 60_000,
    retry: RETRY,
  });
}

export function auditQueryOptions(limit = 60) {
  return queryOptions({
    queryKey: ["audit", limit],
    queryFn: ({ signal }) => getAdapter().getAudit(limit, signal),
    staleTime: 60_000,
    retry: RETRY,
  });
}

export function eventsQueryOptions(limit = 20) {
  return queryOptions({
    queryKey: ["events", limit],
    queryFn: ({ signal }) => getAdapter().getEvents(limit, signal),
    staleTime: 15_000,
    retry: RETRY,
  });
}

export const modeQueryOptions = queryOptions({
  queryKey: ["mode"],
  queryFn: ({ signal }) => getAdapter().getMode(signal),
  staleTime: 5 * 60_000,
  retry: RETRY,
});
