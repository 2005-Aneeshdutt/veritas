import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { backendConnected, paymentsQueryOptions } from "@/data/services";
import type { PaymentRow } from "@/data/adapter";
import { formatCount, formatMoney, formatMoneyCompact, paise } from "@/domain/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/payments")({
  validateSearch: (search: Record<string, unknown>) => ({
    cause: typeof search["cause"] === "string" ? (search["cause"] as string) : undefined,
    ref: typeof search["ref"] === "string" ? (search["ref"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payments — VERITAS" },
      {
        name: "description",
        content: "Failing, disputed and stalled payments with exposure and claim state.",
      },
      { property: "og:title", content: "Payments — VERITAS" },
      {
        property: "og:description",
        content: "Failing, disputed and stalled payments with exposure and claim state.",
      },
    ],
  }),
  component: PaymentsPage,
});

const SELECT =
  "h-8 rounded-md border border-hairline bg-transparent px-2 text-[12px] text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:border-foreground/40";

/** The ledger's outcomes. ALLOW is not one of them — allowed is not executed. */
const OUTCOME_TONE: Record<string, string> = {
  executed: "text-measured",
  denied: "text-denied",
  exception: "text-denied",
  escalated: "text-projected",
  merchant_action: "text-projected",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-meta text-[10px] tracking-[0.14em]">{label}</span>
      {children}
    </label>
  );
}

/**
 * The book, as inventory.
 *
 * Every other Recover screen looks at one payment; this is the only place that
 * says how many there are and where the exposure sits. It reads the same
 * per-run journeys the rest of the app reads, so a row here and the diagnosis
 * it opens cannot disagree.
 *
 * Both groupings are counted from the rows currently on screen rather than
 * fetched separately — a total that disagrees with the list under it is worse
 * than no total at all. Clicking a group filters to it.
 */
