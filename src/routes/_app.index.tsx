import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { overviewQueryOptions } from "@/data/services";
import { PageHeader } from "@/components/veritas/page-header";
import { MetricCard } from "@/components/veritas/metric-card";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { NetworkBackground } from "@/components/veritas/network-background";
import { formatCount, formatMoney, formatMoneyCompact } from "@/domain/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "Overview — VERITAS Revenue Recovery Intelligence" },
      {
        name: "description",
        content:
          "Executive overview of revenue at risk, projected versus measured recovery, policy outcomes and proof health.",
      },
      { property: "og:title", content: "Overview — VERITAS" },
      {
        property: "og:description",
        content: "Recover what you can. Prove what happened.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(overviewQueryOptions);
  },
  component: Overview,
});

function SectionCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-panel flex flex-col p-5", className)} aria-label={title}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <span className="label-meta shrink-0">{hint}</span>}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

const POLICY_TONE: Record<string, string> = {
  allowed: "text-measured",
  conditional: "text-projected",
  denied: "text-denied",
  abstained: "text-muted-foreground",
};

const SEVERITY_TONE: Record<string, string> = {
  high: "text-denied",
  medium: "text-projected",
  low: "text-muted-foreground",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Overview() {
  const { data } = useSuspenseQuery(overviewQueryOptions);
  const maxFunnel = Math.max(...data.funnel.map((f) => f.count));

  return (
    <div className="relative space-y-6">
      <NetworkBackground intensity="subtle" className="-z-10 h-[520px]" />

      <PageHeader
        title="Overview"
        description="Recover what you can. Prove what happened."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-projected/40 bg-projected/10 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.09em] text-projected">
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            {data.source === "demo" ? "Demo data" : "Live backend"}
          </span>
        }
      />

      <section aria-label="Primary metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.headline.map((m) => (
          <MetricCard key={m.id} metric={m} />
        ))}
      </section>

      <p className="flex items-start gap-2 rounded-md border border-hairline bg-elevated/50 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-measured" aria-hidden="true" />
        Projected value is a modelled expectation authorized by policy. Only gateway-confirmed,
        ledger-reconciled value is reported as measured recovery.
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Revenue at risk" hint="By cause" className="lg:col-span-2">
          <ul className="space-y-3">
            {data.risk.map((r) => (
              <li key={r.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className="min-w-0 truncate text-sm text-foreground">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="numeral text-sm font-medium text-foreground">
                      {formatMoneyCompact(r.amount)}
                    </span>
                    <ClaimBadge state={r.claim} size="sm" iconOnly />
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-observed/60"
                    style={{ width: `${r.share}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Policy outcomes" hint="Last 7 days">
          <ul className="space-y-3">
            {data.policyOutcomes.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-muted-foreground">{p.label}</span>
                <span className={cn("numeral text-lg font-semibold", POLICY_TONE[p.tone])}>
                  {formatCount(p.count)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-hairline pt-3 text-xs text-muted-foreground">
            AI recommends. Policy authorizes. Execution acts.
          </p>
        </SectionCard>

        <SectionCard title="Recovery funnel" hint="Detected → confirmed" className="lg:col-span-2">
          <ul className="space-y-2.5">
            {data.funnel.map((s) => (
              <li key={s.id} className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-3">
                <span className="truncate text-sm text-muted-foreground">{s.label}</span>
                <div className="flex items-center gap-3">
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-elevated">
                    <div
                      className={cn(
                        "h-full rounded-md",
                        s.claim === "MEASURED"
                          ? "bg-measured/70"
                          : s.claim === "PROJECTED"
                            ? "bg-projected/60"
                            : "bg-observed/40",
                      )}
                      style={{ width: `${Math.max(6, (s.count / maxFunnel) * 100)}%` }}
                    />
                  </div>
                  <span className="numeral w-16 shrink-0 text-right text-sm text-foreground">
                    {formatCount(s.count)}
                  </span>
                  <span className="numeral hidden w-20 shrink-0 text-right text-sm text-muted-foreground sm:block">
                    {formatMoneyCompact(s.amount)}
                  </span>
                  <ClaimBadge state={s.claim} size="sm" iconOnly />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Intervention mix" hint="Measured vs projected">
          <ul className="space-y-3">
            {data.interventions.map((i) => (
              <li key={i.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-foreground">{i.label}</span>
                  <span className="numeral shrink-0 text-xs text-muted-foreground">{i.share}%</span>
                </div>
                <div className="mt-1 flex items-baseline gap-3 text-xs">
                  <span className="numeral text-measured">{formatMoney(i.measured)} measured</span>
                  <span className="numeral text-projected">
                    ~{formatMoney(i.projected)} projected
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Recent governed actions" hint="Policy → execution" className="lg:col-span-2">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only">Most recent governed recovery actions</caption>
              <thead>
                <tr className="text-left">
                  {["Reference", "Action", "Account", "Amount", "Claim", "When"].map((h) => (
                    <th key={h} scope="col" className="label-meta pb-2 pr-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentActions.map((a) => (
                  <tr key={a.id} className="border-t border-hairline">
                    <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                      {a.reference}
                    </td>
                    <td className="py-2.5 pr-3 text-foreground">
                      {a.action}
                      <div className="font-mono text-[10px] text-muted-foreground">{a.policy}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{a.merchantOrCustomer}</td>
                    <td className="numeral py-2.5 pr-3 text-foreground">{formatMoney(a.amount)}</td>
                    <td className="py-2.5 pr-3">
                      <ClaimBadge state={a.claim} size="sm" />
                    </td>
                    <td className="py-2.5 pr-1 text-xs text-muted-foreground">
                      {timeAgo(a.occurredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title="Exception queue" hint={`${data.exceptions.length} open`}>
            <ul className="space-y-2.5">
              {data.exceptions.map((e) => (
                <li key={e.id} className="rounded-md border border-hairline bg-elevated/50 p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <span className="min-w-0 text-sm text-foreground">{e.reason}</span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-[0.09em]",
                        SEVERITY_TONE[e.severity],
                      )}
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {e.severity}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{e.reference}</span>
                    <span aria-hidden="true">·</span>
                    <span className="numeral">{formatMoney(e.amount)}</span>
                    <span aria-hidden="true">·</span>
                    <span>waiting {timeAgo(e.waitingSince)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Audit & proof health" hint="Evidence chain">
            <ul className="space-y-3">
              {[
                { label: "Evidence coverage", value: data.proofHealth.evidenceCoverage },
                { label: "Ledger integrity", value: data.proofHealth.ledgerIntegrity },
                { label: "Gateway reconciliation", value: data.proofHealth.gatewayReconciliation },
              ].map((row) => (
                <li key={row.label}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="numeral font-medium text-foreground">
                      {row.value.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full rounded-full bg-measured/70"
                      style={{ width: `${row.value}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-xs text-muted-foreground">
              <span>{data.proofHealth.openDisputes} open disputes</span>
              <span>Last audit {timeAgo(data.proofHealth.lastAudit)}</span>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
