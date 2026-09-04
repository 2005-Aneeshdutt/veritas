import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight } from "lucide-react";
import { casesQueryOptions, overviewQueryOptions } from "@/data/services";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { RecoveryFlow } from "@/components/veritas/recovery-flow";
import { Reconciliation } from "@/components/veritas/reconciliation";
import { EngineRun } from "@/components/veritas/engine-run";
import {
  CenterHeader,
  CurrentActivity,
  EngineStatusPanel,
  GovernanceStrip,
  GovernedActionsTable,
  PolicyBreaches,
  PolicyDecisions,
  ProofHealthPanel,
} from "@/components/veritas/command-center";
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
    heading: "Measured recovery — ledger reconciled",
    body: "Retries the engine executed, reconciled to the ledger and marked against an outcome it never saw. Gateway confirmation is tracked separately and is not claimed here.",
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

  return (
    <div className="space-y-4">
      <CenterHeader data={data} />

      <Reconciliation />

      {/* row 1 — the flow, with the engine rail beside it */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="min-w-0 space-y-4">
          <RecoveryFlow
            stages={data.funnel.map((f) => ({ key: f.id, label: f.label, count: f.count }))}
            branches={data.policyOutcomes.map((o) => ({
              key: o.id,
              label: o.label,
              count: o.count,
              tone:
                o.tone === "allowed"
                  ? ("measured" as const)
                  : o.tone === "denied"
                    ? ("denied" as const)
                    : o.tone === "conditional"
                      ? ("projected" as const)
                      : ("muted" as const),
            }))}
          />
          <EngineRun />
        </div>
        <div className="space-y-4">
          <EngineStatusPanel data={data} />
          <CurrentActivity />
        </div>
      </div>

      {/* row 2 — what was done, how it was decided, and what it cost */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,260px)_minmax(0,300px)]">
        <GovernedActionsTable data={data} />
        <PolicyDecisions data={data} />
        <div className="space-y-4">
          <PolicyBreaches />
          <ProofHealthPanel data={data} />
        </div>
      </div>

      {/* row 3 — the counterfactual */}
      <GovernanceStrip />
    </div>
  );
}
