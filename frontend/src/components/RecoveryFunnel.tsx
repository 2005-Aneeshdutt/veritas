"use client";

import { Card, Eyebrow, SectionHeader } from "@/components/ui";
import { inr } from "@/lib/types";

/**
 * Money actually won back across the batch.
 *
 * Every other figure in this app is a forecast, and forecasts are cheap. This
 * one is an outcome: each retry the agent executed is marked afterwards
 * against the distribution that generated the book, by a scorer the engine
 * cannot reach. It is the smallest number on the page and the only one that
 * had to survive being checked.
 *
 * The funnel is here because the honest version of "we recovered ₹39,833"
 * needs the sentence that follows it — the agent was permitted to attempt 305
 * of 1,057 actions, and the rest is sitting behind a mandate. Showing the won
 * figure without showing what the kernel refused would make the agent look
 * weak; showing what it refused without the won figure would make it look
 * theoretical.
 */
export function RecoveryFunnel({ pf }: { pf: any }) {
  const won = pf.total_measured_paise ?? 0;
  const forecast = pf.total_recovered_paise ?? 0;
  const attempted = pf.total_attempted ?? 0;
  const converted = pf.total_converted ?? 0;
  const proposed = pf.gate_allow + pf.gate_step_up + pf.gate_deny;
  const rate = attempted ? (100 * converted) / attempted : 0;

  // How far the rail sat from the marked outcome on these very retries. A
  // number that makes the product look worse and the measurement look real.
  const optimism = won ? forecast / won : 0;

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-6 pt-6">
        <SectionHeader
          eyebrow="Not a forecast"
          title="Money won back"
          sub="Each retry the agent executed, marked afterwards against the distribution that generated the book — by a scorer the engine cannot reach."
        />
      </div>

      <div className="px-6 pb-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-5xl font-display font-bold text-mint leading-none">
              {inr(won)}
            </div>
            <div className="text-sm text-muted mt-2">
              recovered across {pf.merchants_scored} merchants{" "}
              <span className="chip-measured ml-1">measured</span>
            </div>
          </div>

          <div className="h-12 w-px bg-line hidden md:block" />

          <div>
            <div className="text-2xl font-display font-bold">
              {converted}
              <span className="text-muted text-lg"> / {attempted}</span>
            </div>
            <div className="text-sm text-muted mt-1">
              retries that truly converted · {rate.toFixed(0)}%
            </div>
          </div>

          {optimism > 0 && (
            <>
              <div className="h-12 w-px bg-line hidden md:block" />
              <div>
                <div className="text-2xl font-display font-bold text-amber">
                  {optimism.toFixed(2)}×
                </div>
                <div className="text-sm text-muted mt-1">
                  how optimistic the rail was on these same retries
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── the funnel, so the gap between identified and won is explained ── */}
      <div className="border-t border-line grid sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-line">
        <Step
          k="identified"
          v={inr(pf.total_recoverable_central_paise, { compact: true })}
          sub="recoverable, projected"
        />
        <Step
          k="proposed"
          v={String(proposed)}
          sub={`actions across ${pf.merchants.length} merchants`}
        />
        <Step
          k="permitted"
          v={String(pf.gate_allow)}
          sub={`${pf.gate_step_up} held · ${pf.gate_deny} denied`}
          tone="text-amber"
        />
        <Step
          k="won"
          v={inr(won, { compact: true })}
          sub={`from ${converted} payments`}
          tone="text-mint"
        />
      </div>

      <div className="px-6 py-4 border-t border-line">
        <Eyebrow>why won is smaller than identified</Eyebrow>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">
          The mandate let the agent execute {pf.gate_allow} of {proposed}{" "}
          proposed actions. {inr(pf.total_held_paise, { compact: true })} is
          queued for merchant approval and{" "}
          {inr(pf.total_denied_paise, { compact: true })} was refused outright
          for sitting above the hard ceiling. That money is reachable, but only
          by a person widening the agent's authority — never by the agent.
        </p>
        <p className="text-[11px] text-faint mt-2 leading-relaxed">
          Measured against the generating distribution, the same standard as the
          attribution error — not against a live rail. The scorer reads the
          merchant file, not the run, and runs after every decision was made.
        </p>
      </div>
    </Card>
  );
}

function Step({
  k,
  v,
  sub,
  tone,
}: {
  k: string;
  v: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow">{k}</div>
      <div className={`num text-xl font-semibold mt-1 ${tone ?? ""}`}>{v}</div>
      <div className="text-[11px] text-faint mt-0.5">{sub}</div>
    </div>
  );
}
