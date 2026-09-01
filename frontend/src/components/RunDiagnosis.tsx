"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentPipeline } from "@/components/AgentPipeline";
import { useDiagnosis } from "@/components/useDiagnosis";
import { Ticker } from "@/components/ui";
import { inr } from "@/lib/types";

/**
 * Press it, and watch the engine actually run.
 *
 * The temptation in a demo control like this is an animation on a timer that
 * finishes on a number fetched beforehand. This does the opposite: it opens
 * the real SSE stream, every stage that lights up is a node the graph
 * executed, every sub-count is one the node emitted, and the figures that
 * appear at the end are read off the record the run produced.
 *
 * `pace_ms` throttles the drain and never the work, which is the only reason
 * it is watchable — a full run completes in about a second and a half, and
 * ten nodes resolving inside one frame looks like nothing happened at all.
 *
 * When it finishes it offers the run rather than navigating on its own. A
 * presenter mid-sentence should not have the page moved out from under them.
 */
export function RunDiagnosis({
  merchant,
  merchantName,
  onFinished,
}: {
  merchant: string;
  merchantName?: string;
  onFinished?: (runId: string) => void;
}) {
  const router = useRouter();
  const { stages, record, running, error, start, stop } = useDiagnosis(merchant);
  const [everRan, setEverRan] = useState(false);

  useEffect(() => {
    if (running) setEverRan(true);
  }, [running]);

  useEffect(() => {
    if (record?.run_id) onFinished?.(record.run_id);
  }, [record?.run_id, onFinished]);

  const r = record?.report;
  const dec = r?.decomposition;
  const m = r?.measured as Record<string, any> | undefined;
  const gate = r?.gate?.decisions as Record<string, number> | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {!running && (
          <button onClick={start} className="btn-primary">
            {everRan ? "↺ Run it again" : "▶ Run diagnosis"}
          </button>
        )}
        {running && (
          <button onClick={stop} className="btn-secondary">
            ■ Stop
          </button>
        )}
        <span className="text-[12px] text-muted">
          {running
            ? `The engine is working ${merchantName ?? merchant}. Every stage below is a node it really ran.`
            : record
            ? "Finished. Every figure below came off the record the run produced."
            : "Nine stages, on the live stream — not a replay."}
        </span>
      </div>

      {error && (
        <div className="panel p-3 border-l-2 border-l-rose">
          <span className="chip text-rose">failed</span>
          <p className="text-[13px] text-muted mt-1.5">{error}</p>
        </div>
      )}

      {(running || record) && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4 items-start">
          <AgentPipeline stages={stages} live={running} />

          {/* What the run produced, appearing as the stages that produce it
              complete. Nothing here is computed in the browser. */}
          <div className="panel p-4 space-y-4">
            <div className="ui text-[11px] uppercase tracking-[0.12em] text-muted">
              What it found
            </div>

            {!dec && (
              <p className="text-[13px] text-faint">
                {running ? "waiting on the decomposition…" : "—"}
              </p>
            )}

            {dec && (
              <>
                <div className="flex items-end gap-5 flex-wrap">
                  <Fig
                    label="collects"
                    value={`${(100 * dec.s_obs).toFixed(2)}%`}
                  />
                  <span className="text-faint pb-1">→</span>
                  <Fig
                    label="category achieves"
                    value={`${(100 * dec.s_star).toFixed(2)}%`}
                    tone="text-amber"
                  />
                  <Fig
                    label="gap"
                    value={`${dec.gap_pts.toFixed(2)} pts`}
                    tone="text-rose"
                    big
                  />
                </div>

                <div>
                  <div className="ui text-[11px] uppercase tracking-[0.12em] text-muted mb-2">
                    Why the gap is happening
                  </div>
                  <Attribution dec={dec} />
                </div>
              </>
            )}

            {gate && (
              <div className="pt-3 border-t border-line">
                <div className="ui text-[11px] uppercase tracking-[0.12em] text-muted mb-2">
                  Through the mandate gate
                </div>
                <div className="flex gap-5 flex-wrap">
                  <Fig label="allowed" value={String(gate.allow ?? 0)} tone="text-mint" />
                  <Fig label="held" value={String(gate.step_up ?? 0)} tone="text-amber" />
                  <Fig label="denied" value={String(gate.deny ?? 0)} tone="text-rose" />
                </div>
              </div>
            )}

            {m && (
              <div className="pt-3 border-t border-line flex items-end gap-5 flex-wrap">
                <Fig
                  label="recovered"
                  value={inr(m.recovery_vs_truth?.measured_paise ?? 0)}
                  tone="text-mint"
                  chip="measured"
                />
                <Fig
                  label="ledger"
                  value={`${m.ledger_entries ?? 0} entries`}
                  tone={m.chain_verified ? "text-mint" : "text-rose"}
                  sub={m.chain_verified ? "chain verified" : "CHAIN BROKEN"}
                />
                <Fig
                  label="violations"
                  value={String(m.mandate_violations ?? 0)}
                  tone={m.mandate_violations ? "text-rose" : "text-mint"}
                />
              </div>
            )}

            {record && (
              <button
                onClick={() => router.push(`/run/${record.run_id}`)}
                className="btn-secondary w-full mt-1"
              >
                Open the full diagnosis →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The four factors, with the error bar drawn rather than described.
 *
 * The bar a factor has to clear is its own measured error, so showing the bar
 * without showing the error would hide the only thing that decides whether the
 * agent may act on it.
 */
function Attribution({ dec }: { dec: any }) {
  const factors: { factor: string; points: number; mae?: number }[] =
    dec.factors ?? [];
  if (!factors.length) return null;
  const max = Math.max(...factors.map((f) => Math.abs(f.points)), 0.01);

  return (
    <div className="space-y-2">
      {factors.map((f) => {
        const w = (Math.abs(f.points) / max) * 100;
        const err = f.mae ? (f.mae / max) * 100 : 0;
        const acts = f.mae ? Math.abs(f.points) > 2 * f.mae : false;
        return (
          <div key={f.factor} className="flex items-center gap-3">
            <span className="text-[11.5px] text-muted w-24 shrink-0 truncate">
              {f.factor.replace(/_/g, " ")}
            </span>
            <span className="relative flex-1 h-2 rounded-full bg-raised overflow-hidden min-w-[60px]">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${
                  acts ? "bg-brand" : "bg-edge"
                }`}
                style={{ width: `${w}%` }}
              />
              {/* the error bar, laid over the end of the bar it qualifies */}
              {err > 0 && (
                <span
                  className="absolute inset-y-0 bg-ink/15 border-x border-ink/25"
                  style={{
                    left: `${Math.max(0, w - err)}%`,
                    width: `${Math.min(100, err * 2)}%`,
                  }}
                  title={`±${f.mae?.toFixed(2)} pts measured error`}
                />
              )}
            </span>
            <span className="num text-[11.5px] w-24 text-right shrink-0">
              {f.points >= 0 ? "+" : ""}
              {f.points.toFixed(2)}
              {f.mae ? (
                <span className="text-faint"> ±{f.mae.toFixed(2)}</span>
              ) : null}
            </span>
          </div>
        );
      })}
      <p className="text-[11px] text-faint pt-1">
        A factor is only acted on unattended where it clears twice its own
        measured error. The pale band is that error.
      </p>
    </div>
  );
}

function Fig({
  label,
  value,
  tone,
  sub,
  chip,
  big,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
  chip?: string;
  big?: boolean;
}) {
  return (
    <div>
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint flex items-center gap-1.5">
        {label}
        {chip && <span className="chip-measured">{chip}</span>}
      </div>
      <div
        className={`num font-semibold leading-none mt-1 ${
          big ? "text-2xl" : "text-lg"
        } ${tone ?? ""}`}
      >
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-faint mt-1">{sub}</div>}
    </div>
  );
}
