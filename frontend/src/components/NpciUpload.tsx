"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Detail, Eyebrow, Panel, SectionHeader } from "@/components/ui";
import { Merchant } from "@/lib/types";

interface Step {
  key: string;
  label: string;
  detail: string;
  status: string;
  data: Record<string, any>;
}

interface NpciSample {
  key: string;
  filename: string;
  about: string;
  bytes: number;
}

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
  const [steps, setSteps] = useState<Step[]>([]);
  const [bundled, setBundled] = useState<NpciSample[]>([]);
  const [usingSample, setUsingSample] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const held = useRef<File | null>(null);

  useEffect(() => {
    fetch("/api/samples")
      .then((r) => r.json())
      .then((d) => setBundled(d.npci ?? []))
      .catch(() => {});
  }, []);

  /**
   * Read the response as it arrives, one step at a time.
   *
   * A spinner followed by a finished table asks a reader to take the middle
   * on trust, which is the opposite of what this panel is for. The steps are
   * real work already done when they are sent -- the pacing throttles the
   * emission, never the computation -- so nothing here is a progress bar
   * pretending to be a calculation.
   *
   * Hand-rolled rather than EventSource because EventSource cannot POST a
   * file. Same wire format either way.
   */
  async function run(opts: { file?: File; sample?: string; p: string }) {
    setBusy(true);
    setErr(null);
    setRes(null);
    setSteps([]);

    const q = new URLSearchParams({
      merchant,
      period: opts.p,
      pace_ms: "260",
    });
    if (opts.sample) q.set("sample", opts.sample);

    let body: FormData | undefined;
    if (opts.file) {
      body = new FormData();
      body.append("file", opts.file);
    }

    try {
      const r = await fetch(`/api/npci/rerun/stream?${q}`, {
        method: "POST",
        body,
      });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        setErr(d.detail ?? "that file could not be read");
        setBusy(false);
        return;
      }

      // Frames are separated by a blank line, fields by one newline.
      const NL = String.fromCharCode(10);
      const SEP = NL + NL;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let event = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let cut: number;
        while ((cut = buf.indexOf(SEP)) !== -1) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          for (const line of frame.split(NL)) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) {
              const d = JSON.parse(line.slice(6));
              if (event === "step") setSteps((s) => [...s, d]);
              else if (event === "error") setErr(d.detail);
              else if (event === "done") {
                setRes(d);
                setPeriod(d.upload.period);
              }
            }
          }
        }
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
    setUsingSample(null);
    run({ file: f, p: "" });
  }

  /** Whichever source is loaded, re-run it rather than leaving a stale result. */
  function rerun(p: string) {
    if (held.current) run({ file: held.current, p });
    else if (usingSample) run({ sample: usingSample, p });
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
            rerun(period);
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

      {/* Nobody arrives carrying a bank table either. This one is a real
          slice of the committed NPCI file -- three months whose median
          failure rate genuinely runs 5.75% to 8.71% -- so the achievable
          rate moves because banks moved, not because we wrote a number. */}
      {bundled.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[12px] text-faint">
            or run the bank table that ships with this repo —
          </span>
          {bundled.map((b) => (
            <button
              key={b.key}
              onClick={() => {
                held.current = null;
                setUsingSample(b.key);
                setName(b.filename);
                run({ sample: b.key, p: "" });
              }}
              disabled={busy}
              title={b.about}
              className={`btn-secondary h-8 text-[12px] ${
                usingSample === b.key ? "border-brand text-brand" : ""
              }`}
            >
              {b.filename}
            </button>
          ))}
        </div>
      )}

      {/* the agent working, one step at a time */}
      {steps.length > 0 && (
        <div className="mt-5 border-l-2 border-l-line pl-4 space-y-2.5">
          {steps.map((st, i) => (
            <div key={st.key} className="animate-rise">
              <div className="flex items-baseline gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 -ml-[21px] mt-1.5 ${
                    st.status === "fail" ? "bg-rose" : "bg-mint"
                  }`}
                />
                <span className="text-[13px] font-medium">{st.label}</span>
                {i === steps.length - 1 && busy && (
                  <span className="eyebrow animate-breathe">working…</span>
                )}
              </div>
              {st.detail && (
                <p
                  className={`text-[12px] mt-0.5 leading-relaxed ${
                    st.status === "fail" ? "text-rose" : "text-muted"
                  }`}
                >
                  {st.detail}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

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
        <Panel tone="warn" className="mt-4">
          <div className="chip-warn">rejected</div>
          <p className="text-[13px] text-muted mt-1.5 leading-relaxed">{err}</p>
        </Panel>
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
                  rerun(e.target.value);
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
