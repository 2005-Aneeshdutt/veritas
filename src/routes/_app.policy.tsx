import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Ban, Check, CircleDashed, Play, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import type { JourneyCase, PolicyCheck } from "@/domain/journey";
import { formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { CaseWalk } from "@/components/veritas/case-walk";
import { DetailDrawer } from "@/components/veritas/detail-drawer";
import { usePrefersReducedMotion } from "@/hooks/use-journey-engine";
import { clearPolicyDecision, recordPolicyDecision } from "@/lib/policy-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/policy")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Policy Kernel — VERITAS" },
      {
        name: "description",
        content:
          "Deterministic authorization for recovery actions: twelve checks decide whether an AI recommendation may become money movement.",
      },
      { property: "og:title", content: "Policy Kernel — VERITAS" },
      {
        property: "og:description",
        content:
          "Deterministic authorization for recovery actions: twelve checks decide whether an AI recommendation may become money movement.",
      },
    ],
  }),
  component: PolicyKernelPage,
});

const CONTROL =
  "inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] transition-colors";

type EvalStatus = "IDLE" | "EVALUATING POLICY" | "AUTHORIZED" | "DENIED" | "HELD";

function firstFailIndex(checks: PolicyCheck[]): number {
  return checks.findIndex((c) => !c.pass);
}

/** Deterministic sequential reveal of the case's predetermined checks. */
function usePolicyEvaluation(activeCase: JourneyCase, reducedMotion: boolean) {
  const checks = activeCase.policy.checks;
  const failAt = firstFailIndex(checks);
  const stopIndex = failAt === -1 ? checks.length - 1 : failAt;
  const total = stopIndex + 1;
  const settled: EvalStatus = activeCase.policy.decision === "DENY" ? "DENIED" : "AUTHORIZED";

  const [revealed, setRevealed] = useState(0);
  const [status, setStatus] = useState<EvalStatus>("IDLE");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // `run` is defined below; the arrival effect reaches it through a ref so the
  // two do not have to be ordered around each other.
  const runRef = useRef<(() => void) | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  // Replay on arrival and whenever the payment changes. The decision was made
  // when the run was committed -- this is not it being computed now -- but a
  // settled verdict sitting on the page reads as something baked in, and the
  // order the kernel stopped in is the part worth seeing.
  useEffect(() => {
    clear();
    setRevealed(0);
    setStatus("IDLE");
    const id = window.setTimeout(() => runRef.current?.(), 350);
    return () => window.clearTimeout(id);
  }, [activeCase.id, clear]);

  useEffect(() => clear, [clear]);

  const run = useCallback(() => {
    clear();
    if (reducedMotion) {
      setRevealed(total);
      setStatus(settled);
      recordPolicyDecision(activeCase.id, settled);
      return;
    }
    setRevealed(0);
    setStatus("EVALUATING POLICY");
    const step = Math.max(160, Math.round(2800 / total));
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= total) {
        clear();
        setStatus(settled);
        recordPolicyDecision(activeCase.id, settled);
      }
    }, step);
  }, [activeCase.id, clear, reducedMotion, settled, total]);

  runRef.current = run;

  const reset = useCallback(() => {
    clear();
    setRevealed(0);
    setStatus("IDLE");
    clearPolicyDecision(activeCase.id);
  }, [activeCase.id, clear]);


  const evaluating = status === "EVALUATING POLICY";
  return {
    revealed,
    status,
    run,
    reset,
    stopIndex,
    total,
    evaluating,
    // The kernel has actually returned. Everything downstream of the checks --
    // the verdict, the claim, the execution state -- keys off this rather than
    // off the case, so nothing that is an *output* of the run is on screen
    // before the run.
    settled: status !== "IDLE" && !evaluating,
  };
}

function PolicyKernelPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/policy" });
  const { case_: activeCase, isFixture, error } = useJourneyCase(caseId, 1);
  const cases = useJourneyCases();
  const reducedMotion = usePrefersReducedMotion();
  const ev = usePolicyEvaluation(activeCase, reducedMotion);
  const [openCheck, setOpenCheck] = useState<PolicyCheck | null>(null);

  const checks = activeCase.policy.checks;
  const passed = checks.filter((c) => c.pass).length;
  const decision = activeCase.policy.decision;
  const denied = decision === "DENY";

  const statusTone =
    ev.status === "DENIED"
      ? "text-denied"
      : ev.status === "AUTHORIZED"
        ? "text-measured"
        : ev.status === "EVALUATING POLICY"
          ? "text-projected"
          : "text-muted-foreground";

  return (
    <div className="space-y-9">
      <BackendNotice isFixture={isFixture} error={error} what="policy evaluation" />

      <header className="border-b border-hairline pb-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Authority boundary</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Policy Kernel
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              Deterministic authorization for recovery actions.
            </p>
          </div>
          <span
            className={cn(
              "label-meta inline-flex items-center gap-2 rounded-full border border-hairline px-2.5 py-1 text-[10px] tracking-[0.16em]",
              statusTone,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-current",
                ev.evaluating && !reducedMotion && "animate-pulse",
              )}
            />
            {ev.status === "IDLE" ? "READY" : ev.status}
          </span>
        </div>
      </header>

      {/* Demo cases */}
      <section aria-label="Demo cases" className="flex flex-wrap items-center gap-2">

        {cases.map((c) => {
          const active = c.id === activeCase.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate({ to: ".", search: { case: c.id } })}
              className={cn(
                CONTROL,
                active
                  ? "border-foreground/40 text-foreground"
                  : "text-muted-foreground hover:border-foreground/25 hover:text-foreground",
              )}
            >
              <span className="label-meta text-[10px] tracking-[0.14em]">{c.kindLabel}</span>
            </button>
          );
        })}
      </section>

      <CaseWalk caseId={activeCase.id} />

      {/* Authority chain. The first two links are inputs -- the model's
          recommendation and the kernel it will be judged by -- and are true
          before anything runs. The last two are the kernel's output, so they
          stay withheld until the checks have actually been walked. */}
      <section aria-label="Authority chain" className="grid gap-3 sm:grid-cols-4">
        {[
          { k: "Recommendation", v: activeCase.plan.recommended, tone: "text-projected" },
          {
            k: "Policy kernel",
            v: ev.settled ? activeCase.policy.version : "—",
            tone: ev.settled ? "text-foreground" : "text-muted-foreground/40",
          },
          {
            k: "Decision",
            v: ev.settled ? decision : "—",
            tone: !ev.settled
              ? "text-muted-foreground/40"
              : denied
                ? "text-denied"
                : "text-measured",
          },
          {
            k: "Execution",
            v: ev.settled ? activeCase.execution.state : "—",
            tone:
              !ev.settled
                ? "text-muted-foreground/40"
                : activeCase.execution.state === "NOT REACHED"
                  ? "text-muted-foreground"
                  : activeCase.execution.state === "EXCEPTION"
                    ? "text-observed"
                    : "text-measured",
          },
        ].map((s, i) => (
          <div key={s.k} className="relative border-l-2 border-hairline pl-4">
            <p className="label-meta text-[10px] tracking-[0.14em]">{s.k}</p>
            <p className={cn("mt-1.5 text-sm font-medium", s.tone)}>{s.v}</p>
            {i < 3 && (
              <ArrowRight
                aria-hidden="true"
                className="absolute -right-1 top-1 hidden h-3.5 w-3.5 text-muted-foreground/40 sm:block"
              />
            )}
          </div>
        ))}
      </section>

      {/* Decision panel */}
      <section
        aria-label="Policy decision"
        className={cn(
          "grid gap-8 border-l-2 py-6 pl-6 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]",
          denied ? "border-denied/60" : "border-measured/50",
        )}
      >
        <div className="space-y-6">
          <div>
            <p className="label-meta text-[10px] tracking-[0.16em]">Recommendation</p>
            <p className="mt-1 text-lg tracking-tight text-foreground">
              {activeCase.plan.recommended}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              AI recommends. Policy authorizes. A recommendation never overrides the kernel.
            </p>
          </div>

          <div>
            <p className="label-meta text-[10px] tracking-[0.16em]">Policy decision</p>
            <p
              className={cn(
                "numeral mt-1 text-3xl font-semibold tracking-tight sm:text-4xl",
                !ev.settled
                  ? "text-muted-foreground"
                  : denied
                    ? "text-denied"
                    : "text-measured",
              )}
            >
              {ev.status === "IDLE"
                ? "AWAITING EVALUATION"
                : ev.evaluating
                  ? "EVALUATING…"
                  : denied
                    ? "POLICY DENIED"
                    : decision}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ev.settled
                ? activeCase.policy.note
                : ev.evaluating
                  ? `Walking the mandate, one check at a time (${ev.revealed}/${checks.length}).`
                  : `${checks.length} checks stand between this recommendation and money moving.`}
            </p>
          </div>

          {/* The consequences of a decision arrive with the decision, not
              before it. Fading them out was not enough: an opacity-0 answer is
              still in the DOM, the accessibility tree and any copy-paste, which
              is exactly the kind of "invisible but present" claim this product
              exists to argue against. The values are withheld, not hidden. */}
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Claim</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "numeral text-xl font-semibold",
                    ev.settled ? "text-foreground" : "text-muted-foreground/40",
                  )}
                >
                  {ev.settled ? formatMoney(activeCase.claimAmount) : "—"}
                </span>
                {ev.settled && <ClaimBadge state={activeCase.claim} />}
              </p>
            </div>
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Execution</p>
              <p className={cn("mt-1 text-sm", ev.settled ? "text-foreground" : "text-muted-foreground/40")}>
                {ev.settled ? activeCase.execution.state : "—"}
              </p>
            </div>
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Gateway</p>
              <p className={cn("mt-1 text-sm", ev.settled ? "text-muted-foreground" : "text-muted-foreground/40")}>
                {ev.settled ? activeCase.gateway : "—"}
              </p>
            </div>
          </div>

          {activeCase.principle && (
            <p className="max-w-xl border-l border-hairline pl-3 text-sm italic text-muted-foreground">
              “{activeCase.principle}”
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={ev.run}
              disabled={ev.evaluating}
              className={cn(
                CONTROL,
                "border-measured/50 text-foreground hover:border-measured disabled:opacity-50",
              )}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Run policy checks
            </button>
            <button
              type="button"
              onClick={ev.reset}
              className={cn(CONTROL, "text-muted-foreground hover:text-foreground")}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </button>
            <Link
              to="/recovery-journey"
              search={{ case: activeCase.id }}
              className={cn(CONTROL, "text-muted-foreground hover:text-foreground")}
            >
              Open recovery journey
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Checks */}
        <div>
          <div className="flex items-baseline justify-between border-b border-hairline pb-2">
            <p className="label-meta text-[10px] tracking-[0.16em]">12 policy checks</p>
            <p className="numeral text-sm text-muted-foreground">
              {ev.settled
                ? `${passed} / 12 passed`
                : `${checks.slice(0, ev.revealed).filter((c) => c.pass).length} / ${ev.revealed} evaluated`}
            </p>
          </div>
          <ol className="mt-1 divide-y divide-hairline">
            {checks.map((c, i) => {
              const shown = i < ev.revealed;
              // Checks after the one that stopped the kernel were never
              // evaluated. Rendering them as failures would say the opposite.
              const stopped = i > ev.stopIndex;
              // Only once the walk has actually reached it. Flagging the
              // stopping rule in advance is the whole verdict, in red.
              const isFirstFail = i === ev.stopIndex && !c.pass && shown;
              return (
                <li key={c.n}>
                  <button
                    type="button"
                    onClick={() => setOpenCheck(c)}
                    className={cn(
                      "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-left transition-colors",
                      isFirstFail
                        ? "text-denied"
                        : shown && !stopped
                          ? c.pass
                            ? "text-muted-foreground hover:text-foreground"
                            : "text-denied/70 hover:text-denied"
                          : "text-muted-foreground/40",
                    )}
                  >
                    <span className="numeral text-[11px] tabular-nums">
                      {String(c.n).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        isFirstFail ? "text-sm font-semibold" : "text-[13px]",
                      )}
                    >
                      {ev.evaluating && i === ev.revealed ? `Checking ${c.label.toLowerCase()}…` : c.label}
                      {isFirstFail && shown && (
                        <span className="label-meta ml-2 text-[10px] tracking-[0.16em]">stop</span>
                      )}
                    </span>
                    <span className="shrink-0">
                      {!shown || stopped ? (
                        <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : c.pass ? (
                        <Check className="h-3.5 w-3.5 text-measured/70" aria-hidden="true" />
                      ) : (
                        <X className={cn("h-3.5 w-3.5", isFirstFail && "h-4 w-4")} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {ev.settled && activeCase.policy.firstFailure && (
            <p className="mt-3 flex items-start gap-2 text-sm text-denied">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {activeCase.policy.firstFailure}
            </p>
          )}
          {ev.settled && ev.stopIndex < checks.length - 1 && (
            <p className="mt-2 text-xs text-muted-foreground/80">
              Checks after the failed rule were never evaluated. Not evaluated is not passed.
            </p>
          )}
        </div>
      </section>

      {denied && ev.settled && (
        <section
          aria-label="Denial consequence"
          className="grid gap-6 border-y border-hairline py-6 sm:grid-cols-3"
        >
          {[
            { k: "Recovery claim", v: formatMoney(activeCase.claimAmount), s: "ABSTAINED" },
            { k: "Execution", v: "NOT REACHED", s: "Not reached is not failure" },
            { k: "Ledger", v: activeCase.ledger.entry, s: activeCase.ledger.verification },
          ].map((x) => (
            <div key={x.k}>
              <p className="label-meta text-[10px] tracking-[0.16em]">{x.k}</p>
              <p className="numeral mt-1 text-xl font-semibold text-foreground">{x.v}</p>
              <p className="mt-1 text-xs text-muted-foreground">{x.s}</p>
            </div>
          ))}
        </section>
      )}

      {activeCase.kind === "UNVERIFIED" && (
        <p className="flex items-start gap-2 border-l-2 border-observed/60 pl-4 text-sm text-muted-foreground">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-observed" aria-hidden="true" />
          Permission to act is not proof that the action succeeded. Policy authorization ≠ recovery
          proof.
        </p>
      )}

      {/* History */}
      <section aria-label="Policy decision history" className="space-y-3">
        <div className="flex items-baseline justify-between border-b border-hairline pb-2">
          <h2 className="label-meta text-[10px] tracking-[0.16em]">Policy decision history</h2>
          <p className="text-xs text-muted-foreground/80">Demo records · click a row to open its journey</p>
        </div>
        <ul className="divide-y divide-hairline">
          {cases.map((c) => {
            // History is history -- except for the record being re-walked
            // above, whose answer this row would otherwise give away.
            const pending = c.id === activeCase.id && !ev.settled;
            return (
            <li key={c.id}>
              <Link
                to="/recovery-journey"
                search={{ case: c.id }}
                className="grid grid-cols-2 items-baseline gap-x-4 gap-y-1 py-3 text-[13px] transition-colors hover:bg-foreground/[0.03] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto_auto_auto_auto]"
              >
                <span className="min-w-0 truncate font-mono text-[11px] text-foreground">{c.id}</span>
                <span className="min-w-0 truncate text-muted-foreground">{c.plan.recommended}</span>
                <span
                  className={cn(
                    "label-meta text-[10px] tracking-[0.14em]",
                    pending
                      ? "text-muted-foreground/40"
                      : c.policy.decision === "DENY"
                        ? "text-denied"
                        : "text-measured",
                  )}
                >
                  {pending ? "EVALUATING" : c.policy.decision}
                </span>
                <span className="numeral text-muted-foreground">
                  {pending ? "—" : `${c.policy.checks.filter((x) => x.pass).length}/12`}
                </span>
                {pending ? (
                  <span className="text-[11px] text-muted-foreground/40">—</span>
                ) : (
                  <ClaimBadge state={c.claim} size="sm" />
                )}
                <span className="numeral text-[11px] text-muted-foreground/80">
                  {new Date(c.ledger.at).toISOString().slice(0, 16).replace("T", " ")}Z
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground/80">
        Frontend demonstration only. No policy is executed and no money moves from this screen.
      </p>

      <DetailDrawer
        open={openCheck !== null}
        onOpenChange={(o) => !o && setOpenCheck(null)}
        eyebrow={`Check ${openCheck ? String(openCheck.n).padStart(2, "0") : ""} · ${activeCase.policy.version}`}
        title={openCheck?.label ?? ""}
        {...(openCheck?.detail ? { description: openCheck.detail } : {})}
        rows={
          openCheck
            ? [
                { label: "Rule", value: openCheck.label },
                { label: "Evaluated", value: openCheck.evaluated ?? "Not evaluated" },
                { label: "Threshold", value: openCheck.threshold ?? "—" },
                {
                  label: "Result",
                  value: (
                    <span className={openCheck.pass ? "text-measured" : "text-denied"}>
                      {openCheck.pass ? "PASS" : "FAIL"}
                    </span>
                  ),
                },
                ...(openCheck.pass
                  ? []
                  : [
                      {
                        label: "Authority",
                        value: <span className="text-denied">STOP</span>,
                      },
                    ]),
              ]
            : []
        }
        actions={[{ label: "Open recovery journey", to: "/recovery-journey", search: { case: activeCase.id } }]}
        footer="Values come from the selected run record. Nothing is inferred."
      />
    </div>
  );
}
