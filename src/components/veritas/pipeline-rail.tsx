import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatMoney } from "@/domain/money";
import type { JourneyCase, StageId } from "@/domain/journey";
import { STAGE_LABEL, STAGE_ORDER } from "@/domain/journey";
import { cn } from "@/lib/utils";

/**
 * One payment's progress through the authority chain.
 *
 * The stages a case reached come from its own `sequence`, which is derived
 * from what the backend recorded — so a denial genuinely stops at policy and
 * the rail shows the rest as NOT REACHED rather than as failures. Nothing here
 * is scripted: change the case and the rail changes with it.
 *
 * The replay is a reveal of stages already settled, not a simulation of work
 * being done. It exists because a static list of ten labels does not read as a
 * chain, and a chain is the product's whole argument.
 */

const ROUTE_FOR: Partial<Record<StageId, string>> = {
  payment: "/payments",
  diagnosis: "/diagnosis",
  plan: "/plan",
  policy: "/policy",
  outcome: "/outcome",
  ledger: "/audit-trail",
  evidence: "/evidence",
  prove: "/prove",
};

type Reached = "done" | "stopped" | "not-reached";

function reachedMap(c: JourneyCase): Record<StageId, Reached> {
  const out = {} as Record<StageId, Reached>;
  for (const s of STAGE_ORDER) out[s] = "not-reached";
  for (const step of c.sequence) {
    out[step.stage] = step.settles === "denied" ? "stopped" : "done";
  }
  return out;
}

export function PipelineRail({
  case_,
  caseId,
  replay = true,
}: {
  case_: JourneyCase;
  caseId: string;
  replay?: boolean;
}) {
  const reached = reachedMap(case_);
  const total = case_.sequence.length;

  // Reveal the settled stages in order. Skipped entirely for reduced motion,
  // and reset whenever the case changes so switching never shows a stale rail.
  const [shown, setShown] = useState(replay ? 0 : total);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!replay || reduce) {
      setShown(total);
      return;
    }
    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= total) window.clearInterval(id);
    }, 180);
    return () => window.clearInterval(id);
  }, [caseId, total, replay]);

  const revealedStages = new Set(case_.sequence.slice(0, shown).map((s) => s.stage));

  return (
    <ol className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
      {STAGE_ORDER.map((stage) => {
        const state = reached[stage];
        const revealed = state === "not-reached" ? shown >= total : revealedStages.has(stage);
        const to = ROUTE_FOR[stage];

        const body = (
          <div
            className={cn(
              "flex items-center gap-3 bg-background px-4 py-2.5 transition-opacity duration-300",
              revealed ? "opacity-100" : "opacity-25"
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                !revealed
                  ? "bg-muted-foreground/30"
                  : state === "done"
                    ? "bg-measured"
                    : state === "stopped"
                      ? "bg-denied"
                      : "bg-muted-foreground/40"
              )}
              aria-hidden
            />
            <span
              className={cn(
                "flex-1 text-[13px]",
                revealed && state !== "not-reached"
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {STAGE_LABEL[stage]}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {!revealed ? "" : stageNote(stage, state, case_)}
            </span>
          </div>
        );

        return (
          <li key={stage}>
            {to && revealed && state !== "not-reached" ? (
              <Link to={to} search={{ case: caseId } as never} className="block hover:bg-elevated/40">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The one fact that matters at each stage, taken from the record. */
function stageNote(stage: StageId, state: Reached, c: JourneyCase): string {
  if (state === "not-reached") return "NOT REACHED";
  switch (stage) {
    case "payment":
      return c.failureReason;
    case "policy": {
      const passed = c.policy.checks.filter((x) => x.pass).length;
      return c.policy.checks.length
        ? `${passed}/${c.policy.checks.length} · ${c.policy.decision}`
        : "NOT REACHED";
    }
    case "execution":
      return c.execution.state;
    case "outcome":
      return `${c.outcome.state} ${formatMoney(c.outcome.amount)}`;
    case "ledger":
      return c.ledger.entry;
    default:
      return "";
  }
}
