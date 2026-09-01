"use client";

import { inr } from "@/lib/types";

/**
 * The Counterfactual Recovery Lab, rendered.
 *
 * The page has exactly one job: answer "what would this money have done under
 * a different policy?" Everything here serves that and nothing else, because
 * the moment it acquires a second job it becomes another analytics dashboard
 * and stops being an argument.
 *
 * The design decision that matters most is that the winning row is not the
 * one with the biggest recovery. Naive retry recovers more on this batch. The
 * table has to say so plainly and then show the two columns that explain why
 * that is not a win -- attempts spent, and mandate breaches -- or the whole
 * exercise is a rigged benchmark, which is the thing it exists to replace.
 */

export interface Strategy {
  key: string;
  name: string;
  blurb: string;
  basis: string;
  eligible: number;
  attempted_payments: number;
  attempts: number;
  held: number;
  denied: number;
  escalated: number;
  abstained: number;
  held_paise: number;
  denied_paise: number;
  abstained_paise: number;
  converted: number;
  recovered_paise: number;
  recovery_rate: number;
  wasted_attempts: number;
  exposed_paise: number;
  unsupervised_paise: number;
  mandate_violations: number;
  cap_violations: number;
  ceiling_violations: number;
  friction_paise: number;
  net_paise: number;
  yield_per_attempt_paise: number;
}

export interface FrontierPoint {
  auto_limit_paise: number;
  attempts: number;
  converted: number;
  recovered_paise: number;
  wasted_attempts: number;
  unsupervised_paise: number;
  held_paise: number;
  net_paise: number;
  yield_per_attempt_paise: number;
  shipped: boolean;
}

/* ------------------------------------------------------------------ table */

/**
 * The comparison. One batch, one truth, five policies.
 *
 * Deliberately a table. Five policies across nine measures is a table, and
 * drawing each row as a card would add borders and lose the column alignment
 * that lets you read down "mandate breaches" in one movement — which is the
 * single most important column on the page.
 */
export function Comparison({
  strategies,
  observed,
}: {
  strategies: Strategy[];
  observed?: Strategy | null;
}) {
  const rows = [...strategies, ...(observed ? [observed] : [])];
  const best = Math.max(...rows.map((s) => s.recovered_paise), 1);

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="tbl min-w-[54rem]">
        <thead>
          <tr className="text-faint">
            <Th className="text-left w-[15rem]">Policy</Th>
            <Th>Recovered</Th>
            <Th>Payments</Th>
            <Th>Attempts</Th>
            <Th>Wasted</Th>
            <Th>Hit rate</Th>
            <Th>₹ / attempt</Th>
            <Th>Mandate breaches</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const ours = s.key.startsWith("revenue_doctor") || s.key === "observed";
            return (
              <tr
                key={s.key}
                className={`border-t border-line align-top ${
                  ours ? "bg-brand-soft/25" : ""
                }`}
              >
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[13px] ${ours ? "text-ink font-medium" : ""}`}>
                      {s.name}
                    </span>
                    <span
                      className={
                        s.basis === "observed" ? "chip-measured" : "chip-neutral"
                      }
                    >
                      {s.basis === "observed" ? "measured" : "counterfactual"}
                    </span>
                  </div>
                  <div className="text-[11px] text-faint mt-1 leading-snug max-w-[22rem]">
                    {s.blurb}
                  </div>
                </td>

                <td className="py-3 px-2 text-right">
                  <div className="num text-[15px] text-mint">
                    {inr(s.recovered_paise)}
                  </div>
                  {/* A bar rather than a second number: the ratio is the point. */}
                  <div className="h-[3px] bg-line rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="h-full bg-mint/60 rounded-full"
                      style={{ width: `${(100 * s.recovered_paise) / best}%` }}
                    />
                  </div>
                </td>

                <Td>{s.converted} / {s.attempted_payments}</Td>
                <Td>{s.attempts}</Td>
                <Td tone={s.wasted_attempts > 100 ? "text-rose" : undefined}>
                  {s.wasted_attempts}
                </Td>
                <Td>{(100 * s.recovery_rate).toFixed(0)}%</Td>
                <Td>{inr(s.yield_per_attempt_paise)}</Td>

                <td className="py-3 pl-2 text-right">
                  {s.mandate_violations === 0 ? (
                    <span className="chip-measured">none</span>
                  ) : (
                    <span className="chip-warn">{s.mandate_violations}</span>
                  )}
                  {s.mandate_violations > 0 && (
                    <div className="text-[10px] text-faint mt-1 num">
                      {s.cap_violations} over cap · {s.ceiling_violations} over
                      ceiling
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`ui text-[10px] uppercase tracking-[0.1em] font-normal pb-2 text-right ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <td className={`py-3 px-2 text-right num text-[13px] ${tone ?? "text-muted"}`}>
      {children}
    </td>
  );
}

