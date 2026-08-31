"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/types";

interface GatedAction {
  txn_id: string;
  action_type: string;
  amount_paise: number;
  decision: string;
  reason: string;
  outcome: string;
}

interface Step {
  key: string;
  label: string;
  detail: string;
  status: "pass" | "fail" | "info";
}

interface Group {
  group_id: string;
  action_type: string;
  title: string;
  why: string;
  count: number;
  total_paise: number;
  auto: boolean;
}

interface Result {
  actions?: GatedAction[];
  ok: boolean;
  title: string;
  steps: Step[];
  allowed: number;
  stepped_up: number;
  denied: number;
  executed: number;
  recovered_paise: number;
  ledger_len: number;
  ledger_added: number;
  chain_verified: boolean;
  headline: string;
  already_applied: boolean;
}

const ICON: Record<string, string> = {
  retry_soft_decline: "↻",
  reschedule_billing_window: "◷",
  reissue_payment_link: "⇄",
  enable_multi_bank_routing: "⑃",
  update_payment_method: "⊞",
  renew_mandate: "✎",
  flag_for_investigation: "⚑",
};

/**
 * The control-plane moment.
 *
 * A diagnosis that stops at "here is what is wrong" is a report. This is the
 * merchant approving a fix and watching the mandate be checked, the actions
 * run and the audit entries land -- deliberately paced so it can be narrated
 * rather than flashing past.
 */
