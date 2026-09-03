import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { overviewQueryOptions } from "@/data/services";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { NetworkBackground } from "@/components/veritas/network-background";
import { formatCount, formatMoney, formatMoneyCompact } from "@/domain/money";
import type { ClaimState, HeadlineMetric } from "@/domain/types";
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

const CLAIM_ACCENT: Record<ClaimState, string> = {
  VERIFIED: "text-verified",
  MEASURED: "text-measured",
  PROJECTED: "text-projected",
  OBSERVED: "text-foreground",
  UNVERIFIED: "text-denied",
  ABSTAINED: "text-muted-foreground",
};

const CLAIM_RULE: Record<ClaimState, string> = {
  VERIFIED: "bg-verified/60",
  MEASURED: "bg-measured/70",
  PROJECTED: "bg-projected/70",
  OBSERVED: "bg-observed/50",
  UNVERIFIED: "bg-denied/60",
  ABSTAINED: "bg-hairline",
};

const POLICY_TONE: Record<string, string> = {
  allowed: "text-measured",
  conditional: "text-projected",
  denied: "text-denied",
  abstained: "text-muted-foreground",
};

const SEVERITY_TONE: Record<string, string> = {
  high: "bg-denied",
  medium: "bg-projected",
  low: "bg-muted-foreground/60",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function display(metric: HeadlineMetric) {
  return metric.displayOverride ?? formatMoney(metric.value);
}

/** Level 2 heading — no container chrome, just a typographic rule. */
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
      <h2 className="text-[15px] font-medium tracking-tight text-foreground">{title}</h2>
      {hint && <span className="label-meta shrink-0 text-[10px]">{hint}</span>}
    </div>
  );
}

