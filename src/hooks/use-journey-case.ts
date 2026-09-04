import { useQuery } from "@tanstack/react-query";
import { JOURNEY_CASES, findJourneyCase } from "@/data/journey-cases";
import { backendConnected, journeyCaseQueryOptions } from "@/data/services";
import type { JourneyCase } from "@/domain/journey";

/**
 * One payment's history, from the backend when there is one.
 *
 * Every stage screen already renders a `JourneyCase`, so this is the whole
 * integration seam for them: swap `findJourneyCase(id) ?? JOURNEY_CASES[n]!`
 * for `useJourneyCase(id, n)` and the rendering below it is untouched.
 *
 * Two things it deliberately does NOT do:
 *
 *   * it never merges backend and fixture data into one case. A case is either
 *     what the backend recorded or it is the labelled walkthrough — a half-real
 *     record with fixture policy checks stapled on would be the most misleading
 *     artifact this app could produce.
 *
 *   * it reads only `/api/run/{run}/journey/{txn}`, which is HISTORY. The live
 *     recovery loop answers a different question about the same payment id and
 *     disagrees on purpose; mixing them here would put both on one screen.
 *
 * The fixture remains the fallback so the app still demonstrates without a
 * backend, and `isFixture` lets a screen say which it is showing rather than
 * leaving a reader to assume.
 */
export function useJourneyCase(
  caseId: string | undefined,
  fallbackIndex = 0,
): {
  case_: JourneyCase;
  isFixture: boolean;
  isPending: boolean;
  error: Error | null;
} {
  const connected = backendConnected();
  const query = useQuery({
    ...journeyCaseQueryOptions(caseId),
    enabled: connected && Boolean(caseId),
  });

  const fixture = findJourneyCase(caseId) ?? JOURNEY_CASES[fallbackIndex] ?? JOURNEY_CASES[0]!;

  if (connected && query.data) {
    return { case_: query.data, isFixture: false, isPending: false, error: null };
  }
  return {
    case_: fixture,
    isFixture: true,
    isPending: connected && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
