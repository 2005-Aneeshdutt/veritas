import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { PageHeader } from "@/components/veritas/page-header";
import {
  COMPARISON_STEPS,
  OPTIMIZATION_STATEMENT,
  STRATEGIES,
  findStrategy,
} from "@/data/investigate";
import { formatMoney } from "@/domain/money";
import { usePrefersReducedMotion } from "@/hooks/use-journey-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/counterfactual-lab")({
  head: () => ({
    meta: [
      { title: "Counterfactual Lab — VERITAS" },
      {
        name: "description",
        content:
          "What if we optimized only for recovery? Compare strategies on projected recovery, net value and policy breaches.",
      },
      { property: "og:title", content: "Counterfactual Lab — VERITAS" },
      {
        property: "og:description",
        content:
          "What if we optimized only for recovery? Compare strategies on projected recovery, net value and policy breaches.",
      },
    ],
  }),
  component: CounterfactualLabPage,
});

const CONTROL =
  "inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] transition-colors hover:border-foreground/25";

function CounterfactualLabPage() {
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(0);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("doctor");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const selected = findStrategy(selectedId);
  const total = COMPARISON_STEPS.length;
  const ready = revealed >= total;

  const clear = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const run = useCallback(() => {
    clear();
    if (reduced) {
      setRevealed(total);
      setRunning(false);
      return;
    }
    setRevealed(0);
    setRunning(true);
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= total) {
        clear();
        setRunning(false);
      }
    }, 420);
  }, [clear, reduced, total]);

  const reset = useCallback(() => {
    clear();
    setRevealed(0);
    setRunning(false);
  }, [clear]);

  const maxRecovery = Math.max(...STRATEGIES.map((s) => s.recovery.minor));
  const maxBreach = Math.max(...STRATEGIES.map((s) => s.breaches), 1);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Counterfactual Lab"
        description="What if we optimized only for recovery?"
        actions={<ClaimBadge state="PROJECTED" />}
      />

      {/* Experiment header */}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-5">
        <div>
          <p className="label-meta text-[10px] tracking-[0.16em]">Strategy comparison</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            Five strategies over the same demo cohort
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            DEMO ANALYSIS — frontend comparison of existing demo adapter values. No experiment is
            executed and no money moves.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={run} disabled={running} className={cn(CONTROL, "disabled:opacity-50")}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Run comparison
          </button>
          <button type="button" onClick={reset} className={CONTROL}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>
      </section>

      {/* Run sequence */}
      <section aria-live="polite" className="space-y-1.5">
        {COMPARISON_STEPS.map((s, i) => {
          const done = i < revealed;
          return (
            <div
              key={s}
              className={cn(
                "flex items-center gap-2 text-[13px]",
                done ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {done ? <Check className="h-3.5 w-3.5 text-measured" aria-hidden="true" /> : "·"}
              </span>
              <span className="label-meta text-[10px] tracking-[0.14em]">{s}</span>
            </div>
          );
        })}
        {!ready && !running && (
          <p className="pt-1 text-xs text-muted-foreground">
            Run the comparison to reveal the results.
          </p>
        )}
      </section>

      {ready && (
        <>
          <p className="max-w-3xl border-l-2 border-foreground/30 pl-4 text-sm text-foreground">
            {OPTIMIZATION_STATEMENT}
          </p>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Comparison */}
            <section aria-labelledby="cmp-heading" className="min-w-0 space-y-3">
              <h3 id="cmp-heading" className="text-sm font-semibold tracking-tight">
                Recovery versus governance
              </h3>
              <div className="hidden grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))_120px] gap-3 border-b border-hairline pb-2 sm:grid">
                {["Strategy", "Recovery", "Net value", "Policy breaches"].map((h) => (
                  <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
                    {h}
                  </span>
                ))}
              </div>
              <ul className="divide-y divide-hairline">
                {STRATEGIES.map((s) => {
                  const active = s.id === selectedId;
                  const breached = s.breaches > 0;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedId(s.id)}
                        className={cn(
                          "w-full space-y-2 py-3 text-left transition-colors hover:bg-muted/20",
                          active && "bg-muted/20",
                        )}
                      >
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))_120px] sm:items-baseline sm:gap-3">
                          <span className="col-span-2 text-[13px] font-medium sm:col-span-1">
                            {s.label}
                          </span>
                          <Cell head="Recovery" value={formatMoney(s.recovery)} />
                          <Cell head="Net value" value={formatMoney(s.net)} />
                          <span className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
                            <span className="label-meta text-[10px] tracking-[0.14em] sm:hidden">
                              Breaches
                            </span>
                            <span
                              className={cn(
                                "numeral text-[13px] tabular-nums",
                                breached ? "text-denied" : "text-measured",
                              )}
                            >
                              {s.breaches} {breached ? "breaches" : "breaches"}
                            </span>
                          </span>
                        </div>
                        {/* Recovery bar + breach bar */}
                        <div className="grid gap-1">
                          <span className="flex items-center gap-2">
                            <span className="label-meta w-16 text-[9px] tracking-[0.14em]">Recovery</span>
                            <span className="h-1.5 w-full rounded-sm bg-muted/40">
                              <span
                                className="block h-1.5 rounded-sm bg-projected/70"
                                style={{
                                  width: `${maxRecovery ? (s.recovery.minor / maxRecovery) * 100 : 0}%`,
                                }}
                              />
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="label-meta w-16 text-[9px] tracking-[0.14em]">Breaches</span>
                            <span className="h-1.5 w-full rounded-sm bg-muted/40">
                              <span
                                className="block h-1.5 rounded-sm bg-denied/70"
                                style={{ width: `${(s.breaches / maxBreach) * 100}%` }}
                              />
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {breached ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-denied" aria-hidden="true" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5 text-measured" aria-hidden="true" />
                          )}
                          <span className={breached ? "text-denied" : "text-muted-foreground"}>
                            {s.governance}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                All recovery and net values are PROJECTED over the demo cohort. A strategy with
                breaches is outside the authority boundary regardless of how much it recovers.
              </p>
            </section>

            {/* Experiment detail */}
            <aside className="space-y-6 lg:border-l lg:border-hairline lg:pl-6">
              <section>
                <p className="label-meta text-[10px] tracking-[0.16em]">Selected strategy</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight">{selected.label}</h3>
                <dl className="mt-3 divide-y divide-hairline text-sm">
                  <Row label="Expected recovery" value={`${formatMoney(selected.recovery)} · PROJECTED`} />
                  <Row label="Cost" value={`${formatMoney(selected.cost)} · PROJECTED`} />
                  <Row label="Net value" value={`${formatMoney(selected.net)} · PROJECTED`} />
                  <Row label="Policy breaches" value={`${selected.breaches}`} />
                  <Row label="Governance" value={selected.governance} />
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">{selected.difference}</p>
              </section>

              <div
                className={cn(
                  "rounded-md border p-4",
                  selected.breaches > 0 ? "border-denied/40" : "border-hairline",
                )}
              >
                <p className="label-meta text-[10px] tracking-[0.16em]">
                  {selected.breaches > 0 ? "Policy breaches" : "Within authority"}
                </p>
                <p
                  className={cn(
                    "numeral mt-1 text-3xl tabular-nums",
                    selected.breaches > 0 ? "text-denied" : "text-measured",
                  )}
                >
                  {selected.breaches}
                </p>
              </div>

              <nav aria-label="Related workspaces" className="flex flex-col gap-2">
                <Link
                  to="/policy"
                  search={{ case: undefined }}
                  className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                >
                  {selected.breaches > 0 ? "View breaches in policy" : "Open policy"}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <Link
                  to="/recovery-journey"
                  search={{ case: undefined }}
                  className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                >
                  Open recovery journey
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </nav>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ head, value }: { head: string; value: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
      <span className="label-meta text-[10px] tracking-[0.14em] sm:hidden">{head}</span>
      <span className="numeral text-[13px] tabular-nums">{value}</span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 py-2">
      <dt className="label-meta w-32 shrink-0 text-[10px] tracking-[0.14em]">{label}</dt>
      <dd className="min-w-0 break-words text-right">{value}</dd>
    </div>
  );
}
