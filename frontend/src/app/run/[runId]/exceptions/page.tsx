"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, Info, Loading, Stagger, Ticker } from "@/components/ui";
import { GLOSSARY } from "@/lib/explain";
import { RunRecord, inr } from "@/lib/types";

const CLASS_META: Record<
  string,
  { label: string; why: string; fix: string; tone: string }
> = {
  hard_decline: {
    label: "Permanently unusable",
    why: "The card or account cannot be charged at all — expired, closed, or blocked.",
    fix: "Only the customer can fix this. Ask them for a new instrument.",
    tone: "rose",
  },
  auth_failure: {
    label: "Customer did not authenticate",
    why: "Wrong OTP or PIN, or the payment was abandoned partway.",
    fix: "Recoverable by the customer, never by the agent. Send them back to checkout.",
    tone: "amber",
  },
  soft_decline: {
    label: "Temporary, but already retried",
    why: "Recoverable in principle, already attempted the maximum number of times.",
    fix: "Stopped by the mandate's attempt cap, not by a lack of options.",
    tone: "amber",
  },
  technical: {
    label: "Infrastructure",
    why: "The bank, gateway or PSP failed rather than the customer.",
    fix: "Retried where the window allowed; the rest ran out of time.",
    tone: "iris",
  },
  unknown: {
    label: "Unclassified",
    why: "No error code was returned, so nothing can be concluded.",
    fix: "Chase the gateway for the code.",
    tone: "muted",
  },
};

const METHOD_META: Record<string, { label: string; what: string }> = {
  factor_not_identified: {
    label: "Factor not identified",
    what:
      "This merchant has effectively one value for that factor, so there is nothing to compare against. The number is unmeasurable rather than small, and the agent is forbidden from acting on it.",
  },
  weights_clamped: {
    label: "Reweighting unreliable",
    what:
      "This merchant sits far enough from their category profile that the importance weights had to be capped on many transactions. The attribution still runs, but it is not trusted with an automatic action.",
  },
  underpowered_batch: {
    label: "Not enough payments",
    what:
      "The uncertainty on the observed success rate is wider than half the gap being split four ways. Ranking causes here would be ranking noise.",
  },
};

const STOPPING_RULES: [string, string][] = [
  ["3 attempts per payment", "Counting retries the merchant already made, not only ours."],
  ["Escalation ladder", "auto-retry → merchant flag → human handoff. Never skipped."],
  ["4-hour bank hold", "A failing bank is left alone before re-evaluating."],
  ["7-day recovery window", "Older failures are not touched."],
  ["Per-action ceiling", "From the signed mandate. Above it, denied outright."],
  ["Absolute expiry", "An expired mandate denies everything."],
];

