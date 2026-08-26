"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/Chrome";
import { Card, Eyebrow, Stagger } from "@/components/ui";
import { Merchant, inr } from "@/lib/types";

interface Payment {
  txn_id: string;
  bank: string;
  method: string;
  hour: number;
  amount_paise: number;
  succeeded: boolean;
  error_code: string | null;
  error_class: string | null;
}

interface Alert {
  bank: string;
  observed_fail_pct: number;
  confident_fail_pct: number;
  npci_fail_pct: number;
  delta_pts: number;
  window_n: number;
  at_payment: number;
  exposure_paise: number;
  detail: string;
}

interface Stats {
  seen: number;
  failed: number;
  success_pct: number;
  at_risk_paise: number;
  banks_watched: number;
  alerts: number;
}

const RATES = [
  { label: "1×", v: 40 },
  { label: "4×", v: 160 },
  { label: "20×", v: 800 },
];

/**
 * The incident view.
 *
 * Every other page explains a month after it has ended. This one watches the
 * same month arrive payment by payment, with the detector running live, so a
 * bank going bad is something you see happen rather than read about.
 *
 * It is honest about what it is: a real batch replayed in payment order. The
 * detector is not scripted — on a healthy merchant it finds nothing and says
 * so, which is the only reason to believe it when it does find something.
 */
