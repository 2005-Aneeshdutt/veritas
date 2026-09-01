"use client";

import { useEffect, useState } from "react";
import { Budget } from "@/components/Budget";
import { TopBar } from "@/components/Chrome";
import { Card, Detail, Empty, Eyebrow, Loading, SectionHeader, Stagger } from "@/components/ui";
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

interface Outcome {
  note: string;
  fix_effectiveness_assumed: string;
  n_fixes: number;
  overall: {
    mean_forecast_error_pts: number;
    mae_pts: number;
    optimistic: number;
    pessimistic: number;
    held: number;
    within_own_error_bar: number;
  };
  fixes: Fix[];
  excluded_from_headline: { causes: string[]; n: number; why: string };
}

interface Chain {
  run_id: string;
  merchant_name: string;
  entries: number;
  verified: boolean;
  detail: string;
  head: string | null;
}

interface Entry {
  run_id: string;
  merchant: string;
  sequence: number;
  timestamp: string;
  txn_id: string;
  action_type: string;
  amount_paise: number;
  gate_decision: string;
  gate_reason: string;
  outcome: string;
  entry_hash: string;
}

interface Audit {
  chains: Chain[];
  chains_verified: number;
  chains_total: number;
  entries_total: number;
  by_outcome: Record<string, number>;
  by_reason: Record<string, number>;
  recent: Entry[];
}

const DECISION_CHIP: Record<string, string> = {
  allow: "chip-measured",
  step_up: "chip-projected",
  deny: "chip-warn",
};

/**
 * Everything that would settle an argument, in one room.
 *
 * These three things were scattered — the bill at the bottom of Prove, the
 * ledger inside whichever run you happened to be looking at, the accuracy
 * numbers in a JSON file nobody opens. They belong together, because they
 * answer one question between them and none of them answers it alone: is any
 * of this true, and what did it cost to find out?
 *
 * The order is deliberate. Whether the forecasts came true is the only
 * question that can embarrass us, so it goes first.
 */
