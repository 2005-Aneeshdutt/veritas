import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pause, Play, RotateCcw, Repeat } from "lucide-react";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import { CaseWalk } from "@/components/veritas/case-walk";
import { STAGE_ORDER } from "@/domain/journey";
import { formatMoney } from "@/domain/money";
import { useJourneyEngine, usePrefersReducedMotion } from "@/hooks/use-journey-engine";
import { StageTimeline } from "@/components/veritas/journey/stage-timeline";
import { StagePanel } from "@/components/veritas/journey/stage-panels";
import { CaseContextPanel } from "@/components/veritas/journey/case-context";
import { EventLog } from "@/components/veritas/journey/event-log";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/recovery-journey")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Recovery Journey — VERITAS" },
      {
        name: "description",
        content:
          "Watch a payment move through investigation, diagnosis, plan, policy, execution, outcome, ledger, evidence and proof.",
      },
      { property: "og:title", content: "Recovery Journey — VERITAS" },
      {
        property: "og:description",
        content:
          "Watch a payment move through investigation, diagnosis, plan, policy, execution, outcome, ledger, evidence and proof.",
      },
    ],
  }),
  component: RecoveryJourneyPage,
});

const CONTROL =
  "inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] transition-colors";

function RecoveryJourneyPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/recovery-journey" });
  const { case_: activeCase, isFixture, error } = useJourneyCase(caseId, 1);
  const cases = useJourneyCases();
  const reducedMotion = usePrefersReducedMotion();
  const engine = useJourneyEngine(activeCase);

  const total = STAGE_ORDER.length;
  const stopped = engine.finished && engine.reachedStages < total;

  return (
    <div className="space-y-8">
      <BackendNotice isFixture={isFixture} error={error} what="recovery journey" />

      <CaseWalk caseId={activeCase.id} />

      {/* Live status header */}
      <header className="border-b border-hairline pb-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <p className="label-meta text-[10px] tracking-[0.16em]">
              Recovery journey · demo case{" "}
              {String(Math.max(1, cases.findIndex((c) => c.id === activeCase.id) + 1)).padStart(
                2,
                "0"
              )}{" "}
              ·{" "}
              {activeCase.kindLabel}
            </p>
            <h1 className="mt-2 flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {activeCase.title}
              <span
                className={cn(
                  "label-meta inline-flex items-center gap-2 rounded-full border border-hairline px-2.5 py-1 text-[10px] tracking-[0.16em]",
                  engine.running ? "text-projected" : "text-muted-foreground",
                  engine.finished && activeCase.completion.tone === "measured" && "text-measured",
                  engine.finished && activeCase.completion.tone === "denied" && "text-denied",
                  engine.finished && activeCase.completion.tone === "unverified" && "text-observed",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full bg-current",
                    engine.running && !reducedMotion && "animate-pulse",
                  )}
                />
                {engine.liveStatus}
              </span>
            </h1>
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
              {activeCase.id} · {activeCase.merchant} · {formatMoney(activeCase.amount)} ·{" "}
              {activeCase.policy.version}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="numeral mr-2 text-sm text-muted-foreground">
              {String(engine.reachedStages).padStart(2, "0")} / {total}
              {stopped && (
                <span className="label-meta ml-2 text-[10px] text-denied">
                  {activeCase.finalStatus}
                </span>
              )}
            </span>
            {!engine.running && !engine.started && (
              <button
                type="button"
                onClick={engine.start}
                className={cn(CONTROL, "border-measured/50 text-foreground hover:border-measured")}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Start recovery journey
              </button>
            )}
            {engine.running && (
              <button
                type="button"
                onClick={engine.pause}
                className={cn(CONTROL, "text-foreground hover:border-foreground/30")}
              >
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                Pause
              </button>
            )}
            {!engine.running && engine.started && !engine.finished && (
              <button
                type="button"
                onClick={engine.resume}
                className={cn(CONTROL, "border-measured/50 text-foreground hover:border-measured")}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Resume
              </button>
            )}
            {engine.finished && (
              <button
                type="button"
                onClick={engine.replay}
                className={cn(CONTROL, "text-foreground hover:border-foreground/30")}
              >
                <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                Replay journey
              </button>
            )}
            <button
              type="button"
              onClick={engine.reset}
              className={cn(CONTROL, "text-muted-foreground hover:text-foreground")}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>

        {/* Progress rail */}
        <div className="mt-5 flex gap-1" aria-hidden="true">
          {STAGE_ORDER.map((s) => {
            const st = engine.stageStatus(s);
            return (
              <span
                key={s}
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors",
                  st === "completed" && "bg-measured/70",
                  st === "current" && "bg-projected",
                  st === "denied" && "bg-denied",
                  st === "exception" && "bg-observed",
                  (st === "pending" || st === "not-reached" || st === "abstained") && "bg-hairline",
                )}
              />
            );
          })}
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
        <div className="space-y-6">
          <StageTimeline
            activeStage={engine.activeStage}
            statusOf={engine.stageStatus}
            onSelect={engine.selectStage}
            reducedMotion={reducedMotion}
          />
          <EventLog events={engine.events} />
        </div>

        <div className="min-w-0 space-y-8">
          <div
            key={`${activeCase.id}-${engine.activeStage}`}
            className={cn(!reducedMotion && "animate-in fade-in duration-300")}
          >
            <StagePanel
              c={activeCase}
              stage={engine.activeStage}
              status={engine.stageStatus(engine.activeStage)}
              reducedMotion={reducedMotion}
            />
          </div>

          {engine.finished && (
            <section
              aria-label="Journey completion"
              className={cn(
                "border-l-2 pl-5",
                activeCase.completion.tone === "measured" && "border-measured",
                activeCase.completion.tone === "denied" && "border-denied",
                activeCase.completion.tone === "unverified" && "border-observed",
                !reducedMotion && "animate-in fade-in slide-in-from-bottom-1 duration-500",
              )}
            >
              <p className="label-meta text-[10px] tracking-[0.16em]">
                {activeCase.completion.title}
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
                <span className="numeral text-3xl font-semibold leading-none text-foreground">
                  {formatMoney(activeCase.claimAmount)}
                </span>
                <ClaimBadge state={activeCase.claim} size="sm" />
              </div>
              <dl className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
                {activeCase.completion.rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-hairline py-1.5">
                    <dt className="label-meta text-[10px] tracking-[0.14em]">{r.label}</dt>
                    <dd className="text-[13px] text-foreground">{r.value}</dd>
                  </div>
                ))}
              </dl>
              {activeCase.principle && (
                <p className="mt-4 max-w-xl text-sm text-foreground">{activeCase.principle}</p>
              )}
            </section>
          )}

          {/* Demo case switcher */}
          <section aria-label="Demo cases" className="border-t border-hairline pt-5">
            <p className="label-meta text-[10px] tracking-[0.16em]">Demo cases</p>
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {cases.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void navigate({ to: ".", search: { case: c.id } })}
                    aria-current={c.id === activeCase.id ? "true" : undefined}
                    className={cn(
                      "-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 rounded-md px-2 py-3 text-left transition-colors hover:bg-foreground/[0.04]",
                      c.id === activeCase.id && "bg-foreground/[0.055]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        <span className="label-meta mr-2 text-[10px]">
                          {String(i + 1).padStart(2, "0")} {c.kindLabel}
                        </span>
                        {c.title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground/80">
                        {c.id} · {c.policy.decision} · {c.outcome.state}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="numeral text-sm text-foreground">{formatMoney(c.amount)}</span>
                      <ClaimBadge state={c.claim} size="sm" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-muted-foreground/80">
            Controlled demo journey. No financial action is performed by this interface — execution
            and gateway confirmation come from the backend once connected.
          </p>
        </div>

        <CaseContextPanel c={activeCase} />
      </div>
    </div>
  );
}
