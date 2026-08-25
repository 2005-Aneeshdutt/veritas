"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, Spark, Stagger, Ticker } from "@/components/ui";
import { Merchant, inr } from "@/lib/types";
import { NODE_DOCS, FLOW_ORDER } from "@/lib/explain";

const SOURCES = [
  { name: "NPCI remitter banks", detail: "1,599 bank-months · 2023-01 → 2025-08" },
  { name: "NPCI beneficiary banks", detail: "both sides of every failure" },
  { name: "NPCI merchant categories", detail: "46 MCCs × 32 months" },
  { name: "Razorpay error taxonomy", detail: "110 codes, hand-labelled" },
];

const PROOF = [
  { k: "0.53", u: "pts", l: "attribution error", s: "measured on 200 merchants" },
  { k: "96.3", u: "%", l: "primary cause found", s: "against known ground truth" },
  { k: "0", u: "", l: "mandate violations", s: "across every run" },
  { k: "1.0000", u: "", l: "Σφ ÷ v(N)", s: "the parts add up, exactly" },
];

export default function Landing() {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then(setMerchants)
      .catch(() => setMerchants([]));
  }, []);

  async function run(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/run?merchant=${id}`, { method: "POST" });
      const rec = await r.json();
      window.location.href = `/run/${rec.run_id}`;
    } catch {
      setBusy(null);
    }
  }

  return (
    <main className="relative">
      {/* faint grid, so the dark has structure */}
      <div
        className="pointer-events-none fixed inset-0 bg-grid opacity-[0.5]"
        style={{ backgroundSize: "56px 56px", maskImage: "radial-gradient(1000px 600px at 50% 0%, #000, transparent 75%)" }}
      />

      <div className="relative max-w-6xl mx-auto px-6 py-20 space-y-24">
        {/* ------------------------------------------------------------ hero */}
        <header className="space-y-7">
          <Stagger>
            <div className="flex items-center gap-3">
              <span className="chip-neutral">Razorpay AI Buildathon</span>
              <span className="chip bg-gold/12 text-gold border-gold/30">Track 03</span>
            </div>
          </Stagger>

          <Stagger i={1}>
            <h1 className="text-5xl md:text-6xl font-bold leading-[1.05] max-w-4xl">
              Every merchant sees their success rate.
              <br />
              <span className="bg-gradient-to-r from-gold-glow via-gold to-gold-dim bg-clip-text text-transparent">
                Nobody tells them what it should be.
              </span>
            </h1>
          </Stagger>

          <Stagger i={2}>
            <p className="text-lg text-muted max-w-2xl leading-relaxed">
              Revenue Doctor finds the gap between what a merchant collects and what
              their category actually achieves, proves which causes it comes from,
              recovers what it is allowed to recover — and reports the error bar on
              its own diagnosis.
            </p>
          </Stagger>

          <Stagger i={3}>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="#merchants"
                className="px-5 py-2.5 rounded-lg bg-gold text-void font-semibold text-sm
                           hover:bg-gold-glow transition-colors shadow-glow"
              >
                Run a live diagnosis →
              </a>
              <span className="text-sm text-muted font-mono">
                3 merchants · real NPCI data · reproducible
              </span>
            </div>
          </Stagger>

          <Stagger i={4}>
            <div className="glass p-5 border-l-2 border-l-gold mt-6 max-w-3xl">
              <p className="text-base leading-relaxed">
                Everyone can build an agent that acts.{" "}
                <span className="text-gold font-medium">
                  This one measures how often it is wrong, and says so before you ask.
                </span>
              </p>
            </div>
          </Stagger>
        </header>

        {/* ---------------------------------------------------------- proof */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PROOF.map((p, i) => (
            <Stagger key={p.l} i={i}>
              <div className="glass p-5 h-full">
                <div className="text-3xl font-display font-bold text-gold leading-none">
                  {p.k}
                  <span className="text-lg text-muted ml-0.5">{p.u}</span>
                </div>
                <div className="text-sm font-medium mt-2">{p.l}</div>
                <div className="text-xs text-muted mt-1">{p.s}</div>
              </div>
            </Stagger>
          ))}
        </section>

        {/* ------------------------------------------------------ merchants */}
        <section id="merchants" className="space-y-5 scroll-mt-8">
          <div>
            <Eyebrow>Step 1</Eyebrow>
            <h2 className="text-2xl font-semibold mt-1">Pick a merchant</h2>
            <p className="text-sm text-muted mt-1.5 max-w-2xl">
              Three businesses with genuinely different problems. Each runs the full
              ten-node agent live — around four seconds, every step inspectable.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {merchants === null &&
              [0, 1, 2].map((i) => <div key={i} className="shimmer h-56" />)}

            {merchants?.map((m, i) => {
              const failPct = (m.failures / m.transactions) * 100;
              return (
                <Stagger key={m.merchant_id} i={i}>
                  <button
                    onClick={() => run(m.merchant_id)}
                    disabled={busy !== null}
                    className="glass p-5 text-left w-full h-full group
                               hover:shadow-glow hover:-translate-y-1
                               transition-all duration-300 disabled:opacity-50
                               disabled:translate-y-0"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-display font-bold text-lg">{m.name}</div>
                        <div className="text-xs text-muted mt-0.5">
                          MCC {m.mcc} · {m.mcc_description}
                        </div>
                      </div>
                      <span className="chip-neutral">{m.transactions.toLocaleString()}</span>
                    </div>

                    <div className="mt-5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-display font-bold">
                          {m.observed_success_pct}
                          <span className="text-lg text-muted">%</span>
                        </span>
                        <span className="text-xs text-muted">success rate</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-mint-dim to-mint"
                          style={{ width: `${m.observed_success_pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="eyebrow">failed</div>
                        <div className="num text-rose text-base mt-0.5">
                          {m.failures}
                          <span className="text-muted text-xs ml-1">
                            ({failPct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="eyebrow">at risk</div>
                        <div className="num text-amber text-base mt-0.5">
                          {inr(m.at_risk_paise, { compact: true })}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-line flex items-center justify-between">
                      <span className="text-sm text-gold font-medium">
                        {busy === m.merchant_id ? "diagnosing…" : "Run diagnosis"}
                      </span>
                      <span className="text-gold group-hover:translate-x-1 transition-transform">
                        →
                      </span>
                    </div>
                  </button>
                </Stagger>
              );
            })}

            {merchants?.length === 0 && (
              <div className="glass p-6 md:col-span-3 text-sm text-muted font-mono">
                No merchants found — start the backend and run{" "}
                <span className="text-gold">
                  python scripts/generate_batch.py --demo
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ----------------------------------------------------- how it works */}
        <section className="space-y-5">
          <div>
            <Eyebrow>Step 2 · what happens when you click</Eyebrow>
            <h2 className="text-2xl font-semibold mt-1">Ten nodes, and why each exists</h2>
            <p className="text-sm text-muted mt-1.5 max-w-2xl">
              Deterministic wherever correctness is checkable. A model only where
              judgement is genuinely required — and the difference is visible without
              reading a line of code.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {FLOW_ORDER.map((id, i) => {
              const d = NODE_DOCS[id];
              const llm = d.kind === "llm";
              return (
                <Stagger key={id} i={i % 4}>
                  <div
                    className={`glass p-4 h-full border-l-2 ${
                      llm ? "border-l-iris/70" : "border-l-sky/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="num text-xs text-faint">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-semibold text-sm">{d.title}</span>
                      <span className={llm ? "chip-llm" : "chip-det"}>
                        {llm ? d.model ?? "LLM" : "deterministic"}
                      </span>
                    </div>
                    <div className="text-sm text-ink/90 mt-2">{d.tagline}</div>
                    <p className="text-xs text-muted mt-1.5 leading-relaxed">{d.why}</p>
                  </div>
                </Stagger>
              );
            })}
          </div>
        </section>

        {/* ---------------------------------------------------------- sources */}
        <section className="space-y-5">
          <div>
            <Eyebrow>Built on published data, not vibes</Eyebrow>
            <h2 className="text-2xl font-semibold mt-1">Where the numbers come from</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            {SOURCES.map((s, i) => (
              <Stagger key={s.name} i={i}>
                <div className="glass p-4 h-full">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted font-mono mt-1.5">{s.detail}</div>
                </div>
              </Stagger>
            ))}
          </div>
          <p className="text-xs text-muted leading-relaxed max-w-3xl">
            npci.org.in returns 403 to every non-browser client and the usual mirror is
            paywalled, so bank data comes from a <em>pinned</em> Internet Archive
            capture — identical bytes on every clone. Rows failing the
            approved + BD + TD = 100 identity are quarantined rather than silently
            repaired. One genuinely fails.
          </p>
        </section>

        <footer className="pt-8 border-t border-line flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-muted font-mono">
            Aneesh Dutt · PES University · fixed seed 20260824 · temperature 0
          </div>
          <div className="text-xs text-faint font-mono">
            every number below reproduces from the committed repo
          </div>
        </footer>
      </div>
    </main>
  );
}
