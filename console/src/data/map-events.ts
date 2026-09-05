import type { ModeStamp } from "./api-types";

/**
 * Wire types for GET /api/events, transcribed from a live response.
 *
 * The `raw` block is Razorpay's own signed webhook body, stored verbatim. That
 * matters for how it may be read: `raw.payload.payment.entity.captured` is a
 * CLAIM CARRIED INSIDE THE EVENT, not the result of asking the gateway. The
 * backend does ask — `settle_from_events` calls `verify_payment_state` before
 * it counts a rupee — but that answer is not exposed on any endpoint, so the
 * frontend must not present the two as the same thing.
 */
export interface EventRawPaymentEntity {
  id: string;
  status: string;
  captured: boolean;
  amount: number;
  currency: string;
  method?: string;
  bank?: string | null;
  order_id?: string | null;
  acquirer_data?: { bank_transaction_id?: string } | null;
}

export interface VeritasEvent {
  event_id: string;
  source: string;
  event_type: string;
  timestamp: string;
  received_at: string;
  merchant_id: string;
  payment_id: string | null;
  order_id: string | null;
  payment_link_id: string | null;
  amount_paise: number | null;
  currency: string;
  previous_state: string | null;
  new_state: string | null;
  entity: string;
  ingestion_status: string;
  processing_status: string;
  processing_note: string;
  raw?: {
    event?: string;
    account_id?: string;
    payload?: { payment?: { entity?: EventRawPaymentEntity } };
  };
}

export interface EventSummary {
  total: number;
  by_source: Record<string, number>;
  by_type: Record<string, number>;
  by_processing: Record<string, number>;
  /** Store-wide count of redeliveries refused. Not per-event. */
  duplicates_refused: number;
  unknown_types: string[];
  last_received_at: string | null;
  unresolved_payment_refs: number;
}

export interface EventsResponse extends ModeStamp {
  summary: EventSummary;
  events: VeritasEvent[];
  total: number;
}

/** Events that arrived from the real gateway rather than from this system. */
export function gatewayEvents(res: EventsResponse | null): VeritasEvent[] {
  if (!res) return [];
  return res.events
    .filter((e) => e.source === "razorpay_test")
    .slice()
    .reverse();
}

export const paymentEntity = (e: VeritasEvent): EventRawPaymentEntity | undefined =>
  e.raw?.payload?.payment?.entity;
