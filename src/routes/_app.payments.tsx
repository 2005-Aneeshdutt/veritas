import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";
import { ContextNotice } from "@/components/veritas/context-notice";

export const Route = createFileRoute("/_app/payments")({
  validateSearch: (search: Record<string, unknown>) => ({
    cause: typeof search["cause"] === "string" ? (search["cause"] as string) : undefined,
    ref: typeof search["ref"] === "string" ? (search["ref"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payments — VERITAS" },
      { name: "description", content: "Failing, disputed and stalled payments with exposure and claim state." },
      { property: "og:title", content: "Payments — VERITAS" },
      { property: "og:description", content: "Failing, disputed and stalled payments with exposure and claim state." },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { cause, ref } = Route.useSearch();
  const filters = [
    ...(cause ? [{ label: "Cause", value: cause }] : []),
    ...(ref ? [{ label: "Payment", value: ref }] : []),
  ];
  return (
    <PlaceholderPage
      notice={<ContextNotice filters={filters} />}
      title="Payments"
      description="Failing, disputed and stalled payments with exposure and claim state."
      phase="Phase 2"
      icon={CreditCard}
      capabilities={[
        "Payment inventory and filters",
        "Failure reason grouping",
        "Exposure by merchant and instrument",
        "Drill-through to diagnosis",
      ]}
    />
  );
}