function PaymentsPage() {
  const { cause, ref } = Route.useSearch();
  const navigate = useNavigate({ from: "/payments" });
  const connected = backendConnected();
  const query = useQuery({ ...paymentsQueryOptions(120), enabled: connected });

  const rows: PaymentRow[] = query.data ?? [];
  const [q, setQ] = useState(ref ?? "");
  const [outcome, setOutcome] = useState("all");
  const [merchant, setMerchant] = useState("all");
  const [reason, setReason] = useState(cause ?? "all");

  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  const merchants = useMemo(() => uniq(rows.map((r) => r.merchantId)), [rows]);
  const reasons = useMemo(() => uniq(rows.map((r) => r.gateReason)), [rows]);
  const outcomes = useMemo(() => uniq(rows.map((r) => r.outcome)), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!needle || r.txnId.toLowerCase().includes(needle)) &&
        (outcome === "all" || r.outcome === outcome) &&
        (merchant === "all" || r.merchantId === merchant) &&
        (reason === "all" || r.gateReason === reason)
    );
  }, [rows, q, outcome, merchant, reason]);

  const exposure = shown.reduce((n, r) => n + r.amountPaise, 0);
  const dirty = q !== "" || outcome !== "all" || merchant !== "all" || reason !== "all";

  const group = (key: (r: PaymentRow) => string) => {
    const m = new Map<string, { n: number; minor: number }>();
    for (const r of shown) {
      const k = key(r) || "—";
      const cur = m.get(k) ?? { n: 0, minor: 0 };
      m.set(k, { n: cur.n + 1, minor: cur.minor + r.amountPaise });
    }
    return [...m.entries()];
  };
  const byReason = useMemo(
    () => group((r) => r.gateReason).sort((a, b) => b[1].n - a[1].n),
    [shown]
  );
  const byMerchant = useMemo(
    () => group((r) => r.merchantId).sort((a, b) => b[1].minor - a[1].minor),
    [shown]
  );

  function clearAll() {
    setQ("");
    setOutcome("all");
    setMerchant("all");
    setReason("all");
    navigate({ to: ".", search: { cause: undefined, ref: undefined } });
  }

  return (
    <div className="space-y-9">
      <header className="border-b border-hairline pb-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Inventory</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Payments
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Failing, disputed and stalled payments with exposure and claim state.
        </p>
      </header>

      {!connected ? (
        <p className="text-sm text-muted-foreground">
          No backend configured, so there is no inventory to show.
        </p>
      ) : query.isPending ? (
        <div className="h-64 animate-pulse rounded-lg border border-hairline" />
      ) : query.error ? (
        // No stale rows, no fixtures. An inventory that cannot be loaded is blank.
        <div role="status" className="rounded-lg border border-denied/40 bg-denied/5 px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            The payment inventory could not be loaded.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(query.error as Error).message} No rows are shown rather than stale ones.
          </p>
        </div>
      ) : (
        <>
          <section className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3">
            <Stat
              label="Payments"
              value={formatCount(shown.length)}
              note={`of ${formatCount(rows.length)} loaded`}
            />
            <Stat
              label="Exposure"
              value={formatMoneyCompact(paise(exposure))}
              note={formatMoney(paise(exposure))}
            />
            <Stat
              label="Merchants"
              value={formatCount(byMerchant.length)}
              note="represented on screen"
            />
          </section>

          <section aria-label="Filters" className="flex flex-wrap items-end gap-4">
            <Field label="Payment id">
              <span className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="pay_…"
                  className={cn(SELECT, "w-56 pl-7")}
                />
              </span>
            </Field>
            <Field label="Outcome">
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className={SELECT}
              >
                <option value="all">All outcomes</option>
                {outcomes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Merchant">
              <select
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className={SELECT}
              >
                <option value="all">All merchants</option>
                {merchants.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Failure reason">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={cn(SELECT, "max-w-[240px]")}
              >
                <option value="all">All reasons</option>
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            {dirty && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear filters
              </button>
            )}
            <p className="ml-auto text-xs text-muted-foreground/80">
              {shown.length} of {rows.length} payments
            </p>
          </section>

          <div className="grid gap-9 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
            <section aria-label="Payments" className="min-w-0">
              <div className="hidden grid-cols-[minmax(0,1.6fr)_auto_minmax(0,1fr)_auto_auto] gap-4 border-b border-hairline pb-2 lg:grid">
                {["Payment", "Amount", "Action", "Outcome", "Reason"].map((h) => (
                  <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
                    {h}
                  </span>
                ))}
              </div>
              {shown.length === 0 ? (
                <p className="py-10 text-sm text-muted-foreground">No matching payments.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {shown.map((r) => (
                    <li key={r.txnId}>
                      {/* drill-through: the same payment, in the diagnosis view */}
                      <Link
                        to="/diagnosis"
                        search={{ case: r.txnId } as never}
                        className="grid grid-cols-2 items-baseline gap-x-4 gap-y-1 py-3 transition-colors hover:bg-foreground/[0.03] lg:grid-cols-[minmax(0,1.6fr)_auto_minmax(0,1fr)_auto_auto]"
                      >
                        <span className="col-span-2 min-w-0 lg:col-span-1">
                          <span className="block truncate font-mono text-[12px] text-foreground">
                            {r.txnId}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {r.merchantId}
                          </span>
                        </span>
                        <span className="numeral text-[12px] tabular-nums text-foreground">
                          {formatMoney(paise(r.amountPaise))}
                        </span>
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                          {r.actionType}
                        </span>
                        <span
                          className={cn(
                            "text-[11px] uppercase tracking-[0.12em]",
                            OUTCOME_TONE[r.outcome] ?? "text-muted-foreground"
                          )}
                        >
                          {r.outcome}
                        </span>
                        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                          {r.gateReason || "—"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <aside className="min-w-0 space-y-9">
              <Group
                title="By failure reason"
                rows={byReason}
                onPick={(k) => setReason(k === reason ? "all" : k)}
                active={reason}
              />
              <Group
                title="Exposure by merchant"
                rows={byMerchant}
                onPick={(k) => setMerchant(k === merchant ? "all" : k)}
                active={merchant}
                money
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-background px-5 py-4">
      <p className="label-meta text-[10px] tracking-[0.16em]">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

function Group({
  title,
  rows,
  onPick,
  active,
  money = false,
}: {
  title: string;
  rows: [string, { n: number; minor: number }][];
  onPick: (key: string) => void;
  active: string;
  money?: boolean;
}) {
  const max = Math.max(1, ...rows.map(([, v]) => (money ? v.minor : v.n)));
  return (
    <section>
      <h2 className="label-meta mb-3 text-[10px] tracking-[0.16em]">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Nothing to group.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.slice(0, 8).map(([k, v]) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => onPick(k)}
                aria-pressed={active === k}
                className="w-full text-left"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className={cn(
                      "min-w-0 truncate font-mono text-[11px] transition-colors",
                      active === k ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {k}
                  </span>
                  <span className="numeral shrink-0 text-[11px] tabular-nums text-foreground">
                    {money ? formatMoneyCompact(paise(v.minor)) : v.n}
                  </span>
                </span>
                <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-hairline">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      active === k ? "bg-foreground/60" : "bg-foreground/25"
                    )}
                    style={{ width: `${Math.max(2, ((money ? v.minor : v.n) / max) * 100)}%` }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
