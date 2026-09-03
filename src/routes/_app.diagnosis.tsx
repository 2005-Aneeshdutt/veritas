import { createFileRoute } from "@tanstack/react-router";
import { Stethoscope } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/diagnosis")({
  head: () => ({
    meta: [
      { title: "Diagnosis — VERITAS" },
      { name: "description", content: "Why a payment failed, and which levers could change the outcome." },
      { property: "og:title", content: "Diagnosis — VERITAS" },
      { property: "og:description", content: "Why a payment failed, and which levers could change the outcome." },
    ],
  }),
  component: DiagnosisPage,
});

function DiagnosisPage() {
  return (
    <PlaceholderPage
      title="Diagnosis"
      description="Why a payment failed, and which levers could change the outcome."
      phase="Phase 3"
      icon={Stethoscope}
      capabilities={[
        "Root-cause classification",
        "Issuer and network signals",
        "Recommended plan candidates",
        "Confidence and abstention",
      ]}
    />
  );
}
