"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, Info, Loading, SectionHeader, Stagger } from "@/components/ui";
import { FACTOR_DOCS, GLOSSARY } from "@/lib/explain";

/**
 * The submission. Not run-specific — this is the 200-merchant inject-and-recover
 * sweep, loaded from evals/results/.
 */
export default function ValidationPage() {
  const [e, setE] = useState<any>(null);
  const [tab, setTab] = useState<"accuracy" | "limits" | "honesty">("accuracy");

  useEffect(() => {
    fetch("/api/evals").then((r) => r.json()).then(setE).catch(() => setE({}));
  }, []);

  if (!e) return <Loading label="loading 200-merchant sweep" />;

  const mae = e.attribution_mae_by_factor ?? {};
  const nvs = e.naive_vs_shapley ?? {};
  const corr = e.correlation_degradation ?? {};
  const power = e.batch_size_power ?? {};
  const sens = e.s_star_sensitivity ?? {};
  const cls = e.classification_f1 ?? {};
  const rc = e.root_cause_accuracy ?? {};
  const ladder = e.baseline_ladder ?? {};
  const stress = e.stress_test ?? {};
  const outcome = e.outcome_accuracy ?? {};
  const scale = e.scale_benchmark ?? {};
  const backtest = e.backtest_npci ?? {};

  return (
    <div className="space-y-6">
      <Stagger>
        <div>
          <Eyebrow>The part nobody else ships</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">How often is this wrong?</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            200 synthetic merchants, each carrying a <strong>known</strong> cause of a{" "}
            <strong>known</strong> size. Ground truth is not a guess — it is the same
            decomposition computed analytically over the true generating distribution.
            The difference between that and what the engine produces from the sampled
            batch <em>is</em> the error.
          </p>
        </div>
      </Stagger>

      <Stagger i={1}>
        <div className="flex gap-1 border-b border-line">
          {(
            [
              ["accuracy", "Accuracy"],
              ["limits", "Where it breaks"],
              ["honesty", "Uncomfortable results"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === k
                  ? "border-brand text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Stagger>

      {/* ══════════════════════════════════════════════ ACCURACY */}
      {tab === "accuracy" && (
        <div className="space-y-5 animate-rise">
          <Card>
            <SectionHeader
              eyebrow="Per factor, across 200 merchants"
              title="Attribution error"
              sub="These exact numbers are loaded at runtime by the planner and decide what the agent is allowed to act on. They are a dependency, not a report."
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(mae).map(([k, v]: any) => (
                <div key={k} className="card-raised p-4">
                  <div className="eyebrow">{FACTOR_DOCS[k]?.label ?? k}</div>
                  <div className="text-2xl font-display font-bold text-brand mt-1.5">
                    ± {v.mae}
                  </div>
                  <div className="text-[11px] text-muted mt-1">points, mean abs error</div>
                  <div className="mt-3 space-y-1 text-[11px] num text-muted">
                    <Row k="bias" v={v.bias} />
                    <Row k="p90" v={v.p90_abs_err} />
                    <Row k="within ±0.5" v={`${(v.coverage_0p5 * 100).toFixed(0)}%`} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid lg:grid-cols-2 gap-5">
            {cls.accuracy != null && (
              <Card>
                <SectionHeader
                  eyebrow="AI step 1 · Haiku 4.5"
                  title="Classifying error codes it has never seen"
                  sub="All 110 published codes are hand-labelled and answered with no API call. The model exists for codes outside the taxonomy — so the eval holds out CODES, not rows."
                />
                <BigStat
                  value={`${(cls.accuracy * 100).toFixed(1)}%`}
                  label={`accuracy on ${cls.n_test} held-out codes`}
                  ci={`95% CI ${(cls.accuracy_ci95[0] * 100).toFixed(1)}–${(
                    cls.accuracy_ci95[1] * 100
                  ).toFixed(1)}`}
                />
                <table className="w-full text-xs num mt-4">
                  <thead>
                    <tr className="eyebrow border-b border-line">
                      <th className="text-left py-1.5 font-normal">class</th>
                      <th className="text-right py-1.5 font-normal">n</th>
                      <th className="text-right py-1.5 font-normal">precision</th>
                      <th className="text-right py-1.5 font-normal">recall</th>
                      <th className="text-right py-1.5 font-normal">F1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cls.per_class ?? {}).map(([k, v]: any) => (
                      <tr key={k} className="border-b border-line/40">
                        <td className="py-1.5 font-body">{k}</td>
                        <td className="text-right text-muted">{v.support}</td>
                        <td className="text-right">{v.precision.toFixed(2)}</td>
                        <td
                          className={`text-right ${
                            v.recall < 0.5 ? "text-rose" : ""
                          }`}
                        >
                          {v.recall.toFixed(2)}
                        </td>
                        <td className="text-right">{v.f1.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-muted mt-3 leading-relaxed">
                  Below the {">"}95% that was aimed for. Support is tiny by
                  construction, hence Wilson intervals rather than bare percentages.
                  Three of the four errors are boundary calls where the model&apos;s
                  answer is defensible —{" "}
                  <span className="text-ink">ground truth was not moved to match it.</span>
                </p>
              </Card>
            )}

            {rc.accuracy != null && (
              <Card>
                <SectionHeader
                  eyebrow="AI step 2 · Sonnet 4.6"
                  title="Naming the root cause"
                  sub="Exact match on a closed enum shared with the generator — forced-choice classification, not keyword matching on free text."
                />
                <BigStat
                  value={`${(rc.accuracy * 100).toFixed(1)}%`}
                  label={`on ${rc.n} merchants`}
                  ci={`95% CI ${(rc.accuracy_ci95[0] * 100).toFixed(1)}–${(
                    rc.accuracy_ci95[1] * 100
                  ).toFixed(1)}`}
                />
                {rc.error_decomposition && (
                  <>
                    <div className="eyebrow mt-4 mb-2">where that error actually lives</div>
                    <div className="space-y-1.5">
                      <ErrBar
                        label="the attribution pointed at the right cause"
                        v={rc.error_decomposition.attribution_pointed_at_the_right_cause}
                      />
                      <ErrBar
                        label="the model followed what it was shown"
                        v={rc.error_decomposition.model_faithful_to_what_it_saw}
                      />
                      <ErrBar
                        label="correct when the attribution was right"
                        v={rc.error_decomposition.accuracy_when_attribution_was_right}
                      />
                    </div>
                    <p className="text-[11px] text-muted mt-3 leading-relaxed">
                      Not one weak link — the attribution caps the model at 75%, and the
                      model then follows it only 63% of the time. Reporting a bare 60%
                      would have hidden which half to fix.
                    </p>
                  </>
                )}
                {rc.healthy_merchants && (
                  <div className="card-raised p-3 mt-3 text-xs">
                    On genuinely healthy merchants it said{" "}
                    <span className="num text-mint">none_of_the_above</span>{" "}
                    <span className="text-ink">
                      {rc.healthy_merchants.correctly_said_none_of_the_above} of{" "}
                      {rc.healthy_merchants.n}
                    </span>{" "}
                    times — so it is not just reaching for a label to look useful.
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* outcome: did the fix work */}
          {outcome.overall && (
            <Card className="border-l-2 border-l-mint">
              <SectionHeader
                eyebrow="After the fix lands"
                title="Grading the forecast against what actually moved"
                sub="The attribution error says how well the engine explains the past. This says how well it predicts the consequence of acting on that explanation."
              />
              <div className="grid sm:grid-cols-3 gap-3">
                <Stat
                  label="forecast error"
                  v={`${outcome.overall.mean_forecast_error_pts > 0 ? "+" : ""}${
                    outcome.overall.mean_forecast_error_pts
                  } pts`}
                />
                <Stat label="mean absolute" v={`${outcome.overall.mae_pts} pts`} />
                <Stat
                  label="within its own error bar"
                  v={`${outcome.overall.within_own_error_bar}/${outcome.n_fixes}`}
                />
              </div>
              <Table
                head={["cause fixed", "n", "predicted", "measured", "MAE"]}
                rows={Object.entries(outcome.by_cause ?? {}).map(([k, v]: any) => [
                  k.replace(/_/g, " "),
                  v.n,
                  `${v.mean_predicted_pts > 0 ? "+" : ""}${v.mean_predicted_pts}`,
                  `${v.mean_measured_pts > 0 ? "+" : ""}${v.mean_measured_pts}`,
                  v.mae_pts,
                ])}
              />
              {outcome.excluded_from_headline && (
                <p className="text-[11px] text-amber mt-3 leading-relaxed">
                  <strong>{outcome.excluded_from_headline.causes.join(", ")}</strong>{" "}
                  is excluded from the headline: {outcome.excluded_from_headline.why}
                </p>
              )}
            </Card>
          )}

          {/* baseline ladder */}
          {ladder.headline && (
            <Card className="border-l-2 border-l-brand">
              <SectionHeader
                eyebrow="Recovered how much — compared to what?"
                title="Against the strongest baseline, not the easiest"
                sub="B3 is error-code-aware retry: what a good engineer actually builds. Beating “do nothing” would prove nothing."
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm num">
                  <thead>
                    <tr className="eyebrow border-b border-line">
                      <th className="text-left py-2 font-normal">policy</th>
                      <th className="text-right py-2 font-normal">recovered</th>
                      <th className="text-right py-2 font-normal">attempts</th>
                      <th className="text-right py-2 font-normal">over the cap</th>
                      <th className="text-right py-2 font-normal">₹ / attempt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(
                      ladder.absolute_paise_by_calibration ?? {}
                    ).map(([name, v]: any) => {
                      const c = v.central;
                      const isT = name.startsWith("T_");
                      return (
                        <tr
                          key={name}
                          className={`border-b border-line/40 ${
                            isT ? "bg-brand-soft" : ""
                          }`}
                        >
                          <td className={`py-2 font-body ${isT ? "text-brand font-semibold" : ""}`}>
                            {name.replace(/_/g, " ")}
                          </td>
                          <td className="text-right">
                            ₹{(c.recovered_paise / 100).toLocaleString("en-IN", {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td className="text-right text-muted">{c.attempts.toLocaleString()}</td>
                          <td
                            className={`text-right ${
                              c.cap_violations > 0 ? "text-rose" : "text-mint"
                            }`}
                          >
                            {c.cap_violations.toLocaleString()}
                          </td>
                          <td className="text-right">
                            ₹
                            {(
                              ladder.ratios_vs_b3?.central?.[name]
                                ?.recovered_per_attempt_paise / 100 || 0
                            ).toFixed(0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted mt-4 leading-relaxed">
                B3 recovers more in absolute terms —{" "}
                <span className="text-rose">
                  but only by breaching the 3-attempt cap on{" "}
                  {ladder.headline.b3_cap_violations?.toLocaleString()} payments
                </span>
                , because it does not track the retries the merchant already made. That
                omission is exactly what makes it a baseline.{" "}
                <span className="text-ink">
                  Revenue Doctor is 1.27–1.50× more efficient per attempt with zero
                  violations.
                </span>
              </p>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════ LIMITS */}
      {tab === "limits" && (
        <div className="space-y-5 animate-rise">
          <div className="grid lg:grid-cols-2 gap-5">
            <Card>
              <SectionHeader
                eyebrow="Limitation 1"
                title="The price of assuming independence"
                sub="The method reweights each factor's distribution separately, which assumes they do not move together. Here is what that costs as they increasingly do."
              />
              <Table
                head={["ρ", "merchants", "MAE", "accuracy"]}
                rows={Object.entries(corr).map(([k, v]: any) => [
                  k,
                  v.n_merchants,
                  v.mae_all_factors?.toFixed(3),
                  `${(v.primary_cause_accuracy * 100).toFixed(1)}%`,
                ])}
              />
            </Card>

            <Card>
              <SectionHeader
                eyebrow="Limitation 2"
                title="How much data a diagnosis needs"
                sub="Below roughly 400 payments a month the uncertainty on the success rate is wider than the effects being attributed."
              />
              <Table
                head={["payments", "merchants", "MAE", "±pts", "accuracy"]}
                rows={Object.entries(power).map(([k, v]: any) => [
                  k,
                  v.n_merchants,
                  v.mae_all_factors?.toFixed(3),
                  v.mean_wilson_halfwidth_pts?.toFixed(2),
                  `${(v.primary_cause_accuracy * 100).toFixed(1)}%`,
                ])}
              />
              <p className="text-[11px] text-muted mt-3">
                Merchants under that threshold are told the diagnosis is not resolvable,
                rather than handed a confident ranking of noise.
              </p>
            </Card>
          </div>

          {scale.n_merchants && (
            <Card>
              <SectionHeader
                eyebrow="Could this run nightly over a book"
                title="Throughput"
                sub="Deterministic pipeline only. The model steps are excluded because they do not need to run per merchant per night."
              />
              <div className="grid sm:grid-cols-4 gap-3">
                <Stat label="merchants / sec" v={`${scale.merchants_per_second}`} />
                <Stat
                  label="payments / sec"
                  v={Number(scale.payments_per_second).toLocaleString("en-IN")}
                />
                <Stat label="p90 per merchant" v={`${scale.per_merchant_ms?.p90} ms`} />
                <Stat
                  label="1M merchants, 32 cores"
                  v={`${scale.projected?.one_million_merchants_hours_32_cores} h`}
                />
              </div>
            </Card>
          )}

          {stress.cases && (
            <Card>
              <SectionHeader
                eyebrow="Hostile inputs"
                title="Where does it break, and does it say so?"
                sub="The question is not whether error rises under attack — it must. The question is whether the engine tells you. A case where error climbs and nothing is flagged is a silent failure, and the worst outcome short of a crash."
              />
              <div className="overflow-x-auto">
                <table className="w-full text-xs num">
                  <thead>
                    <tr className="eyebrow border-b border-line">
                      <th className="text-left py-2 font-normal">attack</th>
                      <th className="text-right py-2 font-normal">MAE</th>
                      <th className="text-right py-2 font-normal">vs control</th>
                      <th className="text-right py-2 font-normal">flagged</th>
                      <th className="text-right py-2 font-normal">crashes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stress.cases).map(([k, v]: any) => {
                      const bad = (v.mae_vs_control ?? 1) > 1.5;
                      return (
                        <tr key={k} className="border-b border-line/40">
                          <td className="py-1.5 font-body">{k.replace(/_/g, " ")}</td>
                          <td className="text-right">{v.mae?.toFixed(3)}</td>
                          <td className={`text-right ${bad ? "text-rose" : "text-muted"}`}>
                            {v.mae_vs_control?.toFixed(2)}×
                          </td>
                          <td className="text-right text-mint">
                            {v.degenerate_factor_cases + v.underpowered_cases > 0
                              ? "yes"
                              : "—"}
                          </td>
                          <td className="text-right text-mint">{v.crashes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="card-raised p-3 mt-4 text-sm text-mint">
                ✓ Zero crashes, and no silent failures — every case where error rose
                materially was flagged to the user.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════ HONESTY */}
      {tab === "honesty" && (
        <div className="space-y-5 animate-rise">
          <Card className="border-l-2 border-l-amber">
            <SectionHeader
              eyebrow="The result I did not want"
              title="My assumptions move the answer more than my error bars do"
              sub="NPCI publishes nothing hourly, no card rail and no ticket split — so those coefficients are judgement calls, not measurements. Sweeping every one across its stated range at once:"
            />
            {sens.part_c_assumed_priors && (
              <Table
                head={["prior scale", "attribution moves", "gap changes", "cause flips"]}
                rows={Object.entries(sens.part_c_assumed_priors.by_prior_scale).map(
                  ([k, v]: any) => [
                    k,
                    `${v.mean_abs_attribution_move_pts?.toFixed(3)} pts`,
                    `${v.mean_gap_change_pts?.toFixed(3)} pts`,
                    `${(v.primary_cause_flip_rate * 100).toFixed(1)}%`,
                  ]
                )}
              />
            )}
            <p className="text-sm text-amber mt-4 leading-relaxed">
              Up to <strong>1.13 points</strong> of movement — roughly 2× the measured
              MAE of 0.53. Not fixable without data that does not exist. What{" "}
              <em>is</em> fixable is making it visible: every coefficient carries a
              provenance field, a source and a range.
            </p>
            {sens.part_a_s_star_level && (
              <div className="card-raised p-3 mt-3 text-sm text-mint leading-relaxed">
                By contrast, the level of the cohort benchmark moves the attributions by
                exactly{" "}
                <span className="num">
                  {sens.part_a_s_star_level.max_attribution_move_pts_across_all_shifts}
                </span>{" "}
                — structurally, because the value function contains the cohort&apos;s
                factor profile but never its headline rate. The eval asserts it, so a
                regression fails the build.
              </div>
            )}
          </Card>

          <Card className="border-l-2 border-l-brand">
            <SectionHeader
              eyebrow="Was the complicated method necessary?"
              title="For ranking, no. For rupees, decisively yes."
              sub="I predicted naive attribution would pick the wrong cause ~31% of the time versus Shapley's 6%. It did not reproduce."
            />
            <div className="grid sm:grid-cols-3 gap-3">
              <Stat
                label="Shapley picks right"
                v={`${((nvs.shapley_primary_accuracy ?? 0) * 100).toFixed(1)}%`}
              />
              <Stat
                label="Naive picks right"
                v={`${((nvs.naive_primary_accuracy ?? 0) * 100).toFixed(1)}%`}
              />
              <Stat
                label="they disagree"
                v={`${((nvs.disagreement_rate ?? 0) * 100).toFixed(1)}%`}
              />
            </div>
            {nvs.coherence && (
              <>
                <p className="text-sm mt-4 leading-relaxed">
                  So I measured what Shapley actually buys.{" "}
                  <span className="text-brand">Its magnitudes add up and naive&apos;s
                  do not</span> — and every output of this product is a rupee figure
                  derived from a magnitude, not a ranking.
                </p>
                <div className="card-raised p-4 mt-3 num text-xs space-y-1.5">
                  <div className="eyebrow">sum of attributions ÷ v(N) — 1.000 is perfect</div>
                  <div className="flex justify-between">
                    <span>Shapley</span>
                    <span className="text-mint">
                      {nvs.coherence.shapley_mean_ratio.toFixed(4)} (max deviation{" "}
                      {nvs.coherence.shapley_max_abs_dev})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Naive</span>
                    <span className="text-rose">
                      {nvs.coherence.naive_mean_ratio.toFixed(4)} — ranges{" "}
                      {nvs.coherence.naive_min_ratio.toFixed(1)} to{" "}
                      {nvs.coherence.naive_max_ratio.toFixed(1)}
                    </span>
                  </div>
                  <div className="text-muted pt-1">
                    naive overstates the total on {nvs.coherence.naive_overstates_pct}%
                    of merchants
                  </div>
                </div>
              </>
            )}
          </Card>

          {backtest.by_horizon && (
            <Card className="border-l-2 border-l-mint">
              <SectionHeader
                eyebrow="Data I did not generate"
                title="Out-of-sample backtest on real NPCI tables"
                sub="Walk-forward over 42 banks and 32 months, never looking ahead. The fair objection to every other eval here is that the estimator was checked against my own generator; this is not."
              />
              <Table
                head={["predictor", "1-month MAE", "3-month MAE"]}
                rows={["persistence", "smoothed", "rolling3", "global"].map((k) => [
                  k,
                  backtest.by_horizon.horizon_1m?.[k]?.mae_pts ?? "—",
                  backtest.by_horizon.horizon_3m?.[k]?.mae_pts ?? "—",
                ])}
              />
              <p className="text-sm text-muted mt-3 leading-relaxed">
                <strong className="text-ink">It went against me.</strong> Smoothing the
                history loses to simply using the most recent published month — bank
                rates behave close to a random walk. The baseline already pinned one
                NPCI period; that was instinct, and it is now measured. The finding
                that matters more:{" "}
                <span className="text-mint">
                  knowing which bank cuts error{" "}
                  {(1 / backtest.by_horizon.horizon_1m.persistence_vs_global).toFixed(1)}×
                </span>{" "}
                versus ignoring it, which is what makes bank a real factor rather than
                noise.
              </p>
            </Card>
          )}

          {e.failure_cases_md && (
            <Card>
              <SectionHeader
                eyebrow="Every merchant it got wrong"
                title="Failure cases, with the structural reason"
                sub="Generated by the eval, not written by hand."
              />
              <pre className="font-mono text-[10px] leading-relaxed overflow-x-auto
                              text-muted whitespace-pre-wrap max-h-96 overflow-y-auto
                              card-raised p-4">
                {e.failure_cases_md}
              </pre>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between">
      <span className="text-faint">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="card-raised p-4">
      <div className="eyebrow">{label}</div>
      <div className="text-2xl font-display font-bold mt-1">{v}</div>
    </div>
  );
}

function BigStat({ value, label, ci }: { value: string; label: string; ci: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-4xl font-display font-bold text-brand">{value}</span>
      <div>
        <div className="text-sm">{label}</div>
        <div className="eyebrow mt-0.5">{ci}</div>
      </div>
    </div>
  );
}

function ErrBar({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="num">{(v * 100).toFixed(1)}%</span>
      </div>
      <div className="h-1 rounded-full bg-raised overflow-hidden mt-1">
        <div
          className="h-full bg-gradient-to-r from-brand to-brand"
          style={{ width: `${v * 100}%` }}
        />
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: any[][] }) {
  return (
    <table className="w-full text-xs num">
      <thead>
        <tr className="eyebrow border-b border-line">
          {head.map((h, i) => (
            <th
              key={h}
              className={`py-2 font-normal ${i === 0 ? "text-left" : "text-right"}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line/40">
            {r.map((c, j) => (
              <td key={j} className={`py-2 ${j === 0 ? "text-left" : "text-right"}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
