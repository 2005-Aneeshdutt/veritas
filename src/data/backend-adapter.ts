import { type PaymentRow, type VeritasAdapter } from "./adapter";
import { apiGet } from "./http";
import { mapJourneyToCase } from "./map-journey";
import type {
  AuditResponse,
  ControlTowerResponse,
  JourneyListResponse,
  JourneyResponse,
  LabResponse,
  LineageResponse,
  ModeResponse,
  PortfolioResponse,
  ReconcileResponse,
  RunResponse,
} from "./api-types";
import { paise } from "@/domain/money";
import type { JourneyCase } from "@/domain/journey";
import type { OverviewSnapshot } from "@/domain/types";
import type { EventsResponse } from "./map-events";

/**
 * The real client for the separate, frozen VERITAS backend.
 *
 * Only active when VITE_API_BASE_URL is configured. No backend is bundled here,
 * and no endpoint below is invented: every route was read off a live response
 * during the backend audit.
 *
 * The previous version of this file called `/overview`, which does not exist on
 * that backend at all. Worth recording, because it would have failed in the
 * most expensive way available — quietly, and only once someone finally set the
 * environment variable.
 */

/* --------------------------------------------------------------- run cache */

/**
 * Which run holds a given payment.
 *
 * The backend keys journeys by (run, payment), and there is one committed run
 * per merchant -- so "the canonical run" is not a property of the deployment,
 * it is a property of the payment being asked about. The first version of this
 * file picked one run for the whole app and every payment outside it silently
 * fell back to the walkthrough fixture: the screens looked right, the numbers
 * were wrong, and nothing errored. That is the failure this indirection exists
 * to prevent.
 *
 * The portfolio names each merchant's run, so the map is built once and every
 * lookup is exact. Payment ids in this dataset embed their merchant
 * (`pay_cloudsync_0060`), which resolves the common case without a search;
 * anything unrecognised falls back to searching the runs rather than guessing.
 */
interface Book {
  /** merchant_id -> run_id */
  runs: Map<string, string>;
  order: string[];
}

let bookPromise: Promise<Book> | null = null;

async function loadBook(signal?: AbortSignal): Promise<Book> {
  const pf = await apiGet<PortfolioResponse>("/api/portfolio", { signal });
  const runs = new Map<string, string>();
  for (const m of pf.merchants) if (m.run_id) runs.set(m.merchant_id, m.run_id);
  // Richest first: a merchant with a scored run has real outcomes to show.
  const order = pf.merchants
    .filter((m) => m.run_id)
    .sort((a, b) => Number(b.scored) - Number(a.scored) || b.failures - a.failures)
    .map((m) => m.merchant_id);
  return { runs, order };
}

function book(signal?: AbortSignal): Promise<Book> {
  bookPromise ??= loadBook(signal).catch((e: unknown) => {
    bookPromise = null; // a failed load must not be cached for the session
    throw e;
  });
  return bookPromise;
}

/** The merchant a payment belongs to, by the id the backend itself issued. */
function merchantOf(txnId: string, b: Book): string | null {
  for (const id of b.runs.keys()) if (txnId.includes(id)) return id;
  return null;
}

/* ---------------------------------------------------------------- overview */

function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Gate reasons in the audited window, by count and by money on the same rows. */
function mixFrom(au: AuditResponse) {
  const m = new Map<string, { n: number; executed: number; other: number }>();
  for (const e of au.recent) {
    const cur = m.get(e.gate_reason) ?? { n: 0, executed: 0, other: 0 };
    cur.n += 1;
    if (e.outcome === "executed") cur.executed += e.amount_paise;
    else cur.other += e.amount_paise;
    m.set(e.gate_reason, cur);
  }
  const total = au.recent.length || 1;
  return [...m.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 5)
    .map(([reason, v]) => ({
      id: reason,
      label: reason,
      share: v.n / total,
      measured: paise(v.executed),
      projected: paise(v.other),
    }));
}

