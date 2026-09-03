import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";

export const Route = createFileRoute("/_app/counterfactual-lab")({
  head: () => ({
    meta: [
      { title: "Counterfactual Lab — VERITAS" },
      { name: "description", content: "What would have happened under a different plan, policy or timing." },
      { property: "og:title", content: "Counterfactual Lab — VERITAS" },
      { property: "og:description", content: "What would have happened under a different plan, policy or timing." },
    ],
  }),
  component: CounterfactualLabPage,
});

function CounterfactualLabPage() {
  return (
    <PlaceholderPage
      title="Counterfactual Lab"
      description="What would have happened under a different plan, policy or timing."
      phase="Phase 4"
      icon={FlaskConical}
      capabilities={[
        "Holdout and control groups",
        "Counterfactual estimates",
        "Uplift attribution",
        "Projected versus measured comparison",
      ]}
    />
  );
}