export default function EvidencePage() {
  const [o, setO] = useState<Outcome | null>(null);
  const [a, setA] = useState<Audit | null>(null);
  const [dead, setDead] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    fetch("/api/evals")
      .then((r) => r.json())
      .then((d) => setO(d.outcome_accuracy))
      .catch(() => setDead(true));
    fetch("/api/audit?limit=40")
      .then((r) => r.json())
      .then(setA)
      .catch(() => setDead(true));
  }, []);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-60">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">{body}</main>
    </div>
  );

  if (dead) return shell(<Empty label="the API did not respond" />);
  if (!o || !a) return shell(<Loading label="gathering the evidence" />);

  const held = o.overall.within_own_error_bar;

  return shell(
    <>
      <Stagger>
        <div>
          <Eyebrow>Nothing to take on trust</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">Evidence</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            Whether the forecasts came true, every decision the system has
            taken and whether that record has been tampered with, and what the
            model steps cost.
          </p>
        </div>
      </Stagger>

      {/* ── 1. did the fix work ── */}
      <Stagger i={1}>
        <Card>
          <SectionHeader
            eyebrow="The only question that can embarrass us"
            title="Did the fix actually work?"
            sub="Attribution accuracy asks whether the cause was named correctly. This asks the harder thing: after the fix landed, did the merchant's success rate move by as much as we said it would."
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Fig
              k="fixes scored"
              v={String(o.n_fixes)}
              sub="each a real counterfactual month"
            />
            <Fig
              k="mean absolute error"
              v={`${o.overall.mae_pts.toFixed(3)} pts`}
              sub="how far off, on average"
            />
            <Fig
              k="bias"
              v={`${o.overall.mean_forecast_error_pts > 0 ? "+" : ""}${o.overall.mean_forecast_error_pts.toFixed(3)} pts`}
              sub={
                o.overall.mean_forecast_error_pts < 0
                  ? "negative — we under-promised on balance"
                  : "positive — we over-promised on balance"
              }
              tone={o.overall.mean_forecast_error_pts < 0 ? "text-mint" : "text-amber"}
            />
            <Fig
              k="inside their own error bar"
              v={`${held} of ${o.n_fixes}`}
              sub="the bar we publish beforehand"
              tone={held * 2 >= o.n_fixes ? "text-mint" : "text-amber"}
            />
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <span className="chip-warn">{o.overall.optimistic} over-promised</span>
            <span className="chip-measured">{o.overall.pessimistic} beat the forecast</span>
            <span className="chip-neutral">{o.overall.held} landed on it</span>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-[13px] min-w-[46rem]">
              <thead>
                <tr className="text-left border-b border-line">
                  <Th>merchant</Th>
                  <Th>cause fixed</Th>
                  <Th right>we said</Th>
                  <Th right>it moved</Th>
                  <Th right>error</Th>
                  <Th>verdict</Th>
                </tr>
              </thead>
              <tbody>
                {o.fixes.map((f, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3">{f.merchant_name}</td>
                    <td className="py-2 pr-3 text-muted">
                      {f.cause_fixed.replace(/_/g, " ")}
                    </td>
                    <td className="py-2 pr-3 num text-right whitespace-nowrap">
                      +{f.predicted_pts.toFixed(2)}
                      {f.predicted_error_pts != null && (
                        <span className="text-faint">
                          {" "}
                          ± {f.predicted_error_pts.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 num text-right">
                      {f.measured_pts >= 0 ? "+" : ""}
                      {f.measured_pts.toFixed(2)}
                    </td>
                    <td
                      className={`py-2 pr-3 num text-right ${
                        Math.abs(f.forecast_error_pts) <= 0.5 ? "text-mint" : "text-amber"
                      }`}
                    >
                      {f.forecast_error_pts >= 0 ? "+" : ""}
                      {f.forecast_error_pts.toFixed(2)}
                    </td>
                    <td className="py-2">
                      <span
                        className={
                          f.within_error_bar
                            ? "chip-measured"
                            : f.forecast_error_pts < 0
                            ? "chip-brand"
                            : "chip-warn"
                        }
                      >
                        {f.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {o.excluded_from_headline?.n > 0 && (
            <div className="card-raised p-4 mt-5 border-l-2 border-l-amber">
              <button
                onClick={() => setShowExcluded(!showExcluded)}
                className="text-left w-full"
              >
                <Eyebrow>
                  {o.excluded_from_headline.n} fixes excluded from the headline
                </Eyebrow>
                <div className="text-sm mt-1">
                  {o.excluded_from_headline.causes
                    .join(", ")
                    .replace(/_/g, " ")}{" "}
                  — {showExcluded ? "hide why" : "why?"}
                </div>
              </button>
              {showExcluded && (
                <p className="text-[13px] text-muted mt-2 leading-relaxed">
                  {o.excluded_from_headline.why}
                </p>
              )}
            </div>
          )}

          <Detail summary="how a counterfactual month is built">
            <p>{o.note}</p>
            <p>{o.fix_effectiveness_assumed}</p>
          </Detail>
        </Card>
      </Stagger>

      {/* ── 2. the audit trail ── */}
      <Stagger i={2}>
        <Card>
          <SectionHeader
            eyebrow="Every decision, across the whole book"
            title="The audit trail"
            sub="Each run keeps a hash-chained ledger. These chains are re-verified from genesis on every load of this page rather than read off a stored flag — a stored 'verified: true' is a claim, and recomputing the hashes is a check."
          />

          <div className="grid sm:grid-cols-3 gap-3">
            <Fig
              k="chains intact"
              v={`${a.chains_verified} / ${a.chains_total}`}
              sub="re-hashed from genesis just now"
              tone={a.chains_verified === a.chains_total ? "text-mint" : "text-rose"}
            />
            <Fig
              k="entries"
              v={a.entries_total.toLocaleString("en-IN")}
              sub="one per decision, append-only"
            />
            <Fig
              k="denied"
              v={String(a.by_outcome["denied"] ?? 0)}
              sub="the kernel refusing, on the record"
              tone="text-rose"
            />
          </div>

          <div className="mt-5">
            <Eyebrow>why each decision went the way it did</Eyebrow>
            <div className="space-y-1.5 mt-2">
              {Object.entries(a.by_reason).map(([reason, n]) => {
                const max = Math.max(...Object.values(a.by_reason));
                const deny = reason.startsWith("DENY");
                const step = reason.startsWith("STEP_UP");
                return (
                  <div key={reason} className="flex items-center gap-3">
                    <span className="num text-[11px] text-muted w-64 shrink-0 truncate">
                      {reason}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                      <div
                        className={`h-full ${
                          deny ? "bg-rose" : step ? "bg-amber" : "bg-mint"
                        }`}
                        style={{ width: `${(100 * n) / max}%` }}
                      />
                    </div>
                    <span className="num text-[12px] w-12 text-right shrink-0">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <Eyebrow>the last {a.recent.length} entries, newest first</Eyebrow>
            <div className="mt-2 overflow-x-auto max-h-[26rem] overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[12px] min-w-[52rem]">
                <thead className="sticky top-0 bg-canvas">
                  <tr className="text-left border-b border-line">
                    <Th>merchant</Th>
                    <Th>payment</Th>
                    <Th>action</Th>
                    <Th right>amount</Th>
                    <Th>gate</Th>
                    <Th>reason</Th>
                    <Th>hash</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.recent.map((e) => (
                    <tr
                      key={e.entry_hash}
                      className="border-b border-line/50 last:border-0 hover:bg-raised/50"
                    >
                      <td className="py-1.5 px-2 whitespace-nowrap">{e.merchant}</td>
                      <td className="py-1.5 px-2 num truncate max-w-[10rem]">{e.txn_id}</td>
                      <td className="py-1.5 px-2 text-muted whitespace-nowrap">
                        {e.action_type?.replace(/_/g, " ")}
                      </td>
                      <td className="py-1.5 px-2 num text-right whitespace-nowrap">
                        {e.amount_paise ? inr(e.amount_paise) : "—"}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={DECISION_CHIP[e.gate_decision] ?? "chip-neutral"}>
                          {e.gate_decision}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 num text-[10px] text-faint whitespace-nowrap">
                        {e.gate_reason}
                      </td>
                      <td className="py-1.5 px-2 num text-[10px] text-faint">
                        {e.entry_hash?.slice(0, 10)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Detail summary="the chains, one per merchant">
            <div className="space-y-1 not-prose">
              {a.chains.map((c) => (
                <div
                  key={c.run_id}
                  className="flex items-center gap-3 text-[12px] py-1"
                >
                  <span className={c.verified ? "chip-measured" : "chip-warn"}>
                    {c.verified ? "intact" : "BROKEN"}
                  </span>
                  <span className="flex-1 truncate">{c.merchant_name}</span>
                  <span className="num text-muted">{c.entries} entries</span>
                  <span className="num text-faint hidden sm:inline">
                    head {c.head?.slice(0, 12)}…
                  </span>
                </div>
              ))}
            </div>
          </Detail>
        </Card>
      </Stagger>

      {/* ── 3. the bill ── */}
      <Stagger i={3}>
        <Budget />
      </Stagger>
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`eyebrow font-normal pb-2 px-2 first:pl-0 ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Fig({
  k,
  v,
  sub,
  tone,
}: {
  k: string;
  v: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="card-raised p-4">
      <div className="eyebrow">{k}</div>
      <div className={`num text-2xl font-semibold mt-1 ${tone ?? ""}`}>{v}</div>
      {sub && <div className="text-[11px] text-faint mt-1 leading-tight">{sub}</div>}
    </div>
  );
}
