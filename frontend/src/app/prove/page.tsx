"use client";

import { useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { Card, Eyebrow, Stagger } from "@/components/ui";
import { FACTOR_DOCS } from "@/lib/explain";
import { inr } from "@/lib/types";

interface Challenge {
  challenge_id: string;
  seal: string;
  spec: Record<string, any>;
  observed: Record<string, any>;
}

interface Estimate {
  gap_pts: number;
  attributions: Record<string, number>;
  residual_pts: number;
  primary: string;
  underpowered: boolean;
  degenerate_factors: string[];
  clamp_rate: number;
}

interface Verdict {
  factor: string;
  true_pts: number;
  found_pts: number;
  error_pts: number;
  mae: number | null;
  within_error_bar: boolean;
  agent_would: string;
}

interface Reveal {
  matches_published_seal: boolean;
  true_primary: string | null;
  found_primary: string | null;
  primary_correct: boolean | null;
  factors: Verdict[];
  worst_error_pts: number;
  verdict: string;
  underpowered: boolean;
  canonical_bytes: string;
  sealed_payload: Record<string, any>;
}

const CAUSE_LABEL: Record<string, string> = {
  bank_concentration: "Bank concentration",
  midnight_billing_penalty: "Night-time billing",
  amount_band_risk: "High-value routing",
  method_mix_mismatch: "Payment method mix",
  no_soft_decline_retry: "Failures never retried",
};

const VOLUMES = [60, 200, 900, 2500];

/**
 * Falsification on demand.
 *
 * The standing objection to every accuracy number here is fair: the merchants
 * are synthetic, so how does anyone know the engine was not tuned until the
 * committed figures looked good? This is the answer, and it works only
 * BECAUSE the data is synthetic — the exact answer exists before a payment is
 * sampled, so it can be committed to in public and checked afterwards.
 *
 * The page can end in a miss. That is not a bug in the demo. The claim was
 * never that the attribution is exact.
 */
export default function ProvePage() {
  const [cats, setCats] = useState<{ mcc: string; label: string }[]>([]);
  const [mcc, setMcc] = useState("5411");
  const [n, setN] = useState(900);
  const [causes, setCauses] = useState<string[]>(["midnight_billing_penalty"]);
  const [mag, setMag] = useState(2.0);
  const [rho, setRho] = useState(0);

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [coalitions, setCoalitions] = useState<any[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [stage, setStage] = useState<"build" | "sealed" | "running" | "done" | "open">(
    "build"
  );
  const [showBytes, setShowBytes] = useState(false);
  const [composing, setComposing] = useState(false);
  //: The spec the model chose, and why. Shown so the exam it set is legible
  //: rather than a black box that happens to be hard.
  const [adversary, setAdversary] = useState<any>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/prove/options")
      .then((r) => r.json())
      .then((d) => setCats(d.categories))
      .catch(() => {});
    return () => esRef.current?.close();
  }, []);

  function toggleCause(c: string) {
    setCauses((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function surpriseMe() {
    const all = Object.keys(CAUSE_LABEL);
    const k = 1 + Math.floor(Math.random() * 2);
    const picked: string[] = [];
    while (picked.length < k) {
      const c = all[Math.floor(Math.random() * all.length)];
      if (!picked.includes(c)) picked.push(c);
    }
    setCauses(picked);
    setN(VOLUMES[Math.floor(Math.random() * VOLUMES.length)]);
    setMag(Math.round((0.5 + Math.random() * 3.5) * 10) / 10);
    setRho(Math.random() < 0.5 ? 0 : Math.round(Math.random() * 8) / 10);
    if (cats.length) setMcc(cats[Math.floor(Math.random() * cats.length)].mcc);
  }

  /**
   * Hand the exam over to the model.
   *
   * It picks a point inside a fixed space — batch size, causes, magnitude,
   * correlation — and every value is clamped server-side to what the
   * generator accepts. Asking a model to attack the system is worth more
   * than asking it to describe one.
   */
  async function letModelChoose() {
    setComposing(true);
    try {
      const r = await fetch("/api/prove/adversarial", { method: "POST" });
      const d = await r.json();
      setAdversary(d);
      setN(d.n_txns);
      setCauses(d.causes);
      setMag(d.magnitude_pts);
      setRho(d.rho);
    } catch {
      setAdversary(null);
    }
    setComposing(false);
  }

  async function seal() {
    setChallenge(null);
    setEstimate(null);
    setReveal(null);
    setCoalitions([]);
    setShowBytes(false);
    const q = new URLSearchParams({
      mcc,
      n_txns: String(n),
      causes: causes.join(","),
      magnitude_pts: String(mag),
      rho: String(rho),
    });
    const r = await fetch(`/api/prove/new?${q}`, { method: "POST" });
    setChallenge(await r.json());
    setStage("sealed");
  }

  function diagnose() {
    if (!challenge) return;
    esRef.current?.close();
    setCoalitions([]);
    setEstimate(null);
    setStage("running");
    const es = new EventSource(
      `/api/prove/${challenge.challenge_id}/diagnose?pace_ms=45`
    );
    esRef.current = es;
    es.addEventListener("coalition", (e: any) =>
      setCoalitions((prev) => [...prev, JSON.parse(e.data)])
    );
    es.addEventListener("estimate", (e: any) => setEstimate(JSON.parse(e.data)));
    es.addEventListener("done", () => {
      setStage("done");
      es.close();
    });
    es.onerror = () => {
      setStage("done");
      es.close();
    };
  }

  async function breakSeal() {
    if (!challenge) return;
    const r = await fetch(`/api/prove/${challenge.challenge_id}/reveal`, {
      method: "POST",
    });
    setReveal(await r.json());
    setStage("open");
  }

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        <Stagger>
          <div>
            <Eyebrow>Falsification on demand</Eyebrow>
            <h1 className="text-2xl font-semibold mt-1">Prove it</h1>
            <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
              You choose the merchant. The answer is hashed before the engine runs. Break the seal and check it yourself.
            </p>
          </div>
        </Stagger>

        {/* ═══════════════════════════════ 1 · build the challenge */}
        <Stagger i={1}>
          <Card>
            <div className="flex items-center gap-3 flex-wrap">
              <StepBadge n={1} on={stage === "build"} done={stage !== "build"} />
              <h2 className="text-lg font-semibold">Set the exam</h2>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={surpriseMe} className="btn-quiet h-8 px-3 text-xs">
                  Surprise me
                </button>
                <button
                  onClick={letModelChoose}
                  disabled={composing}
                  className="btn-secondary h-8 px-3 text-xs"
                  title="Ask the model to design the exam it thinks will break the engine."
                >
                  {composing ? "designing…" : "Let the model break it"}
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mt-5">
              <div className="space-y-4">
                <Field label="Category">
                  <select
                    value={mcc}
                    onChange={(e) => setMcc(e.target.value)}
                    className="field"
                  >
                    {cats.map((c) => (
                      <option key={c.mcc} value={c.mcc}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Payments in the batch">
                  <div className="flex items-center gap-1">
                    {VOLUMES.map((v) => (
                      <button
                        key={v}
                        onClick={() => setN(v)}
                        className={`px-3 py-1.5 rounded-md text-xs transition-colors border ${
                          n === v
                            ? "bg-brand-soft text-brand border-brand/30"
                            : "text-muted hover:text-ink border-line"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  {n <= 200 && (
                    <p className="text-[11px] text-amber mt-1.5">
                      Small batches are where this method genuinely struggles. Every
                      miss in the committed failure list is an underpowered batch.
                    </p>
                  )}
                </Field>
              </div>

              <div className="space-y-4">
                <Field label="Hidden problems to inject">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(CAUSE_LABEL).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => toggleCause(k)}
                        className={`px-2.5 py-1.5 rounded-md text-xs transition-colors border ${
                          causes.includes(k)
                            ? "bg-brand-soft text-brand border-brand/30"
                            : "text-muted hover:text-ink border-line"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Size of each · ${mag.toFixed(1)} pts`}>
                    <input
                      type="range"
                      min={0.3}
                      max={5}
                      step={0.1}
                      value={mag}
                      onChange={(e) => setMag(Number(e.target.value))}
                      className="w-full accent-brand"
                    />
                  </Field>
                  <Field label={`Correlation · ρ = ${rho.toFixed(1)}`}>
                    <input
                      type="range"
                      min={0}
                      max={0.8}
                      step={0.1}
                      value={rho}
                      onChange={(e) => setRho(Number(e.target.value))}
                      className="w-full accent-brand"
                      disabled={causes.length < 2}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {adversary && (
              <div className="card-raised border-l-2 border-l-iris p-4 mt-5 animate-rise">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="chip-llm">the model set this exam</span>
                  {adversary.clamped && (
                    <span className="chip-warn">
                      asked for values outside the allowed range — clamped
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted mt-2 leading-relaxed">
                  {adversary.reasoning}
                </p>
              </div>
            )}

            <button
              onClick={seal}
              disabled={causes.length === 0}
              className="btn-primary mt-6"
            >
              Generate and seal the answer →
            </button>
          </Card>
        </Stagger>

        {/* ═══════════════════════════════ 2 · the seal */}
        {challenge && (
          <Stagger i={2}>
            <Card className="border-l-2 border-l-brand">
              <div className="flex items-center gap-3 flex-wrap">
                <StepBadge
                  n={2}
                  on={stage === "sealed"}
                  done={stage === "running" || stage === "done" || stage === "open"}
                />
                <h2 className="text-lg font-semibold">The answer is sealed</h2>
                <span className="chip-brand ml-auto">
                  🔒 committed before the run
                </span>
              </div>

              <p className="text-sm text-muted mt-2 max-w-3xl leading-relaxed">
                This is the SHA-256 of the exact ground truth. It is on screen now,
                before the engine has seen anything. Nothing below can change it.
              </p>

              <div className="card-raised p-3 mt-3 font-mono text-[11px] break-all text-brand">
                {challenge.seal}
              </div>

              <div className="grid sm:grid-cols-4 gap-3 mt-4">
                <Stat k="category" v={challenge.spec.category} />
                <Stat k="payments" v={String(challenge.observed.transactions)} />
                <Stat
                  k="observed success"
                  v={`${challenge.observed.observed_success_pct.toFixed(2)}%`}
                />
                <Stat
                  k="value at risk"
                  v={inr(challenge.observed.at_risk_paise, { compact: true })}
                />
              </div>
              <p className="text-[11px] text-faint mt-3">
                {challenge.spec.n_causes} problem
                {challenge.spec.n_causes === 1 ? "" : "s"} injected — the count is
                shown, never which ones.
              </p>

              {stage === "sealed" && (
                <button onClick={diagnose} className="btn-primary mt-5">
                  Diagnose blind →
                </button>
              )}
            </Card>
          </Stagger>
        )}

        {/* ═══════════════════════════════ 3 · the blind run */}
        {(stage === "running" || stage === "done" || stage === "open") && (
          <Stagger i={3}>
            <Card>
              <div className="flex items-center gap-3 flex-wrap">
                <StepBadge
                  n={3}
                  on={stage === "running"}
                  done={stage === "done" || stage === "open"}
                />
                <h2 className="text-lg font-semibold">Diagnosing, blind</h2>
                <span className="chip-neutral ml-auto">
                  {coalitions.length}/16 coalitions
                </span>
              </div>

              <div className="grid sm:grid-cols-4 md:grid-cols-8 gap-1.5 mt-4">
                {Array.from({ length: 16 }).map((_, i) => {
                  const c = coalitions[i];
                  return (
                    <div
                      key={i}
                      className={`card-raised px-2 py-1.5 transition-colors ${
                        c ? "" : "opacity-30"
                      }`}
                    >
                      <div className="text-[9px] text-faint truncate">
                        {c ? c.label : "—"}
                      </div>
                      <div className="num text-[11px] mt-0.5">
                        {c ? `${c.value > 0 ? "+" : ""}${c.value.toFixed(2)}` : "·"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {estimate && (
                <div className="mt-5">
                  <Eyebrow>What the engine says, before seeing the truth</Eyebrow>
                  <div className="grid sm:grid-cols-4 gap-3 mt-2">
                    {Object.entries(estimate.attributions).map(([k, v]) => (
                      <div
                        key={k}
                        className={`card-raised p-3 ${
                          k === estimate.primary ? "border-brand/40" : ""
                        }`}
                      >
                        <div className="eyebrow">{FACTOR_DOCS[k]?.label ?? k}</div>
                        <div className="num text-lg font-semibold mt-0.5">
                          {v > 0 ? "+" : ""}
                          {v.toFixed(3)}
                        </div>
                        {k === estimate.primary && (
                          <div className="text-[10px] text-brand mt-0.5">
                            says this is the cause
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {estimate.underpowered && (
                    <div className="card-raised p-3 mt-3 text-xs text-amber">
                      ▲ The engine has flagged this batch as underpowered — the
                      uncertainty on the success rate is wider than half the gap it
                      is splitting four ways. It is telling you this before it is
                      marked.
                    </div>
                  )}

                  {stage === "done" && (
                    <button onClick={breakSeal} className="btn-primary mt-5">
                      🔓 Break the seal
                    </button>
                  )}
                </div>
              )}
            </Card>
          </Stagger>
        )}

        {/* ═══════════════════════════════ 4 · the reveal */}
        {reveal && (
          <Stagger i={4}>
            <Card
              className={`border-l-2 ${
                reveal.primary_correct === false
                  ? "border-l-rose"
                  : "border-l-mint"
              }`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <StepBadge n={4} on done={false} />
                <h2 className="text-lg font-semibold">The seal is broken</h2>
                <span
                  className={
                    reveal.matches_published_seal ? "chip-measured" : "chip-warn"
                  }
                >
                  {reveal.matches_published_seal
                    ? "✓ hash matches"
                    : "✗ HASH MISMATCH"}
                </span>
              </div>

              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <Stat k="truth" v={reveal.true_primary ?? "nothing injected"} />
                <Stat k="engine said" v={reveal.found_primary ?? "—"} />
                <Stat
                  k="worst factor error"
                  v={`${reveal.worst_error_pts.toFixed(3)} pts`}
                />
              </div>

              <div className="overflow-x-auto mt-5">
                <table className="w-full text-xs num">
                  <thead>
                    <tr className="eyebrow border-b border-line">
                      <th className="text-left py-2 font-normal">factor</th>
                      <th className="text-right py-2 font-normal">truth</th>
                      <th className="text-right py-2 font-normal">found</th>
                      <th className="text-right py-2 font-normal">error</th>
                      <th className="text-right py-2 font-normal">its own bar</th>
                      <th className="text-left py-2 pl-6 font-normal">
                        what the agent does
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reveal.factors.map((f) => (
                      <tr key={f.factor} className="border-b border-line/50">
                        <td className="py-2 font-body">
                          {FACTOR_DOCS[f.factor]?.label ?? f.factor}
                        </td>
                        <td className="text-right text-muted">
                          {f.true_pts > 0 ? "+" : ""}
                          {f.true_pts.toFixed(3)}
                        </td>
                        <td className="text-right">
                          {f.found_pts > 0 ? "+" : ""}
                          {f.found_pts.toFixed(3)}
                        </td>
                        <td
                          className={`text-right ${
                            f.within_error_bar ? "text-mint" : "text-rose"
                          }`}
                        >
                          {f.error_pts > 0 ? "+" : ""}
                          {f.error_pts.toFixed(3)}
                        </td>
                        <td className="text-right text-faint">
                          ± {f.mae?.toFixed(3) ?? "—"}
                        </td>
                        <td className="pl-6 font-body">
                          <span
                            className={
                              f.agent_would === "act alone"
                                ? "text-mint"
                                : f.agent_would === "ask the merchant"
                                ? "text-amber"
                                : "text-faint"
                            }
                          >
                            {f.agent_would}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className={`card-raised p-4 mt-5 text-sm leading-relaxed ${
                  reveal.primary_correct === false ? "text-rose" : "text-ink"
                }`}
              >
                {reveal.verdict}
              </div>

              <button
                onClick={() => setShowBytes(!showBytes)}
                className="mt-4 text-xs link-quiet underline underline-offset-4"
              >
                {showBytes ? "hide" : "check the hash yourself"} →
              </button>
              {showBytes && (
                <div className="mt-3 space-y-2 animate-rise">
                  <p className="text-xs text-muted">
                    These are the exact bytes that were hashed. Run them through
                    SHA-256 and compare with the seal published in step 2.
                  </p>
                  <pre className="card-raised p-3 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                    {reveal.canonical_bytes}
                  </pre>
                </div>
              )}

              <button onClick={seal} className="btn-secondary mt-5">
                Run another
              </button>
            </Card>
          </Stagger>
        )}
      </main>
    </div>
  );
}

function StepBadge({ n, on, done }: { n: number; on: boolean; done: boolean }) {
  return (
    <span
      className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${
        done
          ? "bg-mint-soft text-mint border border-mint/30"
          : on
          ? "bg-brand text-brand-ink"
          : "bg-raised text-muted border border-line"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="card-raised p-3">
      <div className="eyebrow">{k}</div>
      <div className="text-sm font-semibold mt-0.5 truncate">{v}</div>
    </div>
  );
}
