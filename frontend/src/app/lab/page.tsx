"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { ChainFooter } from "@/components/Chain";
import { Comparison, Frontier, WhyThisStrategy } from "@/components/Lab";
import {
  Detail,
  Empty,
  Loading,
  Notes,
  PageHead,
  Panel,
  SectionHeader,
  Stagger,
} from "@/components/ui";
import { inr } from "@/lib/types";

/**
 * The Counterfactual Recovery Lab.
 *
 * A recovery figure with nothing beside it is not a result. This page is the
 * thing beside it: the same batch of failed payments, run through four
 * policies, all marked against the same outcomes none of them could see.
 *
 * The page is deliberately willing to lose. On CloudSync's batch a naive
 * retry loop recovers more than we do, and the table says so in the first
 * column. What it also says, two columns over, is that the loop gets there
 * by breaching the signed mandate 247 times. Hiding the first number to
 * protect the story would make every other number here worthless.
 */
export default function LabPage() {
  const [merchants, setMerchants] = useState<any[]>([]);
  const [id, setId] = useState<string>("cloudsync");
  const [lab, setLab] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => setMerchants(d.merchants ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let dead = false;
    setLab(null);
    setErr(null);
    fetch(`/api/lab/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => !dead && setLab(d))
      .catch(() => !dead && setErr("could not evaluate this batch"));
    return () => {
      dead = true;
    };
  }, [id]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar
        right={
          merchants.length > 0 ? (
            <select
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="field h-8 text-[12px] w-48"
              aria-label="merchant"
            >
              {merchants.map((m: any) => (
                <option key={m.merchant_id} value={m.merchant_id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">{body}</main>
    </div>
  );

  if (err) return shell(<Empty label={err} />);
  if (!lab) return shell(<Loading label="replaying the batch under four policies" />);

  const rd = lab.strategies.find((s: any) => s.key === "revenue_doctor");

  return shell(
    <>
      <Stagger>
        <PageHead
          title="Counterfactual Recovery Lab"
          sub="What this batch was worth under policies we did not run."
          right={<span className="chip-projected">synthetic evaluation</span>}
        />
      </Stagger>

      {/* ── 1. the batch, and the ceiling on the whole exercise ──
          Stated first and deliberately: no policy below can beat this, so a
          reader knows what 100% would even mean before seeing a single row. */}
      <Stagger>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5 divide-y divide-line sm:divide-y-0 sm:divide-x">
          <Fig
            label={`${lab.merchant_name} — failures`}
            value={String(lab.batch_failures)}
            sub={`worth ${inr(lab.at_risk_paise)} in the batch`}
          />
          <Fig
            label="Worth retrying at all"
            value={String(lab.recoverable_failures)}
            sub="soft declines and technical errors — the rest are expired cards"
          />
          <Fig
            label="Would ever have converted"
            value={String(lab.convertible)}
            tone="text-mint"
            sub="ground truth, hidden from every policy until after it decided"
          />
          <Fig
            label="Ceiling on any policy"
            value={inr(lab.convertible_paise)}
            tone="text-mint"
            sub="nothing below can beat this, and nothing does"
          />
        </div>
      </Stagger>

      {/* ── 2. the comparison ── */}
      <Stagger i={1}>
        <div>
          <SectionHeader
            title="Four policies, one batch"
            sub="Same payments, same signed mandate, same hidden outcomes. The
                 outcomes were revealed only after every policy had decided."
          />
          <Comparison strategies={lab.strategies} observed={lab.observed} />
        </div>
      </Stagger>

      {/* ── 3. the decision, from the evaluation rather than about it ── */}
      <Stagger i={2}>
        <div>
          <SectionHeader
            title="Why this policy"
            sub="Every figure below was lifted from the run above. No prose was
                 generated and no model was asked."
          />
          <WhyThisStrategy
            choice={lab.choice}
            friction={lab.friction_paise_per_attempt}
          />
        </div>
      </Stagger>

      {/* ── 4. the frontier: more recovery is not automatically better ── */}
      <Stagger i={3}>
        <div>
          <SectionHeader
            title="The autonomy frontier"
            sub="How large a payment the agent may retry without asking — and
                 what each setting costs as well as what it earns."
          />
          <Frontier points={lab.frontier} />
        </div>
      </Stagger>

      {/* ── 5. method. Collapsed, because only one kind of reader opens it ── */}
      <Stagger i={4}>
        <Detail summary="Method — how the outcomes are known, and what they are not">
          <div className="space-y-4 text-[12.5px] text-muted leading-relaxed max-w-3xl">
            <p>
              Each generated merchant carries, as ground truth, whether every
              recoverable failure would have converted on a retry. It lives on
              the merchant&apos;s ground-truth record, never on a transaction,
              so the engine has never been able to read it and neither can any
              policy on this page. Each policy is a function of the batch and
              the mandate; it returns its decisions; the outcomes are revealed
              afterwards by a separate function. Two tests enforce that —
              one on the shape of every decision function, one that inverts
              the entire truth table and asserts the decisions do not move.
            </p>
            <p>
              <span className="text-ink">Measured</span> means measured against
              that generating distribution — the same standard as the ±0.57
              point attribution error, not a live payment rail.{" "}
              <span className="text-ink">Counterfactual</span> means a replay
              that never happened. The one row labelled{" "}
              <span className="chip-measured">measured</span> is the live
              system&apos;s own result, read from its audit ledger.
            </p>
            <p>
              <span className="text-ink">Where this is weaker than it looks:</span>{" "}
              the truth is one boolean per payment, so it does not vary with
              retry timing. That is why the naive policies reach the ceiling —
              retrying everything three times catches every convertible payment
              by construction. On a real rail, delay and attempt count would
              both matter, and the gap between the policies would come from
              somewhere else. The comparison this page can defend is about
              attempts spent and rules broken, not about who finds the last
              rupee.
            </p>
            <Notes title="How to read this page">
              {lab.notes.map((n: string) => (
                <p key={n} className="text-[12px] text-faint leading-relaxed">
                  {n}
                </p>
              ))}
            </Notes>
          </div>
        </Detail>
      </Stagger>

      {rd && rd.mandate_violations === 0 && (
        <Panel>
          <p className="text-[13px] text-muted leading-relaxed">
            Revenue Doctor returned{" "}
            <span className="num text-mint">{inr(rd.recovered_paise)}</span> of a
            possible <span className="num">{inr(lab.convertible_paise)}</span>{" "}
            and broke no rule doing it. The rest is not lost — it is{" "}
            <span className="num text-amber">{inr(rd.held_paise)}</span> waiting
            on your confirmation and{" "}
            <span className="num text-rose">{inr(rd.denied_paise)}</span> the
            mandate you signed refuses to touch.
          </p>
        </Panel>
      )}

      <ChainFooter />
    </>
  );
}

function Fig({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 pt-5 sm:pt-0 sm:pl-8 sm:first:pl-0">
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
      <div className={`num text-[24px] font-semibold leading-none mt-1.5 ${tone ?? ""}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-faint mt-1.5 leading-snug">{sub}</div>}
    </div>
  );
}
