import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, Minus, Route as RouteIcon, X } from "lucide-react";
import { casesQueryOptions } from "@/data/services";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { PageHeader } from "@/components/veritas/page-header";
import { PlaceholderPage } from "@/components/veritas/placeholder-page";
import { formatMoney } from "@/domain/money";
import type { DemoCase, JourneyStepState } from "@/domain/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/recovery-journey")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Recovery Journey — VERITAS" },
      { name: "description", content: "Payment to outcome: diagnosis, plan, authorization, execution, ledger, evidence." },
      { property: "og:title", content: "Recovery Journey — VERITAS" },
      { property: "og:description", content: "Payment to outcome: diagnosis, plan, authorization, execution, ledger, evidence." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(casesQueryOptions),
  component: RecoveryJourneyPage,
});

const STATE_ICON: Record<JourneyStepState, typeof Check> = {
  complete: Check,
  blocked: X,
  skipped: Minus,
  pending: Circle,
};

const STATE_TONE: Record<JourneyStepState, string> = {
  complete: "text-measured border-measured/40",
  blocked: "text-denied border-denied/40",
  skipped: "text-muted-foreground border-hairline",
  pending: "text-muted-foreground border-hairline",
};

function CasePicker({ cases, activeId }: { cases: DemoCase[]; activeId?: string }) {
  if (cases.length === 0) return null;
  return (
    <section aria-label="Demo cases" className="mt-1">
      <p className="label-meta text-[10px] tracking-[0.16em]">Demo cases</p>
      <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
        {cases.map((c) => (
          <li key={c.id}>
            <Link
              to="/recovery-journey"
              search={{ case: c.id }}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-3 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] px-2 -mx-2 rounded-md",
                activeId === c.id && "bg-foreground/[0.055]",
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  <span className="label-meta mr-2 text-[10px]">{c.kind}</span>
                  {c.title}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
                  {c.id} · {c.merchant} · {c.decision}
                </p>
              </div>
              <div className="flex shrink-0 items-baseline gap-3">
                <span className="numeral text-sm text-foreground">{formatMoney(c.amount)}</span>
                <ClaimBadge state={c.claim} size="sm" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecoveryJourneyPage() {
  const { data: cases } = useSuspenseQuery(casesQueryOptions);
  const { case: caseId } = Route.useSearch();
  const active = cases.find((c) => c.id === caseId);

  if (!active) {
    return (
      <div className="space-y-8">
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
        {caseId && (
          <p className="text-sm text-denied">
            No matching payment in current demo dataset: <span className="font-mono">{caseId}</span>
          </p>
        )}
        <CasePicker cases={cases} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Recovery Journey"
        description={active.summary}
        actions={
          <Link
            to="/recovery-journey"
            className="label-meta inline-flex h-8 items-center rounded-md border border-hairline px-3 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            All cases
          </Link>
        }
      />

      <section aria-label="Case summary" className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="label-meta text-[10px] tracking-[0.16em]">
            {active.kind} · demo case
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {active.title}
          </h2>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
            {active.id} · {active.merchant} · policy {active.policy} · decision {active.decision}
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="numeral text-4xl font-semibold leading-none text-foreground">
            {formatMoney(active.amount)}
          </div>
          <div className="mt-2 sm:flex sm:justify-end">
            <ClaimBadge state={active.claim} size="sm" />
          </div>
        </div>
      </section>

      <section aria-label="Journey timeline">
        <ol className="border-t border-hairline">
          {active.steps.map((s) => {
            const Icon = STATE_ICON[s.state];
            return (
              <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 border-b border-hairline py-4">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                    STATE_TONE[s.state],
                  )}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                    <ClaimBadge state={s.claim} size="sm" />
                    {s.state === "skipped" && (
                      <span className="label-meta text-[10px]">Not reached</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <nav aria-label="Related workspaces" className="flex flex-wrap gap-2">
        {[
          { to: "/payments" as const, label: "View payment" },
          { to: "/control-tower" as const, label: "View Control Tower" },
          { to: "/evidence" as const, label: "View evidence" },
          { to: "/prove" as const, label: "View proof" },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            {l.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <p className="text-xs text-muted-foreground/80">
        Demo case — no financial action is performed by this interface. Execution and confirmation
        come from the backend once connected.
      </p>

      <CasePicker cases={cases} activeId={active.id} />
    </div>
  );
}
