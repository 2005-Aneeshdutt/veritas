"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import {
  Detail,
  Empty,
  Figure,
  Figures,
  Loading,
  Notes,
  PageHead,
  SectionHeader,
  Stagger,
} from "@/components/ui";
import { inr } from "@/lib/types";

interface Fix {
  merchant_id: string;
  merchant_name: string;
  cause_fixed: string;
  factor: string | null;
  predicted_pts: number;
  predicted_error_pts: number | null;
  before_pct: number;
  after_pct: number;
  measured_pts: number;
  forecast_error_pts: number;
  within_error_bar: boolean;
  verdict: string;
  predicted_value_paise: number;
  measured_value_paise: number;
}

interface Merchant {
  merchant_id: string;
  name: string;
  observed_pct: number;
  achievable_pct: number;
  gap_pts: number;
  recoverable_central_paise: number;
  run_id: string;
}

/**
 * Before, and after.
 *
 * Evidence answers "did the forecast hold" as a table of signed errors, which
 * is the right shape for checking and the wrong shape for seeing. The same
 * eight fixes drawn as a rate moving from one place to another, with the band
 * we published beforehand laid over the distance it actually travelled, is
 * the single most legible artefact this project has — and it was buried in a
 * column called `forecast_error_pts`.
 *
 * The scale is the thing to get right. These are movements of one to four
 * points on a rate in the high eighties, so an axis from 0 to 100 renders
 * every fix as an invisible nudge and an axis cropped to the data makes a
 * 0.1-point wobble look like a triumph. It is drawn on a fixed window around
 * the observed range instead, stated on the axis, so the bars are comparable
 * between merchants and nothing is flattered by its own zoom.
 */
