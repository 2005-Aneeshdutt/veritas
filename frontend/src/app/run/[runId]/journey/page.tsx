"use client";

import { useEffect, useState } from "react";
import { Card, Detail, Empty, Eyebrow, Loading, SectionHeader, Stagger } from "@/components/ui";
import { inr } from "@/lib/types";

interface Candidate {
  txn_id: string;
  amount_paise: number;
  action_type: string;
  outcome: string;
  gate_reason: string;
}

interface Beat {
  key: string;
  at: string | null;
  title: string;
  detail: string;
  tone: string;
  facts: { k: string; v: string }[];
}

interface Journey {
  found: boolean;
  txn_id: string;
  merchant_name: string;
  amount_paise: number;
  bank: string;
  method: string;
  hour: number | null;
  error_code: string | null;
  error_class: string | null;
  fault_owner: string;
  fault_label: string;
  beats: Beat[];
  final_outcome: string;
  final_reason: string;
  recovered_paise: number;
  would_have_converted: boolean | null;
  truth_note: string;
}

const OUTCOME_CHIP: Record<string, string> = {
  executed: "chip-measured",
  merchant_action: "chip-projected",
  escalated: "chip-neutral",
  denied: "chip-warn",
  exception: "chip-warn",
};

const OUTCOME_WORD: Record<string, string> = {
  executed: "the agent acted",
  merchant_action: "waiting on a person",
  escalated: "flagged for a human",
  denied: "the kernel refused",
  exception: "could not be acted on",
};

const TONE_RAIL: Record<string, string> = {
  good: "bg-mint",
  held: "bg-amber",
  bad: "bg-rose",
  fact: "bg-line",
};

/**
 * One payment, end to end.
 *
 * Everything else in this product aggregates, which is the right shape for
 * the claims and the wrong shape for the only question anyone asks when they
 * stop believing an aggregate: show me one.
 *
 * The last beat needs care and gets it. Whether a retry would truly have
 * converted is ground truth the engine never sees — the decision above it was
 * made and hashed into the ledger before this page went looking. Showing the
 * counterfactual alongside the evidence, rather than after it, would be
 * showing a system that cheats.
 */
