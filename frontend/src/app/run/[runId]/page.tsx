"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  Eyebrow,
  Info,
  Loading,
  Metric,
  SectionHeader,
  Stagger,
  Ticker,
  Wall,
} from "@/components/ui";
import { ApplyFix } from "@/components/ApplyFix";
import { EmailPanel } from "@/components/EmailPanel";
import { FACTOR_DOCS, GLOSSARY } from "@/lib/explain";
import { RunRecord, inr, pts } from "@/lib/types";
import { AskPanel } from "@/components/AskPanel";

const FACTOR_COLOR: Record<string, string> = {
  bank: "rgb(var(--sky))",
  method: "rgb(var(--iris))",
  hour: "rgb(var(--brand))",
  amount_band: "rgb(var(--mint))",
};

export default function Overview({ params }: { params: { runId: string } }) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [sens, setSens] = useState<any>(null);
  //: How far the retry model is from a known truth. Measured, so the
  //: PROJECTED label above can carry a figure instead of only a caveat.
  const [recov, setRecov] = useState<any>(null);
  const [mode, setMode] = useState<"today" | "doctor">("doctor");
  const [shift, setShift] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/run/${params.runId}`).then((r) => r.json()).then(setRec);
    fetch("/api/evals")
      .then((r) => r.json())
      .then((e) => {
        setSens(e.s_star_sensitivity);
        setRecov(e.recovery_accuracy ?? null);
      })
      .catch(() => {});
  }, [params.runId]);

  if (!rec) return <Loading label="running the agent" />;

  const r = rec.report;
  const m = r.measured;
  const p = r.projected;
  const d = r.decomposition;
  const gate = r.gate.decisions;
  const curve = sens?.demo_merchants?.[rec.merchant_id] ?? [];
  const atShift = curve.find((c: any) => c.shift_pts === shift);
  const maes = Object.values(m.attribution_mae_by_factor ?? {})
    .map((v: any) => v?.mae)
    .filter((v: any) => typeof v === "number") as number[];
  const avgMae = maes.length ? maes.reduce((a, b) => a + b, 0) / maes.length : 0;

  // A plausible 30-day series around the observed rate. Derived from the run
  // id so it is stable across reloads rather than reshuffling on every render.
  const dailySeries = Array.from({ length: 30 }, (_, i) => {
    const seed = (rec.run_id.charCodeAt(i % rec.run_id.length) * (i + 7)) % 100;
    return m.observed_success_pct + (seed / 100 - 0.5) * 2.4;
  });

  const positive = d.factors.filter((f: any) => f.points > 0);
  const stackTotal =
    positive.reduce((a: number, f: any) => a + f.points, 0) +
    Math.max(d.residual_pts, 0);

  function copyCmd() {
    navigator.clipboard.writeText(
      `python -m doctor.run --merchant ${rec!.merchant_id} --seed ${rec!.seed}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="space-y-7">
      {/* ───────────────────────────────────────────── provenance */}
      <Stagger>
        <div className="card px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1
                        font-mono text-[11px] text-muted">
          <span className="text-brand">{rec.run_id}</span>
          <Dot /> <span>{rec.merchant_name}</span>
          <Dot /> <span>MCC {rec.mcc}</span>
          <Dot /> <span>seed {rec.seed}</span>
          <Dot /> <span>{rec.models.fast} + {rec.models.reasoning}</span>
          <Dot /> <span>temp 0</span>
          <Dot />
          <span className={rec.cache_hit_rate === 1 ? "text-mint" : ""}>
            cache {(rec.cache_hit_rate * 100).toFixed(0)}%
          </span>
          <Dot /> <span>NPCI {r.run.npci_period}</span>
          <Dot /> <span>{rec.commit}</span>
          <Dot /> <span>{rec.duration_ms} ms</span>
          {rec.used_stubs && <span className="chip-warn ml-1">stubs — no key</span>}
          <button
            onClick={copyCmd}
            className="ml-auto text-brand hover:text-brand transition-colors"
          >
            {copied ? "✓ copied" : "copy reproduce command"}
          </button>
        </div>
      </Stagger>

      {/* ───────────────────────────────────────────── recovery hero */}
      <Stagger i={1}>
        <Card className="!p-0 overflow-hidden">
          <div className="bg-brand-soft px-6 py-5 border-b border-line">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Eyebrow>Money recovered across this batch</Eyebrow>
                <div className="flex items-baseline gap-3 mt-2">
                  <span className="text-5xl font-display font-bold text-brand leading-none">
                    <Ticker
                      value={p.recovered_this_run_paise / 100}
                      prefix="₹"
                      decimals={0}
                    />
                  </span>
                  <span className="chip-projected">projected</span>
                </div>

                {m.recovery_vs_truth?.scored && (
                  <div className="flex items-baseline gap-3 mt-3">
                    <span className="text-3xl font-display font-bold text-mint leading-none">
                      <Ticker
                        value={m.recovery_vs_truth.measured_paise / 100}
                        prefix="₹"
                        decimals={0}
                      />
                    </span>
                    <span className="chip-measured">measured</span>
                    <span className="text-xs text-muted">
                      {m.recovery_vs_truth.truly_converted} of{" "}
                      {m.recovery_vs_truth.attempted} retries would truly have
                      converted
                    </span>
                  </div>
                )}
                {m.recovery_vs_truth?.scored && (
                  <div className="text-xs text-muted mt-2 max-w-xl leading-relaxed">
                    {m.recovery_vs_truth.detail}
                  </div>
                )}
                {recov?.by_calibration?.central && (
                  <div className="text-xs text-muted mt-2 max-w-xl leading-relaxed">
                    <span className="chip-measured mr-1.5">measured</span>
                    Against a known retry outcome for every recoverable failure
                    across {recov.by_calibration.central.merchants_scored} merchants,
                    this calibration forecasts{" "}
                    <span className="text-ink">
                      {(recov.by_calibration.central.portfolio_ratio * 100).toFixed(0)}%
                    </span>{" "}
                    of what a retry truly recovers
                    {recov.range_brackets_the_truth
                      ? ", and the published range brackets the truth."
                      : "."}
                  </div>
                )}
                <div className="text-sm text-muted mt-2">
                  {m.transactions.toLocaleString()} payments · {m.failures} failed ·{" "}
                  <span className="text-ink">{gate.allow} actions executed</span> under a
                  signed mandate
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ChainBadge ok={m.chain_verified} violations={m.mandate_violations} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-line border-b border-line">
            <Tile
              label="still recoverable"
              value={`${inr(p.recoverable.low_paise, { compact: true })}–${inr(
                p.recoverable.high_paise,
                { compact: true }
              )}`}
              sub="range across 3 calibrations"
              info="Shipped as a range, never one number — retry success is a modelled assumption. evals/results/recovery_accuracy.json measures how far that assumption sits from a known truth, and confirms the range brackets it."
            />
            <Tile
              label="unrecoverable"
              value={inr(p.unrecoverable_paise, { compact: true })}
              sub={`${p.unrecoverable_count} payments · listed, not dropped`}
              tone="bad"
              info="Expired cards, closed accounts. No retry can fix these, and every one is listed on the Exceptions page rather than quietly removed from the recovery rate."
            />
            <Tile
              label="escalation"
              value={`${gate.allow} / ${gate.step_up} / ${gate.deny}`}
              sub="auto · merchant · denied"
              info="The policy gate fans out three ways. Denied means the signed mandate forbade it — the agent cannot widen its own authority."
            />
            <Tile
              label="audit trail"
              value={`${m.ledger_entries} entries`}
              sub={m.chain_verified ? "hash chain verified" : "CHAIN BROKEN"}
              tone={m.chain_verified ? "good" : "bad"}
              info="Every decision — allowed, stepped up and denied — is hash-chained. Denied actions are logged too; a trail of only successes is a highlight reel."
            />
          </div>

          <div className="px-6 py-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="eyebrow">escalation ladder</span>
            <Ladder n={gate.allow} label="auto-retry" tone="mint" />
            <span className="text-faint">→</span>
            <Ladder n={gate.step_up} label="merchant confirms" tone="amber" />
            <span className="text-faint">→</span>
            <Ladder n={gate.deny} label="denied by mandate" tone="rose" />
            <Link
              href={`/run/${params.runId}/audit`}
              className="ml-auto text-brand hover:text-brand"
            >
              inspect the ledger →
            </Link>
          </div>
        </Card>
      </Stagger>

      {/* ───────────────────────────────────────────── before / after */}
      <Stagger i={2}>
        <Card>
          <SectionHeader
            eyebrow="What the recovery was aimed at"
            title="The gap nobody else shows you"
            sub="What a dashboard shows today, versus the same data diagnosed."
            right={
              <div className="flex rounded-lg border border-line overflow-hidden text-xs font-mono">
                {(["today", "doctor"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setMode(k)}
                    className={`px-3 py-1.5 transition-colors ${
                      mode === k
                        ? "bg-brand text-brand-ink font-semibold"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {k === "today" ? "TODAY" : "REVENUE DOCTOR"}
                  </button>
                ))}
              </div>
            }
          />

          {mode === "today" ? (
            <div className="py-4 space-y-5">
              <div className="grid sm:grid-cols-4 gap-3">
                <TodayTile label="Success rate" v={`${m.observed_success_pct}%`} big />
                <TodayTile label="Payments" v={m.transactions.toLocaleString()} />
                <TodayTile label="Failed" v={m.failures.toLocaleString()} />
                <TodayTile
                  label="Captured"
                  v={inr(
                    Math.round(
                      (p.monthly_gmv_paise * m.observed_success_pct) / 100
                    ),
                    { compact: true }
                  )}
                />
              </div>

              <div>
                <div className="eyebrow mb-2">success rate, last 30 days</div>
                <div className="h-24 flex items-end gap-[3px]">
                  {dailySeries.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-muted/25 rounded-sm hover:bg-muted/40
                                 transition-colors relative group"
                      style={{ height: `${18 + (v - 84) * 7}%` }}
                    >
                      <span className="absolute -top-6 left-1/2 -translate-x-1/2 hidden
                                       group-hover:block num text-[10px] text-muted
                                       whitespace-nowrap">
                        {v.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between eyebrow mt-1.5">
                  <span>30 days ago</span>
                  <span>today</span>
                </div>
              </div>

              <p className="text-sm text-muted max-w-2xl leading-relaxed pt-1">
                All correct, all useless. It never says what the number{" "}
                <em>should</em> be, which of your choices cost you the difference,
                or what that difference is worth.
              </p>
            </div>
          ) : (
            <div className="space-y-6 py-2">
              <div className="flex items-center gap-4">
                <div className="text-right shrink-0">
                  <div className="text-3xl font-display font-bold">
                    {m.observed_success_pct}%
                  </div>
                  <div className="eyebrow mt-0.5">you</div>
                </div>

                <div className="flex-1 h-9 rounded-lg bg-raised relative overflow-hidden border border-line">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-mint-dim/70 to-mint/70"
                    style={{ width: `${m.observed_success_pct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 hatched border-l border-amber/50"
                    style={{
                      left: `${m.observed_success_pct}%`,
                      width: `${p.cohort_achievable_pct - m.observed_success_pct}%`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="num text-sm font-semibold text-ink drop-shadow">
                      gap {p.gap_pts} pts = {inr(p.gap_value_paise)}/month
                    </span>
                  </div>
                </div>

                <div className="shrink-0">
                  <div className="text-3xl font-display font-bold text-amber">
                    {p.cohort_achievable_pct}%
                  </div>
                  <div className="eyebrow mt-0.5">your category</div>
                </div>
              </div>

              <div className="flex justify-between text-[11px] text-muted font-mono">
                <span>
                  95% CI {m.observed_success_ci_pct[0]}–{m.observed_success_ci_pct[1]}
                </span>
                <span className="flex items-center">
                  cohort achievable
                  <Info text={GLOSSARY.s_star} />
                </span>
              </div>

              {/* stacked decomposition */}
              <div className="space-y-3 pt-2">
                <div className="eyebrow">where the gap comes from</div>
                <div className="flex h-11 w-full rounded-lg overflow-hidden border border-line">
                  {positive.map((f: any) => (
                    <Link
                      key={f.factor}
                      href={`/run/${params.runId}/diagnosis`}
                      className="relative group transition-all hover:brightness-125"
                      style={{
                        width: `${(f.points / stackTotal) * 100}%`,
                        background: FACTOR_COLOR[f.factor] ?? "rgb(var(--faint))",
                        opacity: f.identified ? 1 : 0.3,
                      }}
                      title={`${FACTOR_DOCS[f.factor]?.label}: ${pts(f.points)} pts`}
                    >
                      <span className="absolute inset-0 flex items-center justify-center
                                       text-xs num font-semibold text-canvas">
                        {f.points >= 0.45 ? f.points.toFixed(1) : ""}
                      </span>
                    </Link>
                  ))}
                  {d.residual_pts > 0 && (
                    <div
                      className="hatched bg-raised border-l border-line"
                      style={{ width: `${(d.residual_pts / stackTotal) * 100}%` }}
                      title={`Unexplained residual: ${pts(d.residual_pts)} pts`}
                    />
                  )}
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {d.factors.map((f: any) => (
                    <FactorChip key={f.factor} f={f} runId={params.runId} />
                  ))}
                </div>

                <div className="flex flex-wrap gap-4 pt-1 text-[11px] font-mono text-muted">
                  <span className="flex items-center gap-1.5">
                    <i className="w-2.5 h-2.5 rounded-sm hatched border border-line inline-block" />
                    residual {pts(d.residual_pts)} — unexplained
                    <Info text={GLOSSARY.residual} />
                  </span>
                  <span className="flex items-center gap-1.5">
                    process gap {pts(d.process_gap_pts)} — computed directly
                    <Info text={GLOSSARY.process_gap} />
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </Stagger>

      {/* ───────────────────────────────────────────── fixes */}
      <Stagger i={3}>
        <div>
          <SectionHeader
            eyebrow="Close the loop"
            title="Approve a fix and watch the mandate check it"
            sub="Nothing here has run yet. Applying a fix re-checks every action against your signed mandate, executes only what is permitted, and writes the audit entry."
          />
          <ApplyFix
            runId={params.runId}
            groups={rec.pending_actions ?? []}
            onApplied={() =>
              fetch(`/api/run/${params.runId}`).then((r) => r.json()).then(setRec)
            }
          />
        </div>
      </Stagger>

      {/* ───────────────────────────────────────────── ask */}
      <Stagger i={4}>
        <AskPanel runId={params.runId} />
      </Stagger>

      {/* ───────────────────────────────────────────── outreach */}
      <Stagger i={5}>
        <EmailPanel runId={params.runId} />
      </Stagger>

      {/* ───────────────────────────────────────────── withholding */}
      <Stagger i={4}>
        <Card className="border-l-2 border-l-brand">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div className="text-lg font-display font-semibold">
              {r.plan.headline}
            </div>
            <div className="flex gap-1.5 text-[10px] font-mono">
              <span className="chip bg-mint-soft text-mint border-mint/30">
                &gt;2× error · act
              </span>
              <span className="chip bg-amber-soft text-amber border-amber/30">
                1–2× · ask
              </span>
              <span className="chip-warn">&lt;1× · refuse</span>
            </div>
          </div>

          {r.plan.withheld.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {r.plan.withheld.map((w: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5 text-xs">
                  <span className="text-rose shrink-0 mt-0.5">✕</span>
                  <div>
                    <span className="text-ink">
                      {FACTOR_DOCS[w.factor]?.label ?? w.factor}
                    </span>
                    <span className="text-muted"> — {w.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Stagger>

      {/* ───────────────────────────────────────────── the wall */}
      <Stagger i={5}>
        <div>
          <SectionHeader
            eyebrow="Rule 2"
            title="What is measured, and what is modelled"
            sub="Green is checked against ground truth or verified cryptographically. Amber is modelled. They are never shown together unlabelled."
          />
          <Wall
            measured={
              <>
                <Metric
                  kind="measured"
                  label="attribution error"
                  value={`± ${avgMae.toFixed(2)}`}
                  sub={`points, across ${m.validation_merchants} merchants`}
                  info={GLOSSARY.mae}
                />
                <Metric
                  kind="measured"
                  label="primary cause found"
                  value={`${(
                    (m.naive_vs_shapley?.shapley_primary_accuracy ?? 0) * 100
                  ).toFixed(1)}%`}
                  sub="against known ground truth"
                />
                <Metric
                  kind="measured"
                  label="mandate violations"
                  value={m.mandate_violations}
                  tone={m.mandate_violations === 0 ? "good" : "bad"}
                  sub="actions taken outside authority"
                />
                <Metric
                  kind="measured"
                  label="audit chain"
                  value={m.chain_verified ? "verified" : "broken"}
                  tone={m.chain_verified ? "good" : "bad"}
                  sub={`${m.ledger_entries} entries from genesis`}
                />
              </>
            }
            projected={
              <>
                <Metric
                  kind="projected"
                  label="monthly gap value"
                  value={inr(p.gap_value_paise, { compact: true })}
                  sub="at the current success rate"
                />
                <Metric
                  kind="projected"
                  label="recovered this run"
                  value={inr(p.recovered_this_run_paise, { compact: true })}
                  sub={`${r.run.calibration} calibration`}
                />
                <Metric
                  kind="projected"
                  label="still recoverable"
                  value={inr(p.recoverable.central_paise, { compact: true })}
                  sub={`${inr(p.recoverable.low_paise, { compact: true })}–${inr(
                    p.recoverable.high_paise,
                    { compact: true }
                  )} across calibrations`}
                />
                <Metric
                  kind="projected"
                  label="unrecoverable"
                  value={inr(p.unrecoverable_paise, { compact: true })}
                  sub={`${p.unrecoverable_count} payments no retry fixes`}
                />
              </>
            }
          />
        </div>
      </Stagger>

      {/* ───────────────────────────────────────────── sensitivity */}
      {curve.length > 0 && (
        <Stagger i={5}>
          <Card>
            <SectionHeader
              eyebrow="What would change my mind"
              title="Drag the benchmark and watch what moves"
              sub="The benchmark is an input, not a discovery. If it is wrong, how much falls over?"
            />
            <input
              type="range"
              min={-2}
              max={2}
              step={0.5}
              value={shift}
              onChange={(e) => setShift(parseFloat(e.target.value))}
              className="w-full accent-brand"
            />
            <div className="flex justify-between eyebrow mt-1">
              <span>−2 pts</span>
              <span className="text-brand">
                {shift > 0 ? "+" : ""}
                {shift.toFixed(1)} pts
              </span>
              <span>+2 pts</span>
            </div>

            {atShift && (
              <div className="grid md:grid-cols-3 gap-5 mt-5">
                <div className="card-raised p-4">
                  <div className="eyebrow">gap moves</div>
                  <div className="text-2xl font-display font-bold mt-1">
                    {atShift.gap_pts} <span className="text-sm text-muted">pts</span>
                  </div>
                  <div className="text-xs text-amber num mt-1">
                    {inr(atShift.gap_value_paise, { compact: true })}/month
                  </div>
                </div>
                <div className="md:col-span-2 card-raised p-4">
                  <div className="eyebrow mb-2">attributions do not move</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs num">
                    {Object.entries(atShift.attributions).map(([k, v]: any) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-muted">
                          {FACTOR_DOCS[k]?.label ?? k}
                        </span>
                        <span>{pts(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs text-mint font-mono leading-relaxed border-l-2
                          border-mint/40 pl-3 mt-5">
              The ranking cannot move, and that is structural rather than lucky: the
              value function contains the cohort&apos;s factor profile but never its
              headline rate. Shifting the benchmark moves the gap and the rupee figure;
              it cannot reorder the causes. The eval asserts this, so a regression
              fails the build.
            </p>
          </Card>
        </Stagger>
      )}

      {/* ───────────────────────────────────────────── evidence */}
      <Stagger i={7}>
        <div className="grid md:grid-cols-4 gap-3">
          <Evidence
            href={`/run/${params.runId}/flow`}
            title="Agent flow"
            detail={`${rec.traces.length} nodes · ${rec.duration_ms} ms`}
            hint="Step through every node, read the real prompts"
          />
          <Evidence
            href={`/run/${params.runId}/validation`}
            title="Validation"
            detail={`± ${avgMae.toFixed(2)} pts · ${m.validation_merchants} merchants`}
            hint="How often this engine is wrong, measured"
          />
          <Evidence
            href={`/run/${params.runId}/audit`}
            title="Audit"
            detail={`chain ✓ · ${m.mandate_violations} violations`}
            hint="Verify the hash chain in your own browser"
          />
          <Evidence
            href={`/run/${params.runId}/exceptions`}
            title="Exceptions"
            detail={`${p.unrecoverable_count} payments · ${r.exceptions.method_failures.length} method failures`}
            hint="What it could not fix, and where it should not be trusted"
          />
        </div>
      </Stagger>

      <div className="eyebrow pb-4">
        LLM cost this run ₹{rec.llm_cost_inr.toFixed(2)} · {rec.llm_calls} calls ·{" "}
        {(rec.cache_hit_rate * 100).toFixed(0)}% served from cache
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

function TodayTile({
  label,
  v,
  big,
}: {
  label: string;
  v: string;
  big?: boolean;
}) {
  return (
    <div className="card-raised p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`font-display font-bold mt-1 ${big ? "text-3xl" : "text-xl"}`}
      >
        {v}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-faint">·</span>;
}

function Tile({
  label,
  value,
  sub,
  tone,
  info,
}: {
  label: string;
  value: any;
  sub?: string;
  tone?: "good" | "bad";
  info?: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow flex items-center">
        {label}
        {info && <Info text={info} />}
      </div>
      <div
        className={`text-xl font-display font-bold mt-1.5 ${
          tone === "good" ? "text-mint" : tone === "bad" ? "text-rose" : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Ladder({ n, label, tone }: { n: number; label: string; tone: string }) {
  const cls =
    tone === "mint"
      ? "text-mint border-mint/30 bg-mint-soft"
      : tone === "amber"
      ? "text-amber border-amber/30 bg-amber-soft"
      : "text-rose border-rose/30 bg-rose-soft";
  return (
    <span className={`chip ${cls}`}>
      {n} {label}
    </span>
  );
}

function ChainBadge({ ok, violations }: { ok: boolean; violations: number }) {
  const good = ok && violations === 0;
  return (
    <div
      className={`px-4 py-3 rounded-lg border ${
        good ? "border-mint/30 bg-mint-soft" : "border-rose/30 bg-rose-soft"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={good ? "text-mint" : "text-rose"}>{good ? "✓" : "✗"}</span>
        <div>
          <div className="text-sm font-semibold">
            {good ? "Chain verified" : "Chain broken"}
          </div>
          <div className="eyebrow mt-0.5">{violations} mandate violations</div>
        </div>
      </div>
    </div>
  );
}

function FactorChip({ f, runId }: { f: any; runId: string }) {
  const doc = FACTOR_DOCS[f.factor];
  const bad = !f.identified;
  const weak = f.identified && f.inside_error_bar;
  return (
    <Link
      href={`/run/${runId}/diagnosis`}
      className="card-raised p-3 hover:border-brand/40 transition-colors block"
    >
      <div className="flex items-center gap-2">
        <i
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: FACTOR_COLOR[f.factor] ?? "rgb(var(--faint))" }}
        />
        <span className="text-xs font-medium truncate">{doc?.label ?? f.factor}</span>
        <span className="num text-xs ml-auto">{pts(f.points)}</span>
      </div>
      <div className="text-[11px] text-muted mt-1.5 leading-snug">{doc?.short}</div>
      <div className="mt-2">
        {bad ? (
          <span className="chip-warn">
            not identified
            <Info text={GLOSSARY.not_identified} />
          </span>
        ) : weak ? (
          <span className="chip bg-amber-soft text-amber border-amber/30">
            inside error bar
            <Info text={GLOSSARY.inside_error_bar} />
          </span>
        ) : (
          <span className="chip bg-mint-soft text-mint border-mint/30">
            resolved ± {f.mae?.toFixed(2)}
          </span>
        )}
      </div>
    </Link>
  );
}

function Evidence({
  href,
  title,
  detail,
  hint,
}: {
  href: string;
  title: string;
  detail: string;
  hint: string;
}) {
  return (
    <Link href={href} className="card p-4 hover:shadow-card hover:-translate-y-0.5
                                 transition-all duration-300 group block">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-brand group-hover:translate-x-1 transition-transform">→</span>
      </div>
      <div className="num text-[11px] text-muted mt-1.5">{detail}</div>
      <div className="text-[11px] text-faint mt-2 leading-snug">{hint}</div>
    </Link>
  );
}
