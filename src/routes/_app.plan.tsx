import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleDashed, Play, RotateCcw } from "lucide-react";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { CaseWalk } from "@/components/veritas/case-walk";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { DetailDrawer } from "@/components/veritas/detail-drawer";
import { PageHeader } from "@/components/veritas/page-header";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import { diagnosisFactors, formatEffect } from "@/data/investigate";
import type { JourneyCase, PlanChannel } from "@/domain/journey";
import { formatMoney } from "@/domain/money";
import { usePrefersReducedMotion } from "@/hooks/use-journey-engine";
import { usePolicyRecord } from "@/lib/policy-state";
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
          "What should VERITAS do next? An AI recommendation with projected recovery, cost, eligibility and risk — authorization stays with the Policy Kernel.",
      },
      { property: "og:title", content: "Recovery Plan — VERITAS" },
      {
        property: "og:description",
        content:
          "What should VERITAS do next? An AI recommendation with projected recovery, cost, eligibility and risk — authorization stays with the Policy Kernel.",
      },
    ],
  }),
  component: PlanPage,
});

const BUILD_STEPS = [
  "Reading diagnosis",
  "Evaluating eligible channels",
  "Comparing projected value",
  "Checking constraints",
  "Recommendation ready",
] as const;

function riskLabel(r: PlanChannel["risk"]): string {
  return r.toUpperCase();
}

function eligibilityLabel(c: PlanChannel): string {
  return c.eligible ? "ELIGIBLE" : "NOT ELIGIBLE";
}

/** Deterministic, frontend-only build sequence over existing adapter data. */
function usePlanBuild(caseId: string, reducedMotion: boolean) {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    clear();
    setStep(0);
    setRunning(false);
  }, [caseId, clear]);

  useEffect(() => clear, [clear]);

  const run = useCallback(() => {
    clear();
    if (reducedMotion) {
      setStep(BUILD_STEPS.length);
      setRunning(false);
      return;
    }
    setStep(0);
    setRunning(true);
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= BUILD_STEPS.length) {
        clear();
        setRunning(false);
      }
    }, 380);
  }, [clear, reducedMotion]);

  const reset = useCallback(() => {
    clear();
    setStep(0);
    setRunning(false);
  }, [clear]);

  return { step, running, run, reset, done: step >= BUILD_STEPS.length };
}

function planStates(activeCase: JourneyCase, record: "AUTHORIZED" | "DENIED" | undefined) {
  if (!record) {
    return {
      policy: "PENDING" as const,
      policyTone: "text-muted-foreground",
      execution: "NOT STARTED",
      claim: "PROJECTED" as const,
      claimAmount: null as string | null,
      note: "The Policy Kernel has not evaluated this case in this session.",
    };
  }
  if (record === "DENIED") {
    return {
      policy: "POLICY DENIED" as const,
      policyTone: "text-denied",
      execution: "NOT REACHED",
      claim: "ABSTAINED" as const,
      claimAmount: formatMoney({ currency: "INR", minor: 0 }),
      note: "Policy denied the plan. The plan was not wrong — it was not authorized. Execution was never reached.",
    };
  }
  const exec = activeCase.execution.state === "EXECUTED" ? "PENDING" : activeCase.execution.state;
  const claim = activeCase.claim === "MEASURED" ? "PROJECTED" : activeCase.claim;
  return {
    policy: "POLICY AUTHORIZED" as const,
    policyTone: "text-measured",
    execution: exec,
    claim,
    claimAmount: claim === "PROJECTED" ? null : formatMoney({ currency: "INR", minor: 0 }),
    note:
      exec === "PENDING"
        ? "Authorized by the Policy Kernel. Authorization is not execution — no outcome is measured yet."
        : "Authorized by the Policy Kernel. Execution did not produce a confirmed gateway outcome.",
  };
}

function PlanPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate();
  const { case_: activeCase, isFixture, error } = useJourneyCase(caseId, 1);
  const plan = activeCase.plan;
  const reducedMotion = usePrefersReducedMotion();
  const build = usePlanBuild(activeCase.id, reducedMotion);
  const policyRecord = usePolicyRecord(activeCase.id);
  const state = planStates(activeCase, policyRecord);

  const recommended = plan.channels.find((c) => c.recommended) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<PlanChannel | null>(null);
  useEffect(() => setSelectedId(null), [activeCase.id]);

  const selected =
    plan.channels.find((c) => c.id === selectedId) ?? recommended ?? plan.channels[0] ?? null;
  const factors = diagnosisFactors(activeCase.id);
  const topFactor = factors.find((f) => f.effect !== null) ?? null;

  return (
    <div className="space-y-8">
      <BackendNotice isFixture={isFixture} error={error} what="recovery plan" />

      <PageHeader
        title="Recovery Plan"
        description="What should VERITAS do next?"
        actions={
          <span className="label-meta rounded-md border border-hairline px-2.5 py-1 text-[10px] tracking-[0.16em] text-muted-foreground">
            Demo data
          </span>
        }
      />

      <CaseSwitcher
        activeId={activeCase.id}
        onSelect={(id) => void navigate({ to: "/plan", search: { case: id } })}
      />

      <CaseWalk caseId={activeCase.id} />

      {/* Case context */}
      <section
        aria-label="Case context"
        className="grid gap-x-8 gap-y-3 border-y border-hairline py-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Fact label="Payment ID" value={activeCase.id} mono />
        <Fact label="Merchant" value={activeCase.merchant} />
        <Fact label="Amount" value={formatMoney(activeCase.amount)} mono />
        <Fact label="Failure reason" value={activeCase.failureReason} />
      </section>

      {/* Authority chain */}
      <nav aria-label="Authority chain" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AuthorityStep label="Diagnosis" state="done" />
        <Chevron />
        <AuthorityStep label="Plan" state="current" />
        <Chevron />
        <AuthorityStep label="Policy" state="next" />
        <Chevron />
        <AuthorityStep label="Execution" state="pending" />
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          {/* Primary recommendation */}
          <section aria-labelledby="recommendation-heading" className="border-b border-hairline pb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-meta text-[10px] tracking-[0.16em]">Recommended action</p>
              <div className="flex items-center gap-2">
                <span className="label-meta text-[10px] tracking-[0.16em] text-muted-foreground">
                  Demo analysis
                </span>
                <button
                  type="button"
                  onClick={build.done ? build.reset : build.run}
                  disabled={build.running}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-hairline px-3 text-[12px] transition-colors hover:border-foreground/25 disabled:opacity-60"
                >
                  {build.done ? (
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {build.done ? "Rebuild plan" : build.running ? "Building…" : "Build recovery plan"}
                </button>
              </div>
            </div>

            <h2
              id="recommendation-heading"
              className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {plan.recommended}
            </h2>

            {(build.running || build.done) && (
              <ol className="mt-4 space-y-1.5" aria-live="polite">
                {BUILD_STEPS.map((s, i) => {
                  const complete = build.step > i;
                  return (
                    <li key={s} className="flex items-center gap-2 text-[13px]">
                      {complete ? (
                        <Check className="h-3.5 w-3.5 text-measured" aria-hidden="true" />
                      ) : (
                        <CircleDashed
                          className="h-3.5 w-3.5 text-muted-foreground/60"
                          aria-hidden="true"
                        />
                      )}
                      <span className={complete ? "" : "text-muted-foreground"}>{s}</span>
                      <span className="sr-only">{complete ? "complete" : "pending"}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-5">
              <p className="label-meta text-[10px] tracking-[0.16em]">Why this action?</p>
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                {activeCase.diagnosis.note}
                {topFactor
                  ? ` Top actionable factor: ${topFactor.label} ${formatEffect(topFactor)}.`
                  : " No factor attribution is available for this case."}
              </p>
            </div>

            {/* Status rail */}
            <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Status label="AI recommendation" value="RECOMMENDED" />
              <Status label="Policy status" value={state.policy} tone={state.policyTone} />
              <Status label="Execution" value={state.execution} />
              <Status
                label="Claim"
                value={state.claimAmount ? `${state.claim} ${state.claimAmount}` : state.claim}
              />
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">{state.note}</p>

            {recommended && (
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Value label="Projected recovery" value={formatMoney(recommended.expected)} strong />
                <Value label="Projected cost" value={formatMoney(recommended.cost)} />
                <Value label="Projected net" value={formatMoney(recommended.net)} />
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                to="/policy"
                search={{ case: activeCase.id }}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-foreground/40 px-3.5 text-[13px] transition-colors hover:bg-foreground/5"
              >
                Send to policy
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <span className="text-xs text-muted-foreground">
                Sends the recommendation for authorization. It does not execute anything.
              </span>
            </div>
          </section>

          {/* Channel comparison */}
          <section aria-labelledby="channels-heading" className="space-y-3">
            <div>
              <h3 id="channels-heading" className="text-sm font-semibold tracking-tight">
                Strategy comparison
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Every expected, cost and net value is PROJECTED. {plan.note}
              </p>
            </div>

            <div className="hidden grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_90px_110px] gap-3 border-b border-hairline pb-2 sm:grid">
              {[
                "Strategy",
                "Projected recovery",
                "Cost",
                "Projected net",
                "Risk",
                "Eligibility",
              ].map((h) => (
                <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
                  {h}
                </span>
              ))}
            </div>

            <ul className="divide-y divide-hairline">
              {plan.channels.map((c) => {
                const isSelected = selected?.id === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      onDoubleClick={() => setDrawer(c)}
                      aria-pressed={isSelected}
                      aria-label={`${c.label} — projected recovery ${formatMoney(c.expected)}, ${eligibilityLabel(c)}, risk ${riskLabel(c.risk)}`}
                      className={cn(
                        "grid w-full grid-cols-2 gap-2 border-l-2 py-3 pl-3 text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_90px_110px] sm:items-baseline sm:gap-3",
                        isSelected ? "border-l-foreground bg-muted/25" : "border-l-transparent",
                      )}
                    >
                      <span className="col-span-2 flex flex-wrap items-center gap-2 text-[13px] font-medium sm:col-span-1">
                        {c.label}
                        {c.recommended && (
                          <span className="label-meta text-[9px] tracking-[0.14em] text-projected">
                            Recommended
                          </span>
                        )}
                        {isSelected && (
                          <span className="label-meta text-[9px] tracking-[0.14em] text-muted-foreground">
                            Selected
                          </span>
                        )}
                      </span>
                      <Cell head="Projected recovery" value={formatMoney(c.expected)} />
                      <Cell head="Cost" value={formatMoney(c.cost)} />
                      <Cell head="Projected net" value={formatMoney(c.net)} />
                      <Cell head="Risk" value={riskLabel(c.risk)} plain />
                      <Cell head="Eligibility" value={eligibilityLabel(c)} plain />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Why this strategy */}
          {selected && (
            <section
              aria-labelledby="why-heading"
              className="rounded-lg border border-hairline p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="why-heading" className="text-sm font-semibold tracking-tight">
                  Why {selected.label.toLowerCase()}?
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawer(selected)}
                  className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Full strategy detail
                </button>
              </div>
              <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <Fact label="Diagnosis" value={activeCase.failureReason} />
                <Fact
                  label="Top actionable factor"
                  value={topFactor ? `${topFactor.label} ${formatEffect(topFactor)}` : "NOT AVAILABLE"}
                />
                <Fact
                  label="Observed success gap"
                  value={`+${activeCase.diagnosis.gapPts.toFixed(2)} pts`}
                />
                <Fact
                  label="Recommendation"
                  value={selected.recommended ? plan.recommended : `${selected.label} — alternative`}
                />
                <Fact label="Projected net" value={formatMoney(selected.net)} mono />
                <Fact label="Eligibility" value={eligibilityLabel(selected)} />
                <Fact label="Risk" value={riskLabel(selected.risk)} />
                <Fact
                  label="Authority"
                  value={state.policy === "PENDING" ? "PENDING POLICY" : state.policy}
                />
              </dl>
            </section>
          )}

          {/* Projected vs measured */}
          <section className="rounded-lg border border-hairline p-5">
            <p className="label-meta text-[10px] tracking-[0.16em]">Projected vs measured</p>
            <dl className="mt-2 space-y-2 text-sm text-muted-foreground">
              <div>
                <dt className="inline font-medium text-foreground">PROJECTED — </dt>
                <dd className="inline">
                  modelled recovery if the authorized plan executes successfully.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">MEASURED — </dt>
                <dd className="inline">
                  only appears once an actual measured outcome exists. No amount on this page is
                  recovered money.
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="space-y-6 lg:border-l lg:border-hairline lg:pl-6">
          <section>
            <p className="label-meta text-[10px] tracking-[0.16em]">Selected strategy</p>
            <dl className="mt-2 divide-y divide-hairline text-sm">
              <Row label="Action" value={selected?.label ?? "NOT AVAILABLE"} />
              <Row
                label="Projected recovery"
                value={selected ? formatMoney(selected.expected) : "NOT AVAILABLE"}
                mono
              />
              <Row
                label="Projected cost"
                value={selected ? formatMoney(selected.cost) : "NOT AVAILABLE"}
                mono
              />
              <Row
                label="Projected net"
                value={selected ? formatMoney(selected.net) : "NOT AVAILABLE"}
                mono
              />
              <Row label="Eligibility" value={selected ? eligibilityLabel(selected) : "UNKNOWN"} />
              <Row label="Risk" value={selected ? riskLabel(selected.risk) : "NOT AVAILABLE"} />
              <Row label="Claim" value="PROJECTED" />
            </dl>
            <div className="mt-3">
              <ClaimBadge state="PROJECTED" />
            </div>
          </section>

          <section>
            <p className="label-meta text-[10px] tracking-[0.16em]">Risk</p>
            <dl className="mt-2 divide-y divide-hairline text-sm">
              <Row label="Policy risk" value={state.policy === "PENDING" ? "PENDING POLICY" : state.policy} />
              <Row label="Execution risk" value={selected ? riskLabel(selected.risk) : "NOT AVAILABLE"} />
              <Row
                label="Channel eligibility"
                value={selected ? eligibilityLabel(selected) : "UNKNOWN"}
              />
              <Row label="Customer fatigue" value="NOT AVAILABLE" />
            </dl>
          </section>

          <nav aria-label="Operator actions" className="flex flex-col gap-2">
            <p className="label-meta text-[10px] tracking-[0.16em]">Operator actions</p>
            <ContextLink to="/diagnosis" caseId={activeCase.id} label="Open diagnosis" />
            <ContextLink to="/policy" caseId={activeCase.id} label="Send to policy" />
            <ContextLink to="/recovery-journey" caseId={activeCase.id} label="Open recovery journey" />
            <Link
              to="/payment/$paymentId"
              params={{ paymentId: activeCase.id }}
              className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              Open payment
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </nav>
        </aside>
      </div>

      <DetailDrawer
        open={drawer !== null}
        onOpenChange={(o) => !o && setDrawer(null)}
        eyebrow="Recovery strategy — AI recommendation"
        title={drawer?.label ?? ""}
        description={
          drawer?.recommended
            ? "Recommended by the agent for this diagnosis. Recommendation is not authorization."
            : "Alternative strategy considered for this diagnosis."
        }
        rows={
          drawer
            ? [
                {
                  label: "Projected recovery",
                  value: `${formatMoney(drawer.expected)} · PROJECTED`,
                },
                { label: "Projected cost", value: `${formatMoney(drawer.cost)} · PROJECTED` },
                { label: "Projected net", value: `${formatMoney(drawer.net)} · PROJECTED` },
                { label: "Risk", value: riskLabel(drawer.risk) },
                { label: "Eligibility", value: eligibilityLabel(drawer) },
                { label: "Authority", value: "Policy Kernel decides" },
              ]
            : []
        }
      />
    </div>
  );
}

function Chevron() {
  return <span aria-hidden="true" className="text-muted-foreground/60">→</span>;
}

function AuthorityStep({
  label,
  state,
}: {
  label: string;
  state: "done" | "current" | "next" | "pending";
}) {
  const tag =
    state === "done" ? "✓" : state === "current" ? "CURRENT" : state === "next" ? "NEXT" : "PENDING";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5",
        state === "current" ? "border-foreground/40" : "border-hairline",
      )}
    >
      <span
        className={cn(
          "label-meta text-[10px] tracking-[0.16em]",
          state === "current" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="label-meta text-[9px] tracking-[0.14em] text-muted-foreground">{tag}</span>
    </span>
  );
}

function Status({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="label-meta text-[10px] tracking-[0.14em]">{label}</dt>
      <dd className={cn("mt-1 text-[13px] font-medium tracking-tight", tone)}>{value}</dd>
    </div>
  );
}

function Value({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-md border px-4 py-3", strong ? "border-projected/40" : "border-hairline")}>
      <p
        className={cn(
          "label-meta text-[10px] tracking-[0.16em]",
          strong ? "text-projected" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className={cn("numeral mt-1 tabular-nums", strong ? "text-2xl" : "text-lg")}>{value}</p>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label-meta text-[10px] tracking-[0.14em]">{label}</dt>
      <dd className={cn("mt-1 break-words text-[13px]", mono && "numeral tabular-nums")}>{value}</dd>
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
      <dd className={cn("min-w-0 break-words text-right", mono && "numeral tabular-nums")}>
        {value}
      </dd>
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
