import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { DetailDrawer } from "@/components/veritas/detail-drawer";
import { PageHeader } from "@/components/veritas/page-header";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import {
  COMPARISON_STEPS,
  COUNTERFACTUAL_DISCLAIMER,
  OPTIMIZATION_STATEMENT,
  bestGovernedRecovery,
  findStrategy,
  highestRawRecovery,
  lowestBreaches,
  type Strategy,
} from "@/data/investigate";
import { useStrategies } from "@/hooks/use-strategies";
import { formatMoney } from "@/domain/money";
import { usePrefersReducedMotion } from "@/hooks/use-journey-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/counterfactual-lab")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Counterfactual Lab — VERITAS" },
      {
        name: "description",
        content:
          "What if we optimized only for recovery? Compare recovery strategies against the same governed payment population.",
      },
      { property: "og:title", content: "Counterfactual Lab — VERITAS" },
      {
        property: "og:description",
        content:
          "What if we optimized only for recovery? Compare recovery strategies against the same governed payment population.",
      },
    ],
  }),
  component: CounterfactualLabPage,
});

const CONTROL =
  "inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40";

type ViewMode = "recovery" | "net" | "breaches";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "recovery", label: "Recovery" },
  { id: "net", label: "Net value" },
  { id: "breaches", label: "Breaches" },
];

function metricOf(s: Strategy, view: ViewMode): number {
  if (view === "recovery") return s.recovery.minor;
  if (view === "net") return s.net.minor;
  return s.breaches;
}

function metricLabel(s: Strategy, view: ViewMode): string {
  if (view === "recovery") return formatMoney(s.recovery);
  if (view === "net") return formatMoney(s.net);
  return `${s.breaches}`;
}

function CounterfactualLabPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate();
  const { case_: activeCase, isFixture, error } = useJourneyCase(caseId, 1);
  const { strategies, sourceLabel } = useStrategies(activeCase.id);
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(0);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("doctor-merchant");
  const [compareId, setCompareId] = useState<string>("naive");
  const [view, setView] = useState<ViewMode>("recovery");
  const [breachOpen, setBreachOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const selected = findStrategy(selectedId, strategies);
  const compare = findStrategy(compareId, strategies);
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
    }, 400);
  }, [clear, reduced, total]);

  const reset = useCallback(() => {
    clear();
    setRevealed(0);
    setRunning(false);
  }, [clear]);

  // Replay on arrival and whenever the payment changes. The comparison is
  // computed from committed runs, not now -- but a table of results already
  // sitting there reads as a slide, and the order the strategies are eliminated
  // in is the argument.
  const runRef = useRef<(() => void) | null>(null);
  runRef.current = run;
  useEffect(() => {
    clear();
    setRevealed(0);
    setRunning(false);
    const id = window.setTimeout(() => runRef.current?.(), 350);
    return () => window.clearTimeout(id);
  }, [activeCase.id, clear]);

  const evaluated = useMemo(() => {
    const done = new Set<string>();
    COMPARISON_STEPS.slice(0, revealed).forEach((s) => {
      if (s.strategyId) done.add(s.strategyId);
    });
    return done;
  }, [revealed]);

  const maxMetric = Math.max(1, ...strategies.map((s) => metricOf(s, view)));
  const maxBreach = Math.max(...strategies.map((s) => s.breaches), 1);
  const rawWinner = highestRawRecovery(strategies);
  const governedWinner = bestGovernedRecovery(strategies);
  const cleanest = lowestBreaches(strategies);

  const diff = (a: number, b: number) => {
    const d = a - b;
    return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}`;
  };

  return (
    <div className="space-y-8">
      <BackendNotice isFixture={isFixture} error={error} what="counterfactual evaluation" />

      <PageHeader
        title="Counterfactual Lab"
        description="What if we optimized only for recovery?"
        actions={<ClaimBadge state="PROJECTED" />}
      />

      <p className="max-w-3xl text-sm text-muted-foreground">
        Compare recovery strategies against the same governed payment population. {COUNTERFACTUAL_DISCLAIMER}
      </p>

      {/* Experiment header */}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-5">
        <div>
          <p className="label-meta text-[10px] tracking-[0.16em]">Experiment</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Recovery strategy comparison</h2>
          <p className="mt-1 text-xs text-muted-foreground">
              {sourceLabel} — comparison of recovery strategies over the same
              governed population. No experiment is executed and no money moves.
            
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={running}
            aria-label="Run strategy comparison"
            className={cn(CONTROL, "disabled:opacity-50")}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Run comparison
          </button>
          <button type="button" onClick={reset} aria-label="Reset comparison" className={CONTROL}>
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
              key={s.label}
              className={cn(
                "flex items-center gap-2 text-[13px]",
                done ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {done ? <Check className="h-3.5 w-3.5 text-measured" aria-hidden="true" /> : "·"}
              </span>
              <span className="label-meta text-[10px] tracking-[0.14em]">{s.label}</span>
            </div>
          );
        })}
        {!ready && !running && (
          <p className="pt-1 text-xs text-muted-foreground">Run the comparison to reveal the results.</p>
        )}
      </section>

      {ready && (
        <>
          {/* Experiment result */}
          <section
            aria-label="Comparison result"
            className="grid gap-4 border-y border-hairline py-5 sm:grid-cols-3"
          >
            <Summary label="Highest raw recovery" strategy={rawWinner} tone="warn" />
            <Summary label="Best governed recovery" strategy={governedWinner} tone="good" />
            <Summary label="Lowest breaches" strategy={cleanest} tone="good" />
          </section>

          <p className="max-w-3xl border-l-2 border-foreground/30 pl-4 text-sm text-foreground">
            <span className="label-meta mr-2 text-[10px] tracking-[0.16em]">
              More recovery ≠ better recovery
            </span>
            {OPTIMIZATION_STATEMENT}
          </p>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Comparison */}
            <section aria-labelledby="cmp-heading" className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id="cmp-heading" className="text-sm font-semibold tracking-tight">
                  Recovery versus governance
                </h3>
                <div role="group" aria-label="Primary view" className="flex items-center gap-1">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={view === v.id}
                      onClick={() => setView(v.id)}
                      className={cn(
                        "inline-flex h-8 items-center rounded-md border px-3 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
                        view === v.id
                          ? "border-foreground/40 text-foreground"
                          : "border-hairline text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                      )}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="hidden grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))_130px] gap-3 border-b border-hairline pb-2 sm:grid">
                {["Strategy", "Recovery", "Net value", "Policy breaches"].map((h) => (
                  <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
                    {h}
                  </span>
                ))}
              </div>

              <ul className="divide-y divide-hairline">
                {strategies.map((s) => {
                  const active = s.id === selectedId;
                  const breached = s.breaches > 0;
                  const isCompare = s.id === compareId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-label={`Select ${s.label}: ${formatMoney(s.recovery)} projected recovery, ${s.breaches} policy breaches`}
                        onClick={() => setSelectedId(s.id)}
                        className={cn(
                          "w-full space-y-2 py-3 text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
                          active && "bg-muted/20",
                        )}
                      >
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))_130px] sm:items-baseline sm:gap-3">
                          <span className="col-span-2 flex items-center gap-2 text-[13px] font-medium sm:col-span-1">
                            {s.label}
                            <span
                              className={cn(
                                "label-meta text-[9px] tracking-[0.14em]",
                                evaluated.has(s.id) ? "text-measured" : "text-muted-foreground/60",
                              )}
                            >
                              {evaluated.has(s.id) ? "Evaluated" : "Pending"}
                            </span>
                            {isCompare && !active && (
                              <span className="label-meta text-[9px] tracking-[0.14em] text-muted-foreground">
                                vs
                              </span>
                            )}
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
                              {s.breaches} policy breaches
                            </span>
                          </span>
                        </div>

                        {/* Primary metric bar + breach bar */}
                        <div className="grid gap-1">
                          <span className="flex items-center gap-2">
                            <span className="label-meta w-16 text-[9px] tracking-[0.14em]">
                              {VIEWS.find((v) => v.id === view)?.label}
                            </span>
                            <span className="h-1.5 w-full rounded-sm bg-muted/40">
                              <span
                                className={cn(
                                  "block h-1.5 rounded-sm transition-[width] duration-500",
                                  view === "breaches" ? "bg-denied/70" : "bg-projected/70",
                                )}
                                style={{ width: `${(metricOf(s, view) / maxMetric) * 100}%` }}
                              />
                            </span>
                            <span className="numeral w-24 shrink-0 text-right text-[12px] tabular-nums">
                              {metricLabel(s, view)}
                            </span>
                          </span>
                          {view !== "breaches" && (
                            <span className="flex items-center gap-2">
                              <span className="label-meta w-16 text-[9px] tracking-[0.14em]">Breaches</span>
                              <span className="h-1.5 w-full rounded-sm bg-muted/40">
                                <span
                                  className="block h-1.5 rounded-sm bg-denied/70 transition-[width] duration-500"
                                  style={{ width: `${(s.breaches / maxBreach) * 100}%` }}
                                />
                              </span>
                              <span className="numeral w-24 shrink-0 text-right text-[12px] tabular-nums">
                                {s.breaches}
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          {breached ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-denied" aria-hidden="true" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5 text-measured" aria-hidden="true" />
                          )}
                          <span className={breached ? "text-denied" : "text-muted-foreground"}>
                            {breached ? `High recovery but governance breaches — ${s.governance}` : s.governance}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Direct comparison */}
              <section aria-label="Direct comparison" className="space-y-2 border-t border-hairline pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label-meta text-[10px] tracking-[0.16em]">Compare {selected.label} versus</span>
                  {strategies.filter((s) => s.id !== selectedId).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={s.id === compareId}
                      onClick={() => setCompareId(s.id)}
                      className={cn(
                        "inline-flex h-8 items-center rounded-md border px-3 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
                        s.id === compareId
                          ? "border-foreground/40 text-foreground"
                          : "border-hairline text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {compare.id !== selected.id && (
                  <dl className="grid gap-2 sm:grid-cols-3">
                    <Delta
                      label="Recovery difference"
                      value={`${formatMoney(selected.recovery)} vs ${formatMoney(compare.recovery)}`}
                    />
                    <Delta
                      label="Net value difference"
                      value={`${formatMoney(selected.net)} vs ${formatMoney(compare.net)}`}
                    />
                    <Delta
                      label="Breach difference"
                      value={`${selected.breaches} vs ${compare.breaches} (${diff(selected.breaches, compare.breaches)})`}
                    />
                  </dl>
                )}
              </section>

              <p className="text-xs text-muted-foreground">
                All recovery and net values are PROJECTED / COUNTERFACTUAL over the demo population. A
                strategy with breaches is outside the authority boundary regardless of how much it models.
              </p>
            </section>

            {/* Strategy detail */}
            <aside className="space-y-6 lg:border-l lg:border-hairline lg:pl-6">
              <section>
                <p className="label-meta text-[10px] tracking-[0.16em]">Selected strategy</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight">{selected.label}</h3>
                {selected.id === governedWinner.id && (
                  <p className="label-meta mt-1 text-[10px] tracking-[0.16em] text-measured">
                    Best governed counterfactual
                  </p>
                )}
                <dl className="mt-3 divide-y divide-hairline text-sm">
                  <Row label="Expected recovery" value={`${formatMoney(selected.recovery)} · PROJECTED`} />
                  <Row label="Cost" value={`${formatMoney(selected.cost)} · PROJECTED`} />
                  <Row label="Net value" value={`${formatMoney(selected.net)} · PROJECTED`} />
                  <Row label="Policy breaches" value={`${selected.breaches}`} />
                  <Row label="Governance status" value={selected.governance} />
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">
                  <span className="label-meta mr-2 text-[10px] tracking-[0.16em]">Why it differs</span>
                  {selected.difference}
                </p>
              </section>

              <button
                type="button"
                onClick={() => setBreachOpen(true)}
                aria-label={`Open breach detail for ${selected.label}`}
                className={cn(
                  "w-full rounded-md border p-4 text-left transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
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
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.breaches > 0 ? "Open breach detail" : "No policy breach in this model"}
                </p>
              </button>

              <CaseSwitcher
                activeId={activeCase.id}
                label="Journey context"
                onSelect={(id) => void navigate({ to: "/counterfactual-lab", search: { case: id } })}
              />

              <nav aria-label="Related workspaces" className="flex flex-col gap-2">
                <Link
                  to="/policy"
                  search={{ case: activeCase.id }}
                  className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                >
                  View policy
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <Link
                  to="/recovery-journey"
                  search={{ case: activeCase.id }}
                  className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                >
                  View recovery journey
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </nav>
            </aside>
          </div>
        </>
      )}

      <DetailDrawer
        open={breachOpen}
        onOpenChange={setBreachOpen}
        eyebrow="Policy breaches"
        title={`${selected.breaches} breaches — ${selected.label}`}
        description={
          selected.breaches > 0
            ? "Modelled violations of the authority boundary under this counterfactual strategy."
            : "This strategy acts only where the Policy Kernel authorizes."
        }
        rows={[
          { label: "Total breaches", value: `${selected.breaches}` },
          { label: "Governance", value: selected.governance },
          ...(selected.breachBreakdown
            ? selected.breachBreakdown.map((b) => ({ label: b.label, value: `${b.count}` }))
            : [
                {
                  label: "Breakdown",
                  value: selected.breaches > 0 ? "NOT AVAILABLE in demo data" : "No breaches",
                },
              ]),
        ]}
        actions={[{ label: "View policy", to: "/policy", search: { case: activeCase.id } }]}
        footer={COUNTERFACTUAL_DISCLAIMER}
      />
    </div>
  );
}

function Summary({
  label,
  strategy,
  tone,
}: {
  label: string;
  strategy: Strategy;
  tone: "good" | "warn";
}) {
  return (
    <div>
      <p className="label-meta text-[10px] tracking-[0.16em]">{label}</p>
      <p className="mt-1 text-sm font-medium">{strategy.label}</p>
      <p className="numeral mt-0.5 text-lg tabular-nums">{formatMoney(strategy.recovery)}</p>
      <p
        className={cn(
          "mt-0.5 text-xs",
          tone === "warn" && strategy.breaches > 0 ? "text-denied" : "text-muted-foreground",
        )}
      >
        {strategy.breaches} policy breaches · PROJECTED / COUNTERFACTUAL
      </p>
    </div>
  );
}

function Delta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline p-3">
      <dt className="label-meta text-[10px] tracking-[0.14em]">{label}</dt>
      <dd className="numeral mt-1 text-[13px] tabular-nums">{value}</dd>
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
