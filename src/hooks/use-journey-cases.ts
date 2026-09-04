import { useQueries } from "@tanstack/react-query";
import { JOURNEY_CASES } from "@/data/journey-cases";
import { backendConnected, journeyCaseQueryOptions } from "@/data/services";
import type { JourneyCase } from "@/domain/journey";

/**
 * The three walkthrough cases, resolved against the backend when connected.
 *
 * The case switcher used to read the fixture array directly, which put a
 * fixture amount next to a live one on the same screen: it showed ₹0 for
 * pay_cloudsync_1133 while the journey page beside it showed the backend's
 * ₹2,724. Two numbers for one payment, both presented as fact.
 *
 * The ids come from the fixture because that is what defines the walkthrough;
 * the VALUES come from the backend. Any case the backend does not have keeps
 * its fixture, which is correct — it is then genuinely a demo case.
 */
export function useJourneyCases(): JourneyCase[] {
  const connected = backendConnected();
  const results = useQueries({
    queries: JOURNEY_CASES.map((c) => ({
      ...journeyCaseQueryOptions(c.id),
      enabled: connected,
    })),
  });

  if (!connected) return JOURNEY_CASES;
  return JOURNEY_CASES.map((fixture, i) => {
    const live = results[i]?.data;
    return live ?? fixture;
  });
}