function Overview() {
  const { data } = useSuspenseQuery(overviewQueryOptions);
  const byId = (id: string) => data.headline.find((m) => m.id === id)!;
  const atRisk = byId("at-risk");
  const recoverable = byId("recoverable");
  const recovered = byId("recovered");
  const held = byId("held");
  const maxFunnel = Math.max(...data.funnel.map((f) => f.count));

  return (
    <div className="relative">
      <NetworkBackground intensity="subtle" className="-z-10 h-[680px]" />

      {/* ── Level 1 · Hero ─────────────────────────────────────────── */}
      <header className="pt-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <p className="label-meta text-[10px] text-muted-foreground/70">
              Veritas · Revenue Recovery Intelligence
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Overview
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Recover what you can. Prove what happened.
            </p>
          </div>
          <span className="label-meta shrink-0 rounded-md border border-hairline px-2 py-1 text-[10px] text-muted-foreground">
            {data.source === "demo" ? "Demo data" : "Live backend"}
          </span>
        </div>
      </header>

      <section
        aria-label="Primary financial position"
        className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="label-meta text-[10px] tracking-[0.14em]">At risk</span>
            <ClaimBadge state={atRisk.claim} size="sm" />
          </div>
          <div className="numeral mt-3 text-6xl font-semibold leading-none text-foreground sm:text-7xl">
            {display(atRisk)}
          </div>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            {atRisk.note}
          </p>
          <p className="numeral mt-3 text-xs text-muted-foreground/80">
            Exact {formatMoney(atRisk.value)} · {atRisk.deltaPct! > 0 ? "+" : ""}
            {atRisk.deltaPct}% vs last week
          </p>
        </div>

        <dl className="min-w-0 divide-y divide-hairline border-t border-hairline">
          {[recoverable, recovered, held].map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-5"
            >
              <div className="min-w-0">
                <dt className="flex items-baseline gap-2">
                  <span className="label-meta text-[10px] tracking-[0.14em]">{m.label}</span>
                  <ClaimBadge state={m.claim} size="sm" />
                </dt>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground/80">
                  {m.note}
                </p>
              </div>
              <dd
                className={cn(
                  "numeral shrink-0 text-3xl font-semibold leading-none sm:text-4xl",
                  CLAIM_ACCENT[m.claim],
                )}
              >
                {m.claim === "PROJECTED" ? "~" : ""}
                {display(m)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Level 1b · Recovery flow ───────────────────────────────── */}
      <section aria-label="Recovery flow" className="mt-14 border-t border-hairline pt-6">
        <SectionTitle title="Recovery flow" hint="Payment → decision → money → proof" />
        <ol className="mt-6 grid gap-px overflow-hidden sm:grid-cols-2 lg:grid-cols-6">
          {data.funnel.map((s, i) => (
            <li
              key={s.id}
              className="relative min-w-0 px-0 pb-5 pt-4 sm:px-4 lg:first:pl-0 lg:last:pr-0"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-6 hidden h-8 w-px bg-hairline lg:block"
                />
              )}
              <div className="label-meta truncate text-[10px] tracking-[0.14em]">{s.label}</div>
              <div className="numeral mt-2 text-2xl font-semibold text-foreground">
                {formatCount(s.count)}
              </div>
              <div
                className={cn(
                  "numeral mt-1 text-sm",
                  s.claim === "MEASURED"
                    ? "text-measured"
                    : s.claim === "PROJECTED"
                      ? "text-projected"
                      : "text-muted-foreground",
                )}
              >
                {s.claim === "PROJECTED" ? "~" : ""}
                {formatMoneyCompact(s.amount)}
              </div>
              <div className="mt-3 h-px w-full bg-hairline">
                <div
                  className={cn("h-px", CLAIM_RULE[s.claim])}
                  style={{ width: `${Math.max(8, (s.count / maxFunnel) * 100)}%` }}
                />
              </div>
              <div className="mt-2">
                <ClaimBadge state={s.claim} size="sm" />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground/80">
          Only gateway-confirmed, ledger-reconciled value is reported as measured recovery.
          Everything upstream of authorization is a modelled expectation.
        </p>
      </section>

      {/* ── Level 2 · Analytical ───────────────────────────────────── */}
      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="surface-panel min-w-0 p-6" aria-label="Revenue at risk by cause">
          <SectionTitle title="Revenue at risk" hint="By cause" />
          <ul className="mt-5 space-y-4">
            {data.risk.map((r) => (
              <li key={r.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
                  <span className="min-w-0 truncate text-sm text-foreground">{r.label}</span>
                  <span className="numeral shrink-0 text-sm font-medium text-foreground">
                    {formatMoneyCompact(r.amount)}
                  </span>
                </div>
                <div className="mt-2 h-px w-full bg-hairline">
                  <div
                    className={cn(
                      "h-px",
                      r.claim === "UNVERIFIED" ? "bg-denied/60" : "bg-foreground/45",
                    )}
                    style={{ width: `${r.share}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-panel min-w-0 p-6" aria-label="Policy outcomes">
          <SectionTitle title="Policy outcomes" hint="Last 7 days" />
          <dl className="mt-5 space-y-4">
            {data.policyOutcomes.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0 truncate text-sm text-muted-foreground">{p.label}</dt>
                <dd className={cn("numeral text-xl font-semibold", POLICY_TONE[p.tone])}>
                  {formatCount(p.count)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-xs text-muted-foreground/80">
            AI recommends. Policy authorizes. Execution acts.
          </p>
        </section>
      </div>

      {/* ── Level 3 · Operational ──────────────────────────────────── */}
      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="min-w-0" aria-label="Recent governed actions">
          <SectionTitle title="Recent governed actions" hint="Policy → execution" />
          <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
            {data.recentActions.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{a.action}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
                    {a.reference} · {a.merchantOrCustomer} · {a.policy}
                  </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-4">
                  <span className="numeral text-sm text-foreground">{formatMoney(a.amount)}</span>
                  <ClaimBadge state={a.claim} size="sm" className="w-[86px] justify-end" />
                  <span className="hidden w-16 text-right text-xs text-muted-foreground/80 sm:inline">
                    {timeAgo(a.occurredAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="min-w-0 space-y-10">
          <section aria-label="Exception queue">
            <SectionTitle title="Exception queue" hint={`${data.exceptions.length} open`} />
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {data.exceptions.map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-3">
                  <span
                    aria-hidden="true"
                    className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_TONE[e.severity])}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-foreground">{e.reason}</p>
                    <p className="numeral mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
                      {e.reference} · {formatMoney(e.amount)} ·{" "}
                      <span className="sr-only">severity </span>
                      {e.severity} · waiting {timeAgo(e.waitingSince)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Intervention mix">
            <SectionTitle title="Intervention mix" hint="Measured vs projected" />
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {data.interventions.map((i) => (
                <li
                  key={i.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm text-foreground">{i.label}</span>
                  <span className="numeral shrink-0 text-xs">
                    <span className="text-measured">{formatMoney(i.measured)}</span>
                    <span className="text-muted-foreground/50"> / </span>
                    <span className="text-projected">~{formatMoney(i.projected)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Audit and proof health">
            <SectionTitle title="Proof health" hint={`Last audit ${timeAgo(data.proofHealth.lastAudit)}`} />
            <dl className="mt-3 divide-y divide-hairline border-t border-hairline">
              {[
                { label: "Evidence coverage", value: data.proofHealth.evidenceCoverage },
                { label: "Ledger integrity", value: data.proofHealth.ledgerIntegrity },
                { label: "Gateway reconciliation", value: data.proofHealth.gatewayReconciliation },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="min-w-0 truncate text-sm text-muted-foreground">{row.label}</dt>
                  <dd className="numeral text-sm text-foreground">{row.value}%</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-sm text-muted-foreground">Open disputes</dt>
                <dd className="numeral text-sm text-foreground">
                  {data.proofHealth.openDisputes}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
