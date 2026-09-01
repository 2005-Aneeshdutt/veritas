"use client";

import { useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { NpciUpload } from "@/components/NpciUpload";
import { Card, Detail, Eyebrow, Figure, PageHead, Panel, SectionHeader, Stagger } from "@/components/ui";
import { Merchant } from "@/lib/types";

interface Summary {
  rows: number;
  used: number;
  skipped: number;
  failures: number;
  success_pct: number;
  banks: number;
  methods: Record<string, number>;
  classified: Record<string, number>;
  unclassified_codes: string[];
  notes: string[];
}

interface Sample {
  key: string;
  filename: string;
  mcc: string;
  about: string;
  bytes: number;
}

interface Diagnosis {
  observed_pct: number;
  achievable_pct: number;
  gap_pts: number;
  process_gap_pts: number;
  primary_cause: string;
  factors: { factor: string; points: number; identified: boolean }[];
  reliable: boolean;
  degenerate_factors: string[];
  cohort_family: string;
}

const CATEGORIES = [
  { mcc: "5411", label: "Grocery" },
  { mcc: "5734", label: "Software / SaaS" },
  { mcc: "4900", label: "Utilities" },
  { mcc: "5912", label: "Pharmacy" },
  { mcc: "5651", label: "Apparel" },
  { mcc: "5732", label: "Electronics" },
  { mcc: "4722", label: "Travel" },
  { mcc: "6300", label: "Insurance" },
];

/**
 * Bring your own data.
 *
 * The question every payments company actually has about a demo is "would
 * this work on our numbers?", and every answer to it is a promise. There are
 * two halves to answering it properly, and this page is both:
 *
 *   * your payments, run through the decomposition
 *   * your bank table, replacing the baseline the engine measures against
 *
 * It is deliberately not one of the five demo steps. The walkthrough is a
 * story with an order; this is a tool you reach for when you stop believing
 * the story and want to try it yourself.
 */
export default function DataPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [mcc, setMcc] = useState("5411");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const held = useRef<File | null>(null);

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then(setMerchants)
      .catch(() => {});
    // The buttons came from a hardcoded pair, so a file added to samples/
    // would ship without a way to run it. The server already knows what is
    // on disk; asking it means the two cannot drift.
    fetch("/api/samples")
      .then((r) => r.json())
      .then((d) => setSamples(d.samples ?? []))
      .catch(() => {});
  }, []);

  async function send(f: File, category: string) {
    setBusy(true);
    setErr(null);
    setSample(null); // an uploaded file replaces whichever sample was loaded
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`/api/txns/diagnose?mcc=${category}`, {
        method: "POST",
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.detail ?? "That file could not be read.");
        setSummary(null);
        setDiag(null);
      } else {
        setSummary(d.summary);
        setDiag(d.diagnosis);
      }
    } catch {
      setErr("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Run a file that ships with the repository.
   *
   * "Would this work on our numbers?" is the question, and answering it
   * needs numbers. Somebody watching a demo has none to hand, and asking
   * them to go and export a month of payments first is asking them to stop
   * watching. Same parse, same decomposition, different door.
   */
  async function runSample(key: string, label: string, category: string) {
    setBusy(true);
    setErr(null);
    setSample(key);
    setName(label);
    held.current = null;
    try {
      const r = await fetch(`/api/txns/diagnose/sample?name=${key}&mcc=${category}`, {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.detail ?? "That sample could not be read.");
        setSummary(null);
        setDiag(null);
      } else {
        setSummary(d.summary);
        setDiag(d.diagnosis);
      }
    } catch {
      setErr("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">
        <Stagger>
          <PageHead
            title="Your own data"
            sub="Two ways to stop taking this on trust: hand it your payments, or hand it the bank table it measures against."
          />
        </Stagger>

        {/* ── your payments ── */}
        <Stagger i={1}>
          <Card>
            <SectionHeader
              title="Diagnose a month of your own transactions"
              sub="The same decomposition the demo merchants get. Column names are matched loosely — issuer or bank, status or succeeded, amount or amount_paise — because no two exports agree on them."
            />

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={mcc}
                onChange={(e) => {
                  const next = e.target.value;
                  setMcc(next);
                  // Whichever source is loaded, re-run it against the new
                  // cohort rather than leaving a result on screen that was
                  // computed against the old one.
                  if (held.current) send(held.current, next);
                  else if (sample) runSample(sample, name ?? sample, next);
                }}
                disabled={busy}
                className="field h-9 py-0 text-sm max-w-[15rem]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.mcc} value={c.mcc}>
                    {c.label}
                  </option>
                ))}
              </select>

              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="btn-primary h-9 px-4 text-sm"
              >
                {busy ? "reading…" : name ? "Choose another CSV" : "Upload payments CSV"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  held.current = f;
                  setName(f.name);
                  send(f, mcc);
                }}
                className="sr-only"
              />
              {name && (
                <span className="text-[13px] text-muted truncate">{name}</span>
              )}
            </div>

            {/* Nobody arrives at a demo carrying a month of payments. Both
                samples are worth a click, and the second one is worth more:
                a system that only ever walks the happy path is not
                demonstrating restraint. */}
            {samples.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[12px] text-faint">
                  or run one that ships with this repo —
                </span>
                {samples.map((sm) => (
                  <button
                    key={sm.key}
                    onClick={() => runSample(sm.key, sm.filename, mcc)}
                    disabled={busy}
                    className={`btn-secondary h-8 text-[12px] ${
                      sample === sm.key ? "border-brand text-brand" : ""
                    }`}
                    title={sm.about}
                  >
                    {sm.filename}
                  </button>
                ))}
              </div>
            )}

            <Detail summary="what the file needs">
              <p>
                One row per payment attempt. Four columns are required —{" "}
                <code className="num text-[12px]">bank</code>,{" "}
                <code className="num text-[12px]">method</code>,{" "}
                <code className="num text-[12px]">amount</code>,{" "}
                <code className="num text-[12px]">succeeded</code> — and{" "}
                <code className="num text-[12px]">error_code</code>,{" "}
                <code className="num text-[12px]">hour</code> and{" "}
                <code className="num text-[12px]">txn_id</code> make the
                diagnosis sharper. Success can be true/false, 1/0, or
                captured/failed. Error codes are read against Razorpay&rsquo;s
                110 published codes with no model call; anything outside that
                list is carried as unclassified rather than guessed at.
              </p>
              <p>
                At least 200 payments. Below that the uncertainty on a success
                rate is wider than the effects being attributed, so a
                diagnosis would be noise and the upload is refused rather than
                answered.
              </p>
            </Detail>

            {err && (
              <Panel tone="warn" className="mt-4">
                <div className="chip-warn">rejected</div>
                <p className="text-[13px] text-muted mt-1.5 leading-relaxed">{err}</p>
              </Panel>
            )}

            {summary && diag && (
              <div className="mt-5 space-y-5 animate-rise">
                {/* What the parser found, named. An ingestion console that
                    says "2,400 rows" without saying which columns it matched
                    is asking you to trust the match. */}
                <div>
                  <div className="ui text-[10px] uppercase tracking-[0.11em] text-faint mb-2">
                    Columns matched
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {[
                      ["bank", true],
                      ["method", true],
                      ["amount", true],
                      ["succeeded", true],
                      ["error_code", summary.failures > 0],
                      ["hour", true],
                    ].map(([k, ok]) => (
                      <span key={String(k)} className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            ok ? "bg-mint" : "bg-line"
                          }`}
                        />
                        <span className="num text-[11.5px] text-muted">{k}</span>
                      </span>
                    ))}
                  </div>
                  {summary.unclassified_codes.length > 0 && (
                    <p className="text-[11px] text-amber mt-2">
                      {summary.unclassified_codes.length} error codes outside
                      Razorpay&rsquo;s published list — carried as unclassified
                      rather than guessed at.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip-measured">
                    {summary.used.toLocaleString("en-IN")} payments
                  </span>
                  <span className="chip-neutral">{summary.banks} banks</span>
                  <span className="chip-neutral">
                    {summary.failures.toLocaleString("en-IN")} failures
                  </span>
                  {summary.skipped > 0 && (
                    <span className="chip-warn">{summary.skipped} rows skipped</span>
                  )}
                  {summary.unclassified_codes.length > 0 && (
                    <span className="chip-warn">
                      {summary.unclassified_codes.length} unknown codes
                    </span>
                  )}
                </div>

                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3
                                divide-y divide-line sm:divide-y-0 sm:divide-x">
                  <Figure
                    label="your success rate"
                    kind="measured"
                    value={`${diag.observed_pct.toFixed(2)}%`}
                  />
                  <Figure
                    label="your category achieves"
                    kind="projected"
                    value={`${diag.achievable_pct.toFixed(2)}%`}
                  />
                  <Figure
                    label="the gap"
                    kind="projected"
                    value={`${diag.gap_pts.toFixed(2)} pts`}
                    tone={diag.gap_pts > 0.75 ? "bad" : "good"}
                  />
                </div>

                <div>
                  <Eyebrow>what is causing it</Eyebrow>
                  <div className="space-y-1.5 mt-2">
                    {diag.factors.map((f) => (
                      <div key={f.factor} className="flex items-center gap-3">
                        <span className="text-[12px] text-muted w-24 shrink-0">
                          {f.factor.replace("_", " ")}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                          <div
                            className={`h-full ${
                              f.identified ? "bg-brand" : "bg-line"
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (Math.abs(f.points) /
                                  Math.max(0.01, Math.abs(diag.gap_pts))) *
                                  100
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="num text-[12px] w-20 text-right shrink-0">
                          {f.points >= 0 ? "+" : ""}
                          {f.points.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {diag.degenerate_factors.length > 0 && (
                    <p className="text-[11px] text-faint mt-2 leading-relaxed">
                      {diag.degenerate_factors.join(", ")} could not be
                      separated in this data — too little variation to attribute
                      to. Shown flat rather than given a number we cannot stand
                      behind.
                    </p>
                  )}
                </div>

                <Panel tone="note">
                  <Eyebrow>what this does not tell you</Eyebrow>
                  <p className="text-sm text-muted mt-1.5 leading-relaxed">
                    Every figure here is projected. There is no known outcome
                    for your payments to mark against, so nothing on this page
                    can be measured the way the demo book is — and no action is
                    proposed, because a file upload is not a signed mandate.
                  </p>
                </Panel>
              </div>
            )}
          </Card>
        </Stagger>

        {/* ── your bank table ── */}
        <Stagger i={2}>
          <NpciUpload merchants={merchants} />
        </Stagger>
      </main>
    </div>
  );
}
