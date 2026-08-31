"use client";

import { useEffect, useState } from "react";
import { Card, Detail, Eyebrow, SectionHeader } from "@/components/ui";

interface ModelUse {
  model: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  cost_inr: number;
}

interface B {
  cached_calls: number;
  cached_tokens_in: number;
  cached_tokens_out: number;
  cache_worth_inr: number;
  by_model: ModelUse[];
  runs: number;
  run_calls: number;
  run_tokens: number;
  run_spent_inr: number;
  run_saved_inr: number;
  cache_hit_rate: number;
  cost_per_merchant_inr: number;
  cost_per_million_inr: number;
  ran_free: boolean;
}

const fmt = (n: number) => n.toLocaleString("en-IN");

/**
 * What the model steps cost.
 *
 * Every run in this demo reports zero rupees, and a bare zero would be
 * quietly claiming the model steps are free. They are not — they were bought
 * once and committed, and a platform running this nightly would buy them
 * every time.
 *
 * So spent and saved are shown apart and never netted, and the figure given
 * the most room is the one a payments company actually needs before putting a
 * model anywhere near a million merchants: the billable cost per merchant,
 * priced as if nothing were cached.
 */
export function Budget() {
  const [b, setB] = useState<B | null>(null);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => r.json())
      .then(setB)
      .catch(() => {});
  }, []);

  if (!b) return null;
  const tokens = b.cached_tokens_in + b.cached_tokens_out;

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-5 pt-5">
        <SectionHeader
          eyebrow="What the AI costs"
          title="Tokens burnt, and tokens not burnt twice"
          sub="Every model answer this project needs was bought once and committed, so the demo runs without spending anything. That is worth stating precisely rather than showing as a zero: the model steps are not free, they are pre-paid."
        />
      </div>

      <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line">
        <Fig
          k="cost per merchant"
          v={`₹${b.cost_per_merchant_inr.toFixed(2)}`}
          sub="billable, as if nothing were cached"
          tone="text-brand"
        />
        <Fig
          k="across a million merchants"
          v={`₹${(b.cost_per_million_inr / 10000000).toFixed(2)} Cr`}
          sub="if every model step ran every night"
          tone="text-amber"
        />
        <Fig
          k="this book actually spent"
          v={b.ran_free ? "₹0.00" : `₹${b.run_spent_inr.toFixed(2)}`}
          sub={`${Math.round(100 * b.cache_hit_rate)}% served from cache`}
          tone="text-mint"
        />
      </div>

      <div className="px-5 py-4 border-t border-line">
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
          <Line
            k="model calls across the book"
            v={`${b.run_calls} over ${b.runs} merchants`}
          />
          <Line k="tokens those calls needed" v={fmt(b.run_tokens)} />
          <Line
            k="not spent, because it was cached"
            v={`₹${b.run_saved_inr.toFixed(2)}`}
          />
          <Line
            k="whole cache, if rebuilt from empty"
            v={`₹${b.cache_worth_inr.toFixed(2)} · ${fmt(tokens)} tokens`}
          />
        </div>

        <Detail summary="where the tokens went">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left">
                  <th className="eyebrow py-1.5">model</th>
                  <th className="eyebrow py-1.5 text-right">answers</th>
                  <th className="eyebrow py-1.5 text-right">in</th>
                  <th className="eyebrow py-1.5 text-right">out</th>
                  <th className="eyebrow py-1.5 text-right">at list price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {b.by_model.map((m) => (
                  <tr key={m.model}>
                    <td className="py-1.5 num text-[12px]">{m.model}</td>
                    <td className="py-1.5 text-right num tabular-nums">
                      {m.calls}
                    </td>
                    <td className="py-1.5 text-right num tabular-nums text-muted">
                      {fmt(m.tokens_in)}
                    </td>
                    <td className="py-1.5 text-right num tabular-nums text-muted">
                      {fmt(m.tokens_out)}
                    </td>
                    <td className="py-1.5 text-right num tabular-nums">
                      ₹{m.cost_inr.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The per-million figure assumes every model step runs for every
            merchant every night, which is the expensive way to do it and not
            what this pipeline needs. Classification is answered from a
            hand-labelled taxonomy with no call at all for the 110 published
            codes, and the deterministic half — the decomposition, the gate,
            the ledger — has no model in it and runs at 1,445 payments a
            second on one core.
          </p>
        </Detail>
      </div>
    </Card>
  );
}

function Fig({
  k,
  v,
  sub,
  tone,
}: {
  k: string;
  v: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow">{k}</div>
      <div className={`num text-2xl font-semibold mt-1 ${tone}`}>{v}</div>
      <div className="text-[11px] text-faint mt-0.5 leading-snug">{sub}</div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted">{k}</span>
      <span className="num tabular-nums shrink-0">{v}</span>
    </div>
  );
}