export default function LivePage() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [who, setWho] = useState("cloudsync");
  const [rate, setRate] = useState(160);
  const [running, setRunning] = useState(false);
  const [tape, setTape] = useState<Payment[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [finished, setFinished] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const tapeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then(setMerchants)
      .catch(() => {});
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    tapeRef.current?.scrollTo({ top: 0 });
  }, [tape.length]);

  function start() {
    esRef.current?.close();
    setTape([]);
    setAlerts([]);
    setStats(null);
    setFinished(false);
    setRunning(true);

    const es = new EventSource(`/api/live/${who}/stream?rate=${rate}`);
    esRef.current = es;

    es.addEventListener("start", (e: any) => setTotal(JSON.parse(e.data).total));
    es.addEventListener("payment", (e: any) => {
      const p: Payment = JSON.parse(e.data);
      // Newest first, and bounded — this runs for thousands of payments.
      setTape((prev) => [p, ...prev.slice(0, 59)]);
    });
    es.addEventListener("stats", (e: any) => setStats(JSON.parse(e.data)));
    es.addEventListener("alert", (e: any) => {
      const a: Alert = JSON.parse(e.data);
      setAlerts((prev) => [a, ...prev]);
    });
    es.addEventListener("done", (e: any) => {
      setStats(JSON.parse(e.data));
      setRunning(false);
      setFinished(true);
      es.close();
    });
    es.onerror = () => {
      setRunning(false);
      es.close();
    };
  }

  function stop() {
    esRef.current?.close();
    setRunning(false);
  }

  async function diagnose() {
    stop();
    const r = await fetch(`/api/run?merchant=${who}`, { method: "POST" });
    const rec = await r.json();
    router.push(`/run/${rec.run_id}`);
  }

  const pct = total ? Math.min(100, ((stats?.seen ?? 0) / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        <Stagger>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <Eyebrow>Watching it happen</Eyebrow>
              <h1 className="text-2xl font-semibold mt-1">Live payment feed</h1>
              <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
                The same payments the batch pages explain afterwards, arriving in
                order with the detector running over them. A rolling window per
                bank, compared against what NPCI publishes for that bank
                nationally — and it only speaks when the confidence interval says
                it should.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={who}
                onChange={(e) => setWho(e.target.value)}
                disabled={running}
                className="field h-9 py-0 text-sm max-w-[13rem]"
              >
                {merchants.map((m) => (
                  <option key={m.merchant_id} value={m.merchant_id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 card-raised p-1">
                {RATES.map((r) => (
                  <button
                    key={r.v}
                    onClick={() => setRate(r.v)}
                    disabled={running}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                      rate === r.v
                        ? "bg-brand-soft text-brand"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {running ? (
                <button onClick={stop} className="btn-secondary h-9 px-4 text-sm">
                  ■ Stop
                </button>
              ) : (
                <button onClick={start} className="btn-primary h-9 px-4 text-sm">
                  ● Start feed
                </button>
              )}
            </div>
          </div>
        </Stagger>

        {/* ───────────────────────────────────── counters */}
        <Stagger i={1}>
          <Card className="!p-0 overflow-hidden">
            <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-line">
              <Counter
                label="payments seen"
                v={(stats?.seen ?? 0).toLocaleString("en-IN")}
                sub={total ? `of ${total.toLocaleString("en-IN")}` : ""}
                live={running}
              />
              <Counter
                label="success rate"
                v={`${(stats?.success_pct ?? 0).toFixed(2)}%`}
                tone={
                  (stats?.success_pct ?? 100) < 88 ? "text-rose" : "text-mint"
                }
              />
              <Counter
                label="value at risk"
                v={inr(stats?.at_risk_paise ?? 0, { compact: true })}
                tone="text-amber"
              />
              <Counter label="banks watched" v={String(stats?.banks_watched ?? 0)} />
              <Counter
                label="alerts raised"
                v={String(alerts.length)}
                tone={alerts.length ? "text-rose" : "text-muted"}
              />
            </div>
            <div className="h-1 bg-raised">
              <div
                className="h-full bg-brand transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </Card>
        </Stagger>

        {/* ───────────────────────────────────── alerts */}
        {alerts.length > 0 && (
          <Stagger i={2}>
            <div className="space-y-3">
              {alerts.map((a, i) => (
                <Card
                  key={`${a.bank}-${a.at_payment}`}
                  className={`border-l-2 border-l-rose ${
                    i === 0 ? "animate-rise" : ""
                  }`}
                >
                  <div className="flex items-start gap-4 flex-wrap">
                    <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0
                                     bg-rose-soft text-rose border border-rose/30">
                      ▲
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{a.bank}</span>
                        <span className="chip-warn">degrading</span>
                        <span className="chip-neutral">
                          payment #{a.at_payment.toLocaleString("en-IN")}
                        </span>
                      </div>
                      <p className="text-sm text-muted mt-1.5 leading-relaxed">
                        {a.detail}
                      </p>

                      <div className="flex items-center gap-6 mt-3 flex-wrap">
                        <Figure
                          k="observed"
                          v={`${a.observed_fail_pct.toFixed(1)}%`}
                          tone="text-rose"
                        />
                        <Figure
                          k="confident floor"
                          v={`${a.confident_fail_pct.toFixed(1)}%`}
                        />
                        <Figure
                          k="NPCI national"
                          v={`${a.npci_fail_pct.toFixed(1)}%`}
                        />
                        <Figure
                          k="worse by"
                          v={`${a.delta_pts.toFixed(1)} pts`}
                          tone="text-amber"
                        />
                        <Figure k="window" v={`${a.window_n} payments`} />
                      </div>
                    </div>

                    <button
                      onClick={diagnose}
                      className="btn-primary h-9 px-4 text-sm shrink-0"
                    >
                      Diagnose now →
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </Stagger>
        )}

        {finished && alerts.length === 0 && (
          <Stagger i={2}>
            <Card className="border-l-2 border-l-mint">
              <div className="text-sm text-mint font-medium">
                ✓ Nothing to report across {(stats?.seen ?? 0).toLocaleString("en-IN")}{" "}
                payments.
              </div>
              <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
                No bank on this merchant was confidently worse than its published
                national rate for long enough to be worth interrupting anyone. This
                is reported as a result rather than padded with a warning — a
                detector that always finds something is not detecting anything.
              </p>
            </Card>
          </Stagger>
        )}

        {/* ───────────────────────────────────── the tape */}
        <Stagger i={3}>
          <Card className="!p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line flex items-center gap-3">
              <span className="eyebrow">payment tape</span>
              {running && (
                <span className="chip-warn">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose animate-breathe" />
                  live
                </span>
              )}
              <span className="ml-auto text-[11px] text-faint">newest first</span>
            </div>
            <div
              ref={tapeRef}
              className="font-mono text-[11px] h-80 overflow-y-auto divide-y divide-line/50"
            >
              {tape.map((p) => (
                <div
                  key={p.txn_id}
                  className={`px-4 py-1.5 flex items-center gap-3 ${
                    p.succeeded ? "" : "bg-rose-soft/40"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      p.succeeded ? "bg-mint" : "bg-rose"
                    }`}
                  />
                  <span className="text-faint w-40 truncate shrink-0">
                    {p.txn_id}
                  </span>
                  <span className="w-52 truncate shrink-0">{p.bank}</span>
                  <span className="text-muted w-14 shrink-0">{p.method}</span>
                  <span className="text-muted w-14 shrink-0">
                    {String(p.hour).padStart(2, "0")}:00
                  </span>
                  <span className="num text-right w-24 shrink-0">
                    {inr(p.amount_paise)}
                  </span>
                  <span
                    className={`truncate ${
                      p.succeeded ? "text-mint" : "text-rose"
                    }`}
                  >
                    {p.succeeded ? "ok" : p.error_code ?? "failed"}
                  </span>
                </div>
              ))}
              {tape.length === 0 && (
                <div className="px-4 py-3 text-faint">
                  press start to open the feed…
                </div>
              )}
            </div>
          </Card>
        </Stagger>
      </main>
    </div>
  );
}

function Counter({
  label,
  v,
  sub,
  tone,
  live,
}: {
  label: string;
  v: string;
  sub?: string;
  tone?: string;
  live?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow flex items-center gap-1.5">
        {label}
        {live && <span className="w-1 h-1 rounded-full bg-brand animate-breathe" />}
      </div>
      <div className={`num text-2xl font-semibold mt-1 ${tone ?? ""}`}>{v}</div>
      {sub && <div className="text-[11px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}

function Figure({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div className="eyebrow">{k}</div>
      <div className={`num text-sm mt-0.5 ${tone ?? ""}`}>{v}</div>
    </div>
  );
}