export default function JourneyPage({ params }: { params: { runId: string } }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [txn, setTxn] = useState<string | null>(null);
  const [j, setJ] = useState<Journey | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch(`/api/run/${params.runId}/journeys?limit=200`)
      .then((r) => r.json())
      .then((d) => {
        setList(d.payments);
        // Open on the most interesting one rather than an empty pane — the
        // list is already ordered denied, then held, then executed.
        const deep = new URLSearchParams(window.location.search).get("txn");
        setTxn(deep ?? d.payments?.[0]?.txn_id ?? null);
      })
      .catch(() => setList([]));
  }, [params.runId]);

  useEffect(() => {
    if (!txn) return;
    setJ(null);
    fetch(`/api/run/${params.runId}/journey/${encodeURIComponent(txn)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setJ)
      .catch(() => setJ(null));
  }, [txn, params.runId]);

  if (!list) return <Loading label="finding payments worth opening" />;
  if (list.length === 0) return <Empty label="no payments were decided in this run" />;

  const outcomes = Array.from(new Set(list.map((c) => c.outcome)));
  const shown = filter === "all" ? list : list.filter((c) => c.outcome === filter);

  return (
    <div className="space-y-6">
      <Stagger>
        <div>
          <Eyebrow>Stop believing the aggregate</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">One payment, end to end</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            Every other view here adds payments up. This one follows a single
            payment from the moment it failed to whatever finally happened to
            it — including, at the end, what would truly have happened, which
            the engine never saw.
          </p>
        </div>
      </Stagger>

      <div className="grid lg:grid-cols-[20rem_1fr] gap-5 items-start">
        {/* ── the picker ── */}
        <Stagger i={1}>
          <Card className="!p-0 overflow-hidden lg:sticky lg:top-4">
            <div className="px-4 pt-4 pb-3 border-b border-line">
              <Eyebrow>{list.length} payments decided</Eyebrow>
              <div className="flex flex-wrap gap-1 mt-2">
                <Pill on={filter === "all"} onClick={() => setFilter("all")}>
                  all
                </Pill>
                {outcomes.map((o) => (
                  <Pill key={o} on={filter === o} onClick={() => setFilter(o)}>
                    {o.replace("_", " ")}
                  </Pill>
                ))}
              </div>
              <p className="text-[11px] text-faint mt-2 leading-tight">
                Refused first, then held, then acted on — a list that opened on
                forty successes would read as a log.
              </p>
            </div>
            <div className="max-h-[30rem] overflow-y-auto">
              {shown.map((c) => (
                <button
                  key={c.txn_id}
                  onClick={() => setTxn(c.txn_id)}
                  className={`w-full text-left px-4 py-2.5 border-b border-line/60
                              last:border-0 transition-colors ${
                                txn === c.txn_id
                                  ? "bg-raised"
                                  : "hover:bg-raised/50"
                              }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="num text-[11px] flex-1 truncate">
                      {c.txn_id}
                    </span>
                    <span className="num text-[12px] shrink-0">
                      {inr(c.amount_paise)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={OUTCOME_CHIP[c.outcome] ?? "chip-neutral"}>
                      {c.outcome.replace("_", " ")}
                    </span>
                    <span className="text-[10px] text-faint truncate">
                      {c.action_type?.replace(/_/g, " ")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </Stagger>

        {/* ── the file ── */}
        <Stagger i={2}>
          {!j ? (
            <Loading label="opening the file" />
          ) : (
            <Card>
              <SectionHeader
                eyebrow={j.merchant_name}
                title={j.txn_id}
                sub={`${inr(j.amount_paise)} · ${j.bank} · ${j.method.replace(/_/g, " ")}${
                  j.hour != null ? ` · ${String(j.hour).padStart(2, "0")}:00` : ""
                }`}
              />

              <div className="flex flex-wrap gap-2 -mt-2 mb-5">
                <span className={OUTCOME_CHIP[j.final_outcome] ?? "chip-neutral"}>
                  {OUTCOME_WORD[j.final_outcome] ?? j.final_outcome}
                </span>
                {j.error_code && (
                  <span className="chip-neutral num">{j.error_code}</span>
                )}
                <span className="chip-neutral">{j.fault_label}</span>
                {j.recovered_paise > 0 && (
                  <span className="chip-measured">
                    {inr(j.recovered_paise)} recovered
                  </span>
                )}
              </div>

              <ol className="relative">
                {j.beats.map((b, i) => (
                  <li key={b.key} className="relative pl-7 pb-5 last:pb-0">
                    {/* the thread */}
                    {i < j.beats.length - 1 && (
                      <span className="absolute left-[7px] top-4 bottom-0 w-px bg-line" />
                    )}
                    <span
                      className={`absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full
                                  border-2 border-canvas ${
                                    TONE_RAIL[b.tone] ?? TONE_RAIL.fact
                                  }`}
                    />
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium">{b.title}</span>
                      {b.at && (
                        <span className="num text-[10px] text-faint">
                          {new Date(b.at).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    {b.detail && (
                      <p className="text-[13px] text-muted mt-1 leading-relaxed">
                        {b.detail}
                      </p>
                    )}
                    {b.facts?.length > 0 && (
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                        {b.facts.map((f) => (
                          <span key={f.k} className="text-[11px]">
                            <span className="text-faint">{f.k} </span>
                            <span className="num">{f.v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>

              {j.would_have_converted !== null && (
                <div
                  className={`card-raised p-4 mt-5 border-l-2 ${
                    j.would_have_converted ? "border-l-mint" : "border-l-line"
                  }`}
                >
                  <Eyebrow>Why this is not cheating</Eyebrow>
                  <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
                    {j.truth_note} The ledger entry above carries a hash taken
                    at the moment of the decision, so the order is not
                    something you have to take our word for.
                  </p>
                </div>
              )}

              <Detail summary="what this page is reading">
                <p>
                  Nothing here is recomputed. Every beat is read off the run
                  record — the transaction as it arrived, Razorpay&rsquo;s
                  published wording for its error code, the action the agent
                  proposed with its own reason text, and the ledger entry the
                  kernel wrote. If this page and the ledger disagreed, the
                  page would be wrong, and it cannot, because it has no
                  second opinion to offer.
                </p>
              </Detail>
            </Card>
          )}
        </Stagger>
      </div>
    </div>
  );
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
        on
          ? "bg-brand text-brand-ink border-brand"
          : "border-line text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
