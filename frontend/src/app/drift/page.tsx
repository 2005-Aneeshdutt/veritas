"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookLenses } from "@/components/BookLenses";
import { DriftDetail, DriftPlot } from "@/components/DriftPlot";
import { TopBar } from "@/components/Chrome";
import { Card, Detail, Eyebrow, Figure, Figures, Hero, Loading, PageHead, Stagger, Ticker } from "@/components/ui";
import { inr } from "@/lib/types";

const SEV: Record<string, string> = {
  critical: "text-rose border-rose/30 bg-rose-soft",
  high: "text-amber border-amber/30 bg-amber-soft",
  moderate: "text-muted border-line bg-raised",
};

export default function DriftPage() {
  //: Which issuer the reader has opened. One at a time — the plot is the
  //: overview and this is the detail, rather than eight expanded rows.
  const [picked, setPicked] = useState<any>(null);
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    fetch("/api/drift")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setD)
      .catch(() => setD({ unreachable: true }));
  }, []);

  if (!d) return <Shell><Loading label="reading 32 months of NPCI data" /></Shell>;
  if (d.unreachable)
    return (
      <Shell>
        <Card className="border-l-2 border-l-rose">
          <div className="text-sm font-medium">Cannot reach the API</div>
          <p className="text-sm text-muted mt-1.5">
            Start the backend with <span className="num">make demo</span> and
            reload. The NPCI data is committed and is not missing.
          </p>
        </Card>
      </Shell>
    );
  if (!d.deteriorating) return <Shell><Card>No drift data.</Card></Shell>;

  const maxDelta = Math.max(
    ...d.deteriorating.map((x: any) => Math.abs(x.delta_pts)),
    ...d.improving.map((x: any) => Math.abs(x.delta_pts)),
    1
  );

  return (
    <Shell>
      <div className="space-y-6">
        <Stagger>
          <PageHead
            title="The book"
            sub="NPCI publishes bank performance monthly, and it moves. This watches it and prices the damage before anyone complains."
            right={<BookLenses />}
          />
        </Stagger>

        <Stagger i={1}>
          <div className="space-y-7">
            <Hero
              label="Cost of this quarter's degradation, nationally"
              kind="projected"
              value={
                <>
                  ₹
                  <Ticker
                    value={d.total_national_impact_paise / 100 / 1e7}
                    decimals={0}
                  />
                  <span className="text-xl ml-1">Cr</span>
                </>
              }
              sub={`Per month, across every merchant in India on these issuers. Comparing ${d.recent_window.join(
                ", "
              )} against ${d.prior_window.join(
                ", "
              )} — three-month windows, because a single-month comparison on a noisy series fires every month and gets ignored.`}
            />

            <Figures>
              <Figure
                label="Deteriorating"
                value={d.deteriorating.length}
                tone="bad"
                kind="measured"
                sub="issuers materially worse than their own prior window"
              />
              <Figure
                label="Improving"
                value={d.improving.length}
                tone="good"
                kind="measured"
                sub="moving the other way over the same window"
              />
              <Figure
                label="Examined"
                value={d.banks_examined}
                sub="every remitter NPCI publishes for both windows"
              />
              <Figure
                label="Exposed on this book"
                kind="projected"
                value={d.merchants_affected}
                sub={
                  d.merchants_affected
                    ? `${inr(d.total_exposure_paise, { compact: true })}/month, from their actual bank mix`
                    : "no merchant here has material volume on a deteriorating issuer"
                }
              />
            </Figures>
          </div>
        </Stagger>

        {/* Every bank on one axis, so the shape of the month is the first
            thing you see: most of the rail held still, a handful moved. */}
        <Stagger i={2}>
          <div className="border-t border-line pt-5">
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <h2>Which issuers moved</h2>
              <span className="text-[12px] text-muted">
                {d.prior_window.join(", ")} against {d.recent_window.join(", ")} —
                three-month windows, because a single month on a noisy series
                fires every month and gets ignored.
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="chip text-rose">{d.deteriorating.length} deteriorating</span>
              <span className="chip text-mint">{d.improving.length} improving</span>
              <span className="chip text-faint">
                {d.banks_examined - d.deteriorating.length - d.improving.length} held still
              </span>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-5 items-start">
              <DriftPlot
                banks={[...d.deteriorating, ...d.improving.slice(0, 8)]}
                selected={picked?.bank}
                onSelect={(b) => setPicked(b)}
              />
              <div className="space-y-3">
                {picked ? (
                  <DriftDetail b={picked} />
                ) : (
                  <div className="panel p-4">
                    <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
                      Pick an issuer
                    </div>
                    <p className="text-[12px] text-muted mt-2 leading-relaxed">
                      The system noticed these moving before any merchant
                      complained. Select one to see what it cost and whether it
                      looks like an incident or like customers with less money.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Stagger>

        {/* exposure */}
        <Stagger i={3}>
          <Card className={d.exposures.length ? "border-l-2 border-l-rose" : ""}>
            <Eyebrow>Who on this book is exposed</Eyebrow>
            <h2 className="text-lg font-semibold mt-1">
              {d.exposures.length > 0
                ? `${inr(d.total_exposure_paise)}/month across ${
                    d.merchants_affected
                  } merchant${d.merchants_affected > 1 ? "s" : ""}`
                : "No merchant on this book is materially exposed"}
            </h2>
            <p className="text-sm text-muted mt-1.5 max-w-3xl">
              Computed from each merchant&apos;s actual bank mix, so it is a rupee
              figure rather than a generic warning.
            </p>

            {d.exposures.length > 0 ? (
              <div className="mt-4 space-y-2">
                {d.exposures.map((e: any, i: number) => (
                  <Link
                    key={i}
                    href={`/run/${e.run_id}`}
                    className="card-raised p-3 flex items-center gap-4 hover:border-brand/40
                               transition-colors group"
                  >
                    <span className="w-40 shrink-0 text-sm font-medium truncate">
                      {e.merchant_name}
                    </span>
                    <span className="flex-1 min-w-0 text-xs text-muted truncate">
                      {e.share_pct}% of volume on {e.bank}
                    </span>
                    <span className="num text-xs text-rose shrink-0">
                      +{e.delta_pts.toFixed(2)} pts
                    </span>
                    <span className="num text-sm text-amber w-24 text-right shrink-0">
                      {inr(e.exposure_paise)}/mo
                    </span>
                    <span className="text-brand group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card-raised p-4 mt-4 text-sm text-mint">
                ✓ None of the 8 merchants routes materially through a degrading
                issuer this quarter. Reported as a clean result rather than padded
                with a warning nobody needs to act on.
              </div>
            )}
          </Card>
        </Stagger>

        {/* the intervention */}
        <Stagger i={3}>
          <Intervention report={d} />
        </Stagger>

        <Stagger i={4}>
          <p className="text-[12px] text-faint leading-relaxed max-w-3xl">
            Improving issuers are on the same axis rather than in a separate
            list. A monitor that only ever reports bad news is not measuring,
            it is alarming.
          </p>
        </Stagger>

        <Stagger i={5}>
          <Card>
            <Eyebrow>Source</Eyebrow>
            <Detail summary="where this data comes from">
              <p className="text-sm text-muted mt-2 leading-relaxed max-w-3xl">
              Every number on this page comes from NPCI&apos;s published top-50
              remitter tables — 32 months, committed to the repo, parsed from a
              pinned Internet Archive capture. The national rupee figure multiplies
              published volume by the published average ticket (₹401.52, derived
              from NPCI&apos;s own volume and value columns), which is why it is
              labelled projected rather than measured.
            </p>
            </Detail>
          </Card>
        </Stagger>
      </div>
    </Shell>
  );
}

function BankRow({
  b,
  maxDelta,
  worse,
}: {
  b: any;
  maxDelta: number;
  worse?: boolean;
}) {
  const w = (Math.abs(b.delta_pts) / maxDelta) * 100;
  return (
    <div className="card-raised p-3">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="w-56 shrink-0 text-sm font-medium truncate">{b.bank}</span>

        <span className="num text-xs text-muted w-32 shrink-0">
          {b.prior_pct.toFixed(2)}%
          <span className="text-faint mx-1">→</span>
          <span className={worse ? "text-rose" : "text-mint"}>
            {b.recent_pct.toFixed(2)}%
          </span>
        </span>

        <span className={`chip shrink-0 ${SEV[b.severity]}`}>
          {b.delta_pts > 0 ? "+" : ""}
          {b.delta_pts.toFixed(2)} pts
        </span>

        <div className="flex-1 min-w-[80px] h-1.5 rounded-full bg-raised overflow-hidden">
          <div
            className={`h-full rounded-full ${worse ? "bg-rose/70" : "bg-mint/70"}`}
            style={{ width: `${w}%` }}
          />
        </div>

        <span className="num text-[11px] text-faint w-20 text-right shrink-0">
          {b.volume_mn.toFixed(0)} Mn/mo
        </span>

        {worse && (
          <span className="num text-xs text-amber w-24 text-right shrink-0">
            ₹{(b.national_impact_paise / 100 / 1e7).toFixed(1)} Cr
          </span>
        )}
      </div>

      {worse && Math.abs(b.technical_share_delta) > 0.08 && (
        <div className="text-[11px] text-muted mt-2 pl-1">
          {b.technical_share_delta > 0 ? (
            <>
              technical share of failures rose{" "}
              {(b.technical_share_delta * 100).toFixed(0)} points — this looks like
              an incident, not customers with less money
            </>
          ) : (
            <>
              technical share fell {(-b.technical_share_delta * 100).toFixed(0)}{" "}
              points — the increase is business declines, not infrastructure
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8">{children}</main>
    </div>
  );
}

/* --------------------------------------------------------- intervention */

const SIM_MERCHANTS = [
  "quickmart", "cloudsync", "techbazaar", "chaipoint",
  "medisure", "voltbill", "urbanthread", "fuelstop",
];

/**
 * Detection is only half of it.
 *
 * A degradation that clears both thresholds becomes a typed action and is put
 * to the merchant's signed mandate — the same kernel every other action goes
 * through. On the current data nothing clears them, which is stated rather
 * than engineered around; the counterfactual below exercises the real gate
 * against a supposed movement so the machinery is visible without the demo
 * data being re-weighted until it looked busy.
 */
function Intervention({ report }: { report: any }) {
  const [merchant, setMerchant] = useState("quickmart");
  const [banks, setBanks] = useState<string[]>([]);
  const [bank, setBank] = useState("");
  const [delta, setDelta] = useState(2.0);
  const [sim, setSim] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Read this merchant's banks — without running a diagnosis to get them.
   *
   * This used to POST /api/run, which executes the entire graph, purely to
   * populate a dropdown. Rendering a select is not a reason to run the engine:
   * it cost a full run on every mount of this page, and before run ids were
   * reused it left a new record on disk each time, which is how six orphan
   * runs appeared during a single test session.
   *
   * It reads the merchant's existing committed run instead. Same data, no
   * write, no work.
   */
  useEffect(() => {
    let cancelled = false;

    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((pf) => {
        const row = (pf.merchants ?? []).find(
          (m: { merchant_id: string }) => m.merchant_id === merchant
        );
        if (!row?.run_id) throw new Error("no run for this merchant");
        return fetch(`/api/run/${row.run_id}`).then((r) => r.json());
      })
      .then((rec) => {
        if (cancelled) return;
        const bs = (rec.report?.bank_health?.banks ?? []).map((b: any) => b.bank);
        setBanks(bs);
        setBank(bs[0] ?? "");
      })
      .catch(() => {
        if (!cancelled) setBanks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [merchant]);

  async function run() {
    if (!bank) return;
    setBusy(true);
    const q = new URLSearchParams({
      merchant,
      bank,
      delta_pts: String(delta),
    });
    const r = await fetch(`/api/drift/simulate?${q}`);
    setSim(r.ok ? await r.json() : null);
    setBusy(false);
  }

  const e = sim?.exposure;

  return (
    <Card>
      <Eyebrow>Detection is half of it</Eyebrow>
      <h2 className="text-lg font-semibold mt-1">
        {report.interventions_proposed > 0
          ? `${report.interventions_proposed} interventions put to a mandate`
          : "Nothing on this book clears the bar for an intervention"}
      </h2>
      <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
        A degradation worth more than ₹5,000/month on a bank that moved at least
        1.00 point becomes a typed action, gated against the merchant&apos;s signed
        mandate. Today the issuers that degraded are small regional banks and this
        book routes through the large nationals, so the honest count is{" "}
        {report.interventions_proposed}. Rather than re-weighting the merchants
        until the feature looked busy, ask the counterfactual directly.
      </p>

      <div className="card-raised p-4 mt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="chip-projected">hypothetical</span>
          <span className="text-xs text-muted">
            real bank mix, real volume, real mandate — only the movement is supposed
          </span>
        </div>

        <div className="flex items-end gap-3 flex-wrap mt-3">
          <div>
            <div className="eyebrow mb-1">merchant</div>
            <select
              value={merchant}
              onChange={(ev) => setMerchant(ev.target.value)}
              className="field h-9 py-0 text-sm w-44"
            >
              {SIM_MERCHANTS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="eyebrow mb-1">if this issuer degraded</div>
            <select
              value={bank}
              onChange={(ev) => setBank(ev.target.value)}
              className="field h-9 py-0 text-sm w-60"
            >
              {banks.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[10rem]">
            <div className="eyebrow mb-1">by {delta.toFixed(1)} points</div>
            <input
              type="range" min={0.2} max={6} step={0.1} value={delta}
              onChange={(ev) => setDelta(Number(ev.target.value))}
              className="w-full accent-brand"
            />
          </div>
          <button onClick={run} disabled={busy || !bank} className="btn-primary h-9 px-4 text-sm">
            {busy ? "gating…" : "What would the agent do?"}
          </button>
        </div>

        {e && (
          <div className="mt-4 pt-4 border-t border-line animate-rise">
            <div className="grid sm:grid-cols-4 gap-3">
              <Fig k="share of volume" v={`${e.share_pct.toFixed(1)}%`} />
              <Fig k="monthly exposure" v={inr(e.exposure_paise)} tone="text-amber" />
              <Fig
                k="clears the bar"
                v={e.actionable ? "yes" : "no"}
                tone={e.actionable ? "text-mint" : "text-faint"}
              />
              <Fig
                k="mandate says"
                v={e.gate_decision ?? "—"}
                tone={
                  e.gate_decision === "deny"
                    ? "text-rose"
                    : e.gate_decision === "step_up"
                    ? "text-amber"
                    : e.gate_decision
                    ? "text-mint"
                    : "text-faint"
                }
              />
            </div>

            {e.proposed_action ? (
              <div className="card-raised p-3 mt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="chip-brand">
                    {e.proposed_action.action_type}
                  </span>
                  <span className="chip-neutral">{e.gate_reason}</span>
                  <span className="num text-[11px] text-faint ml-auto">
                    amount ₹0 — a routing change moves no money
                  </span>
                </div>
                <p className="text-xs text-muted mt-2 leading-relaxed">
                  {e.proposed_action.reason}
                </p>
                <p className="text-[11px] text-faint mt-2">{e.rationale}</p>
              </div>
            ) : (
              <p className="text-xs text-muted mt-3">{e.rationale}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function Fig({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div className="eyebrow">{k}</div>
      <div className={`num text-sm mt-0.5 ${tone ?? ""}`}>{v}</div>
    </div>
  );
}