export default function ImpactPage() {
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [book, setBook] = useState<Merchant[] | null>(null);
  const [dead, setDead] = useState(false);
  const [pf, setPf] = useState<any>(null);

  useEffect(() => {
    fetch("/api/evals")
      .then((r) => r.json())
      .then((d) => setFixes(d.outcome_accuracy?.fixes ?? []))
      .catch(() => setDead(true));
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => {
        setBook(d.merchants ?? []);
        setPf(d);
      })
      .catch(() => setDead(true));
  }, []);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">{body}</main>
    </div>
  );

  if (dead) return shell(<Empty label="the API did not respond" />);
  if (!fixes || !book) return shell(<Loading label="reading every scored fix" />);
  if (fixes.length === 0)
    return shell(<Empty label="no fixes have been scored yet" />);

  // A fixed window around what the data actually occupies. Wide enough that a
  // small movement looks small, tight enough that any of them are visible.
  const lo = 78;
  const hi = 94;
  const x = (pct: number) => ((Math.min(hi, Math.max(lo, pct)) - lo) / (hi - lo)) * 100;

  const gained = fixes.reduce((n, f) => n + Math.max(0, f.measured_value_paise), 0);
  const promised = fixes.reduce((n, f) => n + f.predicted_value_paise, 0);
  const held = fixes.filter((f) => f.within_error_bar).length;

  return shell(
    <>
      <Stagger>
        <PageHead
          title="Before and after"
          sub="Every fix this system has scored, drawn as the merchant's success rate moving — with the band we published beforehand laid over the distance it actually travelled."
        />
      </Stagger>

      <Stagger i={1}>
        <Figures>
          <Figure
            label="fixes scored"
            value={fixes.length}
            sub="each a counterfactual month, regenerated with the cause removed"
          />
          <Figure
            label="we promised"
            kind="projected"
            value={inr(promised, { compact: true })}
            sub="summed across every fix, before any of them ran"
          />
          <Figure
            label="it delivered"
            kind="measured"
            tone="good"
            value={inr(gained, { compact: true })}
            sub="counting only the fixes that moved the rate upward"
          />
          <Figure
            label="landed inside their band"
            value={`${held} of ${fixes.length}`}
            tone={held * 2 >= fixes.length ? "good" : "bad"}
            sub="the error bar was published before the fix ran"
          />
        </Figures>
      </Stagger>

      {/* ── the picture ── */}
      <Stagger i={2}>
        <SectionHeader
          title="What each fix actually moved"
          sub="The bar is the distance travelled. The pale block is the range we forecast before it ran, so where the two overlap the forecast held."
        />

        <div className="space-y-4">
          {fixes.map((f, i) => {
            const up = f.after_pct >= f.before_pct;
            const a = x(Math.min(f.before_pct, f.after_pct));
            const b = x(Math.max(f.before_pct, f.after_pct));

            // The forecast band, in the same coordinates.
            const err = f.predicted_error_pts ?? 0;
            const fLo = x(f.before_pct + f.predicted_pts - err);
            const fHi = x(f.before_pct + f.predicted_pts + err);

            return (
              <div key={i}>
                <div className="flex items-baseline gap-2 flex-wrap text-[12px]">
                  <Link
                    href={`/run/${f.merchant_id}`}
                    className="font-medium text-ink hover:text-brand transition-colors"
                  >
                    {f.merchant_name}
                  </Link>
                  <span className="text-faint">
                    {f.cause_fixed.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`ml-auto ${
                      f.within_error_bar ? "text-mint" : "text-amber"
                    }`}
                  >
                    {f.verdict}
                  </span>
                </div>

                <div className="relative h-7 mt-1.5 rounded bg-raised overflow-hidden">
                  {/* what we said would happen */}
                  {f.predicted_error_pts != null && (
                    <div
                      className="absolute inset-y-0 bg-amber/20 border-x border-amber/40"
                      style={{ left: `${fLo}%`, width: `${Math.max(0.6, fHi - fLo)}%` }}
                      title={`forecast ${f.predicted_pts.toFixed(2)} ± ${f.predicted_error_pts.toFixed(2)} pts`}
                    />
                  )}

                  {/* what did happen */}
                  <div
                    className={`absolute inset-y-1.5 rounded-md ${
                      up ? "bg-mint" : "bg-rose"
                    }`}
                    style={{ left: `${a}%`, width: `${Math.max(0.5, b - a)}%` }}
                    title={`${f.before_pct.toFixed(2)}% → ${f.after_pct.toFixed(2)}%`}
                  />

                  {/* where it started */}
                  <div
                    className="absolute inset-y-0 w-px bg-ink/40"
                    style={{ left: `${x(f.before_pct)}%` }}
                  />
                </div>

                <div className="flex items-baseline gap-3 mt-1 text-[11px] num text-faint">
                  <span>{f.before_pct.toFixed(2)}%</span>
                  <span className={up ? "text-mint" : "text-rose"}>
                    {f.measured_pts >= 0 ? "+" : ""}
                    {f.measured_pts.toFixed(2)} pts
                  </span>
                  <span>{f.after_pct.toFixed(2)}%</span>
                  <span className="ml-auto">
                    forecast +{f.predicted_pts.toFixed(2)}
                    {f.predicted_error_pts != null &&
                      ` ± ${f.predicted_error_pts.toFixed(2)}`}
                  </span>
                  <span className="w-24 text-right">
                    {inr(f.measured_value_paise, { compact: true })}/mo
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[10px] text-faint num mt-3 pt-2 border-t border-line">
          <span>{lo}%</span>
          <span>success rate</span>
          <span>{hi}%</span>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11px] text-faint">
          <span className="flex items-center gap-1.5">
            <i className="w-3 h-2 rounded-md bg-mint inline-block" /> the rate moved up
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-3 h-2 rounded-md bg-rose inline-block" /> it moved down
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-3 h-3 bg-amber/20 border-x border-amber/40 inline-block" />{" "}
            the range we forecast beforehand
          </span>
        </div>
      </Stagger>

      {/* ── the book, as a distance still to travel ── */}
      <Stagger i={3}>
        <SectionHeader
          title="What is still on the table"
          sub="The same picture for every merchant in the book: where they are, and where their own category already gets to."
          right={
            pf && (
              <span className="text-[12px] text-muted whitespace-nowrap">
                {pf.weighted_observed_pct}% → {pf.weighted_achievable_pct}% weighted
              </span>
            )
          }
        />

        <div className="space-y-3">
          {[...book]
            .sort((a, b) => b.recoverable_central_paise - a.recoverable_central_paise)
            .map((mrc) => (
              <div key={mrc.merchant_id}>
                <div className="flex items-baseline gap-2 text-[12px]">
                  <Link
                    href={`/run/${mrc.run_id}`}
                    className="font-medium hover:text-brand transition-colors"
                  >
                    {mrc.name}
                  </Link>
                  <span className="num text-faint ml-auto">
                    {mrc.observed_pct.toFixed(2)}% → {mrc.achievable_pct.toFixed(2)}%
                  </span>
                  <span className="num text-amber w-20 text-right">
                    {inr(mrc.recoverable_central_paise, { compact: true })}
                  </span>
                </div>
                <div className="relative h-4 mt-1 rounded bg-raised overflow-hidden">
                  <div
                    className="absolute inset-y-0 bg-brand/25"
                    style={{
                      left: `${x(mrc.observed_pct)}%`,
                      width: `${Math.max(
                        0.5,
                        x(mrc.achievable_pct) - x(mrc.observed_pct)
                      )}%`,
                    }}
                    title={`${mrc.gap_pts.toFixed(2)} pt gap`}
                  />
                  <div
                    className="absolute inset-y-0 w-px bg-ink/50"
                    style={{ left: `${x(mrc.observed_pct)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 w-px bg-amber"
                    style={{ left: `${x(mrc.achievable_pct)}%` }}
                  />
                </div>
              </div>
            ))}
        </div>
      </Stagger>

      <Notes>
        <Detail summary="why the axis starts at 78% and not at zero">
          <p>
            These are movements of one to four points on a rate in the high
            eighties. An axis from 0 to 100 renders every fix as an invisible
            nudge; an axis cropped to each merchant&rsquo;s own data makes a
            0.1-point wobble look like a triumph. A fixed window around the
            range the data occupies is the only one of the three that lets you
            compare two merchants honestly, so the window is stated on the axis
            rather than chosen per bar.
          </p>
        </Detail>
        <Detail summary="what an after is, given nothing has been deployed">
          <p>
            The counterfactual month is produced by regenerating the same
            merchant with the same seed and the fixed cause removed. That makes
            the outcome synthetic in the same way the batch is — but it is not
            circular: the forecast comes from the decomposition and the outcome
            comes from the generator, and neither is derived from the other. A
            fix is assumed to remove 45–100% of its cause depending on the
            cause, never all of it.
          </p>
          <p>
            The numeric record, including the three fixes excluded from the
            headline and why, is on{" "}
            <Link href="/evidence" className="text-brand">
              Evidence
            </Link>
            .
          </p>
        </Detail>
      </Notes>
    </>
  );
}
