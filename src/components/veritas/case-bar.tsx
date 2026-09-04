import { Link } from "@tanstack/react-router";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { formatMoney } from "@/domain/money";
import type { JourneyCase } from "@/domain/journey";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { cn } from "@/lib/utils";

/**
 * The selected case, visible wherever you are.
 *
 * Every stage screen answers a question about one payment, and before this
 * existed each screen carried its own idea of which payment that was — the
 * case strip on Policy once showed a fixture ₹0 beside a live ₹2,724 on the
 * page below it. One source, one answer: `useJourneyCases()` resolves all
 * three against the backend, and selection is a URL search param so it
 * survives a reload and a shared link.
 */
export function CaseBar({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const cases = useJourneyCases();
  const active = cases.find((c) => c.id === activeId) ?? cases[0];
  if (!active) return null;

  return (
    <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-hairline bg-background/95 px-6 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-3">
          {/* Short id to read, full id to cite. This is an audit surface: the
              identifier a reader would quote has to be on the page. */}
          <span
            className="font-mono text-sm text-foreground"
            title={active.id}
          >
            {shortId(active.id)}
          </span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatMoney(active.amount)}
          </span>
          <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
            {active.id}
          </span>
        </div>

        <dl className="hidden items-center gap-x-5 lg:flex">
          <Meta k="Method" v={active.method} />
          <Meta k="Error" v={active.failureReason} />
          <Meta k="Policy" v={active.policy.decision} />
        </dl>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
              active.policy.decision === "DENY"
                ? "bg-denied/10 text-denied"
                : "bg-measured/10 text-measured"
            )}
          >
            {active.policy.decision}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {active.execution.state}
          </span>
          <ClaimBadge state={active.claim} size="sm" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {cases.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-pressed={c.id === activeId}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
              c.id === activeId
                ? "border-foreground/25 bg-elevated text-foreground"
                : "border-hairline text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="font-mono">{shortId(c.id)}</span>
            <span className="ml-2 tabular-nums">{formatMoney(c.amount)}</span>
            <span className="ml-2 opacity-70">{c.policy.decision}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="label-meta text-[10px] tracking-[0.14em]">{k}</dt>
      <dd className="font-mono text-[11px] text-foreground">{v}</dd>
    </div>
  );
}

/** `pay_cloudsync_0502` -> `0502`. The full id stays available on the page. */
export function shortId(id: string): string {
  const m = /_(\d+)$/.exec(id);
  return m?.[1] ?? id;
}

export type { JourneyCase };
