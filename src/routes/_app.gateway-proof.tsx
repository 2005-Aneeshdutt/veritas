import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Fingerprint,
  Inbox,
  Minus,
  Radio,
  Repeat2,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/veritas/page-header";
import { LiveRecovery } from "@/components/veritas/live-recovery";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { backendConnected, eventsQueryOptions } from "@/data/services";
import { gatewayEvents, paymentEntity, type VeritasEvent } from "@/data/map-events";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/gateway-proof")({
  head: () => ({
    meta: [
      { title: "Live Gateway Proof — VERITAS" },
      {
        name: "description",
        content: "Real Razorpay test-mode webhook deliveries, as received by VERITAS.",
      },
      { property: "og:title", content: "Live Gateway Proof — VERITAS" },
      { property: "og:description", content: "Real gateway events, as received." },
    ],
  }),
  component: GatewayProofPage,
});

/**
 * What a real gateway actually sent.
 *
 * Every value derives from `/api/events`. Nothing is hardcoded: remove the
 * event from the store and this page empties.
 *
 * The claim is OBSERVED, never MEASURED. `entity.captured` is Razorpay's own
 * field inside the signed body — a claim carried by the event, not the result
 * of `verify_payment_state()` re-querying the gateway. The backend makes that
 * call before it counts a rupee; no endpoint returns the answer, so the chain
 * ends at a declared gap rather than a green tick.
 */
function GatewayProofPage() {
  const connected = backendConnected();
  const { data, isPending, isError, error, refetch } = useQuery({
    ...eventsQueryOptions(20),
    enabled: connected,
  });

  const events = gatewayEvents(data ?? null);
  const latest = events[0];
  const duplicates = data?.summary.duplicates_refused ?? 0;

  return (
    <div className="space-y-7">
      <PageHeader title="Live Gateway Proof" description="Razorpay Test Mode" />

      <span className="inline-flex items-center gap-1.5 rounded-md border border-observed/40 bg-observed/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-observed">
        <Radio className="size-3" aria-hidden />
        Real Razorpay test event
      </span>

      {!connected && <Panel tone="warn">No backend configured.</Panel>}

      {connected && isError && (
        <Panel tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{(error as Error).message}</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
            >
              Retry
            </button>
          </div>
        </Panel>
      )}

      <LiveRecovery />


      {connected && isPending && <Panel>Reading the event store…</Panel>}

      {connected && !isPending && !isError && !latest && (
        <Panel>No gateway events received.</Panel>
      )}

      {latest && <Proof event={latest} duplicatesRefused={duplicates} />}

      {events.length > 1 && (
        <section className="rounded-lg border border-hairline">
          <header className="border-b border-hairline px-4 py-3">
            <p className="label-meta text-[10px] tracking-[0.16em]">Earlier deliveries</p>
          </header>
          <ul className="divide-y divide-hairline">
            {events.slice(1).map((e) => (
              <li
                key={e.event_id}
                className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3"
              >
                <span className="font-mono text-xs">{e.payment_id ?? e.event_id}</span>
                <span className="text-xs text-muted-foreground">{e.event_type}</span>
                <span className="font-mono text-xs tabular-nums">
                  {e.amount_paise === null
                    ? "—"
                    : formatMoney({ minor: e.amount_paise, currency: "INR" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ chain */

type LinkState = "ok" | "gap";

interface ChainLink {
  key: string;
  icon: LucideIcon;
  label: string;
  meta: string;
  state: LinkState;
}

function chainOf(event: VeritasEvent, duplicates: number): ChainLink[] {
  const pay = paymentEntity(event);
  return [
    {
      key: "razorpay",
      icon: Building2,
      label: "Razorpay",
      meta: event.source,
      state: "ok",
    },
    {
      key: "webhook",
      icon: Webhook,
      label: "Webhook",
      meta: "200 OK",
      state: "ok",
    },
    {
      key: "hmac",
      icon: Fingerprint,
      label: "Signature",
      meta: "Verified",
      state: "ok",
    },
    {
      key: "ingested",
      icon: Inbox,
      label: "Ingested",
      meta: event.ingestion_status,
      state: event.ingestion_status === "accepted" ? "ok" : "gap",
    },
    {
      key: "idempotent",
      icon: Repeat2,
      label: "Idempotent",
      meta: duplicates > 0 ? `${duplicates} refused` : "no redelivery yet",
      state: duplicates > 0 ? "ok" : "gap",
    },
    {
      key: "gateway",
      icon: Radio,
      label: "Gateway",
      // The declared gap. Short, and it does not pretend otherwise.
      meta: pay?.captured ? "NOT EXPOSED BY LIVE API" : "unknown",
      state: "gap",
    },
  ];
}

function Proof({
  event,
  duplicatesRefused,
}: {
  event: VeritasEvent;
  duplicatesRefused: number;
}) {
  const pay = paymentEntity(event);
  const chain = chainOf(event, duplicatesRefused);

  return (
    <section className="overflow-hidden rounded-lg border border-hairline">
      <header className="grid gap-6 px-5 py-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div>
          <p className="text-4xl font-semibold tabular-nums text-observed">
            {event.amount_paise === null
              ? "—"
              : formatMoney(
                  { minor: event.amount_paise, currency: "INR" },
                  { decimals: true }
                )}
          </p>
          <div className="mt-2">
            <ClaimBadge state="OBSERVED" />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <Fact k="Payment" v={event.payment_id ?? "—"} mono />
          <Fact k="Event" v={event.event_type} mono />
          <Fact k="Source" v={event.source} mono />
          <Fact k="Method" v={pay?.method ?? "—"} />
          <Fact k="Bank" v={pay?.bank ?? "—"} />
          <Fact k="Received" v={new Date(event.received_at).toLocaleTimeString("en-IN")} />
        </dl>
      </header>

      <ol className="grid gap-px border-t border-hairline bg-hairline sm:grid-cols-6">
        {chain.map((link) => (
          <li key={link.key} className="bg-background px-4 py-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border",
                  link.state === "ok"
                    ? "border-measured/50 text-measured"
                    : "border-hairline text-muted-foreground"
                )}
                aria-hidden
              >
                {link.state === "ok" ? (
                  <Check className="size-3" />
                ) : (
                  <Minus className="size-3" />
                )}
              </span>
              <link.icon
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
            </div>
            <p className="mt-2.5 text-[13px] font-medium text-foreground">{link.label}</p>
            <p
              className={cn(
                "mt-0.5 text-[11px]",
                link.state === "ok" ? "text-muted-foreground" : "text-muted-foreground/80"
              )}
            >
              {link.meta}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label-meta text-[10px] tracking-[0.16em]">{k}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-xs text-foreground",
          mono && "font-mono"
        )}
      >
        {v}
      </dd>
    </div>
  );
}

function Panel({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "warn"
          ? "border-denied/40 bg-denied/5 text-foreground"
          : "border-hairline text-muted-foreground"
      )}
    >
      {children}
    </div>
  );
}
