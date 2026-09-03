import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import {
  ATTENTION_GROUP_LABEL,
  CHECKS_TOTAL,
  CLAIMS,
  CONTROL_TOWER_COUNTS,
  DECISIONS,
  MERCHANTS,
  METHODS,
  PRIORITIES,
  QUEUE_ROWS,
  REASONS,
  attentionBreakdown,
  attentionGroup,
  decisionTone,
  nextActionFor,
} from "@/data/control-tower";
import type { AttentionGroupId, QueueRow } from "@/data/control-tower";
import { formatCount, formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { DetailDrawer, type DrawerAction } from "@/components/veritas/detail-drawer";
import { ContextNotice } from "@/components/veritas/context-notice";
import { JOURNEY_CASES } from "@/data/journey-cases";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/control-tower")({
  validateSearch: (search: Record<string, unknown>) => ({
    decision: typeof search["decision"] === "string" ? (search["decision"] as string) : undefined,
    view: typeof search["view"] === "string" ? (search["view"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Control Tower — VERITAS" },
      {
        name: "description",
        content: "Governed recovery operations: an attention-first queue of payments awaiting authority.",
      },
      { property: "og:title", content: "Control Tower — VERITAS" },
      {
        property: "og:description",
        content: "Governed recovery operations: an attention-first queue of payments awaiting authority.",
      },
    ],
  }),
  component: ControlTowerPage,
});

type SortKey = "priority" | "amount" | "newest" | "oldest" | "decision";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "amount", label: "Amount" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "decision", label: "Decision" },
];

const AMOUNTS = [
  { key: "all", label: "Any amount", min: 0 },
  { key: "5k", label: "≥ ₹5,000", min: 5000 },
  { key: "20k", label: "≥ ₹20,000", min: 20000 },
  { key: "50k", label: "≥ ₹50,000", min: 50000 },
];

const SELECT =
  "h-8 rounded-md border border-hairline bg-transparent px-2 text-[12px] text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:border-foreground/40";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-1 lg:grid-cols-[2.5rem_minmax(0,1.6fr)_auto_auto_auto_auto_9rem]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-meta text-[10px] tracking-[0.14em]">{label}</span>
      {children}
    </label>
  );
}

function priorityTone(p: QueueRow["priority"]) {
  return p === "P1" ? "text-denied" : p === "P2" ? "text-projected" : "text-muted-foreground";
}

/** Contextual destination for a row's next action. Navigation only. */
function actionLinkProps(r: QueueRow) {
  const a = nextActionFor(r);
  const caseId = r.journeyCaseId;
  switch (a.target) {
    case "journey":
      return { label: a.label, to: "/recovery-journey" as const, search: { case: caseId } };
    case "policy":
      return { label: a.label, to: "/policy" as const, search: caseId ? { case: caseId } : {} };
    case "evidence":
      return { label: a.label, to: "/evidence" as const, search: caseId ? { case: caseId } : {} };
    case "payment":
      return { label: a.label, to: "/payments" as const, search: { ref: r.id } };
    default:
      return { label: a.label, to: "/audit-trail" as const, search: caseId ? { case: caseId } : {} };
  }
}

