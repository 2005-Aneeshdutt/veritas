"use client";

import { useRef, useState } from "react";
import { Card, Detail, Eyebrow, SectionHeader } from "@/components/ui";
import { Merchant } from "@/lib/types";

interface Rerun {
  merchant_id: string;
  merchant_name: string;
  upload: {
    period: string;
    banks: number;
    periods: string[];
    median_fail_pct: number;
    best_bank: string;
    best_fail_pct: number;
    worst_bank: string;
    worst_fail_pct: number;
    skipped: number;
    notes: string[];
  };
  shipped_period: string;
  before: { achievable_pct: number; gap_pts: number; primary_cause: string; by_factor: Record<string, number> };
  after: { achievable_pct: number; gap_pts: number; primary_cause: string; by_factor: Record<string, number> };
  moved: Record<string, number>;
  primary_changed: boolean;
}

/**
 * Run the engine on bank data it has never seen.
 *
 * The one question a payments company actually has about a demo is "would
 * this work on our numbers?", and every answer to it is a promise except this
 * one. Hand it a CSV in NPCI's published shape and the whole baseline is
 * re-derived from that file: cohort, achievable rate, every factor.
 *
 * What makes it worth watching is not that the numbers move. It is which ones
 * move. Swap August 2025 for January 2024 and the achievable rate climbs
 * three points because banks were genuinely healthier that month — and the
 * primary cause stays exactly where it was, because a merchant billing at
 * midnight has a midnight problem no matter what the banks were doing.
 *
 * Nothing is written. The upload lives for one request, so the committed
 * tables that CI reproduces against are never touched.
 */
export function NpciUpload({ merchants }: { merchants: Merchant[] }) {
  const [merchant, setMerchant] = useState("cloudsync");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Rerun | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const held = useRef<File | null>(null);

  async function send(f: File, p: string) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(
        `/api/npci/rerun?merchant=${merchant}&period=${encodeURIComponent(p)}`,
        { method: "POST", body: fd }
      );
      const d = await r.json();
      if (!r.ok) {
        setErr(d.detail ?? "that file could not be read");
        setRes(null);
      } else {
        setRes(d);
        setPeriod(d.upload.period);
      }
    } catch {
      setErr("could not reach the API");
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    held.current = f;
    setName(f.name);
    send(f, "");
  }

  return (
    <Card>
      <SectionHeader
        eyebrow="Run it on your own numbers"
        title="Bring your own NPCI data"
        sub="Drop in a bank performance table and every baseline is re-derived from it — cohort, achievable rate, and each factor's share. Nothing is saved; the upload lives for one request."
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={merchant}
          onChange={(e) => {
            setMerchant(e.target.value);
            if (held.current) send(held.current, period);
          }}
          disabled={busy}
          className="field h-9 py-0 text-sm max-w-[13rem]"
        >
          {merchants.map((m) => (
            <option key={m.merchant_id} value={m.merchant_id}>
              {m.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn-primary h-9 px-4 text-sm"
        >
          {busy ? "reading…" : name ? "Choose another CSV" : "Upload a CSV"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onPick}
          className="sr-only"
        />

        {name && <span className="text-[13px] text-muted truncate">{name}</span>}
      </div>

      <Detail summary="what the file has to look like">
        <p>
          NPCI&rsquo;s remitter table, as published:{" "}
          <code className="num text-[12px]">
            period, bank, total_volume_mn, approved_pct, bd_pct, td_pct
          </code>
          . The copy in <code className="num text-[12px]">data/npci/</code> is
          exactly this shape, so you can upload the repo&rsquo;s own file and
          pick a different month.
        </p>
      </Detail>

      {err && (
        <div className="card-raised border-l-2 border-l-rose p-3 mt-4">
          <div className="chip-warn">rejected</div>
          <p className="text-sm text-muted mt-2 leading-relaxed">{err}</p>
        </div>
      )}

      {res && (
        <div className="mt-4 space-y-4 animate-rise">
          {/* what was in the file */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip-measured">{res.upload.banks} banks</span>
            <span className="chip-neutral">{res.upload.period}</span>
            <span className="chip-neutral">
              median fail {res.upload.median_fail_pct.toFixed(2)}%
            </span>
            {res.upload.skipped > 0 && (
              <span className="chip-warn">{res.upload.skipped} rows skipped</span>
            )}
            {res.upload.periods.length > 1 && (
              <select
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  if (held.current) send(held.current, e.target.value);
                }}
                disabled={busy}
                className="field h-8 py-0 text-xs max-w-[9rem] ml-auto"
              >
                {res.upload.periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* what moved */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[460px]">
              <thead>
                <tr className="text-left">
                  <th className="eyebrow py-2">factor</th>
                  <th className="eyebrow py-2 text-right">
                    shipped · {res.shipped_period}
                  </th>
                  <th className="eyebrow py-2 text-right">
                    yours · {res.upload.period}
                  </th>
                  <th className="eyebrow py-2 text-right">moved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                <Row
                  k="achievable rate"
                  a={res.before.achievable_pct}
                  b={res.after.achievable_pct}
                  unit="%"
                />
                <Row
                  k="gap"
                  a={res.before.gap_pts}
                  b={res.after.gap_pts}
                  unit=" pts"
                />
                {Object.keys(res.moved).map((f) => (
                  <Row
                    key={f}
                    k={f.replace("_", " ")}
                    a={res.before.by_factor[f]}
                    b={res.after.by_factor[f]}
                    unit=" pts"
                    dim
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* the point */}
          <div
            className={`card-raised p-4 border-l-2 ${
              res.primary_changed ? "border-l-amber" : "border-l-mint"
            }`}
          >
            <Eyebrow>primary cause</Eyebrow>
            <div className="num text-sm mt-1">
              {res.before.primary_cause}
              <span className="text-muted mx-2">→</span>
              <span
                className={res.primary_changed ? "text-amber" : "text-mint"}
              >
                {res.after.primary_cause}
              </span>
            </div>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              {res.primary_changed
                ? "Different bank data, different answer — and the engine says so rather than holding its previous conclusion."
                : "Every number moved and the diagnosis held. The cause is a property of this merchant, not of the month the banks had."}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({
  k,
  a,
  b,
  unit,
  dim,
}: {
  k: string;
  a: number;
  b: number;
  unit: string;
  dim?: boolean;
}) {
  const d = b - a;
  return (
    <tr className={dim ? "text-muted" : ""}>
      <td className="py-2">{k}</td>
      <td className="py-2 text-right num tabular-nums">
        {a.toFixed(3)}
        {unit}
      </td>
      <td className="py-2 text-right num tabular-nums text-ink">
        {b.toFixed(3)}
        {unit}
      </td>
      <td
        className={`py-2 text-right num tabular-nums ${
          Math.abs(d) < 0.001 ? "text-faint" : d > 0 ? "text-amber" : "text-mint"
        }`}
      >
        {d > 0 ? "+" : ""}
        {d.toFixed(3)}
      </td>
    </tr>
  );
}
