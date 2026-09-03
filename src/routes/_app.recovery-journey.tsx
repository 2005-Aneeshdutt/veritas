import { createFileRoute } from "@tanstack/react-router";
import { Route as RouteIcon } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/recovery-journey")({
  head: () => ({
    meta: [
      { title: "Recovery Journey — VERITAS" },
      { name: "description", content: "Payment to outcome: diagnosis, plan, authorization, execution, ledger, evidence." },
      { property: "og:title", content: "Recovery Journey — VERITAS" },
      { property: "og:description", content: "Payment to outcome: diagnosis, plan, authorization, execution, ledger, evidence." },
    ],
  }),
  component: RecoveryJourneyPage,
});

function RecoveryJourneyPage() {
  return (
    <PlaceholderPage
      title="Recovery Journey"
      description="Payment to outcome: diagnosis, plan, authorization, execution, ledger, evidence."
      phase="Phase 3"
      icon={RouteIcon}
      capabilities={[
        "End-to-end timeline per payment",
        "Policy decision at each step",
        "Gateway confirmation record",
        "Evidence attached inline",
      ]}
    />
  );
}
