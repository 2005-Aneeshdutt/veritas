import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { backendConnected, labQueryOptions, modeQueryOptions } from "@/data/services";
import { mapLab } from "@/data/map-lab";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { formatCount, formatMoney, formatMoneyCompact } from "@/domain/money";
import type { OverviewSnapshot } from "@/domain/types";
import { cn } from "@/lib/utils";

/**
 * The command centre, as one screen.
 *
 * Density is the point: an operator scans this, they do not read it. Every
 * figure is passed in from the backend or fetched here, and where the backend
 * has no equivalent for a panel the panel says what it does have rather than
 * inventing the missing number — the counts in the flow are the ledger's own
 * split, not a funnel invented to look tidy.
 */

/* --------------------------------------------------------------- primitives */

function Panel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: string;
  action?: { label: string; to: string; search?: Record<string, unknown> };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("rounded-lg border border-hairline bg-background", className)}
    >
      <header className="flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-3">
        <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
        {action ? (
          <Link
            to={action.to}
            search={(action.search ?? {}) as never}
            className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            {action.label} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : hint ? (
          <span className="label-meta shrink-0 text-[9px] tracking-[0.16em]">{hint}</span>
        ) : null}
      </header>
      <div className="px-4 pb-3.5">{children}</div>
    </section>
  );
}

function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em]",
        tone
      )}
    >
      {text}
    </span>
  );
}

const DECISION_TONE: Record<string, string> = {
  ALLOW: "bg-measured/10 text-measured",
  "AUTO-ALLOW": "bg-measured/10 text-measured",
  DENY: "bg-denied/10 text-denied",
  ESCALATE: "bg-projected/10 text-projected",
  HOLD: "bg-projected/10 text-projected",
};
const OUTCOME_TONE: Record<string, string> = {
  MEASURED: "bg-measured/10 text-measured",
  ABSTAINED: "bg-denied/10 text-denied",
  UNVERIFIED: "bg-projected/10 text-projected",
  OBSERVED: "bg-foreground/10 text-muted-foreground",
  "NOT REACHED": "bg-foreground/10 text-muted-foreground",
};

/* ------------------------------------------------------------------ header */

export function CenterHeader({ data }: { data: OverviewSnapshot }) {
  const connected = backendConnected();
  const { data: mode } = useQuery({ ...modeQueryOptions, enabled: connected });
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const t = () => setClock(new Date().toISOString().slice(11, 19));
    t();
    const id = window.setInterval(t, 1000);
    return () => window.clearInterval(id);
  }, []);

  const failed = data.funnel[0]?.count ?? 0;
  const examined = /across (\d[\d,]*)/.exec(data.headline[0]?.note ?? "")?.[1];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
      <div className="min-w-0">
        <p className="label-meta text-[9px] tracking-[0.18em]">Overview</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-foreground">
          Revenue Recovery Command Center
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Monitor failed payments. Govern decisions. Recover revenue. Prove outcomes.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {data.headline.map((m) => (
            <div key={m.id} className="min-w-0">
              <dt className="label-meta text-[9px] tracking-[0.14em]">{m.label}</dt>
              <dd
                className={cn(
                  "numeral mt-1 text-[22px] font-semibold leading-none tabular-nums",
                  CLAIM_TONE[m.claim] ?? "text-foreground"
                )}
              >
                {m.displayOverride ?? formatMoney(m.value)}
              </dd>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">{m.note}</p>
            </div>
          ))}
        </dl>
      </div>

      {/* Decorative field — deliberately abstract. There is no geographic data
          in the backend, so this asserts no locations; the badges beside it are
          the only claims, and each is a real figure. */}
      <aside className="relative hidden overflow-hidden rounded-lg border border-hairline lg:block">
        <DotField />
        <ul className="absolute inset-y-0 right-0 flex flex-col justify-center gap-2 px-4">
          {[
            `${examined ?? formatCount(failed)} payments`,
            "10 nodes",
            mode?.label ?? "mode unknown",
            "policy driven",
            "audit ready",
          ].map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="size-1 rounded-full bg-measured" aria-hidden />
              <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {b}
              </span>
            </li>
          ))}
        </ul>
        <span className="absolute bottom-2 left-4 flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-measured" : "bg-muted-foreground/50"
            )}
            aria-hidden
          />
          <span className="label-meta text-[9px] tracking-[0.16em]">
            {connected ? "Live" : "No backend"}
          </span>
          <span className="numeral text-[10px] tabular-nums text-muted-foreground" suppressHydrationWarning>
            UTC {clock ?? "--:--:--"}
          </span>
        </span>
      </aside>
    </div>
  );
}

