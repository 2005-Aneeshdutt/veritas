import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { backendConnected, overviewQueryOptions, reconcileQueryOptions } from "@/data/services";
import { getAdapter } from "@/data/index";
import { formatCount, formatMoney, paise } from "@/domain/money";
import { cn } from "@/lib/utils";

/**
 * The system auditing itself.
 *
 * Every other panel reports what the engine decided. This one reports whether
 * the engine's own headline survives being recomputed from the ledger: the
 * backend re-derives the measured figure from the hash chain and compares it to
 * the figure it published. A mismatch here would mean the number on the
 * overview is not the number the ledger supports.
 *
 * It runs across every committed run rather than one, because a single run
 * reconciling proves less than all of them reconciling, and reports the failing
 * runs by name if any do not — a green summary that hides a red run would be
 * exactly the kind of reassurance this product exists to refuse.
 */

export function Reconciliation() {
  const connected = backendConnected();
  const { data: overview } = useQuery({ ...overviewQueryOptions, enabled: connected });

  // the runs, straight from the book the adapter already builds
  const runs = useQuery({
    queryKey: ["reconcile-runs"],
    queryFn: async ({ signal }) => {
      const rows = await getAdapter().listPayments(1, signal);
      return [...new Set(rows.map((r) => r.runId))];
    },
    enabled: connected,
    staleTime: Infinity,
  });

  const results = useQueries({
    queries: (runs.data ?? []).map((id) => ({
      ...reconcileQueryOptions(id),
      enabled: connected && Boolean(id),
    })),
  });

  const loaded = results.filter((r) => r.data).map((r) => r.data!);
  const pending = connected && (runs.isPending || results.some((r) => r.isPending));

  if (!connected) return null;
  if (pending || loaded.length === 0) {
    return <div className="h-24 animate-pulse rounded-lg border border-hairline" />;
  }

  const checks = loaded.flatMap((r) => r.checks);
  const passed = checks.filter((c) => c.ok).length;
  const chains = loaded.filter((r) => r.chain_verified).length;
  const failing = loaded.filter((r) => !r.ok || !r.chain_verified);
  const allOk = failing.length === 0 && passed === checks.length;

  // the measured figure, and the same figure recomputed from the ledger
  const measuredRow = checks.find((c) => c.key === "measured");
  const claimed = overview?.headline.find((m) => m.id === "recovered")?.value;
  const recomputed = loaded.reduce((n, r) => {
    const m = r.checks.find((c) => c.key === "measured");
    return n + (typeof m?.recomputed === "number" ? m.recomputed : 0);
  }, 0);

  return (
    <section
      aria-label="Reconciliation"
      className={cn(
        "rounded-lg border bg-background",
        allOk ? "border-measured/40" : "border-denied/50"
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3 px-4 pb-2.5 pt-3">
        <h2 className="text-[13px] font-medium text-foreground">
          Reconciliation — the ledger recomputes the headline
        </h2>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]",
            allOk ? "text-measured" : "text-denied"
          )}
        >
          {allOk ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
          {allOk ? "All checks pass" : `${checks.length - passed} failing`}
        </span>
      </header>

      <div className="grid gap-px overflow-hidden border-t border-hairline bg-hairline sm:grid-cols-4">
        <Cell
          label="Claimed"
          value={claimed ? formatMoney(claimed) : "—"}
          note="published on this page"
        />
        <Cell
          label="Recomputed from the ledger"
          value={formatMoney(paise(recomputed))}
          note={measuredRow?.detail ?? "sum of retries that truly converted"}
          tone={allOk ? "text-measured" : "text-denied"}
        />
        <Cell
          label="Checks"
          value={`${formatCount(passed)} / ${formatCount(checks.length)}`}
          note={`across ${loaded.length} committed runs`}
        />
        <Cell
          label="Hash chains verified"
          value={`${formatCount(chains)} / ${formatCount(loaded.length)}`}
          note="from genesis, actor inside the hash"
          tone={chains === loaded.length ? "text-measured" : "text-denied"}
        />
      </div>

      {failing.length > 0 && (
        <ul className="border-t border-hairline px-4 py-2">
          {failing.map((r) => (
            <li key={r.run_id} className="text-[11px] text-denied">
              {r.merchant_name} ({r.run_id}) did not reconcile.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Cell({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="bg-background px-4 py-3">
      <p className="label-meta text-[9px] tracking-[0.14em]">{label}</p>
      <p className={cn("numeral mt-1 text-[17px] font-semibold tabular-nums", tone ?? "text-foreground")}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/80">{note}</p>
    </div>
  );
}
