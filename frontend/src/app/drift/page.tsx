"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/Chrome";
import { Card, Eyebrow, Loading, Stagger, Ticker } from "@/components/ui";
import { inr } from "@/lib/types";

const SEV: Record<string, string> = {
  critical: "text-rose border-rose/30 bg-rose-soft",
  high: "text-amber border-amber/30 bg-amber-soft",
  moderate: "text-muted border-line bg-raised",
};

export default function DriftPage() {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    fetch("/api/drift").then((r) => r.json()).then(setD).catch(() => setD({}));
  }, []);

  if (!d) return <Shell><Loading label="reading 32 months of NPCI data" /></Shell>;
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
          <div>
            <Eyebrow>The proactive half</Eyebrow>
            <h1 className="text-2xl font-semibold mt-1">
              Issuers that moved before anyone complained
            </h1>
            <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
              Every other page waits for a merchant to have a problem. This one
              watches NPCI&apos;s published bank series and says so first. A merchant
              on a degrading issuer is losing money for reasons that have nothing to
              do with anything they changed.
            </p>
          </div>
        </Stagger>

        {/* headline */}
        <Stagger i={1}>
          <Card className="!p-0 overflow-hidden">
            <div className="bg-brand-soft px-6 py-6 flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <Eyebrow>Cost of this quarter&apos;s degradation, nationally</Eyebrow>
                <div className="flex items-baseline gap-3 mt-2">
                  <span className="text-5xl font-display font-bold text-brand leading-none">
                    ₹
                    <Ticker
                      value={d.total_national_impact_paise / 100 / 1e7}
                      decimals={0}
                    />
                    <span className="text-2xl ml-1">Cr</span>
                  </span>
                  <span className="chip-projected">projected</span>
                </div>
                <div className="text-sm text-muted mt-2">
                  per month, across every merchant in India on these issuers
                </div>
              </div>

              <div className="h-12 w-px bg-line hidden md:block" />

              <div>
                <div className="text-2xl font-display font-bold text-rose">
                  {d.deteriorating.length}
                </div>
                <div className="text-sm text-muted mt-1">issuers deteriorating</div>
              </div>

              <div>
                <div className="text-2xl font-display font-bold text-mint">
                  {d.improving.length}
                </div>
                <div className="text-sm text-muted mt-1">improving</div>
              </div>

              <div>
                <div className="text-2xl font-display font-bold">
                  {d.banks_examined}
                </div>
                <div className="text-sm text-muted mt-1">examined</div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-line eyebrow">
              comparing {d.recent_window.join(", ")} against{" "}
              {d.prior_window.join(", ")} — three-month windows, because a
              single-month comparison on a noisy series fires every month and gets
              ignored
            </div>
          </Card>
        </Stagger>

        {/* deteriorating */}
        <Stagger i={2}>
          <Card>
            <Eyebrow>Getting worse</Eyebrow>
            <h2 className="text-lg font-semibold mt-1 mb-4">
              Where the ecosystem is degrading
            </h2>
            <div className="space-y-2">
              {d.deteriorating.map((b: any) => (
                <BankRow key={b.key} b={b} maxDelta={maxDelta} worse />
              ))}
            </div>
          </Card>
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

        {/* improving */}
        <Stagger i={4}>
          <Card>
            <Eyebrow>Getting better</Eyebrow>
            <h2 className="text-lg font-semibold mt-1 mb-1">
              Not everything is degrading
            </h2>
            <p className="text-sm text-muted mb-4 max-w-3xl">
              Shown because a monitor that only ever reports bad news is not
              measuring, it is alarming.
            </p>
            <div className="space-y-2">
              {d.improving.slice(0, 6).map((b: any) => (
                <BankRow key={b.key} b={b} maxDelta={maxDelta} />
              ))}
            </div>
          </Card>
        </Stagger>

        <Stagger i={5}>
          <Card>
            <Eyebrow>Source</Eyebrow>
            <p className="text-sm text-muted mt-2 leading-relaxed max-w-3xl">
              Every number on this page comes from NPCI&apos;s published top-50
              remitter tables — 32 months, committed to the repo, parsed from a
              pinned Internet Archive capture. The national rupee figure multiplies
              published volume by the published average ticket (₹401.52, derived
              from NPCI&apos;s own volume and value columns), which is why it is
              labelled projected rather than measured.
            </p>
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
    <div className="min-h-screen bg-canvas">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
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

  useEffect(() => {
    fetch(`/api/run?merchant=${merchant}`, { method: "POST" })
      .then((r) => r.json())
      .then((rec) => {
        const bs = (rec.report?.bank_health?.banks ?? []).map((b: any) => b.bank);
        setBanks(bs);
        setBank(bs[0] ?? "");
      })
      .catch(() => setBanks([]));
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
