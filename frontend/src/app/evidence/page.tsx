"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Budget } from "@/components/Budget";
import { TopBar } from "@/components/Chrome";
import {
  Detail,
  Empty,
  Eyebrow,
  Figure,
  Figures,
  Loading,
  Notes,
  PageHead,
  Panel,
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
  actor: string;
  entry_hash: string;
}

interface Audit {
  chains: Chain[];
  chains_verified: number;
  chains_total: number;
  entries_total: number;
  by_outcome: Record<string, number>;
  by_reason: Record<string, number>;
  by_actor: Record<string, number>;
  recent: Entry[];
}

const ACTOR_LABEL: Record<string, string> = {
  agent: "the agent",
  platform: "Razorpay",
  merchant: "the merchant",
};

const ACTOR_NOTE: Record<string, string> = {
  agent: "acting alone, inside the signed mandate",
  platform: "an operator approving on the merchant's behalf",
  merchant: "deciding for themselves, from the emailed link",
};

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
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">{body}</main>
    </div>
  );

  if (dead) return shell(<Empty label="the API did not respond" />);
  if (!o || !a) return shell(<Loading label="gathering the evidence" />);

  const held = o.overall.within_own_error_bar;
  // The scoreboard's own figures, read from the two endpoints already
  // fetched — nothing here is a second source for a number shown elsewhere.
  const escalated =
    (a.by_outcome["merchant_action"] ?? 0) + (a.by_outcome["escalated"] ?? 0);
  const recovered = o.fixes.reduce(
    (n, f) => n + Math.max(0, f.measured_value_paise),
    0
  );

  return shell(
    <>
      <Stagger>
        <PageHead
          title="Evidence"
          sub="The proof behind everything on the other eight screens: whether the forecasts came true, every decision the system took and whether that record has been tampered with, and what the model steps cost."
        />
      </Stagger>

      {/* The scoreboard. One row, five numbers, each one the answer to a
          question the brief asked by name. */}
      <Stagger i={0}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line rounded-lg overflow-hidden">
          <Score
            label="measured recovery"
            value={inr(recovered)}
            tone="text-mint"
            kind="measured"
            sub="marked against a known outcome"
          />
          <Score
            label="escalated"
            value={escalated.toLocaleString("en-IN")}
            tone="text-amber"
            sub="handed to a person, by rule"
          />
          <Score
            label="stopped"
            value={String(a.by_outcome["denied"] ?? 0)}
            tone="text-rose"
            sub="refused, and unapprovable"
          />
          <Score
            label="ledger entries"
            value={a.entries_total.toLocaleString("en-IN")}
            sub="one per decision, append-only"
          />
          <Score
            label="chains verified"
            value={`${a.chains_verified} / ${a.chains_total}`}
            tone={a.chains_verified === a.chains_total ? "text-mint" : "text-rose"}
            kind="measured"
            sub="re-hashed from genesis just now"
          />
        </div>
      </Stagger>

      {/* ── 1. did the fix work ── */}
      <Stagger i={1}>
        <SectionHeader
          title="Did the fix actually work?"
          sub="Attribution accuracy asks whether the cause was named correctly. This asks the harder thing: after the fix landed, did the merchant's success rate move by as much as we said it would."
          right={
            <span className="text-[12px] text-muted whitespace-nowrap">
              {o.overall.optimistic} over-promised · {o.overall.pessimistic} beat
              it · {o.overall.held} landed on it
            </span>
          }
        />

        <Figures>
          <Figure
            label="fixes scored"
            value={String(o.n_fixes)}
            sub="each a real counterfactual month"
          />
          <Figure
            label="mean absolute error"
            kind="measured"
            value={`${o.overall.mae_pts.toFixed(3)} pts`}
            sub="how far off, on average"
          />
          <Figure
            label="bias"
            kind="measured"
            value={`${o.overall.mean_forecast_error_pts > 0 ? "+" : ""}${o.overall.mean_forecast_error_pts.toFixed(3)} pts`}
            sub={
              o.overall.mean_forecast_error_pts < 0
                ? "negative — we under-promised on balance"
                : "positive — we over-promised on balance"
            }
            tone={o.overall.mean_forecast_error_pts < 0 ? "good" : "bad"}
          />
          <Figure
            label="inside their own error bar"
            value={`${held} of ${o.n_fixes}`}
            sub="the bar we publish beforehand"
            tone={held * 2 >= o.n_fixes ? "good" : "bad"}
          />
        </Figures>

          <div className="mt-6 overflow-x-auto">
            <table className="tbl min-w-[46rem]">
              <thead>
                <tr>
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
                  <tr key={i}>
                    <td>{f.merchant_name}</td>
                    <td className="text-muted">
                      {f.cause_fixed.replace(/_/g, " ")}
                    </td>
                    <td className="num text-right whitespace-nowrap">
                      +{f.predicted_pts.toFixed(2)}
                      {f.predicted_error_pts != null && (
                        <span className="text-faint">
                          {" "}
                          ± {f.predicted_error_pts.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="num text-right">
                      {f.measured_pts >= 0 ? "+" : ""}
                      {f.measured_pts.toFixed(2)}
                    </td>
                    <td
                      className={`num text-right ${
                        Math.abs(f.forecast_error_pts) <= 0.5 ? "text-mint" : "text-amber"
                      }`}
                    >
                      {f.forecast_error_pts >= 0 ? "+" : ""}
                      {f.forecast_error_pts.toFixed(2)}
                    </td>
                    <td>
                      <span
                        className={`text-[12px] ${
                          f.within_error_bar
                            ? "text-mint"
                            : f.forecast_error_pts < 0
                            ? "text-muted"
                            : "text-amber"
                        }`}
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
            <Panel tone="note" className="mt-5">
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
            </Panel>
          )}
      </Stagger>

      {/* ── 2. the audit trail ── */}
      <Stagger i={2}>
          <SectionHeader
            title="The audit trail"
            sub="Each run keeps a hash-chained ledger, re-verified from genesis on every load of this page rather than read off a stored flag — a stored 'verified: true' is a claim, recomputing the hashes is a check."
          />

          <Figures>
            <Figure
              label="chains intact"
              kind="measured"
              value={`${a.chains_verified} / ${a.chains_total}`}
              sub="re-hashed from genesis just now"
              tone={a.chains_verified === a.chains_total ? "good" : "bad"}
            />
            <Figure
              label="entries"
              value={a.entries_total.toLocaleString("en-IN")}
              sub="one per decision, append-only"
            />
            <Figure
              label="denied"
              value={String(a.by_outcome["denied"] ?? 0)}
              sub="the kernel refusing, on the record"
              tone="bad"
            />
            {/* Three different people are answerable for these numbers, and a
                ledger that recorded them identically would be crediting a
                console operator with the merchant's own decisions. */}
            <Figure
              label="acted by"
              value={
                <span className="flex items-baseline gap-3">
                  {(["agent", "platform", "merchant"] as const).map((who) => (
                    <span key={who} className="flex items-baseline gap-1">
                      {(a.by_actor?.[who] ?? 0).toLocaleString("en-IN")}
                      <span className="text-[11px] text-faint font-normal">
                        {ACTOR_LABEL[who]}
                      </span>
                    </span>
                  ))}
                </span>
              }
              sub="the actor is inside the hash, not beside it"
            />
          </Figures>

          <div className="mt-7">
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
              <table className="tbl text-[12px] min-w-[52rem]">
                <thead className="sticky top-0 bg-canvas">
                  <tr>
                    <Th>merchant</Th>
                    <Th>payment</Th>
                    <Th>action</Th>
                    <Th right>amount</Th>
                    <Th>gate</Th>
                    <Th>reason</Th>
                    <Th>by</Th>
                    <Th>hash</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.recent.map((e) => (
                    <tr
                      key={e.entry_hash}
                      className=""
                    >
                      <td className="whitespace-nowrap">{e.merchant}</td>
                      <td className="num truncate max-w-[10rem]">
                        {/* Every row is a decision about a real payment, and
                            the file on that payment is one click away. */}
                        {e.txn_id.startsWith("merchant:") ? (
                          e.txn_id
                        ) : (
                          <Link
                            href={`/run/${e.run_id}/journey?txn=${encodeURIComponent(e.txn_id)}`}
                            className="link-quiet"
                          >
                            {e.txn_id}
                          </Link>
                        )}
                      </td>
                      <td className="text-muted whitespace-nowrap">
                        {e.action_type?.replace(/_/g, " ")}
                      </td>
                      <td className="num text-right whitespace-nowrap">
                        {e.amount_paise ? inr(e.amount_paise) : "—"}
                      </td>
                      <td>
                        <span className={DECISION_CHIP[e.gate_decision] ?? "chip-neutral"}>
                          {e.gate_decision}
                        </span>
                      </td>
                      <td className="num text-[10px] text-faint whitespace-nowrap">
                        {e.gate_reason}
                      </td>
                      <td className="text-[11px] whitespace-nowrap">
                        {ACTOR_LABEL[e.actor] ?? e.actor}
                      </td>
                      <td className="num text-[10px] text-faint">
                        {e.entry_hash?.slice(0, 10)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

      </Stagger>

      {/* ── 3. the bill ── */}
      <Stagger i={3}>
        <Budget />
      </Stagger>

      <Notes>
        <Detail summary="how a counterfactual month is built">
          <p>{o.note}</p>
          <p>{o.fix_effectiveness_assumed}</p>
        </Detail>
        <Detail summary="the chains, one per merchant">
          <div className="space-y-1 not-prose">
            {a.chains.map((c) => (
              <div key={c.run_id} className="flex items-center gap-3 text-[12px] py-1">
                <span className={c.verified ? "text-mint" : "text-rose"}>
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
        <Detail summary="who the three actors are, and why it is in the hash">
          <p>
            <strong>{ACTOR_LABEL.agent}</strong> — {ACTOR_NOTE.agent}.{" "}
            <strong>{ACTOR_LABEL.platform}</strong> — {ACTOR_NOTE.platform}.{" "}
            <strong>{ACTOR_LABEL.merchant}</strong> — {ACTOR_NOTE.merchant}.
          </p>
          <p>
            The actor is inside the hash rather than beside it. Adding it cost
            a rebuild of every chain in the book, which is the price of an
            answer to &ldquo;who approved this&rdquo; that cannot be edited
            afterwards.
          </p>
        </Detail>
      </Notes>
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={right ? "text-right" : ""}>{children}</th>;
}

/** One figure on the scoreboard. Provenance is shown where it applies. */
function Score({
  label,
  value,
  sub,
  tone,
  kind,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  kind?: "measured" | "projected";
}) {
  return (
    <div className="bg-surface p-4">
      <div className="flex items-center gap-1.5">
        <span className="ui text-[10px] uppercase tracking-[0.11em] text-faint">
          {label}
        </span>
        {kind && (
          <span className={kind === "measured" ? "chip-measured" : "chip-projected"}>
            {kind}
          </span>
        )}
      </div>
      <div className={`num text-[20px] font-semibold leading-none mt-2 ${tone ?? ""}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-faint mt-1.5 leading-tight">{sub}</div>}
    </div>
  );
}
