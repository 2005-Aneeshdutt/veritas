import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import { EVIDENCE_CATEGORIES, EVIDENCE_STATUSES, evidenceFor, ledgerEntryForCase } from "@/data/proof";
import type { EvidenceItem } from "@/data/proof";
import { formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { CaseWalk } from "@/components/veritas/case-walk";
import { DetailDrawer, type DrawerAction } from "@/components/veritas/detail-drawer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/evidence")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Evidence — VERITAS" },
      {
        name: "description",
        content: "The data room behind every claim: payment, diagnosis, policy, execution, outcome, ledger and gateway artifacts.",
      },
      { property: "og:title", content: "Evidence — VERITAS" },
      {
        property: "og:description",
        content: "The data room behind every claim: payment, diagnosis, policy, execution, outcome, ledger and gateway artifacts.",
      },
    ],
  }),
  component: EvidencePage,
});

const SELECT =
  "h-8 rounded-md border border-hairline bg-transparent px-2 text-[12px] text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:border-foreground/40";

function statusTone(s: EvidenceItem["status"]) {
  return s === "VERIFIED"
    ? "text-verified"
    : s === "AVAILABLE"
      ? "text-measured"
      : s === "UNCLAIMED"
        ? "text-projected"
        : "text-muted-foreground";
}

function EvidencePage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/evidence" });
  const { case_: c, isFixture, error } = useJourneyCase(caseId, 1);
  const cases = useJourneyCases();
  const items = evidenceFor(c);
  const ledger = ledgerEntryForCase(c.id);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<EvidenceItem | null>(null);

  const dirty = q !== "" || category !== "all" || status !== "all";

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (status !== "all" && e.status !== status) return false;
      if (term) {
        const hay = `${e.category} ${e.source} ${e.reference} ${e.note}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [items, q, category, status]);

  const supporting = items.filter((e) => e.status === "AVAILABLE" || e.status === "VERIFIED");

  const drawerActions = (e: EvidenceItem): DrawerAction[] => {
    const list: DrawerAction[] = [];
    if (e.category === "POLICY") list.push({ label: "Open policy kernel", to: "/policy", search: { case: c.id } });
    if (e.category === "LEDGER") list.push({ label: "Open ledger", to: "/audit-trail", search: { case: c.id } });
    if (e.category === "OUTCOME" || e.category === "EXECUTION")
      list.push({ label: "Open outcome", to: "/outcome", search: { case: c.id } });
    if (e.category === "PAYMENT") list.push({ label: "Open payment", to: "/payments", search: { ref: c.id } });
    list.push({ label: "Open proof", to: "/prove", search: { case: c.id } });
    return list;
  };

  return (
    <div className="space-y-9">
      <header className="border-b border-hairline pb-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Data room</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Evidence
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Exactly what supports this claim — and exactly what does not.
        </p>
      </header>

      <BackendNotice isFixture={isFixture} error={error} what="evidence" />

      <CaseSwitcher activeId={c.id} onSelect={(id) => navigate({ to: ".", search: { case: id } })} />

      <CaseWalk caseId={c.id} />

      {/* Claim relationship */}
      <section aria-label="Claim and support" className="border-l-2 border-hairline pl-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Claim</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="numeral text-2xl font-semibold tracking-tight text-foreground">
            {formatMoney(c.claimAmount)}
          </span>
          <ClaimBadge state={c.claim} />
          <span className="font-mono text-[12px] text-muted-foreground">{c.id}</span>
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{c.claimLine}</p>
        <p className="label-meta mt-4 text-[10px] tracking-[0.16em]">Supported by</p>
        <ul className="mt-2 space-y-1">
          {supporting.map((e) => (
            <li key={e.category} className="text-[13px] text-foreground">
              <span className={cn("mr-2", statusTone(e.status))}>✓</span>
              {e.category} — {e.source}
            </li>
          ))}
        </ul>
        <p className="label-meta mt-3 text-[10px] tracking-[0.16em] text-projected">
          Gateway · {c.gateway}
        </p>
      </section>

      {/* Filters */}
      <section aria-label="Evidence filters" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="label-meta text-[10px] tracking-[0.14em]">Search</span>
            <span className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search evidence"
                placeholder="Type, source, reference"
                className={cn(SELECT, "w-56 pl-7")}
              />
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-meta text-[10px] tracking-[0.14em]">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {EVIDENCE_CATEGORIES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-meta text-[10px] tracking-[0.14em]">State</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {EVIDENCE_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setCategory("all");
                setStatus("all");
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Case file */}
      <section aria-label="Evidence items">
        {rows.length === 0 ? (
          <p className="py-10 text-sm text-muted-foreground">No matching evidence.</p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {rows.map((e) => (
              <li key={e.category}>
                <button
                  type="button"
                  onClick={() => setOpen(e)}
                  className="grid w-full grid-cols-1 items-baseline gap-x-6 gap-y-1 py-3 text-left transition-colors hover:bg-foreground/[0.03] sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
                >
                  <span className="label-meta text-[10px] tracking-[0.14em]">{e.category}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-foreground">{e.source}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {e.reference} · {e.at}
                    </span>
                  </span>
                  <span className={cn("label-meta text-[10px] tracking-[0.14em]", statusTone(e.status))}>
                    {e.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav aria-label="Related workspaces" className="flex flex-wrap gap-2">
        {[
          { label: "Open proof", to: "/prove" as const },
          { label: "Open ledger", to: "/audit-trail" as const },
          { label: "Open outcome", to: "/outcome" as const },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            search={{ case: c.id } as never}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            {l.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <p className="text-xs text-muted-foreground/80">
        Frontend demonstration only. Artifact contents are not fabricated; unavailable evidence is shown as unavailable.
      </p>

      <DetailDrawer
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        {...(open ? { eyebrow: `${open.category} · ${open.status}` } : {})}
        title={open ? `${open.category} evidence` : ""}
        {...(open ? { description: open.note } : {})}
        rows={
          open
            ? [
                { label: "Source", value: open.source },
                { label: "Reference", value: <span className="font-mono">{open.reference}</span> },
                { label: "Timestamp", value: open.at },
                {
                  label: "State",
                  value: <span className={statusTone(open.status)}>{open.status}</span>,
                },
                { label: "Supports", value: open.supports },
                { label: "Payment", value: open.payment },
                {
                  label: "Policy decision",
                  value: `${c.policy.decision} · ${c.policy.checks.filter((x) => x.pass).length}/12`,
                },
                { label: "Ledger entry", value: ledger ? `${ledger.entry} · ${ledger.status}` : "—" },
              ]
            : []
        }
        actions={open ? drawerActions(open) : []}
        footer={
          open?.status === "UNAVAILABLE"
            ? "Evidence unavailable — no artifact exists for this step."
            : open?.status === "NOT REACHED"
              ? "Not reached — the workflow stopped before this step could produce an artifact."
              : open?.status === "UNCLAIMED"
                ? "Gateway confirmation is not claimed for this record."
              : "Read-only artifact reference from the run record."
        }
      />
    </div>
  );
}
