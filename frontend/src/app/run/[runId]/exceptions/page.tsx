"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, Info, Loading, SectionHeader, Stagger } from "@/components/ui";
import { GLOSSARY } from "@/lib/explain";
import { RunRecord, inr } from "@/lib/types";

const STOPPING_RULES = [
  ["Max 3 attempts per payment", "Counting retries the merchant already made, not just ours."],
  ["Escalation ladder", "auto-retry → merchant flag → human handoff. Never skipped."],
  ["Bank-degraded hold", "4 hours before re-evaluating a bank that is failing."],
  ["Recovery window", "7 days from the original failure, then it stops."],
  ["Per-action ceiling", "From the signed mandate. Above it, denied outright."],
  ["Mandate expiry", "Absolute. An expired mandate denies everything."],
];

export default function ExceptionsPage({ params }: { params: { runId: string } }) {
  const [rec, setRec] = useState<RunRecord | null>(null);

  useEffect(() => {
    fetch(`/api/run/${params.runId}`).then((r) => r.json()).then(setRec);
  }, [params.runId]);

  if (!rec) return <Loading label="loading exceptions" />;

  const r = rec.report;
  const ex = r.exceptions;
  const byClass: Record<string, any[]> = {};
  for (const t of ex.unrecoverable_transactions) {
    (byClass[t.error_class ?? "unknown"] ||= []).push(t);
  }

  return (
    <div className="space-y-6">
      <Stagger>
        <div>
          <Eyebrow>What it could not do, and where not to trust it</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">Exceptions</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            Two lists. The first is unusual: it is the exception list for the{" "}
            <em>method itself</em> — places this engine cannot answer the question it
            was asked, as opposed to payments it failed to fix.
          </p>
        </div>
      </Stagger>

      {/* ─────────────────── method failures — the unusual one */}
      <Stagger i={1}>
        <Card className="border-l-2 border-l-amber">
          <SectionHeader
            eyebrow="List 1 · almost nobody ships this"
            title="Where the method itself is unreliable"
            sub="Not payments that failed — attributions that should not be trusted, and the agent is forbidden from acting on them."
          />
          {ex.method_failures.length === 0 ? (
            <div className="glass-raised p-4 text-sm text-mint">
              ✓ Nothing flagged for this merchant — every factor identified, importance
              weights within bounds, batch adequately powered.
            </div>
          ) : (
            <div className="space-y-2">
              {ex.method_failures.map((f: any, i: number) => (
                <div key={i} className="glass-raised p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="chip bg-amber/10 text-amber border-amber/30">
                      {f.kind.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted">factor: {f.factor}</span>
                    <Info
                      text={
                        f.kind === "factor_not_identified"
                          ? GLOSSARY.not_identified
                          : f.kind === "weights_clamped"
                          ? GLOSSARY.clamp_rate
                          : "The batch is too small for the gap being claimed to be resolvable."
                      }
                    />
                  </div>
                  <p className="text-xs text-muted mt-2 leading-relaxed">{f.detail}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Stagger>

      {/* ─────────────────── unrecoverable payments */}
      <Stagger i={2}>
        <Card>
          <SectionHeader
            eyebrow="List 2 · the honest denominator"
            title={`${r.projected.unrecoverable_count} payments no retry can recover`}
            sub={`Worth ${inr(
              r.projected.unrecoverable_paise
            )}. Listed individually rather than quietly dropped from the recovery rate — which is how recovery percentages get flattering.`}
          />

          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {Object.entries(byClass).map(([cls, rows]) => (
              <div key={cls} className="glass-raised p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{cls.replace("_", " ")}</span>
                  <span className="num text-sm">{rows.length}</span>
                </div>
                <div className="num text-xs text-amber mt-1">
                  {inr(
                    rows.reduce((a: number, t: any) => a + t.amount_paise, 0),
                    { compact: true }
                  )}
                </div>
                <p className="text-[11px] text-muted mt-1.5 leading-snug">
                  {rows[0]?.why}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs num">
              <thead className="sticky top-0 bg-surface">
                <tr className="eyebrow border-b border-line">
                  <th className="text-left py-2 font-normal">payment</th>
                  <th className="text-right py-2 font-normal">amount</th>
                  <th className="text-left py-2 pl-4 font-normal">error code</th>
                  <th className="text-left py-2 font-normal">class</th>
                </tr>
              </thead>
              <tbody>
                {ex.unrecoverable_transactions.map((t: any) => (
                  <tr key={t.txn_id} className="border-b border-line/40">
                    <td className="py-1.5 text-muted">{t.txn_id}</td>
                    <td className="text-right text-amber">{inr(t.amount_paise)}</td>
                    <td className="pl-4">{t.error_code}</td>
                    <td>
                      <span
                        className={
                          t.error_class === "hard_decline" ? "text-rose" : "text-amber"
                        }
                      >
                        {t.error_class}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Stagger>

      {/* ─────────────────── human review */}
      {r.needs_review?.length > 0 && (
        <Stagger i={3}>
          <Card>
            <SectionHeader
              eyebrow="Routed to a person"
              title="Low-confidence classifications"
              sub="The classifier scored these below 0.85 and sent them to a human instead of acting. That is a real branch in the graph, not a log line."
            />
            <div className="space-y-1.5">
              {r.needs_review.map((c: any) => (
                <div
                  key={c.code}
                  className="glass-raised px-3 py-2 flex items-center gap-3 text-xs num"
                >
                  <span className="text-ink">{c.code}</span>
                  <span className="text-muted">{c.category}</span>
                  <span className="ml-auto text-amber">confidence {c.confidence}</span>
                </div>
              ))}
            </div>
          </Card>
        </Stagger>
      )}

      {/* ─────────────────── stopping rules */}
      <Stagger i={4}>
        <Card>
          <SectionHeader
            eyebrow="Bounded by construction"
            title="Stopping rules in force"
            sub="All six live in the policy kernel and are enforced deterministically. No model is consulted about what the agent is allowed to do."
          />
          <div className="grid sm:grid-cols-2 gap-2.5">
            {STOPPING_RULES.map(([rule, detail]) => (
              <div key={rule} className="glass-raised p-3 flex gap-3">
                <span className="text-mint text-sm shrink-0">✓</span>
                <div>
                  <div className="text-sm font-medium">{rule}</div>
                  <div className="text-[11px] text-muted mt-0.5 leading-snug">
                    {detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Stagger>
    </div>
  );
}
