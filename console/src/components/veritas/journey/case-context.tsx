import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { formatMoney } from "@/domain/money";
import type { JourneyCase } from "@/domain/journey";
import { cn } from "@/lib/utils";

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-baseline gap-3 py-2">
      <span className="label-meta text-[10px] tracking-[0.14em]">{label}</span>
      <span className={cn("min-w-0 break-words text-right text-[13px] text-foreground sm:text-left", tone)}>
        {value}
      </span>
    </div>
  );
}

export function CaseContextPanel({ c }: { c: JourneyCase }) {
  const cta = c.completion.cta;
  return (
    <aside aria-label="Case context" className="space-y-8">
      <section>
        <p className="label-meta text-[10px] tracking-[0.16em]">Case</p>
        <div className="mt-2 divide-y divide-hairline border-y border-hairline">
          <Row label="Payment ID" value={c.id} />
          <Row label="Merchant" value={c.merchant} />
          <Row label="Amount" value={formatMoney(c.amount)} />
          <Row
            label="Decision"
            value={c.policy.decision}
            tone={c.policy.decision === "DENY" ? "text-denied" : "text-measured"}
          />
          <Row label="Execution" value={c.execution.state} />
          <Row label="Outcome" value={c.outcome.state} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <ClaimBadge state={c.claim} size="sm" />
          <span className="numeral text-sm text-foreground">{formatMoney(c.claimAmount)}</span>
        </div>
      </section>

      <section>
        <p className="label-meta text-[10px] tracking-[0.16em]">Authority</p>
        <div className="mt-2 divide-y divide-hairline border-y border-hairline">
          <Row label="Recommendation" value={c.plan.recommended} />
          <Row label="Policy" value={`${c.policy.version} · ${c.policy.decision}`} />
          <Row label="Execution" value={c.execution.state} />
          <Row label="Evidence" value={c.gateway === "UNCLAIMED" ? "Gateway unclaimed" : c.gateway} />
        </div>
      </section>

      <section>
        <p className="label-meta text-[10px] tracking-[0.16em]">Next step</p>
        {cta.target === "prove" && (
          <Link
            to="/prove"
            search={{ case: c.id }}
            className="mt-3 inline-flex h-9 w-full items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-foreground transition-colors hover:border-foreground/30"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
        {cta.target === "policy" && (
          <Link
            to="/control-tower"
            search={{ decision: c.policy.decision, view: "policy" }}
            className="mt-3 inline-flex h-9 w-full items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-foreground transition-colors hover:border-foreground/30"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
        {cta.target === "evidence" && (
          <Link
            to="/evidence"
            search={{ case: c.id }}
            className="mt-3 inline-flex h-9 w-full items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-foreground transition-colors hover:border-foreground/30"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
        <Link
          to="/payment/$paymentId"
          params={{ paymentId: c.id }}
          className="mt-2 inline-flex h-9 w-full items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
        >
          Open payment
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </section>
    </aside>
  );
}
