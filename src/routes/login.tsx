import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { NetworkBackground } from "@/components/veritas/network-background";
import { VeritasMark } from "@/components/veritas/logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — VERITAS Revenue Recovery Intelligence" },
      {
        name: "description",
        content:
          "Sign in to VERITAS. Revenue recovery, under authority — AI recommends, policy authorizes, evidence proves.",
      },
      { property: "og:title", content: "Sign in — VERITAS" },
      { property: "og:description", content: "Revenue recovery, under authority." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <NetworkBackground intensity="strong" />

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <VeritasMark className="h-9 w-9" />
          <h1 className="mt-4 text-2xl font-semibold tracking-[0.22em] text-foreground">VERITAS</h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Revenue Recovery Intelligence
          </p>
        </div>

        <div className="surface-panel p-7 shadow-sm">
          <h2 className="text-lg font-medium text-foreground">Revenue recovery, under authority.</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            AI can recommend an action. VERITAS determines whether it can be authorized, executed,
            and proven.
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="login-email" className="label-meta">
                Work email
              </Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="h-10 border-hairline bg-elevated"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="label-meta">
                Password
              </Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••"
                className="h-10 border-hairline bg-elevated"
              />
            </div>

            <Link
              to="/"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </form>

          <p className="mt-5 border-t border-hairline pt-4 text-xs text-muted-foreground">
            Authentication is not connected in this phase. Continue opens the demo workspace.
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Recover what you can. Prove what happened.
        </p>
      </div>
    </div>
  );
}
