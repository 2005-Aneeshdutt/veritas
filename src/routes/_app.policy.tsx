import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Ban, Check, CircleDashed, Play, RotateCcw, ShieldAlert, X } from "lucide-react";
import { JOURNEY_CASES, findJourneyCase } from "@/data/journey-cases";
import type { JourneyCase, PolicyCheck } from "@/domain/journey";
import { formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
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

  const clear = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    clear();
    setRevealed(0);
    setStatus("IDLE");
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

  const reset = useCallback(() => {
    clear();
    setRevealed(0);
    setStatus("IDLE");
    clearPolicyDecision(activeCase.id);
  }, [activeCase.id, clear]);


  return { revealed, status, run, reset, stopIndex, total, evaluating: status === "EVALUATING POLICY" };
}

function PolicyKernelPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/policy" });
  const activeCase = findJourneyCase(caseId) ?? JOURNEY_CASES[0]!;
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
        <span className="label-meta mr-2 text-[10px] tracking-[0.16em]">Demo cases</span>
        {JOURNEY_CASES.map((c) => {
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
              <span className="numeral text-[12px]">{formatMoney(c.amount)}</span>
              <span className="text-[11px] text-muted-foreground">{c.policy.decision}</span>
            </button>
          );
        })}
      </section>

      {/* Authority chain */}
      <section aria-label="Authority chain" className="grid gap-3 sm:grid-cols-4">
        {[
          { k: "Recommendation", v: activeCase.plan.recommended, tone: "text-projected" },
          { k: "Policy kernel", v: activeCase.policy.version, tone: "text-foreground" },
          {
            k: "Decision",
            v: decision,
            tone: denied ? "text-denied" : "text-measured",
          },
          {
            k: "Execution",
            v: activeCase.execution.state,
            tone:
              activeCase.execution.state === "NOT REACHED"
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
                ev.evaluating ? "text-muted-foreground" : denied ? "text-denied" : "text-measured",
              )}
            >
              {ev.evaluating ? "EVALUATING…" : denied ? "POLICY DENIED" : decision}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">{activeCase.policy.note}</p>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Claim</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="numeral text-xl font-semibold text-foreground">
                  {formatMoney(activeCase.claimAmount)}
                </span>
                <ClaimBadge state={activeCase.claim} />
              </p>
            </div>
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Execution</p>
              <p className="mt-1 text-sm text-foreground">{activeCase.execution.state}</p>
            </div>
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Gateway</p>
              <p className="mt-1 text-sm text-muted-foreground">{activeCase.gateway}</p>
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
              {passed} / 12 passed
            </p>
          </div>
          <ol className="mt-1 divide-y divide-hairline">
            {checks.map((c, i) => {
              const shown = ev.status === "IDLE" ? true : i < ev.revealed;
              const stopped = ev.status !== "IDLE" && i > ev.stopIndex;
              const isFirstFail = i === ev.stopIndex && !c.pass;
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
          {activeCase.policy.firstFailure && (
            <p className="mt-3 flex items-start gap-2 text-sm text-denied">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {activeCase.policy.firstFailure}
            </p>
          )}
          {ev.status !== "IDLE" && ev.stopIndex < checks.length - 1 && (
            <p className="mt-2 text-xs text-muted-foreground/80">
              Checks after the failed rule were never evaluated. Not evaluated is not passed.
            </p>
          )}
        </div>
      </section>

      {denied && (
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
          {JOURNEY_CASES.map((c) => (
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
                    c.policy.decision === "DENY" ? "text-denied" : "text-measured",
                  )}
                >
                  {c.policy.decision}
                </span>
                <span className="numeral text-muted-foreground">
                  {c.policy.checks.filter((x) => x.pass).length}/12
                </span>
                <ClaimBadge state={c.claim} size="sm" />
                <span className="numeral text-[11px] text-muted-foreground/80">
                  {new Date(c.ledger.at).toISOString().slice(0, 16).replace("T", " ")}Z
                </span>
              </Link>
            </li>
          ))}
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
        footer="Values come from the selected demo record. Nothing is inferred."
      />
    </div>
  );
}
