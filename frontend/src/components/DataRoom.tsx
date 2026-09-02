"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/types";

/**
 * Every source behind a recovery number, and whether it is whole.
 *
 * The Evidence page walks ₹39,833 down to the payments and audit entries that
 * make it. This is the layer below that: are those records complete? A
 * confident total computed over a source missing 40% of its rows is worse
 * than no total, because the confidence is the part that is wrong.
 *
 * The column that earns its place is `unresolved`. An outcome event naming a
 * payment no batch contains means the loop has a hole in it, and this is
 * where that surfaces — as a warning, rather than as a total that is quietly
 * a bit small.
 */

const ORIGIN: Record<string, { cls: string; label: string }> = {
  real: { cls: "chip-measured", label: "real" },
  razorpay_test: { cls: "chip-det", label: "razorpay test" },
  synthetic: { cls: "chip-projected", label: "synthetic" },
  derived: { cls: "chip-neutral", label: "derived" },
  none: { cls: "chip-neutral", label: "empty" },
};

export function DataRoom() {
  const [d, setD] = useState<any>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    fetch("/api/dataroom")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setD)
      .catch(() => setDead(true));
  }, []);

  if (dead)
    return <p className="text-[13px] text-muted">The data room did not load.</p>;
  if (!d) return <p className="text-[13px] text-faint">counting the sources…</p>;

  return (
    <div className="space-y-4">
      {d.warnings.length > 0 && (
        <div className="panel border-amber/40 p-3 space-y-1.5">
          {d.warnings.map((w: string) => (
            <p key={w} className="text-[12px] text-muted leading-relaxed">
              <span className="text-amber">▲</span> {w}
            </p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="tbl min-w-[50rem]">
          <thead>
            <tr className="text-faint">
              <H className="text-left">Source</H>
              <H>Records</H>
              <H className="text-left">Origin</H>
              <H className="text-left">Ingestion</H>
              <H>Complete</H>
              <H>Dupes</H>
              <H>Invalid</H>
              <H>Unresolved</H>
            </tr>
          </thead>
          <tbody>
            {d.sources.map((s: any) => {
              const o = ORIGIN[s.origin] ?? ORIGIN.derived;
              return (
                <tr key={s.key} className="border-t border-line align-top">
                  <td className="py-2.5 pr-3">
                    <div className="text-[13px]">{s.label}</div>
                    <div className="num text-[10.5px] text-faint mt-0.5">
                      {s.path}
                    </div>
                    <div className="text-[11px] text-faint mt-1 leading-snug max-w-[24rem]">
                      {s.note}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right num text-[13px]">
                    {s.records.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2.5 px-2">
                    <span className={o.cls}>{o.label}</span>
                  </td>
                  <td className="py-2.5 px-2 text-[12px] text-muted">
                    {s.ingestion_state}
                  </td>
                  <td
                    className={`py-2.5 px-2 text-right num text-[12px] ${
                      s.completeness_pct >= 100
                        ? "text-mint"
                        : s.completeness_pct > 0
                        ? "text-amber"
                        : "text-faint"
                    }`}
                  >
                    {s.completeness_pct.toFixed(1)}%
                  </td>
                  <Num v={s.duplicates_refused} />
                  <Num v={s.invalid_records} bad />
                  <Num v={s.unresolved_relationships} bad />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-faint leading-relaxed max-w-3xl">
        Duplicate counts for the event log are for this process only — a
        refused delivery is never stored, so there is nothing on disk to count
        afterwards. Everything else is read from the files named above.
      </p>
    </div>
  );
}

function Num({ v, bad }: { v: number; bad?: boolean }) {
  return (
    <td
      className={`py-2.5 px-2 text-right num text-[12px] ${
        v === 0 ? "text-faint" : bad ? "text-rose" : "text-muted"
      }`}
    >
      {v}
    </td>
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

/* ------------------------------------------------------------- lineage */

const STAGE_TONE: Record<string, string> = {
  payment: "bg-edge",
  decision: "bg-iris",
  policy: "bg-sky",
  execution: "bg-brand",
  event: "bg-amber",
  audit: "bg-mint",
};

/**
 * One payment, from the batch row to the audit entry that closed it.
 *
 * A drawer rather than a graph. The relationship being shown is a sequence,
 * and a sequence drawn as a node graph is harder to read than a list for no
 * gain — the only thing a reader wants here is what happened, in order, and
 * where each step is recorded.
 */
export function Lineage({
  merchantId,
  txnId,
}: {
  merchantId: string;
  txnId: string;
}) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let gone = false;
    setD(null);
    setErr(false);
    fetch(`/api/lineage/${merchantId}/${txnId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((x) => !gone && setD(x))
      .catch(() => !gone && setErr(true));
    return () => {
      gone = true;
    };
  }, [merchantId, txnId]);

  if (err)
    return (
      <p className="text-[12px] text-muted">No lineage for {txnId}.</p>
    );
  if (!d) return <p className="text-[12px] text-faint">tracing…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="num text-[13px]">{d.txn_id}</span>
        <span className="num text-[15px] font-semibold">
          {inr(d.amount_paise)}
        </span>
        <span
          className={`text-[12px] ${
            d.recovered_paise ? "text-mint" : "text-muted"
          }`}
        >
          {d.recovered_paise
            ? `${inr(d.recovered_paise)} recovered`
            : "not recovered"}
        </span>
      </div>

      <p className="text-[11.5px] text-faint leading-relaxed">
        {d.recovery_basis}
      </p>

      <ol className="space-y-0">
        {d.steps.map((s: any, i: number) => (
          <li key={i} className="flex gap-3">
            {/* the rail: a dot per step, a line between them */}
            <div className="flex flex-col items-center shrink-0 pt-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  STAGE_TONE[s.stage] ?? "bg-edge"
                }`}
              />
              {i < d.steps.length - 1 && (
                <span className="w-px flex-1 bg-line mt-1" />
              )}
            </div>
            <div className="pb-4 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="ui text-[9.5px] uppercase tracking-[0.1em] text-faint">
                  {s.stage}
                </span>
                <span className="text-[12.5px]">{s.label}</span>
              </div>
              <div className="text-[12px] text-muted mt-0.5 leading-snug break-words">
                {s.detail}
              </div>
              <div className="num text-[10.5px] text-faint mt-1 break-all">
                {s.source}
                {s.ref ? ` · ${s.ref}` : ""}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