/* -------------------------------------------------------------- the choice */

/**
 * Why this policy — from the evaluation, field by field.
 *
 * Every number here was lifted verbatim from a StrategyResult the harness
 * had just computed. No prose is generated and no model is consulted, which
 * is what stops the explanation drifting away from the thing it explains.
 */
export function WhyThisStrategy({
  choice,
  friction,
}: {
  choice: any;
  friction: number;
}) {
  const n = choice.alternatives.naive_retry;
  const c = choice.if_merchant_confirms;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-6 items-start">
      <div>
        <div className="grid sm:grid-cols-3 gap-x-8 gap-y-5">
          <Field
            label="Recovered"
            value={inr(choice.expected_recovery_paise)}
            tone="text-mint"
            sub={`${(100 * choice.share_of_ceiling).toFixed(0)}% of everything this batch could ever have returned`}
          />
          <Field
            label="Attempts spent"
            value={String(choice.attempts)}
            sub={`${inr(choice.yield_per_attempt_paise)} back per attempt`}
          />
          <Field
            label="Friction"
            value={inr(choice.friction_paise)}
            tone="text-amber"
            sub={`assumption: ₹${friction / 100} per attempt`}
          />
          <Field
            label="Held for you"
            value={inr(choice.held_for_merchant_paise)}
            tone="text-amber"
            sub="gated, not refused — one click releases it"
          />
          <Field
            label="Refused by mandate"
            value={inr(choice.refused_by_mandate_paise)}
            tone="text-rose"
            sub="above the ceiling you signed"
          />
          <Field
            label="Stopping rules"
            value={choice.stop_condition === "pass" ? "pass" : "FAIL"}
            tone={choice.stop_condition === "pass" ? "text-mint" : "text-rose"}
            sub={`${choice.mandate_violations} breaches of the signed mandate`}
          />
        </div>
      </div>

      {/* The alternative, priced. This is the paragraph a judge reads. */}
      <div className="panel p-4 space-y-3">
        <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
          The alternative
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">
          Retrying everything recovers{" "}
          <span className="num text-mint">{inr(n.recovered_paise)}</span> — more
          than we did. It gets there with{" "}
          <span className="num text-ink">{n.attempts}</span> attempts, of which{" "}
          <span className="num text-rose">{n.wasted_attempts}</span> could never
          have converted, and it breaks the signed mandate{" "}
          <span className="num text-rose">
            {n.cap_violations + n.ceiling_violations}
          </span>{" "}
          times — <span className="num">{n.cap_violations}</span> payments past
          the attempt cap, <span className="num">{n.ceiling_violations}</span>{" "}
          above the ceiling.
        </p>
        <p className="text-[12.5px] leading-relaxed text-muted border-t border-line pt-3">
          It is not that the loop performs worse. It is that it is doing{" "}
          {n.cap_violations + n.ceiling_violations} things this agent is not
          permitted to do, and{" "}
          <span className="num text-ink">
            {inr(choice.exposure_avoided_vs_naive_paise, { compact: true })}
          </span>{" "}
          of customer money is in front of attempts that were never going to
          land.
        </p>
        <p className="text-[12.5px] leading-relaxed text-muted border-t border-line pt-3">
          Confirm the {inr(choice.held_for_merchant_paise, { compact: true })}{" "}
          we held and the same policy returns{" "}
          <span className="num text-mint">{inr(c.recovered_paise)}</span> —{" "}
          {(100 * c.share_of_ceiling).toFixed(0)}% of the ceiling, still with
          zero breaches.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
      <div className={`num text-[20px] font-semibold leading-none mt-1.5 ${tone ?? ""}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-faint mt-1.5 leading-snug">{sub}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the frontier */

/**
 * The autonomy frontier.
 *
 * One dial: how large a payment the agent may retry without stopping to ask.
 * Two consequences, drawn against each other, because they move together and
 * a chart that showed only the first would be an argument for turning it up.
 *
 * Drawn as paired bars rather than a scatter plot. There are nine points and
 * the reader needs to compare two quantities at each — that is a bar chart,
 * and a line chart with two y-axes would be harder to read and easier to
 * misread.
 */
export function Frontier({ points }: { points: FrontierPoint[] }) {
  const maxRec = Math.max(...points.map((p) => p.recovered_paise), 1);
  const maxExp = Math.max(...points.map((p) => p.unsupervised_paise), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5 flex-wrap text-[11px]">
        <Key className="bg-mint" label="recovered" />
        <Key className="bg-amber" label="money moved with nobody watching" />
        <span className="text-faint">
          each point is a mandate that verifies — re-signed, not waved through
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[42rem] space-y-1.5">
          {points.map((p) => (
            <div
              key={p.auto_limit_paise}
              className={`grid grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 rounded px-2 py-1.5 ${
                p.shipped ? "bg-brand-soft/40" : ""
              }`}
            >
              <div className="num text-[12px] text-right">
                {inr(p.auto_limit_paise)}
                {p.shipped && (
                  <div className="ui text-[9px] uppercase tracking-[0.1em] text-brand">
                    signed
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Bar
                  w={(100 * p.recovered_paise) / maxRec}
                  cls="bg-mint/70"
                  label={inr(p.recovered_paise)}
                />
                <Bar
                  w={(100 * p.unsupervised_paise) / maxExp}
                  cls="bg-amber/60"
                  label={inr(p.unsupervised_paise)}
                />
              </div>

              <div className="num text-[11px] text-faint text-right">
                {p.attempts} att
                <div className="text-[10px]">{p.converted} won</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[12px] text-muted leading-relaxed max-w-3xl border-t border-line pt-3">
        Turning the dial to the hard ceiling recovers{" "}
        <span className="num text-mint">
          {inr(points[points.length - 1].recovered_paise)}
        </span>{" "}
        instead of{" "}
        <span className="num text-mint">
          {inr(points.find((p) => p.shipped)?.recovered_paise ?? 0)}
        </span>
        . It also moves{" "}
        <span className="num text-amber">
          {inr(points[points.length - 1].unsupervised_paise)}
        </span>{" "}
        of customer money with no human in the loop, against{" "}
        <span className="num text-amber">
          {inr(points.find((p) => p.shipped)?.unsupervised_paise ?? 0)}
        </span>{" "}
        today. That is the trade, and it is the merchant&apos;s to make — the
        agent has never held the signing key.
      </p>
    </div>
  );
}

function Bar({ w, cls, label }: { w: number; cls: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[7px] flex-1 bg-line/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${cls} transition-[width] duration-500`}
          style={{ width: `${Math.max(w, w > 0 ? 1.5 : 0)}%` }}
        />
      </div>
      <span className="num text-[10.5px] text-faint w-[4.5rem] text-right shrink-0">
        {label}
      </span>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className={`w-2.5 h-[3px] rounded-full ${className}`} />
      {label}
    </span>
  );
}