export default function ExceptionsPage({ params }: { params: { runId: string } }) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/run/${params.runId}`).then((r) => r.json()).then(setRec);
  }, [params.runId]);

  if (!rec) return <Loading label="loading exceptions" />;

  const r = rec.report;
  const ex = r.exceptions;
  const p = r.projected;

  // The row list is capped by the API for payload size. Counts and rupee
  // totals come from the server's aggregate over every unrecoverable payment,
  // so the bar and the group headers reconcile with the figure above them;
  // only the expandable tables are a sample, and they say so.
  const sample: Record<string, any[]> = {};
  for (const t of ex.unrecoverable_transactions) {
    (sample[t.error_class ?? "unknown"] ||= []).push(t);
  }
  const groups = (ex.unrecoverable_by_class ?? []).map((g: any) => ({
    key: g.error_class,
    count: g.count,
    total: g.total_paise,
    rows: sample[g.error_class] ?? [],
    meta: CLASS_META[g.error_class] ?? CLASS_META.unknown,
  }));
  const grandTotal = groups.reduce((a: number, g: any) => a + g.total, 0) || 1;
  const truncated = ex.unrecoverable_transactions.length < p.unrecoverable_count;

  return (
    <div className="space-y-6">
      <Stagger>
        <div>
          <Eyebrow>The honest denominator</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">What it could not do</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            Two lists. The second is ordinary. The first is unusual — it is the
            exception list for the <em>method itself</em>.
          </p>
        </div>
      </Stagger>

      {/* ─────────────── method failures — the unusual list, first */}
      <Stagger i={1}>
        <Card className="border-l-2 border-l-amber">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <Eyebrow>List one · almost nobody ships this</Eyebrow>
              <h2 className="text-lg font-semibold mt-1">
                Where this engine should not be trusted
              </h2>
              <p className="text-sm text-muted mt-1.5 max-w-2xl">
                Not payments that failed. Attributions the method cannot stand
                behind — and which the agent is therefore forbidden from acting on.
              </p>
            </div>
            <div className="text-right">
              <div
                className={`text-3xl font-display font-bold ${
                  ex.method_failures.length ? "text-amber" : "text-mint"
                }`}
              >
                {ex.method_failures.length}
              </div>
              <div className="eyebrow">flagged</div>
            </div>
          </div>

          {ex.method_failures.length === 0 ? (
            <div className="card-raised p-4 mt-4 text-sm text-mint">
              ✓ Nothing flagged. Every factor was identifiable, the importance
              weights stayed in bounds, and the batch was large enough to resolve
              the gap being claimed.
            </div>
          ) : (
            <div className="mt-4 grid md:grid-cols-2 gap-3">
              {ex.method_failures.map((f: any, i: number) => {
                const m = METHOD_META[f.kind] ?? {
                  label: f.kind,
                  what: f.detail,
                };
                return (
                  <div key={i} className="card-raised p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-amber">▲</span>
                      <span className="text-sm font-medium">{m.label}</span>
                      {f.factor !== "all" && (
                        <span className="chip-neutral ml-auto">{f.factor}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-2 leading-relaxed">{m.what}</p>
                    <p className="text-[11px] text-faint mt-2 font-mono leading-relaxed">
                      {f.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Stagger>

      {/* ─────────────── unrecoverable money, grouped by why */}
      <Stagger i={2}>
        <Card>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <Eyebrow>List two · the honest denominator</Eyebrow>
              <h2 className="text-lg font-semibold mt-1">
                Money no retry can recover
              </h2>
              <p className="text-sm text-muted mt-1.5 max-w-2xl">
                Listed rather than quietly dropped from the recovery rate — which is
                how recovery percentages get flattering.
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-display font-bold text-rose">
                ₹<Ticker value={p.unrecoverable_paise / 100} decimals={0} />
              </div>
              <div className="eyebrow">{p.unrecoverable_count} payments</div>
              {truncated && (
                <div className="text-[10px] text-faint mt-1">
                  totals cover all {p.unrecoverable_count}
                </div>
              )}
            </div>
          </div>

          {/* proportional bar */}
          <div className="flex h-3 w-full rounded-full overflow-hidden mt-5 border border-line">
            {groups.map((g) => (
              <div
                key={g.key}
                title={`${g.meta.label}: ${inr(g.total)}`}
                className={
                  g.meta.tone === "rose"
                    ? "bg-rose/70"
                    : g.meta.tone === "amber"
                    ? "bg-amber/70"
                    : g.meta.tone === "iris"
                    ? "bg-iris/70"
                    : "bg-faint/70"
                }
                style={{ width: `${(g.total / grandTotal) * 100}%` }}
              />
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {groups.map((g) => {
              const isOpen = open === g.key;
              return (
                <div key={g.key} className="card-raised overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : g.key)}
                    className="w-full p-4 text-left hover:bg-raised transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-wrap">
                      <span
                        className={`w-2 h-8 rounded-full shrink-0 ${
                          g.meta.tone === "rose"
                            ? "bg-rose"
                            : g.meta.tone === "amber"
                            ? "bg-amber"
                            : g.meta.tone === "iris"
                            ? "bg-iris"
                            : "bg-faint"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{g.meta.label}</div>
                        <div className="text-xs text-muted mt-0.5">{g.meta.why}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="num text-sm text-amber">
                          {inr(g.total, { compact: true })}
                        </div>
                        <div className="eyebrow">{g.count} payments</div>
                      </div>
                      <span className="text-brand w-3 shrink-0">
                        {isOpen ? "−" : "+"}
                      </span>
                    </div>
                    <div className="text-[11px] text-faint mt-2 pl-6">
                      {g.meta.fix}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-line animate-rise">
                      {g.rows.length < g.count && (
                        <div className="px-4 py-2 text-[11px] text-faint border-b border-line">
                          showing {g.rows.length} of {g.count} — the full list is in
                          the run record, not truncated there
                        </div>
                      )}
                      <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-[11px] num">
                        <thead className="sticky top-0 bg-surface">
                          <tr className="eyebrow border-b border-line">
                            <th className="text-left py-2 px-4 font-normal">payment</th>
                            <th className="text-right py-2 font-normal">amount</th>
                            <th className="text-left py-2 px-4 font-normal">code</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((t: any) => (
                            <tr key={t.txn_id} className="border-b border-line/40">
                              <td className="py-1.5 px-4 text-muted">{t.txn_id}</td>
                              <td className="text-right text-amber">
                                {inr(t.amount_paise)}
                              </td>
                              <td className="px-4">{t.error_code}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </Stagger>

      {/* ─────────────── human review */}
      {r.needs_review?.length > 0 && (
        <Stagger i={3}>
          <Card>
            <Eyebrow>Routed to a person</Eyebrow>
            <h2 className="text-lg font-semibold mt-1 mb-1">
              {r.needs_review.length} low-confidence classifications
            </h2>
            <p className="text-sm text-muted mb-4 max-w-2xl">
              Scored below 0.85 and sent to a human rather than acted on. A real
              branch in the graph, not a log line.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {r.needs_review.map((c: any) => (
                <div
                  key={c.code}
                  className="card-raised px-3 py-2 flex items-center gap-3 text-xs num"
                >
                  <span className="text-ink truncate">{c.code}</span>
                  <span className="text-muted">{c.category}</span>
                  <span className="ml-auto text-amber shrink-0">{c.confidence}</span>
                </div>
              ))}
            </div>
          </Card>
        </Stagger>
      )}

      {/* ─────────────── stopping rules */}
      <Stagger i={4}>
        <Card>
          <Eyebrow>Bounded by construction</Eyebrow>
          <h2 className="text-lg font-semibold mt-1 mb-1">Why it stopped</h2>
          <p className="text-sm text-muted mb-4 max-w-2xl">
            Six rules in the policy kernel, enforced deterministically. No model is
            ever consulted about what the agent is allowed to do.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {STOPPING_RULES.map(([rule, detail]) => (
              <div key={rule} className="card-raised p-3">
                <div className="flex items-center gap-2">
                  <span className="text-mint text-xs">✓</span>
                  <span className="text-sm font-medium">{rule}</span>
                </div>
                <div className="text-[11px] text-muted mt-1 leading-snug pl-5">
                  {detail}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Stagger>
    </div>
  );
}
