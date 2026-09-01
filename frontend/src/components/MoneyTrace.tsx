"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/types";

/**
 * Where the recovered number came from — all the way down.
 *
 * Every other page on this product shows aggregates. This is the one that
 * lets you refuse to believe them: pick a bucket, get the payments inside it,
 * and for each one the action that was proposed, the rule the gate applied,
 * what happened, and the hash of the audit entry that recorded it.
 *
 *   AGGREGATE -> PAYMENT -> DECISION -> POLICY -> OUTCOME -> AUDIT ENTRY
 *
 * The invariant strip above it is the part that makes this more than a
 * drilldown. The buckets are recomputed server-side from the ledger and the
 * batch and checked against what the run file claims; if a total has drifted,
 * the strip says so with both numbers rather than rendering a page that
 * quietly disagrees with itself.
 */

const TONE: Record<string, string> = {
  recovered: "bg-mint",
  attempted: "bg-line",
  held: "bg-amber",
  refused: "bg-rose",
  escalated: "bg-sky",
  untouched: "bg-edge",
};

const TEXT: Record<string, string> = {
  recovered: "text-mint",
  attempted: "text-muted",
  held: "text-amber",
  refused: "text-rose",
  escalated: "text-sky",
  untouched: "text-faint",
};

const WHY: Record<string, string> = {
  recovered: "The retry ran and the payment truly converted. Measured against an outcome the engine never saw.",
  attempted: "The retry ran and did not convert. The attempt was spent; the money was not won.",
  held: "The gate said STEP_UP. Permitted in kind, above the auto-execute limit, so it is waiting on the merchant.",
  refused: "The gate said DENY. Outside the mandate the merchant signed, and no amount of confirming changes that.",
  escalated: "Handed to a person by rule. The agent records the recommendation and stops.",
  untouched: "No action was proposed. Mostly expired cards and failed authentication — a retry does not fix those.",
};

export function MoneyTrace({ runId }: { runId: string }) {
  const [rec, setRec] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let gone = false;
    setRec(null);
    setOpen(null);
    setRows(null);
    fetch(`/api/reconcile/${runId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => !gone && setRec(d))
      .catch(() => !gone && setDead(true));
    return () => {
      gone = true;
    };
  }, [runId]);

  function pick(key: string) {
    if (open === key) {
      setOpen(null);
      return;
    }
    setOpen(key);
    setRows(null);
    fetch(`/api/reconcile/${runId}/${key}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setRows([]));
  }

  if (dead)
    return (
      <p className="text-[13px] text-muted">
        The reconciliation endpoint did not respond for this run.
      </p>
    );
  if (!rec)
    return <p className="text-[13px] text-faint">recomputing from the ledger…</p>;

  const failed = rec.checks.filter((c: any) => !c.ok);

  return (
    <div className="space-y-5">
      {/* ── does it close? ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {failed.length === 0 ? (
          <span className="chip-measured">
            {rec.checks.length} invariants hold
          </span>
        ) : (
          <span className="chip-warn">{failed.length} invariants FAILED</span>
        )}
        <span className="text-[12px] text-muted">
          <span className="num">{inr(rec.at_risk_paise)}</span> across{" "}
          <span className="num">{rec.at_risk_payments}</span> failed payments,
          recomputed from the ledger and checked against the run file.
        </span>
        {rec.account_actions > 0 && (
          <span className="text-[11px] text-faint">
            + {rec.account_actions} account-level actions, worth ₹0
          </span>
        )}
      </div>

      {failed.length > 0 && (
        <div className="panel border-rose/40 p-3 space-y-1">
          {failed.map((c: any) => (
            <div key={c.key} className="text-[12px]">
              <span className="text-rose">{c.label}</span>
              <span className="num text-muted ml-2">
                claims {String(c.claimed)}, recomputes to {String(c.recomputed)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── the partition, as one bar ── */}
      <div className="flex h-2.5 rounded-full overflow-hidden bg-line">
        {rec.buckets.map((b: any) => (
          <div
            key={b.key}
            className={`${TONE[b.key]} ${b.key === "attempted" ? "opacity-60" : ""}`}
            style={{ width: `${(100 * b.paise) / Math.max(rec.at_risk_paise, 1)}%` }}
            title={`${b.label}: ${inr(b.paise)}`}
          />
        ))}
      </div>

      {/* ── the buckets. Click one to stop believing it. ── */}
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-px bg-line rounded-lg overflow-hidden">
        {rec.buckets.map((b: any) => (
          <button
            key={b.key}
            onClick={() => pick(b.key)}
            className={`bg-surface p-3 text-left transition-colors hover:bg-raised
                        focus-visible:outline-none focus-visible:bg-raised ${
                          open === b.key ? "bg-raised" : ""
                        }`}
          >
            <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint leading-tight">
              {b.label}
            </div>
            <div className={`num text-[17px] font-semibold mt-1.5 ${TEXT[b.key]}`}>
              {inr(b.paise, { compact: true })}
            </div>
            <div className="text-[10.5px] text-faint mt-1 num">
              {b.payments} payment{b.payments === 1 ? "" : "s"}
              <span className="ml-1.5 text-brand">
                {open === b.key ? "▾" : "›"}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* ── the rows behind whichever number was clicked ── */}
      {open && (
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed max-w-3xl">
            {WHY[open]}
          </p>

          {rows === null ? (
            <p className="text-[12px] text-faint">loading the payments…</p>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-faint">
              Nothing landed in this bucket for this run.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="tbl min-w-[52rem]">
                <thead>
                  <tr className="text-faint">
                    <H className="text-left">Payment</H>
                    <H>Amount</H>
                    <H className="text-left">Action proposed</H>
                    <H className="text-left">Rule applied</H>
                    <H className="text-left">Outcome</H>
                    <H className="text-left">Audit entry</H>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 25).map((r: any) => (
                    <tr key={r.txn_id} className="border-t border-line">
                      <td className="py-2 pr-3 num text-[12px]">{r.txn_id}</td>
                      <td className="py-2 px-3 num text-[12px] text-right">
                        {inr(r.amount_paise)}
                      </td>
                      <td className="py-2 px-3 text-[12px] text-muted">
                        {r.action_type ?? "—"}
                      </td>
                      <td className="py-2 px-3">
                        <span className="num text-[11px] text-muted">
                          {r.gate_reason}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[12px]">
                        {r.outcome ? (
                          <span className={TEXT[open]}>{r.outcome}</span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                        {r.converted === true && (
                          <span className="chip-measured ml-1.5">converted</span>
                        )}
                      </td>
                      <td className="py-2 pl-3">
                        {r.entry_hash ? (
                          <span
                            className="num text-[11px] text-faint"
                            title={`#${r.sequence} · prev ${r.prev_hash}`}
                          >
                            #{r.sequence} {r.entry_hash.slice(0, 12)}…
                          </span>
                        ) : (
                          <span className="text-[11px] text-faint">
                            no entry — nothing was decided
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 25 && (
                <p className="text-[11px] text-faint mt-2">
                  Showing the 25 largest of {rows.length}. The full set is in{" "}
                  <span className="num">
                    /api/reconcile/{runId}/{open}
                  </span>
                  .
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function H({
  children,
  className = "text-right",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`ui text-[10px] uppercase tracking-[0.1em] font-normal pb-2 ${className}`}
    >
      {children}
    </th>
  );
}
