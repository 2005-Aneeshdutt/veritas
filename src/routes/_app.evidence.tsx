import { createFileRoute } from "@tanstack/react-router";
import { FileCheck2 } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/evidence")({
  head: () => ({
    meta: [
      { title: "Evidence — VERITAS" },
      { name: "description", content: "Artifacts supporting every recovery claim, indexed and verifiable." },
      { property: "og:title", content: "Evidence — VERITAS" },
      { property: "og:description", content: "Artifacts supporting every recovery claim, indexed and verifiable." },
    ],
  }),
  component: EvidencePage,
});

function EvidencePage() {
  return (
    <PlaceholderPage
      title="Evidence"
      description="Artifacts supporting every recovery claim, indexed and verifiable."
      phase="Phase 4"
      icon={FileCheck2}
      capabilities={[
        "Gateway receipts and webhooks",
        "Policy decision records",
        "Evidence sufficiency scoring",
        "Chain-of-custody view",
      ]}
    />
  );
}