function overviewFrom(pf: PortfolioResponse, au: AuditResponse | null): OverviewSnapshot {
  return {
    source: "backend",
    generatedAt: new Date().toISOString(),
    headline: [
      {
        id: "at-risk",
        label: "At risk",
        // total_at_risk_paise, NOT total_gap_value_paise. The latter is a
        // different and much smaller figure that has been mistaken for this one.
        value: paise(pf.total_at_risk_paise),
        claim: "OBSERVED",
        note: `${pf.total_failures} failed payments across ${pf.total_transactions} examined.`,
      },
      {
        id: "recoverable",
        label: "Recoverable",
        value: paise(pf.total_recoverable_central_paise),
        claim: "PROJECTED",
        note: "Central estimate across the book. A forecast, not money.",
      },
      {
        id: "recovered",
        label: "Recovered",
        value: paise(pf.total_measured_paise),
        claim: "MEASURED",
        note:
          `${pf.total_converted} of ${pf.total_attempted} executed retries truly ` +
          "converted, marked afterwards against an outcome the engine never saw.",
      },
      {
        id: "held",
        label: "Held by policy",
        value: paise(pf.total_held_paise),
        claim: "VERIFIED",
        note: "Awaiting merchant confirmation rather than executed unattended.",
      },
    ],
    risk: [
      {
        id: "held",
        label: "Held for confirmation",
        amount: paise(pf.total_held_paise),
        share: share(pf.total_held_paise, pf.total_at_risk_paise),
        claim: "OBSERVED",
      },
      {
        id: "denied",
        label: "Refused by mandate",
        amount: paise(pf.total_denied_paise),
        share: share(pf.total_denied_paise, pf.total_at_risk_paise),
        claim: "ABSTAINED",
      },
      {
        id: "recoverable",
        label: "Modelled recoverable",
        amount: paise(pf.total_recoverable_central_paise),
        share: share(pf.total_recoverable_central_paise, pf.total_at_risk_paise),
        claim: "PROJECTED",
      },
    ],
    funnel: [
      {
        id: "failed",
        label: "Failed",
        count: pf.total_failures,
        amount: paise(pf.total_at_risk_paise),
        claim: "OBSERVED",
      },
      {
        id: "acted",
        label: "Acted on",
        count: pf.acted_on,
        amount: paise(pf.total_recoverable_central_paise),
        claim: "PROJECTED",
      },
      {
        id: "attempted",
        label: "Attempted",
        count: pf.total_attempted,
        amount: paise(pf.total_projected_for_attempted_paise),
        claim: "PROJECTED",
      },
      {
        id: "converted",
        label: "Converted",
        count: pf.total_converted,
        amount: paise(pf.total_measured_paise),
        claim: "MEASURED",
      },
    ],
    // The real mix, by the reason the kernel recorded. Counts and money both
    // come from `recent`, so the share and the amount describe the same rows.
    interventions: au ? mixFrom(au) : [],
    policyOutcomes: [
      { id: "acted", label: "Acted on", count: pf.acted_on, tone: "allowed" },
      { id: "awaiting", label: "Awaiting a person", count: pf.awaiting, tone: "conditional" },
      { id: "refused", label: "Refused by mandate", count: pf.refused, tone: "denied" },
      { id: "escalated", label: "Escalated", count: pf.escalated, tone: "abstained" },
    ],
    recentActions: (au?.recent ?? []).slice(0, 8).map((e) => ({
      id: `${e.run_id}-${e.sequence}`,
      reference: e.txn_id,
      action: e.action_type,
      merchantOrCustomer: e.merchant,
      amount: paise(e.amount_paise),
      claim: e.outcome === "executed" ? ("MEASURED" as const) : ("OBSERVED" as const),
      policy: e.gate_reason,
      occurredAt: e.timestamp,
    })),
    // "Exception" is the ledger's own word for it, not a severity we invent.
    exceptions: (au?.recent ?? [])
      .filter((e) => e.outcome === "exception" || e.outcome === "escalated")
      .slice(0, 6)
      .map((e) => ({
        id: `${e.run_id}-${e.sequence}`,
        reference: e.txn_id,
        reason: e.gate_reason,
        amount: paise(e.amount_paise),
        severity: e.outcome === "escalated" ? ("high" as const) : ("medium" as const),
        waitingSince: e.timestamp,
      })),
    proofHealth: {
      // Percentages, not fractions. 6 of 8 scored is 75%, not 0.75%.
      evidenceCoverage: (pf.merchants_scored / Math.max(pf.merchants.length, 1)) * 100,
      // Measured from the ledger's own chain verification, never asserted.
      ledgerIntegrity: au ? (au.chains_verified / Math.max(au.chains_total, 1)) * 100 : 0,
      openDisputes: pf.refused,
      lastAudit: new Date().toISOString(),
    },
  };
}

/* ---------------------------------------------------------------- adapter */

