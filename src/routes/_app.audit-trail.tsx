import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/audit-trail")({
  head: () => ({
    meta: [
      { title: "Audit Trail — VERITAS" },
      { name: "description", content: "Immutable record of governed actions, decisions and outcomes." },
      { property: "og:title", content: "Audit Trail — VERITAS" },
      { property: "og:description", content: "Immutable record of governed actions, decisions and outcomes." },
    ],
  }),
  component: AuditTrailPage,
});

function AuditTrailPage() {
  return (
    <PlaceholderPage
      title="Audit Trail"
      description="Immutable record of governed actions, decisions and outcomes."
      phase="Phase 4"
      icon={ScrollText}
      capabilities={[
        "Append-only action log",
        "Actor, policy and rationale",
        "Ledger reconciliation entries",
        "Export for auditors",
      ]}
    />
  );
}
