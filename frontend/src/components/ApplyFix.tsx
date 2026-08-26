"use client";

import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/types";

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
  const [done, setDone] = useState<Record<string, Result>>({});
  const timers = useRef<any[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function apply(i: number, confirmed = false) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setActive(i);
    setShown(0);
    setResult(null);

    const r = await fetch(
      `/api/run/${runId}/apply?group_index=${i}&confirmed=${confirmed}`,
      { method: "POST" }
    );
    const res: Result = await r.json();

    // Reveal one check at a time. The pacing is the point: it is what turns
    // "the gate ran" into something you can watch happen.
    res.steps.forEach((_, k) => {
      timers.current.push(
        setTimeout(() => setShown(k + 1), 420 * (k + 1))
      );
    });
    timers.current.push(
      setTimeout(() => {
        setResult(res);
        setDone((d) => ({ ...d, [res.title]: res }));
        onApplied?.();
      }, 420 * res.steps.length + 300)
    );
  }

  if (!groups?.length) return null;

  return (
    <div className="space-y-3">
      {groups.map((g, i) => {
        const finished = done[g.title];
        const running = active === i && !result;
        const open = active === i;

        return (
          <div
            key={g.group_id}
            className={`card overflow-hidden transition-all duration-300 ${
              open ? "border-brand/40" : ""
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
                {(result?.steps ?? []).slice(0, shown).map((s, k) => (
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