const CLAIM_TONE: Record<string, string> = {
  OBSERVED: "text-foreground",
  PROJECTED: "text-projected",
  MEASURED: "text-measured",
  VERIFIED: "text-foreground",
  UNVERIFIED: "text-denied",
  ABSTAINED: "text-muted-foreground",
};

function DotField() {
  return (
    <svg className="h-full w-full opacity-[0.18]" aria-hidden viewBox="0 0 300 150">
      {Array.from({ length: 15 }).map((_, r) =>
        Array.from({ length: 30 }).map((_, c) => {
          const x = 8 + c * 10;
          const y = 8 + r * 10;
          const d = Math.hypot(c - 14, r - 7);
          if (d > 9) return null;
          return <circle key={`${r}-${c}`} cx={x} cy={y} r={1} className="fill-foreground" />;
        })
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ right rail */

export function EngineStatusPanel({ data }: { data: OverviewSnapshot }) {
  const g = (id: string) => data.policyOutcomes.find((o) => o.id === id)?.count ?? 0;
  const f = (id: string) => data.funnel.find((s) => s.id === id)?.count ?? 0;
  const rows = [
    { v: data.funnel[0]?.count ?? 0, l: "Payments evaluated", tone: "text-foreground" },
    { v: g("acted"), l: "Authorised to act", tone: "text-measured" },
    { v: g("awaiting"), l: "Held for a person", tone: "text-projected" },
    { v: f("attempted"), l: "Recovery attempts", tone: "text-foreground" },
    { v: f("converted"), l: "Converted to recovered", tone: "text-measured" },
  ];
  return (
    <Panel title="Engine status" hint="Committed runs">
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.l} className="flex items-baseline gap-3">
            <span className={cn("numeral w-14 shrink-0 text-[17px] font-semibold tabular-nums", r.tone)}>
              {formatCount(r.v)}
            </span>
            <span className="text-[12px] text-muted-foreground">{r.l}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function CurrentActivity() {
  const cases = useJourneyCases();
  return (
    <Panel
      title="Current activity"
      action={{ label: "View all", to: "/audit-trail", search: { case: undefined } }}
    >
      <ul className="space-y-2">
        {cases.map((c) => {
          const denied = c.policy.decision === "DENY";
          const measured = c.outcome.state === "MEASURED";
          return (
            <li key={c.id}>
              <Link
                to="/recovery-journey"
                search={{ case: c.id } as never}
                className="block rounded transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      denied ? "bg-denied" : measured ? "bg-measured" : "bg-projected"
                    )}
                    aria-hidden
                  />
                  <span className="text-[12px] text-foreground">
                    Payment {c.id.slice(-4)}
                  </span>
                  <span className="ml-auto numeral text-[12px] tabular-nums text-foreground">
                    {formatMoney(c.amount)}
                  </span>
                </span>
                <span className="ml-3.5 block text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {denied ? `Policy ${c.policy.decision}` : `Outcome ${c.outcome.state}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function PolicyBreaches() {
  const connected = backendConnected();
  const q = useQuery({ ...labQueryOptions("cloudsync"), enabled: connected });
  if (!q.data) return <Panel title="Policy breaches"><div className="h-20" /></Panel>;
  const rows = mapLab(q.data).filter((s) => s.id !== "no_intervention");
  const max = Math.max(1, ...rows.map((r) => r.breaches));
  return (
    <Panel title="Policy breaches" hint={q.data.label}>
      <ul className="space-y-2">
        {rows.map((s) => (
          <li key={s.id}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">{s.label}</span>
              <span
                className={cn(
                  "numeral shrink-0 text-[12px] tabular-nums",
                  s.breaches > 0 ? "text-denied" : "text-measured"
                )}
              >
                {formatCount(s.breaches)}
              </span>
            </span>
            <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-hairline">
              <span
                className={cn("block h-full rounded-full", s.breaches > 0 ? "bg-denied" : "bg-measured")}
                style={{ width: `${s.breaches === 0 ? 3 : Math.max(6, (s.breaches / max) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ProofHealthPanel({ data }: { data: OverviewSnapshot }) {
  const rows = [
    { l: "Evidence coverage", v: data.proofHealth.evidenceCoverage },
    { l: "Ledger integrity", v: data.proofHealth.ledgerIntegrity },
    ...(data.proofHealth.gatewayReconciliation === undefined
      ? []
      : [{ l: "Gateway reconciliation", v: data.proofHealth.gatewayReconciliation }]),
  ];
  return (
    <Panel title="Proof health" hint="From the ledger">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.l}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">{r.l}</span>
              <span className="numeral text-[12px] tabular-nums text-foreground">
                {Math.round(r.v)}%
              </span>
            </span>
            <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-hairline">
              <span
                className="block h-full rounded-full bg-measured"
                style={{ width: `${Math.max(2, Math.min(100, r.v))}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------- lower row */

export function GovernedActionsTable({ data }: { data: OverviewSnapshot }) {
  const rows = data.recentActions.slice(0, 6);
  return (
    <Panel
      title="Recent governed actions"
      action={{ label: "View all", to: "/audit-trail", search: { case: undefined } }}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-[12px] text-muted-foreground">No entries in the audited window.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline">
              {["Time", "Payment", "Amount", "Action", "Policy", "Outcome"].map((h) => (
                <th key={h} className="label-meta pb-1.5 text-[9px] tracking-[0.14em] font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-hairline/60 last:border-0">
                <td className="py-1.5 text-[11px] text-muted-foreground">{ago(a.occurredAt)}</td>
                <td className="py-1.5 font-mono text-[11px] text-foreground">
                  {a.reference.slice(-4)}
                </td>
                <td className="numeral py-1.5 text-[11px] tabular-nums text-foreground">
                  {formatMoney(a.amount)}
                </td>
                <td className="max-w-[150px] truncate py-1.5 font-mono text-[10px] text-muted-foreground">
                  {a.action}
                </td>
                <td className="py-1.5">
                  <Pill
                    text={shortReason(a.policy)}
                    tone={DECISION_TONE[shortReason(a.policy)] ?? "bg-foreground/10 text-muted-foreground"}
                  />
                </td>
                <td className="py-1.5">
                  <Pill text={a.claim} tone={OUTCOME_TONE[a.claim] ?? "bg-foreground/10 text-muted-foreground"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** The kernel writes long reasons; the table has room for the verb. */
function shortReason(reason: string): string {
  if (reason.startsWith("DENY")) return "DENY";
  if (reason.startsWith("STEP_UP")) return "HOLD";
  if (reason.includes("ESCALATION")) return "ESCALATE";
  if (reason.startsWith("OK")) return "ALLOW";
  return reason.slice(0, 10);
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function PolicyDecisions({ data }: { data: OverviewSnapshot }) {
  const max = Math.max(1, ...data.policyOutcomes.map((o) => o.count));
  const TONE: Record<string, string> = {
    allowed: "bg-measured",
    conditional: "bg-projected",
    denied: "bg-denied",
    abstained: "bg-muted-foreground/60",
  };
  const attention = data.policyOutcomes
    .filter((o) => o.tone !== "allowed")
    .reduce((n, o) => n + o.count, 0);
  return (
    <Panel title="Policy decisions" hint={`${formatCount(attention)} need a person`}>
      <ul className="space-y-2.5">
        {data.policyOutcomes.map((o) => (
          <li key={o.id}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className={cn("size-1.5 rounded-full", TONE[o.tone])} aria-hidden />
                <span className="text-[11px] text-muted-foreground">{o.label}</span>
              </span>
              <span className="numeral text-[12px] tabular-nums text-foreground">
                {formatCount(o.count)}
              </span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-hairline">
              <span
                className={cn("block h-full rounded-full", TONE[o.tone])}
                style={{ width: `${Math.max(2, (o.count / max) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function GovernanceStrip() {
  const connected = backendConnected();
  const q = useQuery({ ...labQueryOptions("cloudsync"), enabled: connected });
  if (!q.data) return null;
  const rows = mapLab(q.data).filter((s) => s.id !== "no_intervention");
  return (
    <Panel
      title="What governance changes"
      action={{ label: "Open the lab", to: "/counterfactual-lab", search: { case: undefined } }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((s) => (
          <div key={s.id} className="rounded-md border border-hairline px-3 py-2.5">
            <p className="truncate text-[11px] text-muted-foreground" title={s.label}>
              {s.label}
            </p>
            <p className="numeral mt-1 text-[17px] font-semibold tabular-nums text-foreground">
              {formatMoneyCompact(s.recovery)}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[10px] uppercase tracking-[0.1em]",
                s.breaches > 0 ? "text-denied" : "text-measured"
              )}
            >
              {formatCount(s.breaches)} {s.breaches === 1 ? "breach" : "breaches"}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {q.data.merchant_name} only — the lab scores one merchant's batch, not the book.
      </p>
    </Panel>
  );
}
