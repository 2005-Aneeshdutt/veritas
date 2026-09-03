import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/payments")({
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
  return (
    <PlaceholderPage
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