export function ApplyFix({
  runId,
  groups,
  onApplied,
}: {
  runId: string;
  groups: Group[];
  onApplied?: () => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  /**
   * The checks, available the moment they come back.
   *
   * These used to be read off `result`, which is not set until the reveal
   * finishes -- so the timer counted up against an empty list and the whole
   * walkthrough appeared at once at the end. The pacing existed; there was
   * simply nothing to pace. Holding the steps separately lets the checks
   * appear one by one while the summary still waits for the last of them.
   */
  const [checks, setChecks] = useState<Step[]>([]);
  /**
   * The payments the kernel ruled on, one line each.
   *
   * The walkthrough showed six rules and a count -- "17 need your
   * confirmation" -- and stopped there, which asks a reader to take the
   * per-action gating on trust. Gating each payment separately against a
   * signed mandate IS the work; a summary of it is not the same thing as
   * seeing it happen.
   */
  const [gated, setGated] = useState<GatedAction[]>([]);
  const [shownActions, setShownActions] = useState(0);
  /**
   * Arriving from the assistant's "Do it" link.
   *
   * The answer names a fix; this opens that fix and scrolls to it, so the
   * advice and the action are one click apart instead of a hunt down the
   * page. It only highlights -- nothing is applied without the merchant
   * pressing the button themselves.
   */
  const search = useSearchParams();
  const asked = search?.get("fix");
  const highlight = asked !== null && asked !== undefined ? Number(asked) : null;
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const autoRan = useRef(false);
  useEffect(() => {
    if (highlight === null || Number.isNaN(highlight)) return;
    const el = cardRefs.current[highlight];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });

    // The assistant said "do it", so do it. Landing on a highlighted card and
    // waiting for a second click made the answer feel like a bookmark rather
    // than an instruction -- and the work it then performs is the part worth
    // watching. Nothing is executed that the kernel would not have allowed
    // anyway: this is the same gated apply the button runs.
    if (!autoRan.current && groups[highlight]) {
      autoRan.current = true;
      const t = setTimeout(() => apply(highlight), 400);
      return () => clearTimeout(t);
    }
  }, [highlight, groups]);
  const [done, setDone] = useState<Record<string, Result>>({});
  const [batch, setBatch] = useState<{
    at: number;
    total: number;
    label: string;
    results: Result[];
  } | null>(null);
  const timers = useRef<any[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function apply(i: number, confirmed = false) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setActive(i);
    setShown(0);
    setResult(null);
    setChecks([]);
    setGated([]);
    setShownActions(0);

    const r = await fetch(
      `/api/run/${runId}/apply?group_index=${i}&confirmed=${confirmed}`,
      { method: "POST" }
    );
    const res: Result = await r.json();
    setChecks(res.steps);
    setGated(res.actions ?? []);

    // Reveal one check at a time. The pacing is the point: it is what turns
    // "the gate ran" into something you can watch happen.
    res.steps.forEach((_, k) => {
      timers.current.push(
        setTimeout(() => setShown(k + 1), 420 * (k + 1))
      );
    });
    // Then the payments themselves, fast enough not to be tedious and slow
    // enough to read. Capped, because ninety rows revealed one at a time is
    // a screensaver, not evidence.
    const afterChecks = 420 * res.steps.length;
    const rows = Math.min(res.actions?.length ?? 0, 24);
    for (let k = 0; k < rows; k++) {
      timers.current.push(
        setTimeout(() => setShownActions(k + 1), afterChecks + 70 * (k + 1))
      );
    }
    timers.current.push(
      setTimeout(() => {
        setShownActions(res.actions?.length ?? 0);
        setResult(res);
        setDone((d) => ({ ...d, [res.title]: res }));
        onApplied?.();
      }, afterChecks + 70 * rows + 300)
    );
  }

  /**
   * Approve every proposed fix, one after another.
   *
   * Sequential rather than parallel, and each group is still gated
   * individually against the signed mandate -- "apply everything" approves
   * the queue, it does not widen the agent's authority. Anything the kernel
   * denies stays denied, and the run-off shows exactly that.
   */
  async function applyAll() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setActive(null);
    setResult(null);

    const results: Result[] = [];
    for (let i = 0; i < groups.length; i++) {
      setBatch({ at: i, total: groups.length, label: groups[i].title, results });
      const r = await fetch(
        `/api/run/${runId}/apply?group_index=${i}&confirmed=false`,
        { method: "POST" }
      );
      const res: Result = await r.json();
      results.push(res);
      setDone((d) => ({ ...d, [res.title]: res }));

      // Anything the kernel held for the merchant is confirmed in a second
      // pass, because that is what approving the whole queue means.
      if (res.stepped_up > 0 && !res.already_applied) {
        const c = await fetch(
          `/api/run/${runId}/apply?group_index=${i}&confirmed=true`,
          { method: "POST" }
        );
        const confirmed: Result = await c.json();
        results.push(confirmed);
        setDone((d) => ({ ...d, [confirmed.title]: confirmed }));
      }
    }
    setBatch({ at: groups.length, total: groups.length, label: "", results });
    onApplied?.();
  }

  if (!groups?.length) return null;

  const running = batch !== null && batch.at < batch.total;
  const totals = (batch?.results ?? []).reduce(
    (a, r) => ({
      recovered: a.recovered + (r.recovered_paise || 0),
      executed: a.executed + (r.executed || 0),
      denied: a.denied + (r.denied || 0),
      entries: a.entries + (r.ledger_added || 0),
      chain: a.chain && (r.chain_verified || r.already_applied),
    }),
    { recovered: 0, executed: 0, denied: 0, entries: 0, chain: true }
  );

  return (
    <div className="space-y-3">
      {/* run the whole queue */}
      <div className="card p-4 flex items-center gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {groups.length} fixes proposed
          </div>
          <div className="text-xs text-muted mt-0.5">
            {running
              ? `Gating ${batch!.label} — ${batch!.at + 1} of ${batch!.total}`
              : batch
              ? "Queue complete. Every action was gated individually."
              : "Approve the queue. Each action is still checked against your mandate one by one."}
          </div>
        </div>

        {batch && !running && (
          <div className="flex items-center gap-5 text-right shrink-0">
            <div>
              <div className="num text-sm text-mint">
                {inr(totals.recovered, { compact: true })}
              </div>
              <div className="eyebrow">recovered</div>
            </div>
            <div>
              <div className="num text-sm text-rose">{totals.denied}</div>
              <div className="eyebrow">denied</div>
            </div>
            <div>
              <div className="num text-sm">{totals.entries}</div>
              <div className="eyebrow">ledger rows</div>
            </div>
            <div>
              <div className={`text-sm ${totals.chain ? "text-mint" : "text-rose"}`}>
                {totals.chain ? "verified" : "BROKEN"}
              </div>
              <div className="eyebrow">chain</div>
            </div>
          </div>
        )}

        <button
          onClick={applyAll}
          disabled={running}
          className="btn-primary shrink-0"
        >
          {running
            ? `Applying ${batch!.at + 1}/${batch!.total}…`
            : batch
            ? "Re-run the queue"
            : "Apply everything"}
        </button>
      </div>

      {groups.map((g, i) => {
        const finished = done[g.title];
        const running = active === i && !result;
        const open = active === i;

        return (
          <div
            key={g.group_id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className={`card overflow-hidden transition-all duration-300 ${
              open
                ? "border-brand/40"
                : highlight === i
                ? "border-brand/60 ring-1 ring-brand/30"
                : ""
            }`}
          >
            {/* header */}
            <div className="p-4 flex items-center gap-4">
              <div
                className={`w-10 h-10 rounded-lg grid place-items-center text-lg shrink-0
                  ${
                    finished
                      ? "bg-mint-soft text-mint border border-mint/30"
                      : g.auto
                      ? "bg-brand-soft text-brand border border-brand/30"
                      : "bg-raised text-muted border border-line"
                  }`}
              >
                {finished ? "✓" : ICON[g.action_type] ?? "•"}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{g.title}</span>
                  {g.auto ? (
                    <span className="chip bg-brand-soft text-brand border-brand/30">
                      agent can run this
                    </span>
                  ) : (
                    <span className="chip-neutral">needs you</span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">{g.why}</div>
              </div>

              {g.total_paise > 0 && (
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="num text-sm text-amber">
                    {inr(g.total_paise, { compact: true })}
                  </div>
                  <div className="eyebrow">at stake</div>
                </div>
              )}

              <button
                onClick={() => apply(i)}
                disabled={running || !!finished}
                className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold
                  transition-all disabled:opacity-60 ${
                    finished
                      ? "bg-mint-soft text-mint border border-mint/40"
                      : "bg-brand text-brand-ink hover:brightness-110 shadow-xs"
                  }`}
              >
                {finished ? "applied" : running ? "applying…" : "Apply fix"}
              </button>
            </div>

            {/* live walkthrough */}
            {open && (
              <div className="border-t border-line bg-subtle p-4 space-y-2 animate-rise">
                {gated.length > 0 && shownActions > 0 && (
                  <div className="mt-3 pt-3 border-t border-line">
                    <div className="eyebrow mb-2">
                      each payment, checked on its own
                    </div>
                    <div className="font-mono text-[11px] space-y-0.5 max-h-52 overflow-y-auto">
                      {gated.slice(0, shownActions).map((a) => (
                        <div
                          key={a.txn_id}
                          className="flex items-center gap-3 animate-rise"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              a.decision === "deny"
                                ? "bg-rose"
                                : a.decision === "step_up"
                                ? "bg-amber"
                                : "bg-mint"
                            }`}
                          />
                          <span className="text-faint w-40 truncate shrink-0">
                            {a.txn_id}
                          </span>
                          <span className="num w-20 text-right shrink-0">
                            {inr(a.amount_paise)}
                          </span>
                          <span className="text-muted truncate">
                            {a.reason.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </div>
                      ))}
                      {shownActions < gated.length && (
                        <div className="text-faint pt-1">
                          …and {gated.length - shownActions} more, all gated the
                          same way
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {checks.slice(0, shown).map((s, k) => (
                  <div
                    key={s.key}
                    className="flex items-start gap-3 animate-rise"
                    style={{ animationDelay: `${k * 40}ms` }}
                  >
                    <span
                      className={`w-5 h-5 rounded-full grid place-items-center text-[10px]
                        shrink-0 mt-0.5 ${
                          s.status === "pass"
                            ? "bg-mint-soft text-mint"
                            : s.status === "fail"
                            ? "bg-rose-soft text-rose"
                            : "bg-raised text-muted"
                        }`}
                    >
                      {s.status === "pass" ? "✓" : s.status === "fail" ? "✕" : "•"}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{s.label}</div>
                      <div className="text-[11px] text-muted leading-relaxed mt-0.5">
                        {s.detail}
                      </div>
                    </div>
                  </div>
                ))}

                {/* still revealing */}
                {!result && (
                  <div className="flex items-center gap-2 text-[11px] text-brand pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand animate-breathe" />
                    checking the mandate…
                  </div>
                )}

                {/* outcome */}
                {result && (
                  <div className="pt-3 mt-1 border-t border-line animate-rise">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`text-base font-display font-bold ${
                          result.recovered_paise > 0 ? "text-mint" : "text-ink"
                        }`}
                      >
                        {result.headline}
                      </span>
                      {result.chain_verified && (
                        <span className="chip bg-mint-soft text-mint border-mint/30">
                          chain verified
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                      <Mini label="allowed" v={result.allowed} tone="mint" />
                      <Mini label="need you" v={result.stepped_up} tone="amber" />
                      <Mini label="denied" v={result.denied} tone="rose" />
                      <Mini label="ledger entries" v={result.ledger_added} />
                    </div>

                    {result.denied > 0 && (
                      <p className="text-[11px] text-muted mt-3 leading-relaxed">
                        The {result.denied} denied actions exceeded the ceiling in your
                        signed mandate. The agent cannot widen its own authority — that
                        is the point of the mandate, and those attempts are still
                        recorded in the audit trail.
                      </p>
                    )}

                    {result.stepped_up > 0 && !result.already_applied && (
                      <button
                        onClick={() => apply(i, true)}
                        className="mt-3 px-3 py-1.5 rounded-lg bg-amber-soft text-amber
                                   border border-amber/40 text-xs font-semibold
                                   hover:bg-amber/25 transition-colors"
                      >
                        Confirm the {result.stepped_up} that need approval →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Mini({
  label,
  v,
  tone,
}: {
  label: string;
  v: number;
  tone?: "mint" | "amber" | "rose";
}) {
  const c =
    tone === "mint"
      ? "text-mint"
      : tone === "amber"
      ? "text-amber"
      : tone === "rose"
      ? "text-rose"
      : "text-ink";
  return (
    <div className="card-raised px-3 py-2">
      <div className={`num text-lg font-semibold ${c}`}>{v}</div>
      <div className="eyebrow">{label}</div>
    </div>
  );
}
