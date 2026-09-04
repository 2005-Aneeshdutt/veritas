import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import { formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/outcome")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Outcome — VERITAS" },
      {
        name: "description",
        content:
          "What actually happened after execution: measured, observed, unverified, abstained or never reached.",
      },
      { property: "og:title", content: "Outcome — VERITAS" },
      {
        property: "og:description",
        content:
          "What actually happened after execution: measured, observed, unverified, abstained or never reached.",
      },
    ],
  }),
  component: OutcomePage,
});

const DISTINCTIONS = [
  { a: "Policy allowed", b: "Execution occurred" },
  { a: "Execution occurred", b: "Recovery confirmed" },
  { a: "Recovery observed", b: "Evidence verified" },
];

function OutcomePage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/outcome" });
  const { case_: c, isFixture, error } = useJourneyCase(caseId, 0);

  const outcomeTone =
    c.outcome.state === "MEASURED"
      ? "text-measured"
      : c.outcome.state === "OBSERVED"
        ? "text-observed"
        : c.outcome.state === "UNVERIFIED"
          ? "text-denied"
          : "text-muted-foreground";

  const evidenceForOutcome = c.evidence.find((e) => e.label === "Outcome");

  return (
    <div className="space-y-9">
      <BackendNotice isFixture={isFixture} error={error} what="outcome" />

      <header className="border-b border-hairline pb-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">After execution</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Outcome
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          What actually happened after execution. Execution is not recovery.
        </p>
      </header>

      <CaseSwitcher activeId={c.id} onSelect={(id) => navigate({ to: ".", search: { case: id } })} />

      <section aria-label="Outcome" className="border-l-2 border-hairline pl-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Outcome</p>
        <p className={cn("numeral mt-1 text-3xl font-semibold tracking-tight sm:text-4xl", outcomeTone)}>
          {c.outcome.state}
        </p>
        <p className="numeral mt-2 text-2xl font-semibold text-foreground">
          {formatMoney(c.outcome.amount)}
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{c.outcome.note}</p>

        <dl className="mt-5 max-w-xl divide-y divide-hairline border-y border-hairline">
          {[
            { k: "Payment", v: c.id },
            { k: "Execution", v: `${c.execution.state} · ${c.execution.action}` },
            { k: "Timestamp", v: c.execution.at ?? c.ledger.at },
            { k: "Source", v: c.execution.at ? "Settlement observation" : "No execution artifact" },
            { k: "Evidence", v: `${evidenceForOutcome?.status ?? "UNAVAILABLE"} — ${evidenceForOutcome?.note ?? ""}` },
            { k: "Gateway", v: c.gateway },
          ].map((r) => (
            <div key={r.k} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4 py-2.5">
              <dt className="label-meta w-32 shrink-0 text-[10px] tracking-[0.14em]">{r.k}</dt>
              <dd className="min-w-0 break-words text-right text-[13px] text-foreground">{r.v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-wrap items-baseline gap-x-4">
          <span className="label-meta text-[10px] tracking-[0.16em]">Claim</span>
          <span className="numeral text-lg font-semibold text-foreground">
            {formatMoney(c.claimAmount)}
          </span>
          <ClaimBadge state={c.claim} />
        </div>
      </section>

      <section aria-label="Outcome rules" className="grid gap-3 sm:grid-cols-3">
        {DISTINCTIONS.map((d) => (
          <p key={d.a} className="border-l-2 border-hairline pl-3 text-[12px] text-muted-foreground">
            <span className="text-foreground">{d.a}</span>
            <span className="mx-2 text-denied">≠</span>
            <span className="text-foreground">{d.b}</span>
          </p>
        ))}
      </section>

      <nav aria-label="Related workspaces" className="flex flex-wrap gap-2">
        {[
          { label: "Open ledger", to: "/audit-trail" as const },
          { label: "Open evidence", to: "/evidence" as const },
          { label: "Open proof", to: "/prove" as const },
          { label: "View recovery journey", to: "/recovery-journey" as const },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            search={{ case: c.id } as never}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            {l.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <p className="text-xs text-muted-foreground/80">
        Frontend demonstration only. Outcomes are read from the committed run record — never inferred.
      </p>
    </div>
  );
}
