import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  LEDGER_CLAIMS,
  LEDGER_DECISIONS,
  LEDGER_OUTCOMES,
  ledgerNeighbours,
} from "@/data/proof";
import type { LedgerEntry } from "@/data/proof";
import { useLedger } from "@/hooks/use-ledger";
import { BackendNotice } from "@/components/veritas/backend-notice";
import { CaseWalk } from "@/components/veritas/case-walk";
import { formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { DetailDrawer, type DrawerAction } from "@/components/veritas/detail-drawer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/audit-trail")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Audit Ledger — VERITAS" },
      {
        name: "description",
        content: "Append-only governance record of every decision, action and reconciliation.",
      },
      { property: "og:title", content: "Audit Ledger — VERITAS" },
      {
        property: "og:description",
        content: "Append-only governance record of every decision, action and reconciliation.",
      },
    ],
  }),
  component: LedgerPage,
});

const SELECT =
  "h-8 rounded-md border border-hairline bg-transparent px-2 text-[12px] text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:border-foreground/40";

type SortKey = "newest" | "oldest" | "amount";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-meta text-[10px] tracking-[0.14em]">{label}</span>
      {children}
    </label>
  );
}

function LedgerPage() {
  const { case: caseId } = Route.useSearch();
  const { entries, isFixture } = useLedger();
  const navigate = useNavigate({ from: "/audit-trail" });
  const [q, setQ] = useState(caseId ?? "");
  const [decision, setDecision] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [claim, setClaim] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [open, setOpen] = useState<LedgerEntry | null>(null);

  const dirty = q !== "" || decision !== "all" || outcome !== "all" || claim !== "all" || sort !== "newest";

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = entries.filter((e) => {
      if (decision !== "all" && e.decision !== decision) return false;
      if (outcome !== "all" && e.outcome !== outcome) return false;
      if (claim !== "all" && e.claim !== claim) return false;
      if (term) {
        const hay = `${e.payment} ${e.actor} ${e.action} ${e.entry}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "amount") return b.amount.minor - a.amount.minor;
      if (sort === "oldest") return a.n - b.n;
      return b.n - a.n;
    });
  }, [entries, q, decision, outcome, claim, sort]);

  function clearAll() {
    setQ("");
    setDecision("all");
    setOutcome("all");
    setClaim("all");
    setSort("newest");
    navigate({ to: ".", search: { case: undefined } });
  }

  const neighbours = open ? ledgerNeighbours(open, entries) : { prev: undefined, next: undefined };

  const actions = (e: LedgerEntry): DrawerAction[] => {
    const list: DrawerAction[] = [{ label: "Open payment", to: "/payments", search: { ref: e.payment } }];
    if (e.caseId) {
      list.push({ label: "Open recovery journey", to: "/recovery-journey", search: { case: e.caseId } });
      list.push({ label: "Open evidence", to: "/evidence", search: { case: e.caseId } });
      list.push({ label: "Open proof", to: "/prove", search: { case: e.caseId } });
    }
    return list;
  };

  return (
    <div className="space-y-8">
      <BackendNotice isFixture={isFixture} error={new Error("Audit ledger unavailable.")} what="ledger" />

      {caseId && <CaseWalk caseId={caseId} />}

      <header className="border-b border-hairline pb-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Append-only governance record</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Audit Ledger
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Every decision, action and reconciliation, hashed in sequence.
        </p>
      </header>

      <section aria-label="Ledger filters" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search">
            <span className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Payment, actor, action"
                aria-label="Search ledger"
                className={cn(SELECT, "w-64 pl-7")}
              />
            </span>
          </Field>
          <Field label="Decision">
            <select value={decision} onChange={(e) => setDecision(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {LEDGER_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Outcome">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {LEDGER_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Claim">
            <select value={claim} onChange={(e) => setClaim(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {LEDGER_CLAIMS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={SELECT}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="amount">Amount</option>
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
        </div>
        <p className="text-xs text-muted-foreground/80">
          {rows.length} of {entries.length} entries
        </p>
      </section>

      <section aria-label="Ledger entries">
        <div className="hidden grid-cols-[auto_auto_auto_minmax(0,1.4fr)_auto_auto_auto] gap-4 border-b border-hairline pb-2 lg:grid">
          {["Entry", "Timestamp", "Actor", "Action", "Decision", "Outcome", "Amount"].map((h) => (
            <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
              {h}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="py-10 text-sm text-muted-foreground">No matching ledger entries.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((e) => (
              <li key={e.n}>
                <button
                  type="button"
                  onClick={() => setOpen(e)}
                  className="grid w-full grid-cols-2 items-baseline gap-x-4 gap-y-1 py-3 text-left transition-colors hover:bg-foreground/[0.03] lg:grid-cols-[auto_auto_auto_minmax(0,1.4fr)_auto_auto_auto]"
                >
                  <span className="numeral text-[12px] text-foreground">{e.entry}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {e.at.replace("T", " ").replace(".000Z", "Z")}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{e.actor}</span>
                  <span className="col-span-2 min-w-0 lg:col-span-1">
                    <span className="block truncate text-[12px] text-foreground">{e.action}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {e.payment} · {e.prevHash} → {e.hash}
                    </span>
                  </span>
                  <span className="label-meta text-[10px] tracking-[0.14em] text-muted-foreground">
                    {e.decision}
                  </span>
                  <span className="label-meta text-[10px] tracking-[0.14em] text-muted-foreground">
                    {e.outcome}
                  </span>
                  <span className="numeral text-[12px] text-foreground">{formatMoney(e.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground/80">
        Demo ledger records. Chain status is read from the record — never asserted by the interface.
      </p>

      <DetailDrawer
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        {...(open ? { eyebrow: `${open.entry} · ${open.decision}` } : {})}
        title={open?.payment ?? ""}
        {...(open ? { description: open.action } : {})}
        rows={
          open
            ? [
                { label: "Actor", value: open.actor },
                { label: "Decision", value: open.decision },
                { label: "Outcome", value: open.outcome },
                {
                  label: "Amount",
                  value: (
                    <span className="inline-flex items-center gap-2">
                      {formatMoney(open.amount)}
                      <ClaimBadge state={open.claim} size="sm" />
                    </span>
                  ),
                },
                { label: "Timestamp", value: open.at },
                { label: "Previous hash", value: <span className="font-mono">{open.prevHash}</span> },
                { label: "Current hash", value: <span className="font-mono">{open.hash}</span> },
                { label: "Verification", value: open.status },
              ]
            : []
        }
        actions={open ? actions(open) : []}
        footer="Chain continuity is shown as recorded. Nothing is re-computed in the browser."
      >
        {open && (
          <div aria-label="Chain integrity" className="rounded-md border border-hairline p-4">
            <p className="label-meta text-[10px] tracking-[0.16em]">Chain integrity</p>
            <ol className="mt-3 space-y-2 text-[12px]">
              <li className="text-muted-foreground">
                {neighbours.prev ? neighbours.prev.entry : "Chain start"}
              </li>
              <li className="font-mono text-[11px] text-muted-foreground/80">↓ {open.prevHash}</li>
              <li className="font-medium text-foreground">{open.entry}</li>
              <li className="font-mono text-[11px] text-muted-foreground/80">↓ {open.hash}</li>
              <li className="text-muted-foreground">
                {neighbours.next ? neighbours.next.entry : "Chain head"}
              </li>
            </ol>
            <p
              className={cn(
                "label-meta mt-3 text-[10px] tracking-[0.16em]",
                open.status.startsWith("CHAIN VERIFIED") ? "text-measured" : "text-denied",
              )}
            >
              {open.status}
            </p>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
