import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/veritas/landing";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "VERITAS — Recover what you can. Prove what happened." },
      {
        name: "description",
        content:
          "A recovery agent bounded by a signed mandate: the model proposes, a deterministic policy kernel decides, and every rupee is marked against an outcome the engine never saw.",
      },
      { property: "og:title", content: "VERITAS — Revenue Recovery Intelligence" },
      {
        property: "og:description",
        content: "Recover what you can. Prove what happened.",
      },
    ],
  }),
  component: Landing,
});
