import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { backendConnected, labQueryOptions } from "@/data/services";
import { mapLab } from "@/data/map-lab";
import { formatCount, formatMoneyCompact } from "@/domain/money";
import type { OverviewSnapshot } from "@/domain/types";
import { cn } from "@/lib/utils";

/**
 * The three command-centre panels: what the engine did, what the alternatives
 * would have broken, and what each strategy would have recovered.
 *
 * The counterfactual figures are per-merchant — the lab scores one merchant's
 * batch, not the book — so the heading names the merchant rather than letting
 * a portfolio-wide reading be assumed. That distinction is the difference
 * between a comparison and a claim.
 */

/* ------------------------------------------------------------------ engine */

export function EngineStatus({ data }: { data: OverviewSnapshot }) {
  const failed = data.funnel[0]?.count ?? 0;
  const actedOn = data.policyOutcomes.find((o) => o.id === "acted")?.count ?? 0;
  const awaiting = data.policyOutcomes.find((o) => o.id === "awaiting")?.count ?? 0;
  const attempted = data.funnel.find((f) => f.id === "attempted")?.count ?? 0;
  const converted = data.funnel.find((f) => f.id === "converted")?.count ?? 0;

  const rows: { label: string; value: number; tone?: string }[] = [
    { label: "Payments evaluated", value: failed },
    { label: "Authorised to act", value: actedOn, tone: "text-measured" },
    { label: "Waiting on a person", value: awaiting, tone: "text-projected" },
    { label: "Recovery attempts", value: attempted },
    { label: "Converted", value: converted, tone: "text-measured" },
  ];

  return (
    <section aria-label="Engine status">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Engine status</h2>
        <span className="label-meta text-[10px] tracking-[0.16em]">Committed runs</span>
      </div>
      <dl className="divide-y divide-hairline border-t border-hairline">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-[13px] text-muted-foreground">{r.label}</dt>
            <dd
              className={cn(
                "numeral text-sm tabular-nums",
                r.tone ?? "text-foreground"
              )}
            >
              {formatCount(r.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------- counterfactuals */

/**
 * What the alternatives would have cost.
 *
 * Two panels from one query: the breach count per strategy, and the recovery
 * each would have produced. They belong together — the strategy that recovers
 * most is also the one that breaks the most rules, and separating them would
 * let a reader see the recovery without the price.
 */
export function GovernanceComparison({ merchantId = "cloudsync" }: { merchantId?: string }) {
  const connected = backendConnected();
  const query = useQuery({ ...labQueryOptions(merchantId), enabled: connected });

  if (!connected || query.isPending) {
    return <div className="h-40 animate-pulse rounded-lg border border-hairline" />;
  }
  if (query.error || !query.data) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Counterfactual comparison unavailable.
      </p>
    );
  }

  const lab = query.data;
  const strategies = mapLab(lab);
  const maxRecovery = Math.max(1, ...strategies.map((s) => s.recovery.minor));
  const maxBreach = Math.max(1, ...strategies.map((s) => s.breaches));

  return (
    <div className="grid gap-9 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ------------------------------------------------------- breaches */}
      <section aria-label="Policy breaches">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">Policy breaches</h2>
          <span className="label-meta text-[10px] tracking-[0.16em]">{lab.label}</span>
        </div>
        <ul className="divide-y divide-hairline border-t border-hairline">
          {strategies.map((s) => (
            <li key={s.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                  {s.label}
                </span>
                <span
                  className={cn(
                    "numeral shrink-0 text-sm tabular-nums",
                    s.breaches > 0 ? "text-denied" : "text-measured"
                  )}
                >
                  {formatCount(s.breaches)}
                </span>
              </div>
              <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-hairline">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    s.breaches > 0 ? "bg-denied" : "bg-measured"
                  )}
                  style={{
                    width: `${s.breaches === 0 ? 2 : Math.max(4, (s.breaches / maxBreach) * 100)}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------- recovery vs what it costs */}
      <section aria-label="What governance changes">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">What governance changes</h2>
          <Link
            to="/counterfactual-lab"
            search={{ case: undefined }}
            className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open the lab <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2 xl:grid-cols-4">
          {strategies
            .filter((s) => s.id !== "no_intervention")
            .map((s) => (
              <div key={s.id} className="bg-background px-4 py-3.5">
                <p className="truncate text-[12px] text-muted-foreground" title={s.label}>
                  {s.label}
                </p>
                <p className="numeral mt-1.5 text-lg tabular-nums text-foreground">
                  {formatMoneyCompact(s.recovery)}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-[11px]",
                    s.breaches > 0 ? "text-denied" : "text-measured"
                  )}
                >
                  {formatCount(s.breaches)}{" "}
                  {s.breaches === 1 ? "breach" : "breaches"}
                </p>
                <span className="mt-2 block h-0.5 overflow-hidden rounded-full bg-hairline">
                  <span
                    className="block h-full rounded-full bg-muted-foreground/40"
                    style={{
                      width: `${Math.max(2, (s.recovery.minor / maxRecovery) * 100)}%`,
                    }}
                  />
                </span>
              </div>
            ))}
        </div>
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          {lab.merchant_name} only — the lab scores one merchant's batch, not the book.
          More recovery is not better recovery.
        </p>
      </section>
    </div>
  );
}