export const backendAdapter: VeritasAdapter = {
  kind: "backend",

  async getOverview(signal) {
    // The audit is what makes the governance panels real. If it cannot be read
    // they stay empty rather than being filled with something plausible.
    const [pf, au] = await Promise.all([
      apiGet<PortfolioResponse>("/api/portfolio", { signal }),
      apiGet<AuditResponse>("/api/audit", { params: { limit: 60 }, signal }).catch(() => null),
    ]);
    return overviewFrom(pf, au);
  },

  async getCases() {
    // Walkthrough cases are a demo-mode affordance. With a backend connected,
    // the real payments are the cases.
    return [];
  },

  async getCanonicalRunId(signal) {
    const b = await book(signal);
    const first = b.order[0];
    return first ? (b.runs.get(first) ?? null) : null;
  },

  async listPayments(limit = 60, signal): Promise<PaymentRow[]> {
    const b = await book(signal);
    // Every merchant's run, so the inventory is the book rather than whichever
    // merchant happened to sort first.
    const perRun = Math.max(10, Math.ceil(limit / Math.max(b.order.length, 1)));
    const batches = await Promise.all(
      b.order.map(async (merchantId) => {
        const runId = b.runs.get(merchantId)!;
        try {
          const res = await apiGet<JourneyListResponse>(`/api/run/${runId}/journeys`, {
            params: { limit: perRun },
            signal,
          });
          return res.payments.map((p) => ({
            txnId: p.txn_id,
            runId: res.run_id,
            merchantId,
            amountPaise: p.amount_paise,
            actionType: p.action_type,
            outcome: p.outcome,
            gateReason: p.gate_reason,
          }));
        } catch {
          // One merchant's run failing must not empty the whole inventory.
          return [] as PaymentRow[];
        }
      })
    );
    return batches.flat();
  },

  async getJourneyCase(txnId, signal): Promise<JourneyCase | null> {
    const b = await book(signal);
    const owner = merchantOf(txnId, b);
    // Try the owning merchant's run first, then the rest. A payment lives in
    // exactly one run, so this finds it or it genuinely is not there.
    const candidates = owner
      ? [b.runs.get(owner)!, ...b.order.filter((m) => m !== owner).map((m) => b.runs.get(m)!)]
      : b.order.map((m) => b.runs.get(m)!);

    let journey: JourneyResponse | null = null;
    let runId = "";
    for (const candidate of candidates) {
      try {
        const res = await apiGet<JourneyResponse>(
          `/api/run/${candidate}/journey/${encodeURIComponent(txnId)}`,
          { signal }
        );
        if (res.found) {
          journey = res;
          runId = candidate;
          break;
        }
      } catch {
        /* try the next run */
      }
      if (owner) break; // the owner is authoritative; do not scan on its miss
    }
    if (!journey) return null;

    // The run supplies the decomposition the Diagnosis screen reads. It is
    // optional: a journey is complete without it, and a failure fetching it
    // must not cost the caller the whole case.
    let run: RunResponse | null = null;
    try {
      run = await apiGet<RunResponse>(`/api/run/${runId}`, { signal });
    } catch {
      run = null;
    }
    return mapJourneyToCase(journey, 0, run);
  },

  async getLab(merchantId, signal) {
    return apiGet<LabResponse>(`/api/lab/${encodeURIComponent(merchantId)}`, { signal });
  },

  async getLabForPayment(txnId, signal) {
    const b = await book(signal);
    const owner = merchantOf(txnId, b) ?? b.order[0];
    if (!owner) return null;
    return apiGet<LabResponse>(`/api/lab/${encodeURIComponent(owner)}`, { signal });
  },

  async getControlTower(filter, limit, signal) {
    return apiGet<ControlTowerResponse>("/api/control-tower/decisions", {
      params: { filter, limit },
      signal,
    });
  },

  async getLineage(merchantId, txnId, signal) {
    return apiGet<LineageResponse>(
      `/api/lineage/${encodeURIComponent(merchantId)}/${encodeURIComponent(txnId)}`,
      { signal }
    );
  },

  async getReconcile(runId, signal) {
    return apiGet<ReconcileResponse>(`/api/reconcile/${encodeURIComponent(runId)}`, {
      signal,
    });
  },

  async getAudit(limit, signal) {
    return apiGet<AuditResponse>("/api/audit", { params: { limit }, signal });
  },

  async getMode(signal) {
    return apiGet<ModeResponse>("/api/mode", { signal });
  },

  async getEvents(limit, signal) {
    return apiGet<EventsResponse>("/api/events", { params: { limit }, signal });
  },
};
