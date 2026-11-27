import { createFileRoute, redirect } from "@tanstack/react-router";

// The landing page used to live here. It is now at "/"; old links still land.
export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
