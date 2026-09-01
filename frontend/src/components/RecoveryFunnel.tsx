"use client";

import { useState } from "react";
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
 * needs the sentence that follows it — the agent was permitted to attempt 285
 * of 1,037 proposed actions, and the rest is sitting behind a mandate. Showing
 * the won figure without showing what the kernel refused would make the agent
 * look weak; showing what it refused without the won figure would make it look
 * theoretical.
 *
 * The pending band is a forecast and is labelled one. Quoting the marked
 * figure for work nobody has authorised yet would mean reading the answer key
 * to write the pitch — so the rail forecasts it, a person approves it, and the
 * measurement lands beside the forecast whether or not it agrees.
 */
export function RecoveryFunnel({ pf, onApproved }: { pf: any; onApproved?: () => void }) {
  const [busy, setBusy] = useState(false);

  async function approveBook() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/portfolio/approve?confirm=true", { method: "POST" });
      onApproved?.();
    } finally {
      setBusy(false);
    }
  }

  const won = pf.total_measured_paise ?? 0;
  const forecast = pf.total_projected_for_attempted_paise ?? 0;
  const attempted = pf.total_attempted ?? 0;
  const converted = pf.total_converted ?? 0;
  const proposed = pf.acted_on + pf.awaiting + pf.refused + pf.escalated;
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
            <div className="text-[34px] font-display font-bold text-mint leading-none">
              {inr(won)}
            </div>
            <div className="text-sm text-muted mt-2">
              {/* This figure is not a starting balance and must not read as
                  one. It is what the agent already won on its own authority
                  the last time these merchants were diagnosed -- and without
                  saying so, a reader sees a number that appeared from
                  nowhere and reasonably assumes it was seeded. */}
              won unattended across {pf.merchants_scored} of{" "}
              {pf.merchants.length} merchants, when they were last diagnosed{" "}
              <span className="chip-measured ml-1">measured</span>
            </div>
          </div>

          <div className="h-12 w-px bg-line hidden md:block" />

          <div>
            <div className="text-[20px] font-display font-bold">
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
                <div className="text-[20px] font-display font-bold text-amber">
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
          k="acted on"
          v={String(pf.acted_on)}
          sub={`${pf.awaiting} awaiting you · ${pf.refused} denied`}
          tone="text-amber"
        />
        <Step
          k="won"
          v={inr(won, { compact: true })}
          sub={`from ${converted} payments`}
          tone="text-mint"
        />
      </div>

      {/* ── the forecast that approval would settle ─────────────────── */}
      {pf.pending_retry_actions > 0 && (
        <div className="px-6 py-5 border-t border-line bg-brand-soft/40">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="min-w-0 flex-1">
              <Eyebrow>waiting on a person</Eyebrow>
              <div className="text-[20px] font-display font-bold mt-1">
                {inr(pf.pending_projected_low_paise, { compact: true })} –{" "}
                {inr(pf.pending_projected_high_paise, { compact: true })}
                <span className="chip-projected ml-2 align-middle">projected</span>
              </div>
              <p className="text-sm text-muted mt-2 max-w-2xl leading-relaxed">
                {pf.pending_retry_actions} retries are sitting in merchant
                queues, already inside the agent&rsquo;s authority and waiting
                only for someone to say yes. This is the rail&rsquo;s forecast
                for them, not a measurement — approving turns it into one, and
                the marked figure lands beside it whether or not it agrees.
              </p>
              {optimism > 1 && (
                <p className="text-[11px] text-faint mt-2 leading-relaxed">
                  Read the band low. On the retries this agent has already run,
                  the same rail forecast {optimism.toFixed(2)}× what was truly
                  recovered — so the bottom of this range is the optimistic
                  reading of it, not the pessimistic one.
                </p>
              )}
            </div>
            <button
              onClick={approveBook}
              disabled={busy}
              className="btn-primary h-9 px-4 text-sm shrink-0"
            >
              {busy ? "gating…" : "Approve across the book →"}
            </button>
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-t border-line">
        <Eyebrow>why won is smaller than identified</Eyebrow>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">
          The agent acted on {pf.acted_on} of {proposed} proposed actions.{" "}
          {pf.awaiting > 0 ? (
            <>
              {inr(pf.total_held_paise, { compact: true })} is queued for
              merchant approval and{" "}
            </>
          ) : (
            <>Every queued action has now been approved, and{" "}</>
          )}
          {inr(pf.total_denied_paise, { compact: true })} was refused outright
          for sitting above the hard ceiling. That last figure is reachable only
          by a person widening the agent&rsquo;s authority — never by the agent.
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
