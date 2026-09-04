import type { DemoCase, OverviewSnapshot } from "@/domain/types";
import type { JourneyCase } from "@/domain/journey";
import type {
  AuditResponse,
  ControlTowerResponse,
  LabResponse,
  LineageResponse,
  ModeResponse,
  ReconcileResponse,
} from "./api-types";
import type { EventsResponse } from "./map-events";

/** One row of the payment inventory. Enough to list, filter and open. */
export interface PaymentRow {
  txnId: string;
  runId: string;
  merchantId: string;
  amountPaise: number;
  actionType: string;
  outcome: string;
  gateReason: string;
}

/**
 * The single seam between the VERITAS frontend and any data source.
 * Components never call fetch directly — they go through services in `services.ts`.
 *
 * Methods that can legitimately have no answer return `null` rather than
 * throwing, so a screen can tell "the backend says there is none" apart from
 * "the backend could not be reached". Those need different words on screen,
 * and collapsing them is how an outage comes to look like an empty account.
 */
export interface VeritasAdapter {
  readonly kind: "demo" | "backend";

  getOverview(signal?: AbortSignal): Promise<OverviewSnapshot>;
  /** Curated walkthrough cases. Empty when a real backend is connected. */
  getCases(): Promise<DemoCase[]>;

  /** The run every journey screen hangs off. Null in demo mode. */
  getCanonicalRunId(signal?: AbortSignal): Promise<string | null>;

  /** Payment inventory for the Payments page. */
  listPayments(limit?: number, signal?: AbortSignal): Promise<PaymentRow[]>;

  /**
   * HISTORY: what happened to one payment inside a committed diagnosis run.
   * This is what the Recovery Journey and every stage screen must read. It is
   * NOT the live recovery loop, which answers a different question about the
   * same payment id and will disagree.
   */
  getJourneyCase(txnId: string, signal?: AbortSignal): Promise<JourneyCase | null>;

  getLab(merchantId: string, signal?: AbortSignal): Promise<LabResponse | null>;
  /**
   * The lab for whichever merchant owns this payment. The Lab screen holds a
   * payment id, not a merchant id, and resolving that mapping in the adapter
   * keeps the merchant->run book in the one place that already owns it.
   */
  getLabForPayment(txnId: string, signal?: AbortSignal): Promise<LabResponse | null>;
  getControlTower(
    filter: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<ControlTowerResponse | null>;
  getLineage(
    merchantId: string,
    txnId: string,
    signal?: AbortSignal
  ): Promise<LineageResponse | null>;
  getReconcile(runId: string, signal?: AbortSignal): Promise<ReconcileResponse | null>;
  getAudit(limit: number, signal?: AbortSignal): Promise<AuditResponse | null>;
  getMode(signal?: AbortSignal): Promise<ModeResponse | null>;
  /** The live event feed. Gateway deliveries and this system's own records. */
  getEvents(limit: number, signal?: AbortSignal): Promise<EventsResponse | null>;
}

/**
 * Where the backend lives. Empty means demo mode, which is a supported state
 * rather than a misconfiguration.
 *
 * Both names are accepted because both are in circulation: VITE_API_BASE_URL is
 * what this app shipped with, VITE_API_URL is what the integration brief calls
 * it. Reading one and silently ignoring the other is the kind of mismatch that
 * costs an afternoon, so it reads whichever is set.
 */
export const API_BASE_URL: string =
  import.meta.env["VITE_API_BASE_URL"] ?? import.meta.env["VITE_API_URL"] ?? "";
