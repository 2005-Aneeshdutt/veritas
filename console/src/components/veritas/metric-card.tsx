import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { ClaimBadge } from "./claim-badge";
import { formatMoney, formatMoneyCompact } from "@/domain/money";
import type { HeadlineMetric } from "@/domain/types";
import { cn } from "@/lib/utils";

const CLAIM_ACCENT: Record<string, string> = {
  MEASURED: "text-measured",
  PROJECTED: "text-projected",
  OBSERVED: "text-observed",
  VERIFIED: "text-verified",
  UNVERIFIED: "text-denied",
  ABSTAINED: "text-muted-foreground",
};

const CLAIM_RAIL: Record<string, string> = {
  MEASURED: "bg-measured",
  PROJECTED: "bg-projected",
  OBSERVED: "bg-observed",
  VERIFIED: "bg-verified",
  UNVERIFIED: "bg-denied",
  ABSTAINED: "bg-muted-foreground",
};

export function MetricCard({ metric }: { metric: HeadlineMetric }) {
  const projected = metric.claim === "PROJECTED";
  const display = metric.displayOverride ?? formatMoney(metric.value);
  const Delta = (metric.deltaPct ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <article className="surface-panel relative overflow-hidden p-5">
      <span
        aria-hidden="true"
        className={cn("absolute inset-x-0 top-0 h-px", CLAIM_RAIL[metric.claim])}
      />
      <div className="flex items-start justify-between gap-3">
        <h3 className="label-meta">{metric.label}</h3>
        <ClaimBadge state={metric.claim} size="sm" />
      </div>

      <p
        className={cn(
          "numeral mt-3 text-3xl font-semibold lg:text-[34px]",
          projected ? "text-projected" : "text-foreground",
          projected && "[font-variant-numeric:tabular-nums]",
        )}
      >
        {projected && (
          <span className="mr-1 align-middle text-xl font-normal text-projected/70">~</span>
        )}
        {display}
      </p>

      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className={cn("font-medium", CLAIM_ACCENT[metric.claim])}>
          {projected ? "Projected — not yet recovered" : metric.claim.toLowerCase()}
        </span>
        {metric.deltaPct !== undefined && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <Delta className="h-3 w-3" aria-hidden="true" />
            {Math.abs(metric.deltaPct).toFixed(1)}% vs last week
          </span>
        )}
      </div>

      <p className="mt-3 border-t border-hairline pt-3 text-xs text-muted-foreground">
        {metric.note}
      </p>
      {metric.displayOverride && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          Exact: {formatMoney(metric.value)}
        </p>
      )}
      {!metric.displayOverride && metric.value.minor / 100 >= 100000 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          Compact: {formatMoneyCompact(metric.value)}
        </p>
      )}
    </article>
  );
}
