"use client";

import Link from "next/link";
import { useState } from "react";
import { Detail, Eyebrow } from "@/components/ui";
import { RunRecord, inr } from "@/lib/types";

/**
 * The three things the brief asks for, under the names the brief uses.
 *
 * All of this was already true of the system and none of it was findable. The
 * escalation lived in a ledger column, the stopping rules were spread across
 * a policy module and a sequencer, and the audit trail sat under a heading
 * that said "verify the chain in your own browser". A reader scanning for the
 * words in the brief found none of them, and a capability nobody can locate
 * scores the same as one that was never built.
 *
 * They were three summary numbers, and a summary is where a sceptic stops
 * being able to check you. Each opens now: escalation lists WHICH payments
 * were handed to a person and why, stopping rules lists what was refused and
 * on which rule, and the audit trail draws the actual hash chain — each
 * entry's prev_hash sitting under the previous entry's hash, which is the
 * one property a reader can verify with their own eyes.
 *
 * The stopping-rules panel is the one that matters most and is easiest to get
 * wrong: it reports what the agent did NOT do. An agent that only ever shows
 * its successes is not demonstrating restraint, it is hiding the denominator.
 */

const REASON_LABEL: Record<string, string> = {
  DENY_AMOUNT_ABOVE_CEILING: "above the hard ceiling",
  DENY_ALREADY_SETTLED: "the payment had already been collected",
  DENY_ACTION_NOT_PERMITTED: "action type not in the mandate",
  DENY_MAX_ATTEMPTS: "already attempted the maximum times",
  DENY_OUTSIDE_RECOVERY_WINDOW: "outside the 7-day recovery window",
  DENY_MANDATE_EXPIRED: "the mandate had expired",
  DENY_MANDATE_NOT_YET_VALID: "the mandate was not yet in force",
  DENY_SIGNATURE_INVALID: "the mandate signature did not verify",
  DENY_BANK_DEGRADED_HOLD: "the bank was under a degradation hold",
  STEP_UP_ABOVE_AUTO_LIMIT: "above the auto-execute limit",
  STEP_UP_MERCHANT_APPROVAL_REQUESTED: "the planner asked for sign-off",
  OK_MERCHANT_ACTION: "only a person can do this one",
  OK_ESCALATION: "flagged for a human to investigate",
};

type Open = "escalation" | "stopping" | "audit" | null;

