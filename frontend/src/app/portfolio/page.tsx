"use client";

import { useEffect, useState } from "react";
import { RecoveryFunnel } from "@/components/RecoveryFunnel";
import { BookLenses } from "@/components/BookLenses";
import { TopBar } from "@/components/Chrome";
import {
  Detail,
  Empty,
  Figure,
  Figures,
  Hero,
  Loading,
  Notes,
  PageHead,
  Panel,
  SectionHeader,
  Stagger,
  Ticker,
} from "@/components/ui";
import { inr } from "@/lib/types";

const BAND: Record<string, { label: string; dot: string; blurb: string }> = {
  urgent: {
    label: "Act now",
    dot: "bg-rose",
    blurb: "material money on the table and a cause we can name",
  },
  review: {
    label: "Review",
    dot: "bg-amber",
    blurb: "a real gap, smaller than the urgent band",
  },
  insufficient_data: {
    label: "Not enough data",
    dot: "bg-faint",
    blurb: "too few payments to resolve a gap this size — no call yet",
  },
  healthy: {
    label: "Healthy",
    dot: "bg-mint",
    blurb: "at or near what their category achieves",
  },
};

const CAUSE_LABEL: Record<string, string> = {
  bank_concentration: "Bank concentration",
  midnight_billing_penalty: "Billing window",
  amount_band_risk: "Ticket size",
  method_mix_mismatch: "Method mix",
  no_soft_decline_retry: "No retry policy",
  none_of_the_above: "Nothing conclusive",
};

/**
 * Step 1: where the money is, across the whole book.
 *
 * This was a stack of bordered cards — a five-line headline panel in a tinted
 * box, a row of chips, then eight merchant rows drawn as clickable cards with
 * hover lift. It read as a landing page for a product rather than the first
 * screen of one.
 *
 * It is now one number, a row of four facts, and a table. The merchants are a
 * table because that is what a ranked list of eight things with five columns
 * is; drawing each row as a card added a border, a shadow and a translate
 * animation, and no information.
 */
