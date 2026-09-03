import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, CircleDashed, MinusCircle } from "lucide-react";
import type { JourneyCase } from "@/domain/journey";
import { formatMoney } from "@/domain/money";
import { proofFor, proofSteps } from "@/data/proof";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { cn } from "@/lib/utils";
import type { AppRoute } from "@/components/veritas/nav-config";

const STRIP: { key: string; label: string; to?: AppRoute }[] = [
  { key: "payment", label: "Payment", to: "/payments" },
  { key: "policy", label: "Policy", to: "/policy" },
  { key: "execution", label: "Execution", to: "/recovery-journey" },
  { key: "outcome", label: "Outcome", to: "/outcome" },
  { key: "ledger", label: "Ledger", to: "/audit-trail" },
  { key: "evidence", label: "Evidence", to: "/evidence" },
  { key: "proof", label: "Proof", to: "/prove" },
];

function StateIcon({ state }: { state: "ok" | "caution" | "absent" }) {
  if (state === "ok") return <Check className="h-3.5 w-3.5 text-measured" aria-hidden="true" />;
  if (state === "caution")
    return <CircleDashed className="h-3.5 w-3.5 text-projected" aria-hidden="true" />;
  return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

/**
 * Compact case file for a single recovery: what was recommended, what was
 * authorized, what happened, and exactly what may be claimed.
 */
export function RecoveryPassport({
  journeyCase: c,
  showOpenProof = true,
}: {
  journeyCase: JourneyCase;
  showOpenProof?: boolean;
}) {
  const steps = proofSteps(c);
  const proof = proofFor(c);
  const denied = c.policy.decision === "DENY";
  const headline = denied
    ? "Recovery not authorized"
    : c.claim === "MEASURED"
      ? "Recovery measured"
      : "Recovery unverified";

  const stripState = (key: string): "ok" | "caution" | "absent" => {
    if (key === "proof") return proof.complete ? "ok" : "caution";
    return steps.find((s) => s.key === key)?.state ?? "absent";
  };

  return (
    <article
      aria-label="Recovery passport"
      className="rounded-lg border border-hairline bg-card/40 p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-hairline pb-4">
        <div>
          <p className="label-meta text-[10px] tracking-[0.18em]">VERITAS</p>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-foreground">
            Recovery passport
          </h2>
        </div>
        <p className="label-meta text-[10px] tracking-[0.14em] text-muted-foreground">
          {proof.proofId}
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="font-mono text-[12px] text-muted-foreground">{c.id}</span>
        <span className="numeral text-2xl font-semibold tracking-tight text-foreground">
          {formatMoney(c.amount)}
        </span>
        <ClaimBadge state={c.claim} />
        <span className="text-[13px] text-muted-foreground">{headline}</span>
      </div>

      {/* Authority chain */}
      <dl className="mt-5 divide-y divide-hairline border-y border-hairline">
        {[
          { k: "Recommendation", v: c.plan.recommended },
          {
            k: "Policy",
            v: `${c.policy.decision} · ${c.policy.checks.filter((x) => x.pass).length}/12`,
          },
          ...(c.policy.firstFailure ? [{ k: "First failed rule", v: c.policy.firstFailure }] : []),
          { k: "Execution", v: c.execution.state },
          { k: "Outcome", v: `${c.outcome.state} · ${formatMoney(c.outcome.amount)}` },
          { k: "Ledger", v: `${c.ledger.entry} · ${c.ledger.verification}` },
          {
            k: "Evidence",
            v: `${c.evidence.filter((e) => e.status !== "UNAVAILABLE" && e.status !== "UNCLAIMED").length} of ${c.evidence.length} present`,
          },
          { k: "Gateway", v: c.gateway },
        ].map((r) => (
          <div key={r.k} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4 py-2">
            <dt className="label-meta w-36 shrink-0 text-[10px] tracking-[0.14em]">{r.k}</dt>
            <dd className="min-w-0 break-words text-right text-[13px] text-foreground">{r.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="label-meta text-[10px] tracking-[0.16em]">Claim</span>
        <span className="numeral text-lg font-semibold text-foreground">
          {formatMoney(c.claimAmount)}
        </span>
        <ClaimBadge state={c.claim} />
        <span className="text-[12px] text-muted-foreground">{c.claimLine}</span>
      </div>

      {c.claim === "UNVERIFIED" && (
        <p className="mt-3 border-l-2 border-denied/60 pl-3 text-[13px] text-foreground">
          Permission to act is not proof that the action succeeded.
        </p>
      )}

      {/* Status strip */}
      <nav aria-label="Passport status strip" className="mt-5 flex flex-wrap gap-2">
        {STRIP.map((s) => {
          const state = stripState(s.key);
          const content = (
            <>
              <StateIcon state={state} />
              <span className="label-meta text-[10px] tracking-[0.14em]">{s.label}</span>
            </>
          );
          return s.to ? (
            <Link
              key={s.key}
              to={s.to}
              search={
                (s.to === "/payments" ? { ref: c.id } : { case: c.id }) as never
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              {content}
            </Link>
          ) : (
            <span
              key={s.key}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-muted-foreground"
            >
              {content}
            </span>
          );
        })}
      </nav>

      {showOpenProof && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/prove"
            search={{ case: c.id } as never}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border border-foreground/30 px-3.5 text-[13px] text-foreground",
              "transition-colors hover:border-foreground/50",
            )}
          >
            Open proof
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link
            to="/recovery-journey"
            search={{ case: c.id } as never}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            View recovery journey
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </article>
  );
}
