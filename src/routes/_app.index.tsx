import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight } from "lucide-react";
import { casesQueryOptions, overviewQueryOptions } from "@/data/services";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { NetworkBackground } from "@/components/veritas/network-background";
import { DetailDrawer, type DrawerAction } from "@/components/veritas/detail-drawer";
import { formatCount, formatMoney, formatMoneyCompact } from "@/domain/money";
import type { ClaimState, HeadlineMetric } from "@/domain/types";
import type { AppRoute } from "@/components/veritas/nav-config";
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
    await context.queryClient.ensureQueryData(casesQueryOptions);
  },
  component: Overview,
});

const CLAIM_ACCENT: Record<ClaimState, string> = {
  VERIFIED: "text-foreground",
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

/** What clicking a headline metric opens, and why. */
const METRIC_CONTEXT: Record<
  string,
  { heading: string; body: string; actions: { label: string; to: AppRoute; search?: Record<string, string> | undefined }[] }
> = {
  "at-risk": {
    heading: "Revenue at risk, by cause",
    body: "Observed exposure across payments currently failing, disputed or stalled. Exposure is not a loss, and not all of it is recoverable.",
    actions: [{ label: "View affected payments", to: "/payments" }],
  },
  recoverable: {
    heading: "Projected recovery — plans awaiting or holding authority",
    body: "Modelled contribution of authorized plans. Projected money is not recovered money and is never reported as such.",
    actions: [
      { label: "View Control Tower", to: "/control-tower", search: { view: "authorized" } },
      { label: "Open Recovery Journey", to: "/recovery-journey" },
    ],
  },
  recovered: {
    heading: "Measured recovery — gateway confirmed",
    body: "Only value confirmed by the gateway and reconciled to the ledger appears here. Every rupee has supporting evidence.",
    actions: [
      { label: "View evidence", to: "/evidence" },
      { label: "View proof", to: "/prove" },
    ],
  },
  held: {
    heading: "Held revenue — retained, evidenced",
    body: "Revenue prevented from churning out, with evidence attached. Held value is retention, not recovery.",
    actions: [{ label: "View Control Tower", to: "/control-tower", search: { view: "held" } }],
  },
};

const RISK_CONTEXT: Record<string, string> = {
  "hard-decline":
    "Issuer refused the charge outright. Recovery generally requires a new instrument or customer action.",
  "soft-decline": "Potentially recoverable through bounded retry strategies inside the issuer window.",
  mandate: "Authorization or mandate lapsed. Recovery requires mandate repair before any retry.",
  dispute: "Under dispute. Outcome depends on evidence sufficiency, not on retry logic.",
  orphan: "Movement observed without a reconciled counterpart. Recovery cannot be established yet.",
};

const STAGE_CONTEXT: Record<
  string,
  { body: string; action: { label: string; to: AppRoute; search?: Record<string, string> | undefined } }
> = {
  detected: {
    body: "Payments observed as failing, disputed or stalled. Detection is exposure, not loss.",
    action: { label: "View payments", to: "/payments" },
  },
  diagnosed: {
    body: "Cause established for each payment from gateway signals and history.",
    action: { label: "View diagnosis", to: "/diagnosis" },
  },
  planned: {
    body: "Recovery plans proposed with a modelled contribution. Proposal is not authority.",
    action: { label: "Open Counterfactual Lab", to: "/counterfactual-lab" },
  },
  authorized: {
    body: "Recovery actions passed policy authorization. Authorized is not executed.",
    action: { label: "View Control Tower", to: "/control-tower", search: { view: "authorized" } },
  },
  executed: {
    body: "Actions were executed against the gateway. Executed is not recovered.",
    action: { label: "View Recovery Journey", to: "/recovery-journey" },
  },
  confirmed: {
    body: "Gateway confirmed capture and the ledger reconciled. This is measured recovery.",
    action: { label: "View proof", to: "/prove" },
  },
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

function InlineAction({
  label,
  to,
  search,
}: {
  label: string;
  to: AppRoute;
  search?: Record<string, string> | undefined;
}) {
  return (
    <Link
      to={to}
      search={(search ?? {}) as never}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function Overview() {
  const { data } = useSuspenseQuery(overviewQueryOptions);
  const { data: cases } = useSuspenseQuery(casesQueryOptions);

  const [metricId, setMetricId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [causeId, setCauseId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [exceptionId, setExceptionId] = useState<string | null>(null);

  const byId = (id: string) => data.headline.find((m) => m.id === id)!;
  const atRisk = byId("at-risk");
  const recoverable = byId("recoverable");
  const recovered = byId("recovered");
  const held = byId("held");
  const maxFunnel = Math.max(...data.funnel.map((f) => f.count));

  const metric = metricId ? byId(metricId) : null;
  const metricCtx = metricId ? METRIC_CONTEXT[metricId] : undefined;
  const stage = data.funnel.find((s) => s.id === stageId);
  const stageCtx = stageId ? STAGE_CONTEXT[stageId] : undefined;
  const cause = data.risk.find((r) => r.id === causeId);
  const action = data.recentActions.find((a) => a.id === actionId);
  const exception = data.exceptions.find((e) => e.id === exceptionId);

  const toggle = (
    set: (v: string | null) => void,
    current: string | null,
    id: string,
  ) => set(current === id ? null : id);

  const exceptionActions = (reason: string): DrawerAction[] => {
    if (reason.includes("evidence")) return [{ label: "Open Evidence", to: "/evidence" }, { label: "Open Audit Trail", to: "/audit-trail" }];
    if (reason.includes("denial")) return [{ label: "Open Control Tower", to: "/control-tower", search: { decision: "DENY" } }, { label: "Open Audit Trail", to: "/audit-trail" }];
    if (reason.includes("mismatch")) return [{ label: "Open Audit Trail", to: "/audit-trail" }, { label: "Open Evidence", to: "/evidence" }];
    return [{ label: "Open Control Tower", to: "/control-tower" }, { label: "Open Evidence", to: "/evidence" }];
  };

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
          <button
            type="button"
            onClick={() => toggle(setMetricId, metricId, "at-risk")}
            aria-pressed={metricId === "at-risk"}
            className="group -mx-2 block w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-baseline gap-3">
              <span className="label-meta text-[10px] tracking-[0.14em]">At risk</span>
              <ClaimBadge state={atRisk.claim} size="sm" />
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground/60 transition-transform",
                  metricId === "at-risk" && "rotate-90",
                )}
              />
            </span>
            <span className="numeral mt-3 block text-6xl font-semibold leading-none text-foreground sm:text-7xl">
              {display(atRisk)}
            </span>
          </button>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            {atRisk.note}
          </p>
          <p className="numeral mt-3 text-xs text-muted-foreground/80">
            Exact {formatMoney(atRisk.value)} · {atRisk.deltaPct! > 0 ? "+" : ""}
            {atRisk.deltaPct}% vs last week
          </p>

          <ol className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2">
            {["Money", "Intelligence", "Authority", "Action", "Proof"].map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                {i > 0 && (
                  <span aria-hidden="true" className="h-px w-5 bg-hairline" />
                )}
                <span className="label-meta text-[10px] tracking-[0.16em]">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <dl className="min-w-0 divide-y divide-hairline border-t border-hairline">
          {[recoverable, recovered, held].map((m) => (
            <div key={m.id}>
              <button
                type="button"
                onClick={() => toggle(setMetricId, metricId, m.id)}
                aria-pressed={metricId === m.id}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 rounded-md px-2 py-5 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <dt className="flex items-baseline gap-2">
                    <span className="label-meta text-[10px] tracking-[0.14em]">{m.label}</span>
                    <ClaimBadge state={m.claim} size="sm" />
                  </dt>
                  <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground/80">
                    {m.note}
                  </p>
                </span>
                <dd
                  className={cn(
                    "numeral shrink-0 text-3xl font-semibold leading-none sm:text-4xl",
                    CLAIM_ACCENT[m.claim],
                  )}
                >
                  {m.claim === "PROJECTED" ? "~" : ""}
                  {display(m)}
                </dd>
              </button>
            </div>
          ))}
        </dl>
      </section>

      {/* Contextual metric panel */}
      {metric && metricCtx && (
        <section
          aria-label={`${metric.label} detail`}
          className="mt-8 border-l-2 border-foreground/20 pl-5"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
            <h2 className="text-[15px] font-medium tracking-tight text-foreground">
              {metricCtx.heading}
            </h2>
            <button
              type="button"
              onClick={() => setMetricId(null)}
              className="label-meta shrink-0 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Close
            </button>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {metricCtx.body}
          </p>

          {metricId === "at-risk" && (
            <ul className="mt-4 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {data.risk.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{r.label}</span>
                  <span className="numeral shrink-0 text-sm text-foreground">
                    {formatMoneyCompact(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(metricId === "recoverable" || metricId === "recovered") && (
            <ul className="mt-4 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {data.interventions.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{i.label}</span>
                  <span className="numeral shrink-0 text-sm">
                    {metricId === "recovered" ? (
                      <span className="text-measured">{formatMoney(i.measured)}</span>
                    ) : (
                      <span className="text-projected">~{formatMoney(i.projected)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {metricId === "held" && (
            <ul className="mt-4 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
              <li className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-muted-foreground">Evidence coverage</span>
                <span className="numeral text-sm text-foreground">
                  {data.proofHealth.evidenceCoverage}%
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-muted-foreground">Ledger integrity</span>
                <span className="numeral text-sm text-foreground">
                  {data.proofHealth.ledgerIntegrity}%
                </span>
              </li>
            </ul>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {metricCtx.actions.map((a) => (
              <InlineAction key={a.label} {...a} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground/80">
            Demo aggregation — detailed payment records require backend connection.
          </p>
        </section>
      )}

      {/* ── Level 1b · Recovery flow ───────────────────────────────── */}
      <section aria-label="Recovery flow" className="mt-14 border-t border-hairline pt-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
          <SectionTitle title="Recovery flow" hint="Payment → decision → money → proof" />
          <Link
            to="/recovery-journey"
            search={{ case: undefined }}
            className="label-meta inline-flex shrink-0 items-center gap-1.5 text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Recovery Journey
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <ol className="mt-6 grid gap-px overflow-hidden sm:grid-cols-2 lg:grid-cols-6">
          {data.funnel.map((s, i) => {
            const selected = stageId === s.id;
            return (
              <li key={s.id} className="relative min-w-0">
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-6 hidden h-8 w-px bg-hairline lg:block"
                  />
                )}
                <button
                  type="button"
                  onClick={() => toggle(setStageId, stageId, s.id)}
                  aria-pressed={selected}
                  className={cn(
                    "w-full rounded-md px-3 pb-5 pt-4 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "bg-foreground/[0.055]",
                  )}
                >
                  <span className="label-meta block truncate text-[10px] tracking-[0.14em]">
                    {s.label}
                  </span>
                  <span className="numeral mt-2 block text-2xl font-semibold text-foreground">
                    {formatCount(s.count)}
                  </span>
                  <span
                    className={cn(
                      "numeral mt-1 block text-sm",
                      s.claim === "MEASURED"
                        ? "text-measured"
                        : s.claim === "PROJECTED"
                          ? "text-projected"
                          : "text-muted-foreground",
                    )}
                  >
                    {s.claim === "PROJECTED" ? "~" : ""}
                    {formatMoneyCompact(s.amount)}
                  </span>
                  <span className="mt-3 block h-px w-full bg-hairline">
                    <span
                      className={cn("block h-px transition-all duration-300", CLAIM_RULE[s.claim])}
                      style={{ width: `${Math.max(8, (s.count / maxFunnel) * 100)}%` }}
                    />
                  </span>
                  <span className="mt-2 block">
                    <ClaimBadge state={s.claim} size="sm" />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {stage && stageCtx ? (
          <div className="mt-5 border-l-2 border-measured/50 pl-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="label-meta text-[10px] tracking-[0.16em]">{stage.label}</span>
                <span className="numeral text-lg font-semibold text-foreground">
                  {formatCount(stage.count)}
                </span>
                <span className="numeral text-sm text-muted-foreground">
                  {stage.claim === "PROJECTED" ? "~" : ""}
                  {formatMoneyCompact(stage.amount)}
                </span>
                <ClaimBadge state={stage.claim} size="sm" />
              </div>
              <button
                type="button"
                onClick={() => setStageId(null)}
                className="label-meta shrink-0 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Close
              </button>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {formatCount(stage.count)} payments at this stage. {stageCtx.body}
            </p>
            <div className="mt-4">
              <InlineAction {...stageCtx.action} />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground/80">
            Select a stage to see what it means, what it counts and where to act. Only
            gateway-confirmed, ledger-reconciled value is reported as measured recovery.
          </p>
        )}

        {cases.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4">
            <span className="label-meta text-[10px] tracking-[0.16em]">Demo cases</span>
            {cases.map((c) => (
              <Link
                key={c.id}
                to="/recovery-journey"
                search={{ case: c.id }}
                className="inline-flex items-baseline gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <span className="label-meta text-[10px]">{c.kind}</span>
                <span className="font-mono text-[11px]">{c.id}</span>
                <span className="numeral text-xs">{formatMoney(c.amount)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Level 2 · Analytical ───────────────────────────────────── */}
      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="surface-panel min-w-0 p-6" aria-label="Revenue at risk by cause">
          <SectionTitle title="Revenue at risk" hint="By cause" />
          <ul className="mt-5 space-y-1">
            {data.risk.map((r) => {
              const selected = causeId === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggle(setCauseId, causeId, r.id)}
                    aria-pressed={selected}
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected && "bg-foreground/[0.055]",
                    )}
                  >
                    <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
                      <span className="min-w-0 truncate text-sm text-foreground">{r.label}</span>
                      <span className="numeral shrink-0 text-sm font-medium text-foreground">
                        {formatMoneyCompact(r.amount)}
                      </span>
                    </span>
                    <span className="mt-2 block h-px w-full bg-hairline">
                      <span
                        className={cn(
                          "block h-px transition-all duration-300",
                          r.claim === "UNVERIFIED" ? "bg-denied/60" : "bg-foreground/45",
                        )}
                        style={{ width: `${r.share}%` }}
                      />
                    </span>
                  </button>

                  {selected && (
                    <div className="mt-2 border-l-2 border-foreground/20 pl-4">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {RISK_CONTEXT[r.id]}
                      </p>
                      <p className="mt-1.5 flex items-center gap-3">
                        <ClaimBadge state={r.claim} size="sm" />
                        <span className="numeral text-xs text-muted-foreground/80">
                          {formatMoney(r.amount)} · {r.share}% of exposure
                        </span>
                      </p>
                      <div className="mt-3">
                        <InlineAction
                          label="View affected payments"
                          to="/payments"
                          search={{ cause: r.label }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground/80">
                        Demo aggregation — detailed payment records require backend connection.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="surface-panel min-w-0 p-6" aria-label="Policy outcomes">
          <SectionTitle title="Policy outcomes" hint="Last 7 days" />
          <dl className="mt-5 space-y-1">
            {data.policyOutcomes.map((p) => (
              <Link
                key={p.id}
                to="/control-tower"
                search={{ decision: p.label, view: undefined }}
                className="flex items-baseline justify-between gap-4 rounded-md px-2 py-2 transition-colors hover:bg-foreground/[0.04]"
              >
                <dt className="min-w-0 truncate text-sm text-muted-foreground">{p.label}</dt>
                <dd className={cn("numeral text-xl font-semibold", POLICY_TONE[p.tone])}>
                  {formatCount(p.count)}
                </dd>
              </Link>
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
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setActionId(a.id)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 rounded-md px-2 py-3 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{a.action}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground/80">
                      {a.reference} · {a.merchantOrCustomer} · {a.policy}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-4">
                    <span className="numeral text-sm text-foreground">{formatMoney(a.amount)}</span>
                    <ClaimBadge state={a.claim} size="sm" className="w-[86px] justify-end" />
                    <span className="hidden w-16 text-right text-xs text-muted-foreground/80 sm:inline">
                      {timeAgo(a.occurredAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="min-w-0 space-y-10">
          <section aria-label="Exception queue">
            <SectionTitle title="Exception queue" hint={`${data.exceptions.length} open`} />
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {data.exceptions.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setExceptionId(e.id)}
                    className="flex w-full items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_TONE[e.severity])}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug text-foreground">{e.reason}</span>
                      <span className="numeral mt-0.5 block truncate font-mono text-[11px] text-muted-foreground/80">
                        {e.reference} · {formatMoney(e.amount)} ·{" "}
                        <span className="sr-only">severity </span>
                        {e.severity} · waiting {timeAgo(e.waitingSince)}
                      </span>
                    </span>
                  </button>
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

      {/* Investigation drawers */}
      <DetailDrawer
        open={Boolean(action)}
        onOpenChange={(o) => !o && setActionId(null)}
        eyebrow="Governed action"
        title={action?.action ?? ""}
        description="Recorded decision and execution context. This panel does not perform any financial action."
        rows={
          action
            ? [
                { label: "Payment ID", value: <span className="font-mono">{action.reference}</span> },
                { label: "Merchant", value: action.merchantOrCustomer },
                { label: "Amount", value: <span className="numeral">{formatMoney(action.amount)}</span> },
                { label: "Action", value: action.action },
                { label: "Policy decision", value: <span className="font-mono">{action.policy}</span> },
                { label: "Claim state", value: <span className="inline-flex justify-end"><ClaimBadge state={action.claim} size="sm" /></span> },
                { label: "Timestamp", value: new Date(action.occurredAt).toLocaleString("en-IN") },
              ]
            : []
        }
        actions={[
          { label: "View payment", to: "/payments", search: action ? { ref: action.reference } : {} },
          { label: "View Recovery Journey", to: "/recovery-journey" },
        ]}
        footer="Demo aggregation — detailed payment records require backend connection."
      />

      <DetailDrawer
        open={Boolean(exception)}
        onOpenChange={(o) => !o && setExceptionId(null)}
        eyebrow="Exception"
        title={exception?.reason ?? ""}
        description="Open exception awaiting operator review. No remediation is performed from this interface."
        rows={
          exception
            ? [
                { label: "Severity", value: exception.severity },
                { label: "Payment ID", value: <span className="font-mono">{exception.reference}</span> },
                { label: "Amount", value: <span className="numeral">{formatMoney(exception.amount)}</span> },
                { label: "Current state", value: "Open — unresolved" },
                { label: "Waiting", value: timeAgo(exception.waitingSince) },
                {
                  label: "Recommended next step",
                  value: exception.reason.includes("evidence")
                    ? "Attach or locate supporting evidence before any claim."
                    : exception.reason.includes("denial")
                      ? "Review the policy decision and appeal record."
                      : exception.reason.includes("mismatch")
                        ? "Reconcile the ledger entry against gateway settlement."
                        : "Confirm gateway status before claiming any recovery.",
                },
              ]
            : []
        }
        actions={exception ? exceptionActions(exception.reason) : []}
        footer="Demo aggregation — detailed payment records require backend connection."
      />
    </div>
  );
}