function NextActionLink({ row }: { row: QueueRow }) {
  const a = actionLinkProps(row);
  return (
    <Link
      to={a.to}
      search={a.search as never}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-hairline px-2 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <span className="label-meta text-[10px] tracking-[0.14em]">{a.label}</span>
      <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

function ControlTowerPage() {
  const { decision: incomingDecision, view } = Route.useSearch();
  const navigate = useNavigate({ from: "/control-tower" });

  const [q, setQ] = useState("");
  const [decision, setDecision] = useState<string>(incomingDecision ?? "all");
  const [claim, setClaim] = useState<string>("all");
  const [merchant, setMerchant] = useState<string>("all");
  const [method, setMethod] = useState<string>("all");
  const [reason, setReason] = useState<string>("all");
  const [amount, setAmount] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [group, setGroup] = useState<AttentionGroupId | "all">("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [openRow, setOpenRow] = useState<QueueRow | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const dirty =
    q !== "" ||
    group !== "all" ||
    [decision, claim, merchant, method, reason, amount, priority].some((v) => v !== "all") ||
    sort !== "priority";

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const minAmount = (AMOUNTS.find((a) => a.key === amount)?.min ?? 0) * 100;
    const filtered = QUEUE_ROWS.filter((r) => {
      if (decision !== "all" && r.decision !== decision) return false;
      if (claim !== "all" && r.claim !== claim) return false;
      if (merchant !== "all" && r.merchant !== merchant) return false;
      if (method !== "all" && r.methodLabel !== method) return false;
      if (reason !== "all" && r.failureReason !== reason) return false;
      if (priority !== "all" && r.priority !== priority) return false;
      if (group !== "all" && attentionGroup(r) !== group) return false;
      if (r.amount.minor < minAmount) return false;
      if (term) {
        const hay = `${r.id} ${r.merchant} ${r.failureReason} ${r.recommendation}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    const pri = { P1: 0, P2: 1, P3: 2 } as const;
    const dec = { DENY: 0, ESCALATE: 1, "HUMAN REVIEW": 2, HOLD: 3, "AUTO-ALLOW": 4 } as const;
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "amount":
          return b.amount.minor - a.amount.minor;
        case "newest":
          return b.detectedAt.localeCompare(a.detectedAt);
        case "oldest":
          return a.detectedAt.localeCompare(b.detectedAt);
        case "decision":
          return dec[a.decision] - dec[b.decision];
        default:
          return pri[a.priority] - pri[b.priority] || b.amount.minor - a.amount.minor;
      }
    });
  }, [q, decision, claim, merchant, method, reason, amount, priority, group, sort]);

  const urgent = useMemo(() => rows.filter((r) => r.priority === "P1").slice(0, 4), [rows]);
  const breakdown = useMemo(() => attentionBreakdown(QUEUE_ROWS), []);
  const attention = CONTROL_TOWER_COUNTS.find((c) => c.label === "Attention");
  const secondary = CONTROL_TOWER_COUNTS.filter((c) => c.label !== "Attention");

  function clearAll() {
    setQ("");
    setDecision("all");
    setClaim("all");
    setMerchant("all");
    setMethod("all");
    setReason("all");
    setAmount("all");
    setPriority("all");
    setGroup("all");
    setSort("priority");
    navigate({ to: ".", search: { decision: undefined, view: undefined } });
  }

  const drawerActions = (r: QueueRow): DrawerAction[] => {
    const acts: DrawerAction[] = [{ label: "Open payment", to: "/payments", search: { ref: r.id } }];
    if (r.journeyCaseId) {
      acts.push({ label: "Open recovery journey", to: "/recovery-journey", search: { case: r.journeyCaseId } });
      acts.push({ label: "Open policy", to: "/policy", search: { case: r.journeyCaseId } });
      acts.push({ label: "Open evidence", to: "/evidence", search: { case: r.journeyCaseId } });
      acts.push({ label: "Open audit trail", to: "/audit-trail", search: { case: r.journeyCaseId } });
    } else {
      acts.push({ label: "Open policy", to: "/policy", search: undefined });
      acts.push({ label: "Open evidence", to: "/evidence", search: undefined });
      acts.push({ label: "Open audit trail", to: "/audit-trail", search: undefined });
    }
    return acts;
  };

  return (
    <div className="space-y-8">
      <header className="border-b border-hairline pb-5">
        <p className="label-meta text-[10px] tracking-[0.16em]">Operations</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Control Tower
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Governed recovery operations.</p>
      </header>

      {(incomingDecision || view) && (
        <ContextNotice
          filters={[
            ...(incomingDecision ? [{ label: "Decision", value: incomingDecision }] : []),
            ...(view ? [{ label: "View", value: view }] : []),
          ]}
          message="Demo aggregation — live policy decisions require backend connection."
        />
      )}

      {/* Attention summary */}
      <section
        aria-label="Attention summary"
        className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b border-hairline pb-5"
      >
        <div className="min-w-0">
          <p className="numeral text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {formatCount(attention?.value ?? 0)}
          </p>
          <p className="label-meta mt-1 text-[10px] tracking-[0.18em] text-projected">
            Cases need attention
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {secondary.map((c) => (
            <div key={c.label} className="min-w-0">
              <dd className="numeral text-[13px] text-foreground">{formatCount(c.value)}</dd>
              <dt className="label-meta mt-0.5 text-[10px] tracking-[0.14em]">{c.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* Attention breakdown — derived from the queue rows below */}
      <section aria-label="Attention breakdown" className="space-y-2">
        <p className="label-meta text-[10px] tracking-[0.16em]">Why these cases are open</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setGroup("all")}
            aria-pressed={group === "all"}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[12px] transition-colors",
              group === "all"
                ? "border-foreground/35 text-foreground"
                : "border-hairline text-muted-foreground hover:border-foreground/25 hover:text-foreground",
            )}
          >
            <span className="numeral">{QUEUE_ROWS.length}</span>
            <span className="label-meta text-[10px] tracking-[0.14em]">All queued</span>
          </button>
          {breakdown.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(group === g.id ? "all" : g.id)}
              aria-pressed={group === g.id}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[12px] transition-colors",
                group === g.id
                  ? "border-foreground/35 text-foreground"
                  : "border-hairline text-muted-foreground hover:border-foreground/25 hover:text-foreground",
              )}
            >
              <span className="numeral">{g.count}</span>
              <span className="label-meta text-[10px] tracking-[0.14em]">{g.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/80">
          Counts are of the queued cases shown on this page, not of the aggregate above.
        </p>
      </section>

      {/* Needs attention */}
      {urgent.length > 0 && (
        <section aria-label="Needs attention" className="space-y-2">
          <p className="label-meta text-[10px] tracking-[0.16em]">Needs attention · P1</p>
          <ul className="divide-y divide-hairline border-y border-hairline">
            {urgent.map((r) => (
              <li key={r.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenRow(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenRow(r);
                    }
                  }}
                  className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 border-l-2 border-denied/70 py-3 pl-3 transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="font-mono text-[11px] text-foreground">{r.id}</span>
                  <span className="text-[12px] text-muted-foreground">{r.merchant}</span>
                  <span className="numeral text-[13px] font-medium text-foreground">
                    {formatMoney(r.amount)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                    {r.failureReason}
                  </span>
                  <span className={cn("label-meta text-[10px] tracking-[0.14em]", decisionTone(r.decision))}>
                    {r.decision}
                  </span>
                  <ClaimBadge state={r.claim} size="sm" />
                  <NextActionLink row={r} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Filters */}
      <section aria-label="Filters" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search cases"
              placeholder="Payment, merchant, issue, recommendation"
              className={cn(SELECT, "w-full pl-7 sm:w-72")}
            />
          </span>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground lg:hidden"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Filters
          </button>
          {/* Demo cases — clearly labelled, deliberately quiet */}
          <label className="ml-auto flex items-center gap-2">
            <span className="label-meta text-[10px] tracking-[0.16em]">Demo case</span>
            <select
              value=""
              onChange={(e) => e.target.value && setQ(e.target.value)}
              className={cn(SELECT, "max-w-[220px]")}
            >
              <option value="">Demo data — select…</option>
              {JOURNEY_CASES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kindLabel.toUpperCase()} · {c.id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={cn("flex-wrap items-end gap-3", filtersOpen ? "flex" : "hidden lg:flex")}>
          <Field label="Decision">
            <select value={decision} onChange={(e) => setDecision(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Claim">
            <select value={claim} onChange={(e) => setClaim(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {CLAIMS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Merchant">
            <select value={merchant} onChange={(e) => setMerchant(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {MERCHANTS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Issue">
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={cn(SELECT, "max-w-[220px]")}>
              <option value="all">All</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount">
            <select value={amount} onChange={(e) => setAmount(e.target.value)} className={SELECT}>
              {AMOUNTS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={SELECT}>
              <option value="all">All</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={SELECT}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
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
        </div>
        <p className="text-xs text-muted-foreground/80">
          {rows.length} of {QUEUE_ROWS.length} cases shown
          {group !== "all" ? ` · ${ATTENTION_GROUP_LABEL[group]}` : ""}
        </p>
      </section>

      {/* Queue */}
      <section aria-label="Attention queue">
        <div className={cn(GRID, "hidden border-b border-hairline pb-2 lg:grid")}>
          {["Pri", "Payment", "Amount", "Policy", "Execution", "Claim", "Next action"].map((h) => (
            <span key={h} className="label-meta text-[10px] tracking-[0.14em]">
              {h}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="space-y-3 py-10">
            <p className="label-meta text-[10px] tracking-[0.16em]">No matching cases</p>
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((r) => (
              <li key={r.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenRow(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenRow(r);
                    }
                  }}
                  className={cn(
                    GRID,
                    "w-full cursor-pointer items-baseline py-3 text-left transition-colors hover:bg-foreground/[0.03]",
                    r.priority === "P1" && "border-l-2 border-denied/60 pl-2.5",
                  )}
                >
                  <span className={cn("label-meta text-[10px] tracking-[0.14em]", priorityTone(r.priority))}>
                    {r.priority}
                  </span>
                  <span className="col-span-2 min-w-0 lg:col-span-1">
                    <span className="block truncate font-mono text-[11px] text-foreground">{r.id}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {r.merchant} · {r.failureReason}
                    </span>
                  </span>
                  <span className="numeral text-[13px] text-foreground">{formatMoney(r.amount)}</span>
                  <span className={cn("label-meta text-[10px] tracking-[0.14em]", decisionTone(r.decision))}>
                    {r.decision}
                    <span className="numeral ml-1.5 text-muted-foreground">
                      {r.checksPassed}/{CHECKS_TOTAL}
                    </span>
                  </span>
                  <span className="label-meta text-[10px] tracking-[0.14em] text-muted-foreground">
                    {r.execution}
                  </span>
                  <ClaimBadge state={r.claim} size="sm" />
                  <NextActionLink row={r} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground/80">
        Frontend demonstration only. Opening a case never executes a recovery action.
      </p>

      <DetailDrawer
        open={openRow !== null}
        onOpenChange={(o) => !o && setOpenRow(null)}
        {...(openRow ? { eyebrow: `${openRow.priority} · ${openRow.decision}` } : {})}
        title={openRow?.id ?? ""}
        {...(openRow ? { description: openRow.failureReason } : {})}
        rows={
          openRow
            ? [
                { label: "Merchant", value: openRow.merchant },
                { label: "Amount", value: formatMoney(openRow.amount) },
                { label: "Method", value: openRow.method },
                { label: "Attention", value: ATTENTION_GROUP_LABEL[attentionGroup(openRow)] },
                { label: "Recommendation", value: openRow.recommendation },
                {
                  label: "Policy",
                  value: (
                    <span className={decisionTone(openRow.decision)}>
                      {openRow.decision} · {openRow.checksPassed}/{CHECKS_TOTAL}
                    </span>
                  ),
                },
                ...(openRow.failedRule
                  ? [{ label: "Failed rule", value: <span className="text-denied">{openRow.failedRule}</span> }]
                  : []),
                { label: "Execution", value: openRow.execution },
                {
                  label: "Claim",
                  value: (
                    <span className="inline-flex items-center gap-2">
                      {formatMoney(openRow.claimAmount)}
                      <ClaimBadge state={openRow.claim} size="sm" />
                    </span>
                  ),
                },
                { label: "Next action", value: openRow.nextAction },
              ]
            : []
        }
        actions={openRow ? drawerActions(openRow) : []}
        footer="Navigation only. No financial action is taken from this drawer."
      />
    </div>
  );
}
