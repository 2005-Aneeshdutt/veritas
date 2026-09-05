import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CheckCircle2, Play } from "lucide-react";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { formatMoney } from "@/domain/money";
import { shortId } from "./case-bar";
import { cn } from "@/lib/utils";

/**
 * One payment, walked through the pipeline in the order the pipeline runs it.
 *
 * The app is a mesh: nine surfaces answer different questions about the same
 * payment, and every one of them links to several others. That is right for
 * an operator who arrives knowing what they want, and wrong for a person being
 * shown the system for the first time, who needs the causal order -- what
 * failed, why, what was proposed, what was permitted, what happened, and what
 * stands behind the claim.
 *
 * So this is the same mesh with one path drawn through it. Position comes from
 * the route, not from stored state, which means there is no walk to start or
 * lose: open any stage with a `?case=` and the walk is already at that stage.
 * Advance from wherever you are, leave whenever you like, come back and it has
 * not forgotten.
 *
 * Changing the demo order is changing CASE_FLOW below. Nothing else knows it.
 */

export interface Stage {
  to:
    | "/recovery-journey"
    | "/diagnosis"
    | "/plan"
    | "/policy"
    | "/outcome"
    | "/evidence"
    | "/audit-trail"
    | "/prove";
  /** Shown in the stepper. */
  label: string;
  /** What this stage settles, in the operator's words. */
  does: string;
}

/** The causal order: diagnose before planning, plan before authorizing. */
export const CASE_FLOW: Stage[] = [
  { to: "/recovery-journey", label: "Journey", does: "what happened to this payment" },
  { to: "/diagnosis", label: "Diagnosis", does: "why it failed" },
  { to: "/plan", label: "Plan", does: "what the model recommends" },
  { to: "/policy", label: "Policy", does: "whether that is permitted" },
  { to: "/outcome", label: "Outcome", does: "what actually happened" },
  { to: "/evidence", label: "Evidence", does: "the artifacts behind the claim" },
  { to: "/audit-trail", label: "Ledger", does: "the record, hash-chained" },
  { to: "/prove", label: "Proof", does: "what can be stood behind" },
];

export function stageIndexFor(pathname: string): number {
  return CASE_FLOW.findIndex((s) => s.to === pathname);
}

export function CaseWalk({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Any payment the backend has a journey for, not only the three walkthrough
  // records -- the Control Tower queue is full of real ones and the walk should
  // carry whichever was clicked. `isFixture` gates the figures: a payment the
  // backend cannot resolve falls back to a walkthrough case, and printing that
  // case's amount beside another payment's id is the one thing worse than
  // printing nothing.
  const { case_, isFixture } = useJourneyCase(caseId, 0);
  const active = isFixture ? null : case_;
  // The three labelled records, for the selector. A payment picked out of the
  // Control Tower queue is not one of them and gets its own leading option.
  const known = useJourneyCases();

  const i = stageIndexFor(pathname);
  if (i === -1) return null;
  const next = CASE_FLOW[i + 1];
  const prev = CASE_FLOW[i - 1];
  const stage = CASE_FLOW[i]!;

  const go = (to: Stage["to"]) => navigate({ to, search: { case: caseId } as never });

  return (
    <section
      aria-label="Payment walkthrough"
      className="rounded-lg border border-hairline bg-elevated/20 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <label
            htmlFor="walk-case"
            className="label-meta text-[10px] tracking-[0.16em] text-muted-foreground"
          >
            Executing for
          </label>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* Switching record mid-walk is the commonest thing a presenter does
                -- show the refusal, then the recovery, without leaving the stage
                they are on. A native select so it works with a keyboard and on a
                phone, and so the option text says which outcome each one is. */}
            <select
              id="walk-case"
              value={known.some((c) => c.id === caseId) ? caseId : ""}
              onChange={(e) => navigate({ to: pathname, search: { case: e.target.value } as never })}
              className="h-8 rounded-md border border-hairline bg-transparent px-2 font-mono text-[13px] text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:border-foreground/40"
            >
              {!known.some((c) => c.id === caseId) && (
                <option value="">{shortId(caseId)} — from the queue</option>
              )}
              {known.map((c) => (
                <option key={c.id} value={c.id}>
                  {shortId(c.id)} — {c.kindLabel}
                </option>
              ))}
            </select>
            {active && (
              <>
                <span className="numeral text-sm font-semibold tabular-nums text-foreground">
                  {formatMoney(active.amount)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {active.failureReason}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {prev && (
            <button
              type="button"
              onClick={() => go(prev.to)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {prev.label}
            </button>
          )}
          {next ? (
            <button
              type="button"
              onClick={() => go(next.to)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-foreground/30 px-3.5 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Execute for this payment</span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {next.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate({ to: "/" })}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-measured/40 px-3.5 text-[13px] text-measured transition-colors hover:bg-measured/10"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Done — back to the overview
            </button>
          )}
        </div>
      </div>

      {/* The stepper is also the navigation: a stage already passed is a place
          to go back to, not a decoration. */}
      <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
        {CASE_FLOW.map((s, n) => {
          const done = n < i;
          const here = n === i;
          return (
            <li key={s.to} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => go(s.to)}
                aria-current={here ? "step" : undefined}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                  here
                    ? "bg-foreground/10 font-medium text-foreground"
                    : done
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground/45 hover:text-muted-foreground",
                )}
              >
                <span className="numeral tabular-nums">{n + 1}</span>
                <span className="ml-1.5">{s.label}</span>
              </button>
              {n < CASE_FLOW.length - 1 && (
                <span aria-hidden="true" className="text-muted-foreground/30">
                  ·
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Stage {i + 1} of {CASE_FLOW.length} — {stage.does}.
      </p>
    </section>
  );
}
