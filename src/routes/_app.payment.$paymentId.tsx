import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { findJourneyCase } from "@/data/journey-cases";
import { formatMoney } from "@/domain/money";
import { PageHeader } from "@/components/veritas/page-header";
import { ClaimBadge } from "@/components/veritas/claim-badge";

export const Route = createFileRoute("/_app/payment/$paymentId")({
  head: () => ({
    meta: [
      { title: "Payment detail — VERITAS" },
      { name: "description", content: "Payment record, failure reason and attempt history behind a recovery journey." },
      { property: "og:title", content: "Payment detail — VERITAS" },
      { property: "og:description", content: "Payment record, failure reason and attempt history behind a recovery journey." },
    ],
  }),
  component: PaymentDetailPage,
});

function PaymentDetailPage() {
  const { paymentId } = Route.useParams();
  const c = findJourneyCase(paymentId);

  if (!c) {
    return (
      <div className="space-y-6">
        <PageHeader title="Payment detail" description="No matching payment in the current demo dataset." />
        <p className="font-mono text-sm text-denied">{paymentId}</p>
        <Link
          to="/recovery-journey"
          search={{ case: undefined }}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to Recovery Journey
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const rows = [
    { label: "Payment ID", value: c.id },
    { label: "Merchant", value: c.merchant },
    { label: "Amount", value: formatMoney(c.amount) },
    { label: "Method", value: c.method },
    { label: "Status", value: c.paymentStatus },
    { label: "Failure reason", value: c.failureReason },
    { label: "Detected", value: new Date(c.detectedAt).toLocaleString("en-IN") },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Payment detail"
        description={c.title}
        actions={
          <Link
            to="/recovery-journey"
            search={{ case: c.id }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3 text-[13px] text-foreground transition-colors hover:border-foreground/30"
          >
            Open recovery journey
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      />

      <section aria-label="Payment value" className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <span className="numeral text-4xl font-semibold leading-none text-foreground sm:text-5xl">
          {formatMoney(c.amount)}
        </span>
        <ClaimBadge state={c.claim} size="sm" />
      </section>

      <section aria-label="Payment record">
        <dl className="divide-y divide-hairline border-y border-hairline">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-4 py-2.5">
              <dt className="label-meta text-[10px] tracking-[0.14em]">{r.label}</dt>
              <dd className="min-w-0 break-words text-sm text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Attempt history">
        <p className="label-meta text-[10px] tracking-[0.16em]">Attempt history</p>
        <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
          {c.attempts.map((a) => (
            <li key={a.n} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-4 py-2.5 text-sm">
              <span className="label-meta text-[10px] tabular-nums">
                {String(a.n).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                <span className="text-foreground">{a.result}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground/80">{a.code}</span>
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {new Date(a.at).toLocaleString("en-IN")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground/80">
        Demo payment record. Live payment data arrives through the existing adapter seam once the
        backend is connected.
      </p>
    </div>
  );
}
