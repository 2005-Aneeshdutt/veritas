import { createFileRoute } from "@tanstack/react-router";
import { Gauge } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";
import { ContextNotice } from "@/components/veritas/context-notice";

export const Route = createFileRoute("/_app/control-tower")({
  validateSearch: (search: Record<string, unknown>) => ({
    decision: typeof search["decision"] === "string" ? (search["decision"] as string) : undefined,
    view: typeof search["view"] === "string" ? (search["view"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Control Tower — VERITAS" },
      { name: "description", content: "Live operating view of governed recovery across every payment in motion." },
      { property: "og:title", content: "Control Tower — VERITAS" },
      { property: "og:description", content: "Live operating view of governed recovery across every payment in motion." },
    ],
  }),
  component: ControlTowerPage,
});

function ControlTowerPage() {
  const { decision, view } = Route.useSearch();
  const filters = [
    ...(decision ? [{ label: "Decision", value: decision }] : []),
    ...(view ? [{ label: "View", value: view }] : []),
  ];
  return (
    <PlaceholderPage
      notice={
        <ContextNotice
          filters={filters}
          message="Demo aggregation — live policy decisions require backend connection."
        />
      }
      title="Control Tower"
      description="Live operating view of governed recovery across every payment in motion."
      phase="Phase 2"
      icon={Gauge}
      capabilities={[
        "Real-time recovery throughput",
        "Authority and policy posture",
        "Operator interventions with audit",
        "Queue triage by exposure",
      ]}
    />
  );
}
