import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/prove")({
  head: () => ({
    meta: [
      { title: "Prove — VERITAS" },
      { name: "description", content: "Attestations and recovery certificates that stand behind the number." },
      { property: "og:title", content: "Prove — VERITAS" },
      { property: "og:description", content: "Attestations and recovery certificates that stand behind the number." },
    ],
  }),
  component: ProvePage,
});

function ProvePage() {
  return (
    <PlaceholderPage
      title="Prove"
      description="Attestations and recovery certificates that stand behind the number."
      phase="Phase 5"
      icon={Activity}
      capabilities={[
        "Recovery certificates",
        "Measured-only attestation",
        "Auditor-facing summary",
        "Verifiable claim bundle",
      ]}
    />
  );
}
