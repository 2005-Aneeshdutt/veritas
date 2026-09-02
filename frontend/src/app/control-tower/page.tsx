"use client";

import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { ChainFooter } from "@/components/Chain";
import {
  DecisionCard,
  FILTERS,
  ReviewDrawer,
  STATE_TONE,
} from "@/components/ControlTower";
import { Loading, PageHead, Panel, Stagger } from "@/components/ui";

/**
 * Control Tower — what needs a person right now.
 *
 * Deliberately not a dashboard. There are no charts, no totals nobody acts
 * on, and no second copy of anything Authorise already does. Authorise
 * answers "is this allowed?"; this answers "which of the allowed and
 * uncertain ones should I look at?", which is a different question and the
 * one an operator actually has at 9am.
 *
 * The queue is capped and sorted. Showing 1,718 items would be honest and
 * useless; the top of a ranked list is the product.
 */
export default function ControlTowerPage() {
  const [q, setQ] = useState<any>(null);
  const [filt, setFilt] = useState("urgent");
  const [open, setOpen] = useState<{ m: string; d: string } | null>(null);
  const [dead, setDead] = useState(false);

  const load = useCallback(() => {
    setQ(null);
    fetch(`/api/control-tower/decisions?filter=${filt}&limit=25`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setQ)
      .catch(() => setDead(true));
  }, [filt]);

  useEffect(load, [load]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-7">{body}</main>
    </div>
  );

  if (dead) return shell(<Panel tone="warn">The API did not respond.</Panel>);
  if (!q) return shell(<Loading label="working out what needs attention" />);

  const clear = q.decisions.length === 0;

  return shell(
    <>
      <Stagger>
        <PageHead
          title="Control Tower"
          sub="Decisions requiring attention."
          right={
            <span className="text-[12px] text-muted whitespace-nowrap">
              <span className="num text-ink">{q.needing_attention}</span> of{" "}
              <span className="num">{q.total}</span> need attention
            </span>
          }
        />
      </Stagger>

      {/* ── the split, in one line ── */}
      <Stagger>
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-[12px]">
          {Object.entries(STATE_TONE).map(([k, t]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={t.cls}>{t.label}</span>
              <span className="num text-muted">
                {q.counts_by_state[k] ?? 0}
              </span>
            </span>
          ))}
        </div>
      </Stagger>

      {/* ── filters ── */}
      <Stagger>
        <div className="flex gap-1.5 flex-wrap border-b border-line pb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilt(f.key)}
              className={`h-8 px-3 rounded text-[12px] transition-colors ${
                filt === f.key
                  ? "bg-brand text-brand-ink"
                  : "text-muted hover:text-ink hover:bg-raised"
              }`}
            >
              {f.label}
              <span className="num text-[11px] opacity-70 ml-1.5">
                {q.counts_by_filter?.[f.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </Stagger>

      {/* ── the queue ── */}
      {clear ? (
        <Stagger>
          <div className="py-16 text-center">
            <div className="ui text-[11px] uppercase tracking-[0.14em] text-mint">
              All clear
            </div>
            <p className="text-[13px] text-muted mt-2">
              No decisions require human attention under this filter.
            </p>
          </div>
        </Stagger>
      ) : (
        <Stagger>
          <div className="space-y-3">
            {q.decisions.map((d: any) => (
              <DecisionCard
                key={d.decision_id}
                d={d}
                onReview={() =>
                  setOpen({ m: d.merchant_id, d: d.decision_id })
                }
              />
            ))}
          </div>
        </Stagger>
      )}

      <Stagger>
        <p className="text-[11.5px] text-faint leading-relaxed max-w-3xl border-t border-line pt-4">
          {q.note} Showing the top {q.decisions.length} of{" "}
          {q.counts_by_filter?.[filt] ?? 0} under this filter, ranked by a
          deterministic score over money at stake, uncertainty, whether a
          person is blocked on it, and how much of the attempt window is left.
          Every card says why it is where it is.
        </p>
      </Stagger>

      {open && (
        <ReviewDrawer
          merchantId={open.m}
          decisionId={open.d}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}

      <ChainFooter />
    </>
  );
}
