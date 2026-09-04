import { useQuery } from "@tanstack/react-query";
import { CONTROL_TOWER_COUNTS, QUEUE_ROWS, type QueueRow } from "@/data/control-tower";
import { mapControlTower, mapCounts } from "@/data/map-control-tower";
import { backendConnected, controlTowerQueryOptions } from "@/data/services";

/**
 * The attention queue, from the backend when there is one.
 *
 * Asks for the `all` filter and lets the page's existing filters do the rest,
 * so the counts and the rows describe the same population. Requesting an
 * already-filtered slice and then filtering it again is how a queue comes to
 * disagree with its own header.
 */
export function useQueue(limit = 200): {
  rows: QueueRow[];
  counts: { value: number; label: string }[];
  isFixture: boolean;
  isPending: boolean;
  error: Error | null;
} {
  const connected = backendConnected();
  const query = useQuery({
    ...controlTowerQueryOptions("all", limit),
    enabled: connected,
  });

  if (connected && query.data) {
    return {
      rows: mapControlTower(query.data),
      counts: mapCounts(query.data),
      isFixture: false,
      isPending: false,
      error: null,
    };
  }
  return {
    rows: QUEUE_ROWS,
    counts: CONTROL_TOWER_COUNTS,
    isFixture: true,
    isPending: connected && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