export default function PortfolioPage() {
  const [pf, setPf] = useState<any>(null);
  const [band, setBand] = useState<string>("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);

  /**
   * Refresh when this tab comes back to the front.
   *
   * A fix approved from an email lands in a different tab, so the book a
   * merchant switches back to is the one they left — showing the figures from
   * before the thing they just authorised.
   */
  useEffect(() => {
    function onFocus() {
      if (!document.hidden) load();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  function load() {
    // Distinguish "the API said there are no runs" from "the API is not
    // there". Both used to render "No runs yet — diagnose a merchant", which
    // is false when the backend is down and sends the reader to a button that
    // cannot work either.
    fetch("/api/portfolio")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setPf)
      .catch(() => setPf({ unreachable: true }));
  }

  async function refreshAll() {
    setBusy(true);
    const ms = await (await fetch("/api/merchants")).json();
    for (const m of ms) {
      await fetch(`/api/run?merchant=${m.merchant_id}`, { method: "POST" });
    }
    load();
    setBusy(false);
  }

  // The chrome renders immediately, so the actions are there while the book is
  // still loading rather than appearing after it.
  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar
        right={
          <>
            <a href="/api/portfolio.csv" className="btn-quiet h-8 text-[12px]">
              Export CSV
            </a>
            <button
              onClick={refreshAll}
              disabled={busy}
              className="btn-secondary h-8 text-[12px]"
            >
              {busy ? "Scanning…" : "Re-scan"}
            </button>
          </>
        }
      />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">{body}</main>
    </div>
  );

  if (!pf) return shell(<Loading label="scanning the book" />);

  if (pf.unreachable)
    return shell(
      <Panel tone="warn">
        <div className="text-[13px] font-medium">Cannot reach the API</div>
        <p className="text-[13px] text-muted mt-1 leading-relaxed">
          The book could not be loaded because the backend did not respond.
          Nothing here is missing — start it with{" "}
          <span className="num">make demo</span> and reload.
        </p>
      </Panel>
    );

  if (!pf.merchants?.length)
    return shell(<Empty label="no runs yet — press Re-scan" />);

  const rows =
    band === "all" ? pf.merchants : pf.merchants.filter((r: any) => r.band === band);
  const actionable = pf.merchants.filter(
    (r: any) => r.band === "urgent" || r.band === "review"
  ).length;
  const maxRec = Math.max(
    ...pf.merchants.map((r: any) => r.recoverable_central_paise),
    1
  );

  return shell(
    <>
      <Stagger>
        <PageHead
          title="The book"
          sub="Every merchant at once, ranked by money on the table."
          right={<BookLenses />}
        />
      </Stagger>

      {/* ── the two numbers, side by side, never blurred ──
          Projected and measured are the one distinction the whole product
          rests on, so they get equal billing and opposite colour rather than
          one headline with a caveat under it. */}
      <Stagger>
        <div className="space-y-7">
          <div className="grid sm:grid-cols-2 gap-px bg-line rounded-lg overflow-hidden">
            <div className="bg-surface p-5">
              <div className="flex items-center gap-2">
                <span className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
                  Revenue opportunity
                </span>
                <span className="chip-projected">projected</span>
              </div>
              <div className="num text-[34px] font-semibold leading-none mt-2.5 text-amber">
                <Ticker value={pf.total_recoverable_central_paise / 100} prefix="₹" />
              </div>
              <div className="text-[12px] text-muted mt-2.5 leading-relaxed">
                Central estimate. The published range is{" "}
                <span className="num">
                  {inr(pf.total_recoverable_low_paise, { compact: true })}–
                  {inr(pf.total_recoverable_high_paise, { compact: true })}
                </span>
                , and it is the range the validation brackets, not this figure.
              </div>
            </div>

            <div className="bg-surface p-5">
              <div className="flex items-center gap-2">
                <span className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
                  Actually won back
                </span>
                <span className="chip-measured">measured</span>
              </div>
              <div className="num text-[34px] font-semibold leading-none mt-2.5 text-mint">
                <Ticker value={pf.total_measured_paise / 100} prefix="₹" />
              </div>
              <div className="text-[12px] text-muted mt-2.5 leading-relaxed">
                <span className="num">{pf.total_converted}</span> of{" "}
                <span className="num">{pf.total_attempted}</span> executed
                retries truly converted, marked against an outcome the engine
                never saw.
              </div>
            </div>
          </div>

          {/* the book, as a flow rather than four unrelated tiles */}
          <Flow
            steps={[
              { k: "payments examined", v: pf.total_transactions.toLocaleString("en-IN") },
              { k: "failures", v: pf.total_failures.toLocaleString("en-IN"), tone: "text-rose" },
              { k: "projected recoverable", v: inr(pf.total_recoverable_central_paise, { compact: true }), tone: "text-amber" },
              { k: "retries", v: `${pf.total_attempted} → ${pf.total_converted}`, tone: "text-muted" },
              { k: "actually recovered", v: inr(pf.total_measured_paise, { compact: true }), tone: "text-mint" },
            ]}
          />

          <Figures>
            <Figure
              label="Success rate"
              kind="measured"
              value={
                <>
                  {pf.weighted_observed_pct}%
                  <span className="text-faint mx-1.5 text-base">→</span>
                  <span className="text-amber">{pf.weighted_achievable_pct}%</span>
                </>
              }
              sub="volume-weighted, against what these categories achieve"
            />
            <Figure
              label="Worth a call"
              value={
                <>
                  {actionable}
                  <span className="text-faint"> / {pf.merchants.length}</span>
                </>
              }
              sub="a nameable cause and material money"
            />
            <Figure
              label="Already won back"
              kind="measured"
              tone="good"
              value={inr(pf.total_measured_paise, { compact: true })}
              sub={`${pf.total_converted} of ${pf.total_attempted} retries converted`}
            />
            <Figure
              label="Waiting on a person"
              value={pf.awaiting.toLocaleString("en-IN")}
              sub={`${pf.refused} refused by the kernel outright`}
            />
          </Figures>
        </div>
      </Stagger>

      {/* ── what the batch actually won back ── */}
      <Stagger>
        <RecoveryFunnel pf={pf} onApproved={load} />
      </Stagger>

      {/* ── the work queue ── */}
      <Stagger i={1}>
        <SectionHeader
          title="Who to call"
          sub="Ranked by recoverable value. Open a merchant to watch the agent work the case."
          right={
            <div className="flex flex-wrap gap-1">
              <BandTab on={band === "all"} onClick={() => setBand("all")}>
                all {pf.merchants.length}
              </BandTab>
              {Object.entries(pf.bands).map(([k, n]: any) => (
                <BandTab
                  key={k}
                  on={band === k}
                  onClick={() => setBand(k)}
                  dot={BAND[k].dot}
                >
                  {BAND[k].label} {n}
                </BandTab>
              ))}
            </div>
          }
        />

        <div className="overflow-x-auto">
          <table className="tbl min-w-[54rem]">
            <thead>
              <tr>
                <th>merchant</th>
                <th>success → achievable</th>
                <th>primary cause</th>
                <th className="w-44">recoverable</th>
                <th className="text-right">fixes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr
                  key={r.merchant_id}
                  onClick={() => {
                    window.location.href = `/run/${r.run_id}`;
                  }}
                  className="cursor-pointer"
                >
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${BAND[r.band].dot}`}
                        title={BAND[r.band].blurb}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{r.name}</span>
                        <span className="block text-[11px] text-faint">
                          MCC {r.mcc} · {r.transactions.toLocaleString("en-IN")} payments
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="num whitespace-nowrap">
                    {r.observed_pct}%
                    <span className="text-faint mx-1">→</span>
                    <span className="text-amber">{r.achievable_pct}%</span>
                    <span className="text-[11px] text-faint ml-2">
                      {r.gap_pts > 0 ? "+" : ""}
                      {r.gap_pts.toFixed(2)} pts
                    </span>
                  </td>
                  <td className="text-muted whitespace-nowrap">
                    {CAUSE_LABEL[r.primary_cause] ?? r.primary_cause}
                  </td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="h-1 flex-1 min-w-[3rem] rounded-full bg-raised overflow-hidden">
                        <span
                          className="block h-full bg-brand"
                          style={{
                            width: `${(r.recoverable_central_paise / maxRec) * 100}%`,
                          }}
                        />
                      </span>
                      <span className="num text-amber whitespace-nowrap">
                        {inr(r.recoverable_central_paise, { compact: true })}
                      </span>
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {r.fixes_auto > 0 ? (
                      <span className="chip-brand">{r.fixes_auto} auto</span>
                    ) : (
                      <span className="chip-neutral">{r.fixes_available}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Stagger>

      {/* ── the same causes, over and over ── */}
      {Object.keys(pf.by_cause ?? {}).length > 0 && (
        <Stagger i={2}>
          <SectionHeader
            title="The same causes recur"
            sub="One merchant with a billing-window problem is a support ticket. Forty of them is a product change."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
            {Object.entries(pf.by_cause).map(([cause, v]: any) => (
              <div key={cause}>
                <div className="text-[13px] font-medium">
                  {CAUSE_LABEL[cause] ?? cause}
                </div>
                <div className="num text-[20px] font-semibold text-amber mt-1">
                  {inr(v.value_paise, { compact: true })}
                </div>
                <div className="text-[11px] text-faint mt-1">
                  {v.merchants} merchant{v.merchants > 1 ? "s" : ""} ·{" "}
                  {v.names.slice(0, 2).join(", ")}
                  {v.names.length > 2 ? ` +${v.names.length - 2}` : ""}
                </div>
              </div>
            ))}
          </div>
        </Stagger>
      )}

      <Notes>
        <Detail summary="why the range matters more than the central figure">
          <p>
            Every rupee on this page is projected through a retry model. The
            three calibrations are published together because it is the range
            the validation brackets — quoting the central estimate on its own
            would report a point where the evidence supports an interval.
          </p>
        </Detail>
        <Detail summary="how a merchant lands in a band">
          <p>
            Below a 0.75-point gap a merchant is healthy and gets no call. Above
            it, a merchant whose gap cannot be resolved from this month&rsquo;s
            volume is filed as insufficient data rather than given a priority —
            sending an account manager after noise is worse than saying nothing.
            The rest split on whether the money is material.
          </p>
        </Detail>
      </Notes>
    </>
  );
}

/** A filter that reads as a filter, not as a status pill. */
function BandTab({
  on,
  onClick,
  dot,
  children,
}: {
  on: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[12px]
                  transition-colors ${
                    on ? "bg-raised text-ink" : "text-muted hover:text-ink"
                  }`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}

/**
 * The book as a flow, not four unrelated tiles.
 *
 * Payments narrow to failures, failures to what is recoverable, and only some
 * of that is actually won back. Four boxes in a grid state those as separate
 * facts; an arrow between them states the one thing that matters, which is
 * that each number is a subset of the one before it.
 */
function Flow({ steps }: { steps: { k: string; v: string; tone?: string }[] }) {
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto no-scrollbar">
      {steps.map((s, i) => (
        <div key={s.k} className="flex items-center shrink-0">
          <div className="px-4 first:pl-0">
            <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint whitespace-nowrap">
              {s.k}
            </div>
            <div className={`num text-lg font-semibold mt-1 ${s.tone ?? ""}`}>
              {s.v}
            </div>
          </div>
          {i < steps.length - 1 && (
            <span className="text-faint text-sm px-1 select-none" aria-hidden>
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
