"use client";

import { useEffect, useState } from "react";
import { Detail, SectionHeader } from "@/components/ui";
import { inr } from "@/lib/types";

interface Attempt {
  n: number;
  hours_after_failure: number;
  p_success: number;
  reason: string;
}

interface Stop {
  rule: string;
  detail: string;
  value: string;
  binds: boolean;
}

interface Klass {
  error_class: string;
  payments: number;
  value_paise: number;
  headline: string;
  cumulative_p: number;
  naive_p: number;
  lift_pts: number;
  attempts: Attempt[];
  stops?: Stop[];
}

interface Sched {
  classes: Klass[];
  note: string;
}

const LABEL: Record<string, string> = {
  technical: "Technical failure",
  soft_decline: "Soft decline",
};

const WHAT: Record<string, string> = {
  technical:
    "A timeout, a switch error, an issuer that did not answer. The incident clears on its own and the customer has not given up yet, so waiting is pure loss.",
  soft_decline:
    "Not enough money in the account. Retrying six hours later asks the same question of the same empty account — what has to change is the balance, not the bank.",
};

/**
 * When each retry fires, and what the timing is worth.
 *
 * The engine has planned this ladder attempt by attempt since sequence.py
 * landed, and none of it reached the screen: only the first slot's hours
 * leaked into an action's reason text. A capability nobody can locate scores
 * the same as one that was never built, which is the third time that has been
 * true on this project and the reason it is now shown.
 *
 * The honest part is the comparison. Every dunning tool ships a fixed
 * cooldown — "retry in 30 minutes, three times" — and on technical failures
 * the sequencing is worth 22 points of modelled odds against it. On soft
 * declines it is worth nothing at all, because the flat 36-hour delay already
 * sat in that class's good window. Both are reported. The second number is
 * what makes the first one worth reading.
 */
export function RetrySchedule({ runId }: { runId: string }) {
  const [d, setD] = useState<Sched | null>(null);

  useEffect(() => {
    fetch(`/api/run/${runId}/schedule`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => {});
  }, [runId]);

  if (!d) return null;
  const live = d.classes.filter((c) => c.payments > 0);
  if (live.length === 0) return null;

  // One axis for both ladders, so the two are comparable by eye.
  const maxH = Math.max(
    ...live.flatMap((c) => c.attempts.map((a) => a.hours_after_failure)),
    1
  );

  return (
    <div>
      <SectionHeader
        title="When each retry fires"
        sub="Not whether — when. The rail's own curve says the two failure classes want opposite treatment, and a single fixed cooldown for both throws that away."
      />

      <div className="grid lg:grid-cols-2 gap-x-10 gap-y-8">
        {live.map((c) => (
          <div key={c.error_class}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[13px] font-medium">
                {LABEL[c.error_class] ?? c.error_class}
              </span>
              <span className="text-[11px] text-faint">
                {c.payments} payments · {inr(c.value_paise, { compact: true })}
              </span>
              <span
                className={`ml-auto num text-[12px] ${
                  c.lift_pts > 1 ? "text-mint" : "text-faint"
                }`}
              >
                {c.lift_pts > 1
                  ? `+${c.lift_pts.toFixed(1)} pts vs a flat cooldown`
                  : "no better than a flat cooldown"}
              </span>
            </div>

            <p className="text-[11px] text-faint mt-1 leading-relaxed">
              {WHAT[c.error_class]}
            </p>

            {/* the ladder, on a shared time axis */}
            <div className="relative h-9 mt-4 mb-1">
              <div className="absolute inset-x-0 top-4 h-px bg-line" />
              {c.attempts.map((a) => {
                const left = (a.hours_after_failure / maxH) * 100;
                return (
                  <div
                    key={a.n}
                    className="absolute -translate-x-1/2 text-center"
                    style={{ left: `${left}%`, top: 0 }}
                    title={a.reason}
                  >
                    <div className="num text-[10px] text-faint whitespace-nowrap">
                      +{a.hours_after_failure}h
                    </div>
                    <div
                      className="w-2.5 h-2.5 rounded-full bg-brand mx-auto mt-1"
                      style={{ opacity: 0.35 + 0.65 * a.p_success }}
                    />
                    <div className="num text-[10px] text-muted mt-1">
                      {(100 * a.p_success).toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-baseline gap-3 text-[11px] num pt-3 border-t border-line">
              <span className="text-faint">flat 36h × 3</span>
              <span>{(100 * c.naive_p).toFixed(1)}%</span>
              <span className="text-faint">→ sequenced</span>
              <span className={c.lift_pts > 1 ? "text-mint" : ""}>
                {(100 * c.cumulative_p).toFixed(1)}%
              </span>
            </div>

            {/* Where the ladder STOPS, and which rule stopped it.
                "Retry until 3" and "retry while the recovery condition still
                holds" produce the same three dots on the axis above. The
                difference is only visible if the conditions are named, so
                they are — with the live value each one is holding to, read
                from the policy kernel rather than written here. */}
            {c.stops && (
              <div className="mt-3 space-y-1.5">
                <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                  Execution stops when
                </div>
                {c.stops.map((st) => (
                  <div
                    key={st.rule}
                    className="flex items-baseline gap-2 text-[11px]"
                    title={st.detail}
                  >
                    <span
                      className={`w-1 h-1 rounded-full shrink-0 translate-y-[-2px] ${
                        st.binds ? "bg-rose" : "bg-edge"
                      }`}
                    />
                    <span className={st.binds ? "text-ink" : "text-muted"}>
                      {st.rule}
                    </span>
                    <span className="num text-faint ml-auto">{st.value}</span>
                    {st.binds && (
                      <span className="chip-warn shrink-0">stops here</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Detail summary="why one of these earns nothing, and why that is the point">
        {live.map((c) => (
          <p key={c.error_class}>
            <strong>{LABEL[c.error_class] ?? c.error_class}.</strong>{" "}
            {c.headline}
          </p>
        ))}
        <p>
          {d.note} Every slot has also had to survive the constraints that
          already exist — the seven-day recovery window, the four-hour bank
          hold and the mandate&rsquo;s attempt cap. A schedule that proposed an
          attempt the kernel would refuse is not a schedule.
        </p>
      </Detail>
    </div>
  );
}
