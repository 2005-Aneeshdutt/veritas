"use client";

import { useEffect, useState } from "react";
import { inr } from "@/lib/types";

/**
 * The operations console: what needs a person, and everything needed to judge it.
 *
 * Two rules shaped this. First, it is a queue and not a table — 2,090 rows
 * sorted by anything is a spreadsheet, and the job here is triage. Second,
 * the drawer is the product: a card exists to get you into the drawer, and
 * the drawer has to carry enough for a decision nobody has to take on trust.
 *
 * The controls a person is not allowed to use are disabled AND the server
 * refuses them. The disabling is a courtesy; the refusal is the rule.
 */

export const STATE_TONE: Record<string, { cls: string; label: string }> = {
  auto_allow: { cls: "chip-measured", label: "auto-allow" },
  human_review: { cls: "chip-brand", label: "human review" },
  hold: { cls: "chip-projected", label: "hold" },
  deny: { cls: "chip-warn", label: "deny" },
  escalate: { cls: "chip-det", label: "escalate" },
};

const PRIORITY_TONE: Record<string, string> = {
  high: "text-rose",
  medium: "text-amber",
  low: "text-faint",
};

const GRADE_TONE: Record<string, string> = {
  strong: "text-mint",
  adequate: "text-amber",
  weak: "text-rose",
  unavailable: "text-faint",
};

export const FILTERS = [
  { key: "urgent", label: "Urgent" },
  { key: "high_value", label: "High value" },
  { key: "uncertain", label: "Uncertain" },
  { key: "policy", label: "Policy" },
  { key: "all", label: "All" },
];

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? "unavailable" : `${Math.round(100 * v)}%`;
}

/* ------------------------------------------------------------------ card */

