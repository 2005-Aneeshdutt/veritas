"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RecoveryFunnel } from "@/components/RecoveryFunnel";
import { TopBar } from "@/components/Chrome";
import { Card, Eyebrow, Loading, Stagger, Ticker } from "@/components/ui";
import { inr } from "@/lib/types";

const BAND: Record<
  string,
  { label: string; tone: string; dot: string; blurb: string }
> = {
  urgent: {
    label: "Act now",
    tone: "text-rose border-rose/30 bg-rose-soft",
    dot: "bg-rose",
    blurb: "material money on the table and a cause we can name",
  },
  review: {
    label: "Review",
    tone: "text-amber border-amber/30 bg-amber-soft",
    dot: "bg-amber",
    blurb: "a real gap, smaller than the urgent band",
  },
  insufficient_data: {
    label: "Not enough data",
    tone: "text-muted border-line bg-raised",
    dot: "bg-faint",
    blurb: "too few payments to resolve a gap this size — no call yet",
  },
  healthy: {
    label: "Healthy",
    tone: "text-mint border-mint/30 bg-mint-soft",
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

export default function PortfolioPage() {
  const [pf, setPf] = useState<any>(null);
  const [band, setBand] = useState<string>("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
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

  // The chrome renders immediately, so the theme toggle and re-scan button are
  // there while the book is still loading rather than appearing after it.
  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <TopBar
        right={
          <>
            <a href="/api/portfolio.csv" className="btn-quiet h-8 px-3 text-xs">
              Export CSV
            </a>
            <button onClick={refreshAll} disabled={busy} className="btn-primary h-8 px-3 text-xs">
              {busy ? "Scanning…" : "Re-scan the book"}
            </button>
          </>
        }
      />
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">{body}</main>
    </div>
  );

  if (!pf) return shell(<Loading label="scanning the book" />);
  if (pf.unreachable)
    return shell(
      <Card className="border-l-2 border-l-rose">
        <div className="text-sm font-medium">Cannot reach the API</div>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">
          The book could not be loaded because the backend did not respond.
          Nothing here is missing — start it with{" "}
          <span className="num">make demo</span> and reload.
        </p>
      </Card>
    );

  if (!pf.merchants?.length)
    return shell(
      <Card>
        <div className="text-sm text-muted">
          No runs yet. Diagnose a merchant first, or hit “Re-scan the book”.
        </div>
      </Card>
    );

  const rows =
    band === "all" ? pf.merchants : pf.merchants.filter((r: any) => r.band === band);
  const actionable = pf.merchants.filter(
    (r: any) => r.band === "urgent" || r.band === "review"
  ).length;
  const maxRec = Math.max(...pf.merchants.map((r: any) => r.recoverable_central_paise), 1);

  return shell(
    <>

        {/* ───────────────────────────────────── headline */}
        <Stagger>
          <Card className="!p-0 overflow-hidden">
            <div className="bg-brand-soft px-6 py-6">
              <Eyebrow>Across the entire merchant book</Eyebrow>
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4 mt-3">
                <div>
                  <div className="text-5xl font-display font-bold text-brand leading-none">
                    <Ticker
                      value={pf.total_recoverable_central_paise / 100}
                      prefix="₹"
                      decimals={0}
                    />
                  </div>
                  <div className="text-sm text-muted mt-2">
                    recoverable this month ·{" "}
                    <span className="num">
                      {inr(pf.total_recoverable_low_paise, { compact: true })}–
                      {inr(pf.total_recoverable_high_paise, { compact: true })}
                    </span>{" "}
                    <span className="chip-projected ml-1">projected</span>
                  </div>
                </div>

                <div className="h-12 w-px bg-line hidden md:block" />

                <div>
                  <div className="text-2xl font-display font-bold">
                    {pf.weighted_observed_pct}%
                    <span className="text-muted text-lg mx-2">→</span>
                    <span className="text-amber">{pf.weighted_achievable_pct}%</span>
                  </div>
                  <div className="text-sm text-muted mt-1">
                    volume-weighted success rate vs achievable
                  </div>
                </div>

                <div className="h-12 w-px bg-line hidden md:block" />

                <div>
                  <div className="text-2xl font-display font-bold">
                    {actionable}
                    <span className="text-muted text-lg"> / {pf.merchants.length}</span>
                  </div>
                  <div className="text-sm text-muted mt-1">merchants worth a call</div>
                </div>
              </div>
            </div>

            {/* band filter */}
            <div className="px-6 py-3 border-t border-line flex flex-wrap gap-2">
              <button
                onClick={() => setBand("all")}
                className={`chip ${
                  band === "all"
                    ? "bg-brand-soft text-brand border-brand/30"
                    : "bg-raised text-muted border-line"
                }`}
              >
                all {pf.merchants.length}
              </button>
              {Object.entries(pf.bands).map(([k, n]: any) => (
                <button
                  key={k}
                  onClick={() => setBand(k)}
                  className={`chip ${
                    band === k ? BAND[k].tone : "bg-raised text-muted border-line"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${BAND[k].dot}`} />
                  {BAND[k].label} {n}
                </button>
              ))}
            </div>
          </Card>
        </Stagger>

        {/* ─────────────────── what the batch actually won back */}
        <Stagger>
          <RecoveryFunnel pf={pf} onApproved={load} />
        </Stagger>

        {/* ───────────────────────────────────── work queue */}
        <Stagger i={1}>
          <div className="space-y-2">
            {rows.map((r: any) => {
              const b = BAND[r.band];
              return (
                <Link
                  key={r.merchant_id}
                  href={`/run/${r.run_id}`}
                  className="card p-4 flex items-center gap-4 hover:border-brand/40
                             hover:-translate-y-0.5 transition-all duration-300 group"
                >
                  <span className={`w-2 h-10 rounded-full shrink-0 ${b.dot}`} />

                  <div className="w-52 shrink-0 min-w-0">
                    <div className="font-semibold text-sm truncate">{r.name}</div>
                    <div className="eyebrow mt-0.5">
                      MCC {r.mcc} · {r.transactions.toLocaleString()} payments
                    </div>
                  </div>

                  <div className="w-40 shrink-0 hidden lg:block">
                    <div className="num text-sm">
                      {r.observed_pct}%
                      <span className="text-faint mx-1">→</span>
                      <span className="text-amber">{r.achievable_pct}%</span>
                    </div>
                    <div className="eyebrow mt-0.5">
                      gap {r.gap_pts > 0 ? "+" : ""}
                      {r.gap_pts.toFixed(2)} pts
                    </div>
                  </div>

                  <div className="w-44 shrink-0 hidden xl:block">
                    <div className="text-xs">{CAUSE_LABEL[r.primary_cause]}</div>
                    <div className="eyebrow mt-0.5 truncate">{b.blurb}</div>
                  </div>

                  <div className="flex-1 min-w-0 hidden md:block">
                    <div className="h-1.5 rounded-full bg-raised overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r bg-brand"
                        style={{
                          width: `${
                            (r.recoverable_central_paise / maxRec) * 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="w-28 shrink-0 text-right">
                    <div className="num text-sm text-amber">
                      {inr(r.recoverable_central_paise, { compact: true })}
                    </div>
                    <div className="eyebrow mt-0.5">recoverable</div>
                  </div>

                  <div className="w-24 shrink-0 text-right hidden sm:block">
                    {r.fixes_auto > 0 ? (
                      <span className="chip bg-brand-soft text-brand border-brand/30">
                        {r.fixes_auto} auto-fix
                      </span>
                    ) : (
                      <span className="chip-neutral">{r.fixes_available} fixes</span>
                    )}
                  </div>

                  <span className="text-brand shrink-0 group-hover:translate-x-1 transition-transform">
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        </Stagger>

        {/* ───────────────────────────────────── by cause */}
        {Object.keys(pf.by_cause ?? {}).length > 0 && (
          <Stagger i={2}>
            <Card>
              <Eyebrow>What to build, not just who to call</Eyebrow>
              <h2 className="text-lg font-semibold mt-1">
                The same causes recur across the book
              </h2>
              <p className="text-sm text-muted mt-1.5 max-w-2xl">
                One merchant with a billing-window problem is a support ticket.
                Forty of them is a product change.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                {Object.entries(pf.by_cause).map(([cause, v]: any) => (
                  <div key={cause} className="card-raised p-4">
                    <div className="text-sm font-medium">
                      {CAUSE_LABEL[cause] ?? cause}
                    </div>
                    <div className="num text-2xl font-display font-bold text-amber mt-1.5">
                      {inr(v.value_paise, { compact: true })}
                    </div>
                    <div className="eyebrow mt-1">
                      {v.merchants} merchant{v.merchants > 1 ? "s" : ""} ·{" "}
                      {v.names.slice(0, 2).join(", ")}
                      {v.names.length > 2 ? ` +${v.names.length - 2}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </Stagger>
        )}
    </>
  );
}