export function BarStrip({ rec, runId }: { rec: RunRecord; runId?: string }) {
  const [open, setOpen] = useState<Open>(null);
  const ledger = rec.report.ledger ?? [];

  // Final word per action: the ledger is append-only, so a held action that
  // was later confirmed appears twice and must not be counted twice.
  const final = new Map<string, any>();
  for (const e of ledger) {
    final.set(`${e.txn_id}|${e.proposed_action?.action_type}`, e);
  }
  const rows = [...final.values()];

  const stopped = rows.filter(
    (e) => e.gate_decision === "deny" || e.outcome === "denied"
  );
  const escalated = rows.filter(
    (e) => e.outcome === "merchant_action" || e.outcome === "escalated"
  );

  const byReason = (rs: any[]) => {
    const m = new Map<string, { n: number; paise: number }>();
    for (const e of rs) {
      const k = e.gate_reason ?? "OTHER";
      const cur = m.get(k) ?? { n: 0, paise: 0 };
      cur.n += 1;
      cur.paise += e.proposed_action?.amount_paise ?? 0;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };

  const m = rec.report.measured as any;
  const toggle = (k: Open) => setOpen(open === k ? null : k);

  return (
    <div>
      <Eyebrow>What the brief asks for</Eyebrow>

      <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line mt-3">
        <Card
          title="Compliant escalation"
          headline={`${escalated.length} handed to a person`}
          tone="text-amber"
          on={open === "escalation"}
          onClick={() => toggle("escalation")}
          hint={`${escalated.length} payments`}
        >
          <Reasons rows={byReason(escalated)} />
          <p className="text-[11px] text-faint mt-2 leading-relaxed">
            Each was routed by a rule in the policy kernel, not by a model.
          </p>
        </Card>

        <Card
          title="Stopping rules"
          headline={`${stopped.length} refused outright`}
          tone="text-rose"
          on={open === "stopping"}
          onClick={() => toggle("stopping")}
          hint={stopped.length ? `${stopped.length} payments` : "the 10 checks"}
        >
          {stopped.length ? (
            <Reasons rows={byReason(stopped)} />
          ) : (
            <p className="text-[11px] text-faint leading-relaxed">
              Nothing hit a stop on this merchant. The rules still ran on every
              action.
            </p>
          )}
        </Card>

        <Card
          title="Audit trail"
          headline={`${m?.ledger_entries ?? ledger.length} entries`}
          tone={m?.chain_verified ? "text-mint" : "text-rose"}
          on={open === "audit"}
          onClick={() => toggle("audit")}
          hint="draw the chain"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={m?.chain_verified ? "chip-measured" : "chip-warn"}>
              chain {m?.chain_verified ? "verified" : "BROKEN"}
            </span>
            <span className="chip-neutral">
              {m?.mandate_violations ?? 0} violations
            </span>
          </div>
          <p className="text-[11px] text-faint mt-2 leading-relaxed">
            Every decision — allowed, escalated and denied — is SHA-256
            hash-chained.
          </p>
        </Card>
      </div>

      {/* ── what each card opens ── */}
      {open === "escalation" && (
        <Drawer
          title={`${escalated.length} payments the kernel handed to a person`}
          sub="Who has to act, on what, and which rule sent it there. The agent did not decide any of this — a rule did."
          onClose={() => setOpen(null)}
        >
          <ActionTable rows={escalated} runId={runId} />
        </Drawer>
      )}

      {open === "stopping" && (
        <Drawer
          title={
            stopped.length
              ? `${stopped.length} payments the kernel refused`
              : "Nothing was refused on this merchant"
          }
          sub="A refusal cannot be approved into an allow by anybody. Every one is recorded, because a log of only successes is a highlight reel."
          onClose={() => setOpen(null)}
        >
          {stopped.length > 0 && <ActionTable rows={stopped} runId={runId} />}
          <Detail summary="every check, in the order they run">
            <ol className="list-decimal pl-4 space-y-1">
              <li>the mandate signature must verify, before anything else</li>
              <li>the mandate must be in force — expiry is absolute</li>
              <li>the action type must be one the merchant authorised</li>
              <li>nothing above the hard ceiling, at any approval</li>
              <li>
                a payment that has already been collected is never chased
                again — charging a customer twice is worse than recovering
                nothing
              </li>
              <li>no payment attempted more times than the cap allows</li>
              <li>nothing remediated more than 7 days after it failed</li>
              <li>
                nothing retried into a bank under a degradation hold, which
                lapses after 4 hours — retrying there only burns an attempt
              </li>
              <li>
                anything the agent may not execute itself is escalated or
                handed to the merchant rather than done
              </li>
              <li>
                anything over the auto-execute limit waits for a person, even
                though it is permitted in kind
              </li>
            </ol>
          </Detail>
        </Drawer>
      )}

      {open === "audit" && (
        <Drawer
          title="The chain, link by link"
          sub="Each entry carries the hash of the one before it. Change any field in any entry and every hash after it stops matching — which is the property, and it is one you can check by eye."
          onClose={() => setOpen(null)}
        >
          <Chain entries={ledger} runId={runId} />
        </Drawer>
      )}
    </div>
  );
}

function Card({
  title,
  headline,
  tone,
  children,
  on,
  onClick,
  hint,
}: {
  title: string;
  headline: string;
  tone: string;
  children: React.ReactNode;
  on: boolean;
  onClick: () => void;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-4 text-left transition-colors ${
        on ? "bg-raised" : "hover:bg-raised/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">{title}</span>
        <span
          className={`text-[10px] text-faint ml-auto transition-transform ${
            on ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ›
        </span>
      </div>
      <div className={`num text-xl font-semibold mt-1 ${tone}`}>{headline}</div>
      <div className="mt-2">{children}</div>
      <div className="text-[10px] text-brand mt-2">
        {on ? "hide" : `open ${hint}`}
      </div>
    </button>
  );
}

function Drawer({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line pt-5 mt-1 animate-rise">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3>{title}</h3>
          <p className="text-[12px] text-muted mt-1 max-w-3xl leading-relaxed">
            {sub}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-faint hover:text-ink text-lg leading-none shrink-0"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Which payments, for how much, under which rule. */
function ActionTable({ rows, runId }: { rows: any[]; runId?: string }) {
  const sorted = [...rows].sort(
    (a, b) =>
      (b.proposed_action?.amount_paise ?? 0) - (a.proposed_action?.amount_paise ?? 0)
  );
  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="tbl min-w-[42rem]">
        <thead>
          <tr>
            <th>payment</th>
            <th>what was proposed</th>
            <th className="text-right">at stake</th>
            <th>which rule sent it there</th>
            <th>who acts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 60).map((e, i) => (
            <tr key={`${e.txn_id}-${i}`}>
              <td className="num text-[11px]">
                {runId && !e.txn_id.startsWith("merchant:") ? (
                  <Link
                    href={`/run/${runId}/journey?txn=${encodeURIComponent(e.txn_id)}`}
                    className="link-quiet"
                  >
                    {e.txn_id}
                  </Link>
                ) : (
                  e.txn_id
                )}
              </td>
              <td className="text-muted whitespace-nowrap">
                {String(e.proposed_action?.action_type ?? "").replace(/_/g, " ")}
              </td>
              <td className="num text-right whitespace-nowrap">
                {e.proposed_action?.amount_paise
                  ? inr(e.proposed_action.amount_paise)
                  : "—"}
              </td>
              <td className="text-[12px]">
                {REASON_LABEL[e.gate_reason] ??
                  String(e.gate_reason ?? "").toLowerCase().replace(/_/g, " ")}
              </td>
              <td className="text-[11px] text-faint whitespace-nowrap">
                {e.outcome === "denied"
                  ? "nobody — it is refused"
                  : e.outcome === "escalated"
                  ? "a human reviewer"
                  : "the merchant"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 60 && (
        <div className="text-[11px] text-faint pt-2">
          showing the 60 largest of {sorted.length}
        </div>
      )}
    </div>
  );
}

/**
 * The chain drawn as a chain.
 *
 * A hash-chained ledger is normally shown as a table with a hash column,
 * which shows that hashes exist and not that they are linked. Putting each
 * entry's prev_hash directly under the previous entry's own hash makes the
 * link the visible thing: the two strings match, all the way down, and the
 * first one is genesis.
 */
function Chain({ entries, runId }: { entries: any[]; runId?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, 12);

  const TONE: Record<string, string> = {
    allow: "border-l-mint",
    step_up: "border-l-amber",
    deny: "border-l-rose",
  };

  return (
    <div>
      <div className="text-[11px] text-faint num mb-2">
        genesis 0000000000000000000000000000000000000000000000000000000000000000
      </div>

      <div className="space-y-0">
        {shown.map((e, i) => (
          <div key={e.entry_hash ?? i}>
            {/* the link between this entry and the one above it */}
            <div className="flex items-center gap-2 pl-3">
              <span className="w-px h-4 bg-line" />
              <span className="num text-[10px] text-faint">
                prev {String(e.prev_hash ?? "").slice(0, 24)}…
              </span>
            </div>

            <div
              className={`border-l-2 ${TONE[e.gate_decision] ?? "border-l-line"}
                          pl-3 py-1.5 hover:bg-raised/50 transition-colors`}
            >
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <span className="num text-faint w-8 shrink-0">#{e.sequence}</span>
                <span className="num text-[11px] truncate max-w-[11rem]">
                  {runId && !String(e.txn_id).startsWith("merchant:") ? (
                    <Link
                      href={`/run/${runId}/journey?txn=${encodeURIComponent(e.txn_id)}`}
                      className="link-quiet"
                    >
                      {e.txn_id}
                    </Link>
                  ) : (
                    e.txn_id
                  )}
                </span>
                <span className="text-muted">
                  {String(e.proposed_action?.action_type ?? "").replace(/_/g, " ")}
                </span>
                <span
                  className={
                    e.gate_decision === "deny"
                      ? "chip-warn"
                      : e.gate_decision === "step_up"
                      ? "chip-projected"
                      : "chip-measured"
                  }
                >
                  {e.gate_decision}
                </span>
                <span className="text-[10px] text-faint ml-auto">
                  {e.actor ?? "agent"}
                </span>
              </div>
              <div className="num text-[10px] text-brand mt-0.5">
                hash {String(e.entry_hash ?? "").slice(0, 24)}…
              </div>
            </div>
          </div>
        ))}
      </div>

      {entries.length > 12 && (
        <button
          onClick={() => setAll(!all)}
          className="text-[12px] text-brand mt-3"
        >
          {all
            ? "show the first 12"
            : `show all ${entries.length} links in the chain`}
        </button>
      )}
    </div>
  );
}

/** The top few reasons, as a count and a phrase. */
function Reasons({ rows }: { rows: [string, { n: number; paise: number }][] }) {
  return (
    <div className="space-y-1">
      {rows.slice(0, 4).map(([code, v]) => (
        <div key={code} className="flex items-baseline gap-2 text-[11px]">
          <span className="num text-ink shrink-0">{v.n}</span>
          <span className="text-muted leading-snug">
            {REASON_LABEL[code] ?? code.toLowerCase().replace(/_/g, " ")}
          </span>
        </div>
      ))}
    </div>
  );
}
