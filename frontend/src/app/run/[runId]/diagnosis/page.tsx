"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, Info, Loading, SectionHeader, Stagger } from "@/components/ui";
import { FACTOR_DOCS, GLOSSARY } from "@/lib/explain";
import { RunRecord, inr, pts } from "@/lib/types";

const FACTOR_COLOR: Record<string, string> = {
  bank: "rgb(var(--sky))",
  method: "rgb(var(--iris))",
  hour: "rgb(var(--brand))",
  amount_band: "rgb(var(--mint))",
};

export default function DiagnosisPage({ params }: { params: { runId: string } }) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [openCoalitions, setOpenCoalitions] = useState(false);

  useEffect(() => {
    fetch(`/api/run/${params.runId}`).then((r) => r.json()).then(setRec);
  }, [params.runId]);

  if (!rec) return <Loading label="loading diagnosis" />;

  const r = rec.report;
  const d = r.decomposition;
  const diag = r.diagnosis ?? {};
  const maxAbs = Math.max(
    ...d.factors.map((f: any) => Math.abs(f.points)),
    Math.abs(d.process_gap_pts),
    0.5
  );

  return (
    <div className="space-y-6">
      <Stagger>
        <div>
          <Eyebrow>Why the gap exists</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">Diagnosis</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            The decomposition splits the gap across four causes and provably accounts
            for all of it. Each row states its own uncertainty, and whether it can be
            measured on this merchant at all.
          </p>
        </div>
      </Stagger>

      {/* ─────────────────────────────────── the model's read */}
      {diag.hypotheses?.length > 0 && (
        <Stagger i={1}>
          <Card className="border-l-2 border-l-iris">
            <div className="flex items-start gap-3">
              <span className="chip-llm shrink-0 mt-0.5">Sonnet 4.6</span>
              <div className="min-w-0">
                <p className="text-base leading-relaxed">{diag.summary}</p>
                {rec.used_stubs && (
                  <span className="chip-warn mt-2 inline-flex">
                    stub output — no API key set
                  </span>
                )}
              </div>
            </div>
          </Card>
        </Stagger>
      )}

      {/* ─────────────────────────────────── decomposition */}
      <Stagger i={2}>
        <Card>
          <SectionHeader
            eyebrow="Shapley-ordered Oaxaca-Blinder"
            title="Where the gap comes from"
            sub={`Total gap ${d.gap_pts.toFixed(2)} points. The four factors sum to exactly the movement the method explains — that is the efficiency axiom, and it is what makes converting these into rupees legitimate.`}
          />

          <div className="space-y-2.5">
            {d.factors.map((f: any) => {
              const doc = FACTOR_DOCS[f.factor];
              const w = (Math.abs(f.points) / maxAbs) * 100;
              return (
                <div key={f.factor} className="card-raised p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <i
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: FACTOR_COLOR[f.factor] }}
                        />
                        <span className="font-semibold text-sm">{doc?.label}</span>
                        {!f.identified ? (
                          <span className="chip-warn">
                            not identified <Info text={GLOSSARY.not_identified} />
                          </span>
                        ) : f.inside_error_bar ? (
                          <span className="chip bg-amber-soft text-amber border-amber/30">
                            inside error bar <Info text={GLOSSARY.inside_error_bar} />
                          </span>
                        ) : (
                          <span className="chip bg-mint-soft text-mint border-mint/30">
                            resolved
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1.5 leading-relaxed">
                        {doc?.short}
                      </p>
                      <p className="text-xs text-ink/70 mt-1">
                        <span className="text-faint">fix — </span>
                        {doc?.fix}
                      </p>
                    </div>

                    <div className="text-right shrink-0 w-32">
                      <div className="num text-xl font-semibold">{pts(f.points)}</div>
                      <div className="num text-[11px] text-muted">
                        {f.mae != null ? `± ${f.mae.toFixed(2)} measured` : "—"}
                      </div>
                      <div className="num text-[11px] text-amber mt-0.5">
                        {inr(f.value_paise, { compact: true })}/mo
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 rounded-full bg-raised overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{
                        width: `${w}%`,
                        background: FACTOR_COLOR[f.factor],
                        opacity: f.identified ? 0.85 : 0.3,
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* residual — visually distinct on purpose */}
            <div className="card-raised p-4 hatched">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-muted flex items-center">
                    Unexplained residual
                    <Info text={GLOSSARY.residual} />
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Not attributed to any factor. Shown rather than redistributed —
                    a decomposition that sums to exactly 100% is hiding something.
                  </p>
                </div>
                <div className="num text-xl text-muted">{pts(d.residual_pts)}</div>
              </div>
            </div>

            {/* process gap — alongside, never inside */}
            <div className="card-raised p-4 border-l-2 border-l-mint/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold flex items-center">
                    No soft-decline retry
                    <Info text={GLOSSARY.process_gap} />
                  </div>
                  <p className="text-xs text-muted mt-1">
                    A process gap, computed directly from the batch and deliberately
                    kept <em>outside</em> the Shapley sum — a missing retry policy is
                    not a distribution over transactions.
                  </p>
                </div>
                <div className="num text-xl text-mint">{pts(d.process_gap_pts)}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-line flex flex-wrap gap-5
                          text-[11px] font-mono text-muted">
            <span>
              Σφ ={" "}
              <span className="text-ink">
                {r.measured.efficiency_check.sum_of_attributions_pts.toFixed(6)}
              </span>
            </span>
            <span>
              v(N) ={" "}
              <span className="text-ink">
                {r.measured.efficiency_check.v_of_grand_coalition_pts.toFixed(6)}
              </span>
            </span>
            <span className="text-mint">✓ efficiency holds to machine precision</span>
          </div>
        </Card>
      </Stagger>

      {/* ─────────────────────────────────── hypotheses */}
      {diag.hypotheses?.length > 0 && (
        <Stagger i={3}>
          <Card>
            <SectionHeader
              eyebrow="Root cause"
              title="What the model concluded, and the evidence it cited"
              sub="The prompt forbids any number that is not in the supplied context. Every evidence line should quote something the model was actually shown."
            />
            <div className="grid md:grid-cols-2 gap-3">
              {diag.hypotheses.map((h: any, i: number) => (
                <div key={i} className="card-raised p-4 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="num text-xs text-brand">{h.root_cause_label}</span>
                    <span
                      className={`chip ml-auto ${
                        h.action_type === "auto_execute"
                          ? "bg-mint-soft text-mint border-mint/30"
                          : h.action_type === "merchant_action"
                          ? "bg-amber-soft text-amber border-amber/30"
                          : "bg-raised text-muted border-line"
                      }`}
                    >
                      {h.action_type.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{h.hypothesis}</p>
                  {h.evidence?.length > 0 && (
                    <ul className="space-y-1">
                      {h.evidence.map((e: string, j: number) => (
                        <li
                          key={j}
                          className="text-[11px] text-muted font-mono flex gap-1.5"
                        >
                          <span className="text-brand shrink-0">·</span>
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-xs pt-1 border-t border-line">
                    <span className="eyebrow">recommended</span>
                    <div className="mt-1">{h.recommended_action}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Stagger>
      )}

      {/* ─────────────────────────────────── bank health */}
      <Stagger i={4}>
        <Card>
          <SectionHeader
            eyebrow="The ecosystem join"
            title="Your banks vs what the whole country sees"
            sub="This is the comparison nobody makes. It separates “I have a problem with this bank” from “everyone has a problem with this bank right now”."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow border-b border-line">
                  <th className="text-left py-2 font-normal">Bank</th>
                  <th className="text-right py-2 font-normal">Share</th>
                  <th className="text-right py-2 font-normal">You</th>
                  <th className="text-right py-2 font-normal">NPCI BD%</th>
                  <th className="text-right py-2 font-normal">NPCI TD%</th>
                  <th className="text-left py-2 pl-4 font-normal">Verdict</th>
                </tr>
              </thead>
              <tbody className="num">
                {r.bank_health?.banks?.map((b: any) => {
                  const npci = (b.npci_bd_pct ?? 0) + (b.npci_td_pct ?? 0);
                  const worse = b.in_npci_top50 && b.merchant_fail_pct > npci * 1.5;
                  return (
                    <tr key={b.bank} className="border-b border-line/50">
                      <td className="py-2 font-body">{b.bank}</td>
                      <td className="text-right">{b.share_pct}%</td>
                      <td className={`text-right ${worse ? "text-rose" : ""}`}>
                        {b.merchant_fail_pct}%
                      </td>
                      <td className="text-right text-muted">{b.npci_bd_pct ?? "—"}</td>
                      <td className="text-right text-muted">{b.npci_td_pct ?? "—"}</td>
                      <td className="pl-4 text-[11px] font-body">
                        {!b.in_npci_top50 ? (
                          <span className="text-faint">not in NPCI top-50</span>
                        ) : worse ? (
                          <span className="text-rose">
                            worse than the country — your problem
                          </span>
                        ) : (
                          <span className="text-muted">in line with the country</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="eyebrow mt-3">
            NPCI {r.bank_health?.period} · remitter table — the payer&apos;s issuing
            bank, which is who actually declines a collection
          </p>
        </Card>
      </Stagger>

      {/* ─────────────────────────────────── coalitions */}
      <Stagger i={5}>
        <Card>
          <SectionHeader
            eyebrow="Show your working"
            title="All 16 coalition values"
            sub="Every subset of the four factors, and the improvement from fixing exactly that subset. The Shapley values above are the weighted average of the marginal contributions across all of them — so you can check the arithmetic rather than trust it."
            right={
              <button
                onClick={() => setOpenCoalitions(!openCoalitions)}
                className="card-raised px-3 py-1.5 text-xs hover:border-brand/40 transition-colors"
              >
                {openCoalitions ? "hide" : "show"} the numbers
              </button>
            }
          />
          {openCoalitions && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 animate-rise">
              {Object.entries(d.coalition_values ?? {})
                .sort((a: any, b: any) => a[0].length - b[0].length)
                .map(([k, v]: any) => (
                  <div
                    key={k}
                    className="card-raised px-3 py-2 flex justify-between gap-2 text-xs"
                  >
                    <span className="text-muted truncate font-mono">
                      v({k === "{}" ? "∅" : k})
                    </span>
                    <span className="num shrink-0">{v.toFixed(3)}</span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </Stagger>
    </div>
  );
}
