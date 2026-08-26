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
