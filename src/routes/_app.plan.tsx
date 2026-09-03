import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { DetailDrawer } from "@/components/veritas/detail-drawer";
import { PageHeader } from "@/components/veritas/page-header";
import { JOURNEY_CASES, findJourneyCase } from "@/data/journey-cases";
import { diagnosisFactors, formatEffect } from "@/data/investigate";
import type { PlanChannel } from "@/domain/journey";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/plan")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Recovery Plan — VERITAS" },
      {
        name: "description",
        content:
          "What should VERITAS do next? An AI recommendation with projected recovery, cost and eligibility — authorization stays with the Policy Kernel.",
      },
      { property: "og:title", content: "Recovery Plan — VERITAS" },
      {
        property: "og:description",
        content:
          "What should VERITAS do next? An AI recommendation with projected recovery, cost and eligibility — authorization stays with the Policy Kernel.",
      },
    ],
  }),
  component: PlanPage,
});

function riskLabel(r: PlanChannel["risk"]): string {
  return r.toUpperCase();
}

function PlanPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate();
  const activeCase = findJourneyCase(caseId) ?? JOURNEY_CASES[1]!;
  const plan = activeCase.plan;
  const [selected, setSelected] = useState<PlanChannel | null>(null);
  const recommended = plan.channels.find((c) => c.recommended);
  const topFactor = diagnosisFactors(activeCase.id).find((f) => f.effect !== null);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Recovery Plan"
        description="What should VERITAS do next?"
        actions={<ClaimBadge state="PROJECTED" />}
      />

      <CaseSwitcher
        activeId={activeCase.id}
        onSelect={(id) => void navigate({ to: "/plan", search: { case: id } })}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <section className="border-b border-hairline pb-6">
            <p className="label-meta text-[10px] tracking-[0.16em]">AI recommendation</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {plan.recommended}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              <span className="label-meta mr-2 text-[10px] tracking-[0.16em]">Why</span>
              {activeCase.diagnosis.note}
              {topFactor && ` Leading factor: ${topFactor.label} ${formatEffect(topFactor)}.`}
            </p>
            {recommended && (
              <div className="mt-5 inline-flex flex-col gap-1 rounded-md border border-projected/40 px-4 py-3">
                <span className="label-meta text-[10px] tracking-[0.16em] text-projected">
                  Projected recovery
                </span>
                <span className="numeral text-2xl tabular-nums">
                  {formatMoney(recommended.expected)}
                </span>
                <span className="text-xs text-muted-foreground">
                  PROJECTED — modelled, not recovered money.
                </span>
              </div>
            )}
          </section>

          {/* Channel comparison */}
          <section aria-labelledby="channels-heading" className="space-y-3">
            <div>
              <h3 id="channels-heading" className="text-sm font-semibold tracking-tight">
                Recovery channels
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Every expected and net value is PROJECTED. {plan.note}
              </p>
            </div>

            <div className="hidden grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_90px_110px] gap-3 border-b border-hairline pb-2 sm:grid">
              {["Action", "Expected", "Cost", "Net", "Risk", "Eligibility"].map((h) => (
                <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
                  {h}
                </span>
              ))}
            </div>

            <ul className="divide-y divide-hairline">
              {plan.channels.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c)}
                    aria-label={`${c.label} — projected ${formatMoney(c.expected)}`}
                    className={cn(
                      "grid w-full grid-cols-2 gap-2 py-3 text-left transition-colors hover:bg-muted/20 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_90px_110px] sm:gap-3 sm:items-baseline",
                      c.recommended && "bg-projected/5",
                    )}
                  >
                    <span className="col-span-2 flex items-center gap-2 text-[13px] font-medium sm:col-span-1">
                      {c.label}
                      {c.recommended && (
                        <span className="label-meta text-[9px] tracking-[0.14em] text-projected">
                          Recommended
                        </span>
                      )}
                    </span>
                    <Cell head="Expected" value={formatMoney(c.expected)} />
                    <Cell head="Cost" value={formatMoney(c.cost)} />
                    <Cell head="Net" value={formatMoney(c.net)} />
                    <Cell head="Risk" value={riskLabel(c.risk)} plain />
                    <Cell
                      head="Eligibility"
                      value={c.eligible ? "Eligible" : "Not eligible"}
                      plain
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Policy handoff */}
          <section className="rounded-lg border border-hairline p-5">
            <div className="flex flex-col items-start gap-1">
              <p className="label-meta text-[10px] tracking-[0.16em]">AI recommends</p>
              <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="label-meta text-[10px] tracking-[0.16em]">Policy Kernel decides</p>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              The plan is a recommendation only. AUTO-ALLOW, HOLD, DENY and ESCALATE are decided by
              the Policy Kernel. Nothing on this page authorizes or executes money movement.
            </p>
            <Link
              to="/policy"
              search={{ case: activeCase.id }}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-foreground/40 px-3.5 text-[13px] transition-colors hover:bg-foreground/5"
            >
              Send to policy
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </section>
        </div>

        <aside className="space-y-6 lg:border-l lg:border-hairline lg:pl-6">
          <section>
            <p className="label-meta text-[10px] tracking-[0.16em]">Payment</p>
            <dl className="mt-2 divide-y divide-hairline text-sm">
              <Row label="Payment ID" value={activeCase.id} mono />
              <Row label="Merchant" value={activeCase.merchant} />
              <Row label="Amount" value={formatMoney(activeCase.amount)} mono />
              <Row label="Method" value={activeCase.method} />
              <Row label="Failure reason" value={activeCase.failureReason} />
            </dl>
          </section>

          <section>
            <p className="label-meta text-[10px] tracking-[0.16em]">Recommendation</p>
            <dl className="mt-2 divide-y divide-hairline text-sm">
              <Row label="Action" value={plan.recommended} />
              <Row
                label="Projected"
                value={recommended ? formatMoney(recommended.expected) : "NOT AVAILABLE"}
                mono
              />
              <Row label="Authority" value="Policy Kernel decides" />
            </dl>
          </section>

          <nav aria-label="Related workspaces" className="flex flex-col gap-2">
            <p className="label-meta text-[10px] tracking-[0.16em]">Next</p>
            <ContextLink to="/diagnosis" caseId={activeCase.id} label="Open diagnosis" />
            <ContextLink to="/policy" caseId={activeCase.id} label="Send to policy" />
            <ContextLink to="/recovery-journey" caseId={activeCase.id} label="Open recovery journey" />
          </nav>
        </aside>
      </div>

      <DetailDrawer
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        eyebrow="Recovery channel — AI recommendation"
        title={selected?.label ?? ""}
        description={
          selected?.recommended
            ? "Recommended by the agent for this diagnosis. Recommendation is not authorization."
            : "Alternative channel considered for this diagnosis."
        }
        rows={
          selected
            ? [
                { label: "Expected", value: `${formatMoney(selected.expected)} · PROJECTED` },
                { label: "Cost", value: `${formatMoney(selected.cost)} · PROJECTED` },
                { label: "Net value", value: `${formatMoney(selected.net)} · PROJECTED` },
                { label: "Risk", value: riskLabel(selected.risk) },
                { label: "Eligibility", value: selected.eligible ? "Eligible" : "Not eligible" },
                { label: "Authority", value: "Requires Policy Kernel decision" },
              ]
            : []
        }
        actions={[
          { label: "Send to policy", to: "/policy", search: { case: activeCase.id } },
          { label: "Open diagnosis", to: "/diagnosis", search: { case: activeCase.id } },
        ]}
        footer="Projected values are modelled from demo adapter data. No money has been recovered."
      />
    </div>
  );
}

function Cell({ head, value, plain }: { head: string; value: string; plain?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-2 text-[13px] sm:block sm:text-right">
      <span className="label-meta text-[10px] tracking-[0.14em] sm:hidden">{head}</span>
      <span className={cn(plain ? "text-muted-foreground" : "numeral tabular-nums")}>{value}</span>
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 py-2">
      <dt className="label-meta w-28 shrink-0 text-[10px] tracking-[0.14em]">{label}</dt>
      <dd className={cn("min-w-0 break-words text-right", mono && "numeral tabular-nums")}>{value}</dd>
    </div>
  );
}

function ContextLink({
  to,
  caseId,
  label,
}: {
  to: "/diagnosis" | "/policy" | "/recovery-journey";
  caseId: string;
  label: string;
}) {
  return (
    <Link
      to={to}
      search={{ case: caseId } as never}
      className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
