"use client";

import { Card, Detail, Eyebrow } from "@/components/ui";
import { RunRecord } from "@/lib/types";

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
 * The stopping rules panel is the one that matters most and is easiest to get
 * wrong: it reports what the agent did NOT do. An agent that only ever shows
 * you its successes is not demonstrating restraint, it is hiding the denominator.
 */

const REASON_LABEL: Record<string, string> = {
  DENY_AMOUNT_ABOVE_CEILING: "above the hard ceiling",
  DENY_ALREADY_SETTLED: "the payment had already been collected",
  DENY_ACTION_NOT_PERMITTED: "action type not in the mandate",
  DENY_ATTEMPT_CAP: "already attempted the maximum times",
  DENY_OUTSIDE_WINDOW: "outside the 7-day recovery window",
  DENY_MANDATE_EXPIRED: "the mandate had expired",
  DENY_MANDATE_NOT_YET_VALID: "the mandate was not yet in force",
  DENY_BAD_SIGNATURE: "the mandate signature did not verify",
  DENY_BANK_DEGRADED_HOLD: "the bank was under a degradation hold",
  STEP_UP_ABOVE_AUTO_LIMIT: "above the auto-execute limit",
  STEP_UP_MERCHANT_APPROVAL_REQUESTED: "the planner asked for sign-off",
  OK_MERCHANT_ACTION: "only a person can do this one",
  OK_ESCALATION: "flagged for a human to investigate",
};

export function BarStrip({ rec }: { rec: RunRecord }) {
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

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-5 pt-5">
        <Eyebrow>What the brief asks for</Eyebrow>
      </div>

      <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line mt-3">
        {/* ─────────────────────────────────── compliant escalation */}
        <Panel
          title="Compliant escalation"
          headline={`${escalated.length} handed to a person`}
          tone="text-amber"
        >
          <Reasons rows={byReason(escalated)} />
          <p className="text-[11px] text-faint mt-2 leading-relaxed">
            Each was routed by a rule in the policy kernel, not by a model.
          </p>
        </Panel>

        {/* ─────────────────────────────────────────── stopping rules */}
        <Panel
          title="Stopping rules"
          headline={`${stopped.length} refused outright`}
          tone="text-rose"
        >
          {stopped.length ? (
            <Reasons rows={byReason(stopped)} />
          ) : (
            <p className="text-[11px] text-faint leading-relaxed">
              Nothing hit a stop on this merchant. The rules still ran on every
              action.
            </p>
          )}
          <Detail summary="the seven rules, always on">
            <ul className="list-disc pl-4 space-y-1">
              <li>the mandate signature must verify, before anything else</li>
              <li>
                a payment that has already been collected is never chased
                again — charging a customer twice is worse than recovering
                nothing
              </li>
              <li>the mandate must be in force at the moment of the action</li>
              <li>the action type must be one the merchant authorised</li>
              <li>no payment may be attempted more than the cap allows</li>
              <li>nothing is remediated more than 7 days after it failed</li>
              <li>
                every amount is checked against the auto-execute limit and the
                hard ceiling
              </li>
            </ul>
          </Detail>
        </Panel>

        {/* ────────────────────────────────────────────── audit trail */}
        <Panel
          title="Audit trail"
          headline={`${m?.ledger_entries ?? ledger.length} entries`}
          tone={m?.chain_verified ? "text-mint" : "text-rose"}
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
            hash-chained. Re-verified in your browser below.
          </p>
        </Panel>
      </div>
    </Card>
  );
}

function Panel({
  title,
  headline,
  tone,
  children,
}: {
  title: string;
  headline: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className={`num text-xl font-semibold mt-1 ${tone}`}>{headline}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

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
