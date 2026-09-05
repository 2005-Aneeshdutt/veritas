import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Play, RotateCcw } from "lucide-react";
import { getAdapter } from "@/data/index";
import { backendConnected, reconcileQueryOptions } from "@/data/services";
import { formatCount, formatMoney, paise } from "@/domain/money";
import { cn } from "@/lib/utils";

/**
 * Every recovery in the book, not just the one on screen.
 *
 * A single worked example proves the mechanism; it does not show the mechanism
 * working at size. This reads the `recovered` bucket out of each run's
 * reconciliation — the same figures the ledger recomputes itself against — so
 * the total here and the headline on the overview are the same number arrived
 * at the same way.
 *
 * Merchants that recovered nothing are listed too. Dropping them would turn a
 * book with eight merchants into a chart of the six that look good.
 */
export function RecoveredBook() {
  const connected = backendConnected();

  const runs = useQuery({
    queryKey: ["recovered-runs"],
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

  if (!connected) return null;
  if (runs.isPending || results.some((r) => r.isPending)) {
    return <div className="h-40 animate-pulse rounded-lg border border-hairline" />;
  }

  const rows: Row[] = results
    .map((r) => r.data)
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .map((d) => {
      const b = d.buckets.find((x) => x.key === "recovered");
      return {
        merchant: d.merchant_name,
        payments: b?.payments ?? 0,
        minor: b?.paise ?? 0,
      };
    })
    .sort((a, b) => b.minor - a.minor);

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        The reconciliation could not be read, so recoveries are not listed.
      </p>
    );
  }

  return <Book rows={rows} />;
}

interface Row {
  merchant: string;
  payments: number;
  minor: number;
}

/**
 * The same figures, optionally counted out one payment at a time.
 *
 * At rest it shows the real totals, because a panel that starts empty shows
 * nothing. The sweep is a replay: it walks recoveries the book already
 * contains, merchant by merchant, and lands on the figure the ledger
 * reconciles to. It cannot land anywhere else — the ceiling is the sum of what
 * actually converted, not a target — which is the reason it is safe to run in
 * front of someone who will then check the reconciliation panel.
 */
function Book({ rows }: { rows: Row[] }) {
  const payments = rows.reduce((n, r) => n + r.payments, 0);
  const max = Math.max(1, ...rows.map((r) => r.minor));

  const [revealed, setRevealed] = useState(payments);
  const [sweeping, setSweeping] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => setRevealed(payments), [payments]);
  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    []
  );

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
  };

  const sweep = () => {
    stop();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(payments);
      return;
    }
    setSweeping(true);
    setRevealed(0);
    let i = 0;
    timer.current = window.setInterval(
      () => {
        i += 1;
        setRevealed(i);
        if (i >= payments) {
          stop();
          setSweeping(false);
        }
      },
      Math.max(24, Math.round(2600 / Math.max(payments, 1)))
    );
  };

  const reset = () => {
    stop();
    setSweeping(false);
    setRevealed(payments);
  };

  // Walk the merchants in order and give each its share of what has been
  // revealed so far, so the running total is always a real partial sum.
  let left = revealed;
  const shown = rows.map((r) => {
    const n = Math.max(0, Math.min(r.payments, left));
    left -= n;
    const per = r.payments > 0 ? r.minor / r.payments : 0;
    return { ...r, shownPayments: n, shownMinor: Math.round(per * n) };
  });
  const runningTotal = shown.reduce((n, r) => n + r.shownMinor, 0);
  const done = revealed >= payments;

  return (
    <section aria-label="Recovered across the book" className="rounded-lg border border-hairline">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hairline px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">Every recovery in this book</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Not one payment — every retry that converted, marked against a held-out truth.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <p className="text-right">
            <span className="numeral block text-xl font-semibold tabular-nums text-measured">
              {formatMoney(paise(runningTotal))}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatCount(revealed)} of {formatCount(payments)} payments ·{" "}
              {formatCount(rows.length)} merchants
            </span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={sweep}
              disabled={sweeping}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] transition-colors hover:border-foreground/30 disabled:opacity-60"
            >
              <Play className="h-3 w-3" aria-hidden />
              {sweeping ? "Counting" : "Count them out"}
            </button>
            {/* Also the stop button. Hiding it during the sweep left no way to
                interrupt a count that runs for several seconds. */}
            {(sweeping || !done) && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                {sweeping ? "Stop" : "Reset"}
              </button>
            )}
          </div>
        </div>
      </header>

      <ul className="divide-y divide-hairline">
        {shown.map((r) => (
          <li key={r.merchant} className="px-5 py-2.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-[13px] text-foreground">{r.merchant}</span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {formatCount(r.shownPayments)} of {formatCount(r.payments)}
                </span>
                <span
                  className={cn(
                    "numeral w-24 text-right text-[13px] tabular-nums",
                    r.shownMinor > 0 ? "text-measured" : "text-muted-foreground"
                  )}
                >
                  {formatMoney(paise(r.shownMinor))}
                </span>
              </span>
            </div>
            <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-hairline">
              <span
                className={cn(
                  "block h-full rounded-full transition-all duration-200",
                  r.shownMinor > 0 ? "bg-measured" : "bg-hairline"
                )}
                style={{
                  width: `${r.shownMinor === 0 ? 0 : Math.max(3, (r.shownMinor / max) * 100)}%`,
                }}
              />
            </span>
          </li>
        ))}
      </ul>

      <p className="border-t border-hairline px-5 py-2.5 text-[11px] text-muted-foreground">
        {done
          ? "Each figure is the run's own reconciled total — the same number the ledger recomputes itself against."
          : "Counting real recoveries. It can only land on what actually converted."}
      </p>
    </section>
  );
}