export function DecisionCard({
  d,
  onReview,
}: {
  d: any;
  onReview: () => void;
}) {
  const st = STATE_TONE[d.state] ?? STATE_TONE.escalate;
  return (
    <div className="panel p-4 hover:border-edge transition-colors">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span
          className={`ui text-[10px] uppercase tracking-[0.12em] font-medium ${
            PRIORITY_TONE[d.priority]
          }`}
        >
          {d.priority} priority
        </span>
        <span className={st.cls}>{st.label}</span>
        <span className="num text-[11px] text-faint ml-auto">{d.payment_id}</span>
      </div>

      <div className="flex items-end gap-6 flex-wrap mt-3">
        <div>
          <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
            at stake
          </div>
          <div className="num text-[24px] font-semibold leading-none mt-1">
            {inr(d.revenue_at_stake_paise)}
          </div>
        </div>
        <div>
          <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
            recommended
          </div>
          <div className="num text-[15px] mt-1.5">{d.recommended_action}</div>
        </div>
        <div>
          <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
            expected back
          </div>
          <div className="num text-[15px] mt-1.5 text-mint">
            {d.expected_recovery_paise
              ? inr(d.expected_recovery_paise)
              : "—"}
          </div>
        </div>
        <div>
          <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
            confidence
          </div>
          <div
            className={`num text-[15px] mt-1.5 ${
              d.confidence === null ? "text-faint" : ""
            }`}
          >
            {pct(d.confidence)}
          </div>
        </div>
        <div>
          <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
            evidence
          </div>
          <div className={`text-[15px] mt-1.5 ${GRADE_TONE[d.evidence.grade]}`}>
            {d.evidence.grade}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3.5 pt-3 border-t border-line">
        <p className="text-[11.5px] text-muted leading-snug flex-1 min-w-0">
          {d.merchant_name} ·{" "}
          {d.priority_reasons.slice(0, 2).join(" · ") || d.state_reason}
        </p>
        <button
          onClick={onReview}
          className="btn-secondary h-8 text-[12px] shrink-0"
        >
          Review
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */

export function ReviewDrawer({
  merchantId,
  decisionId,
  onClose,
  onChanged,
}: {
  merchantId: string;
  decisionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [reason, setReason] = useState("insufficient_evidence");
  const [note, setNote] = useState("");

  function load() {
    setD(null);
    fetch(
      `/api/control-tower/decisions/${decisionId}?merchant_id=${merchantId}`
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setD)
      .catch(() => setErr("could not load this decision"));
  }

  useEffect(load, [merchantId, decisionId]);

  // Escape closes, because a drawer that traps you is a modal.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function act(human_decision: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    const q = new URLSearchParams({
      merchant_id: merchantId,
      human_decision,
      reason_code: reason,
      note,
    });
    const r = await fetch(
      `/api/control-tower/decisions/${decisionId}/review?${q}`,
      { method: "POST" }
    );
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(body.detail ?? "the server refused this");
      return;
    }
    setOk(
      `Recorded: ${body.ai_recommendation} → ${body.human_decision}` +
        (body.executed ? " · executed" : "") +
        (body.ledger_entry_hash
          ? ` · audit ${String(body.ledger_entry_hash).slice(0, 12)}…`
          : "")
    );
    load();
    onChanged();
  }

  async function requestEvidence(key: string) {
    setBusy(true);
    await fetch(
      `/api/control-tower/decisions/${decisionId}/evidence-request?merchant_id=${merchantId}&key=${key}`,
      { method: "POST" }
    );
    setBusy(false);
    load();
  }

  async function reevaluate() {
    setBusy(true);
    await fetch(
      `/api/control-tower/decisions/${decisionId}/reevaluate?merchant_id=${merchantId}`,
      { method: "POST" }
    );
    setBusy(false);
    load();
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-canvas/70 backdrop-blur-sm"
      />
      <aside className="relative w-full max-w-[38rem] bg-subtle border-l border-line overflow-y-auto">
        <div className="sticky top-0 bg-subtle/95 backdrop-blur border-b border-line px-6 h-12 flex items-center justify-between z-10">
          <span className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
            Review decision
          </span>
          <button onClick={onClose} className="btn-quiet h-7 text-[12px]">
            Close
          </button>
        </div>

        {!d ? (
          <p className="p-6 text-[13px] text-faint">
            {err ?? "loading the decision…"}
          </p>
        ) : (
          <div className="p-6 space-y-7">
            {/* ── DECISION ── */}
            <Section title="Decision">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <F label="Recommended action" v={d.recommended_action} />
                <F
                  label="Expected recovery"
                  v={
                    d.expected_recovery_paise
                      ? inr(d.expected_recovery_paise)
                      : "unavailable"
                  }
                  tone="text-mint"
                  sub={`basis: ${d.expected_recovery_basis}`}
                />
                <F
                  label="Confidence"
                  v={pct(d.confidence)}
                  sub={`uncertainty: ${d.uncertainty}`}
                />
                <F
                  label="Priority"
                  v={d.priority}
                  tone={PRIORITY_TONE[d.priority]}
                  sub={d.priority_reasons.join(" · ")}
                />
              </div>
              <p className="text-[12.5px] text-muted leading-relaxed mt-4 border-t border-line pt-3">
                {d.state_reason}
              </p>
            </Section>

            {/* ── WHY ── */}
            <Section title="Why">
              {d.root_cause ? (
                <>
                  <F label="Primary cause" v={String(d.root_cause).replace(/_/g, " ")} />
                  <div className="mt-3">
                    <F
                      label="Attribution"
                      v={
                        d.attribution_pts === null
                          ? "unavailable"
                          : `${d.attribution_pts > 0 ? "+" : ""}${Number(
                              d.attribution_pts
                            ).toFixed(2)} pts${
                              d.attribution_mae
                                ? ` ± ${Number(d.attribution_mae).toFixed(2)}`
                                : ""
                            }`
                      }
                    />
                  </div>
                  {d.diagnosis_summary && (
                    <p className="text-[12.5px] text-muted leading-relaxed mt-3">
                      {d.diagnosis_summary}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[12.5px] text-faint">
                  No diagnosis on file for this merchant.
                </p>
              )}
            </Section>

            {/* ── EVIDENCE ── */}
            <Section title="Evidence">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[15px] ${GRADE_TONE[d.evidence.grade]}`}>
                  {d.evidence.grade === "weak" ||
                  d.evidence.grade === "unavailable"
                    ? "INSUFFICIENT EVIDENCE"
                    : `evidence ${d.evidence.grade}`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px]">
                <E
                  k="Classifier"
                  v={
                    d.evidence.classifier_confidence === null
                      ? "unavailable"
                      : `${pct(d.evidence.classifier_confidence)} (${
                          d.evidence.classifier_source
                        })`
                  }
                />
                <E
                  k="Attribution vs its own error"
                  v={
                    d.evidence.attribution_ratio === null
                      ? "unavailable"
                      : `${d.evidence.attribution_ratio}×`
                  }
                />
                <E
                  k="Decomposition"
                  v={
                    d.evidence.decomposition_reliable === null
                      ? "unavailable"
                      : d.evidence.decomposition_reliable
                      ? "reliable"
                      : "did not hold up"
                  }
                />
                <E
                  k="Batch power"
                  v={
                    d.evidence.batch_underpowered === null
                      ? "unavailable"
                      : d.evidence.batch_underpowered
                      ? "underpowered"
                      : "adequate"
                  }
                />
                <E k="Payment" v={`${d.payment_id} · ${d.error_code ?? "?"}`} />
                <E k="Prior attempts" v={`${d.prior_attempts} of 3`} />
              </div>

              {d.evidence.gaps.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {d.evidence.gaps.map((g: string) => (
                    <li key={g} className="text-[12px] text-rose leading-snug">
                      · {g}
                    </li>
                  ))}
                </ul>
              )}

              {/* the missing-evidence flow: grounded requests, never a guess */}
              {d.evidence_available?.length > 0 && (
                <div className="mt-4 border-t border-line pt-3 space-y-2">
                  <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                    Request evidence
                  </div>
                  {d.evidence_available.map((r: any) => {
                    const open = (d.evidence_requests ?? []).some(
                      (x: any) => x.key === r.key
                    );
                    return (
                      <div key={r.key} className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px]">{r.label}</div>
                          <div className="text-[11px] text-faint leading-snug">
                            {r.how}
                          </div>
                        </div>
                        <button
                          disabled={busy || open}
                          onClick={() => requestEvidence(r.key)}
                          className="btn-quiet h-7 text-[11px] shrink-0 disabled:opacity-40"
                        >
                          {open ? "requested" : "Request"}
                        </button>
                      </div>
                    );
                  })}
                  <button
                    onClick={reevaluate}
                    disabled={busy}
                    className="btn-quiet h-7 text-[11px] mt-1"
                  >
                    ↺ Re-evaluate
                  </button>
                  <p className="text-[11px] text-faint leading-snug">
                    Re-evaluating re-derives this decision from whatever the
                    data says now. If nothing underneath has changed, the
                    decision will not change either — no model is asked to fill
                    the gap.
                  </p>
                </div>
              )}
            </Section>

            {/* ── COUNTERFACTUAL ── */}
            <Section title="Counterfactual">
              {d.counterfactual?.available ? (
                <>
                  <div className="grid grid-cols-3 gap-x-6">
                    <F
                      label="Without intervention"
                      v={inr(d.counterfactual.without_intervention_paise)}
                    />
                    <F
                      label="With this policy"
                      v={inr(d.counterfactual.with_intervention_paise)}
                      tone="text-mint"
                    />
                    <F
                      label="Delta"
                      v={inr(d.counterfactual.delta_paise)}
                      tone="text-mint"
                    />
                  </div>
                  <p className="text-[11.5px] text-faint leading-relaxed mt-3">
                    {d.counterfactual.note}
                  </p>
                </>
              ) : (
                <p className="text-[12.5px] text-faint">
                  COUNTERFACTUAL UNAVAILABLE
                  {d.counterfactual?.note ? ` — ${d.counterfactual.note}` : ""}
                </p>
              )}
            </Section>

            {/* ── POLICY ── */}
            <Section title="Policy">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <F
                  label="Policy result"
                  v={d.policy_result}
                  tone={
                    d.policy_result === "deny"
                      ? "text-rose"
                      : d.policy_result === "step_up"
                      ? "text-amber"
                      : "text-mint"
                  }
                />
                <F label="Rule" v={d.policy_rule} />
                <F
                  label="Auto-execute limit"
                  v={inr(d.auto_execute_limit_paise)}
                />
                <F label="Hard ceiling" v={inr(d.max_amount_paise)} />
              </div>
              <p className="text-[11.5px] text-faint leading-relaxed mt-3">
                Decided by the deterministic policy kernel against a mandate
                signed with a key this system has never held. No model was
                consulted and nothing on this screen can widen it.
              </p>
            </Section>

            {/* ── ACTION ── */}
            <Section title="What would execute">
              <div className="grid grid-cols-3 gap-x-6">
                <F label="Action" v={d.recommended_action} />
                <F label="Channel" v={d.recommended_channel} />
                <F label="Amount" v={inr(d.revenue_at_stake_paise)} />
              </div>
              <p className="text-[11.5px] text-faint leading-relaxed mt-3">
                Approving runs the existing recovery path, with its own
                idempotency and stopping rules. Approving twice does not act
                twice.
              </p>
            </Section>

            {/* ── DECIDE ── */}
            <Section title="Your decision">
              {d.override_blocked_reason && (
                <p className="text-[12.5px] text-rose leading-relaxed mb-4">
                  {d.override_blocked_reason}
                </p>
              )}

              <label className="block">
                <span className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                  Reason (required)
                </span>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="field h-9 text-[13px] w-full mt-1.5"
                >
                  {Object.entries(d.override_reasons ?? {}).map(
                    ([k, v]: any) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, " ")} — {v}
                      </option>
                    )
                  )}
                </select>
              </label>

              {reason === "other" && (
                <label className="block mt-3">
                  <span className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                    Explanation (required for “other”)
                  </span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="what the system could not see"
                    className="field h-9 text-[13px] w-full mt-1.5"
                  />
                </label>
              )}
              {reason !== "other" && (
                <label className="block mt-3">
                  <span className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                    Note (optional)
                  </span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="field h-9 text-[13px] w-full mt-1.5"
                  />
                </label>
              )}

              <div className="flex gap-2 mt-4 flex-wrap">
                {["approve", "hold", "deny", "escalate"].map((a) => {
                  const allowed = d.permitted_human_actions.includes(a);
                  return (
                    <button
                      key={a}
                      disabled={!allowed || busy}
                      onClick={() => act(a)}
                      title={
                        allowed
                          ? undefined
                          : d.override_blocked_reason ?? "not available here"
                      }
                      className={`h-9 px-4 text-[12.5px] rounded ${
                        a === "approve"
                          ? "btn-primary"
                          : "btn-secondary"
                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>

              {err && (
                <p className="text-[12.5px] text-rose mt-3 leading-relaxed">
                  {err}
                </p>
              )}
              {ok && (
                <p className="text-[12.5px] text-mint mt-3 leading-relaxed">
                  {ok}
                </p>
              )}
            </Section>

            {/* ── THE LOOP ── */}
            {(d.reviews?.length > 0 ||
              d.outcome?.state !== "not_executed") && (
              <Section title="What happened">
                {(d.reviews ?? []).map((r: any, i: number) => (
                  <div
                    key={i}
                    className="text-[12.5px] leading-relaxed border-l-2 border-line pl-3 mb-3"
                  >
                    <div>
                      AI: <span className="num">{r.ai_recommendation}</span> ·
                      policy: <span className="num">{r.policy_result}</span> ·
                      human:{" "}
                      <span className="num text-brand">{r.human_decision}</span>
                    </div>
                    <div className="text-faint text-[11.5px] mt-0.5">
                      {r.reason_code.replace(/_/g, " ")}
                      {r.note ? ` — ${r.note}` : ""} · {r.actor}
                    </div>
                    {r.ledger_entry_hash && (
                      <div className="num text-[10.5px] text-faint mt-0.5">
                        audit {r.ledger_entry_hash.slice(0, 20)}…
                      </div>
                    )}
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-2">
                  <E k="Executed" v={d.outcome.executed_action ?? "nothing yet"} />
                  <E k="Outcome" v={d.outcome.state} />
                  <E
                    k="Recovered"
                    v={
                      d.outcome.recovered_paise
                        ? inr(d.outcome.recovered_paise)
                        : "₹0 — no outcome event yet"
                    }
                  />
                  <E
                    k="Confirmed by"
                    v={d.outcome.confirmed_by_event ?? "—"}
                  />
                </div>
              </Section>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------- atoms */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="ui text-[10px] uppercase tracking-[0.14em] text-faint border-b border-line pb-2 mb-3.5">
        {title}
      </h3>
      {children}
    </section>
  );
}

function F({
  label,
  v,
  sub,
  tone,
}: {
  label: string;
  v: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
      <div className={`num text-[15px] mt-1 break-words ${tone ?? ""}`}>{v}</div>
      {sub && (
        <div className="text-[11px] text-faint mt-1 leading-snug">{sub}</div>
      )}
    </div>
  );
}

function E({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <span className="text-faint">{k}: </span>
      <span className="num break-words">{v}</span>
    </div>
  );
}
