"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { ChainFooter } from "@/components/Chain";
import { Lineage } from "@/components/DataRoom";
import {
  Detail,
  Loading,
  PageHead,
  Panel,
  SectionHeader,
  Stagger,
} from "@/components/ui";
import { inr } from "@/lib/types";

/**
 * How the recovery actually reaches the customer — and how rarely it has to.
 *
 * The headline finding of this page is a negative one, which is why it is
 * stated first: across CloudSync's 227 failures the policy contacts a
 * customer zero times. Every recoverable failure still has a quieter option,
 * and the policy takes it. That is the correct behaviour and it is worth
 * more than a page full of channels firing.
 *
 * The voice section exists because it is the highest-risk thing this product
 * could do, and the safest way to present it is to show exactly how narrow
 * the box around it is: it cannot choose to call, cannot call twice, cannot
 * ask for a card number, and cannot report money.
 */

const CHANNEL: Record<string, { label: string; tone: string; blurb: string }> = {
  retry: {
    label: "Retry",
    tone: "text-mint",
    blurb: "The customer does nothing. Cheapest, quietest, tried first.",
  },
  no_action: {
    label: "No action",
    tone: "text-faint",
    blurb: "Nothing converts this. An expired card is not fixed by asking again.",
  },
  escalate: {
    label: "Escalate",
    tone: "text-sky",
    blurb: "No channel is both permitted and available. A person decides.",
  },
  payment_link: {
    label: "Payment link",
    tone: "text-amber",
    blurb: "The customer has to act. A link is the quietest way to ask.",
  },
  email: { label: "Email", tone: "text-amber", blurb: "A link, in an inbox." },
  voice: {
    label: "Voice",
    tone: "text-rose",
    blurb: "One call, scripted, only when nothing quieter is available.",
  },
};

export default function RecoverPage() {
  const [mix, setMix] = useState<any>(null);
  const [scenario, setScenario] = useState("accepts");
  const [lang, setLang] = useState("en");
  const [voice, setVoice] = useState<any>(null);
  const [trace, setTrace] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/channels/cloudsync")
      .then((r) => r.json())
      .then(setMix)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setVoice(null);
    fetch(`/api/voice/demo?scenario=${scenario}&language=${lang}`)
      .then((r) => r.json())
      .then(setVoice)
      .catch(() => {});
  }, [scenario, lang]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">{body}</main>
    </div>
  );

  if (!mix) return shell(<Loading label="working out how to reach anybody" />);

  const total = Object.values(mix.mix).reduce(
    (a: number, b: any) => a + Number(b),
    0
  ) as number;
  const contacted =
    (mix.mix.voice ?? 0) + (mix.mix.payment_link ?? 0) + (mix.mix.email ?? 0);

  return shell(
    <>
      <Stagger>
        <PageHead
          title="Reaching the customer"
          sub="Which channel, if any — and the finding that the answer is almost always none."
        />
      </Stagger>

      {/* ── 1. the finding, before the mechanism ── */}
      <Stagger>
        <Panel>
          <p className="text-[13px] text-muted leading-relaxed">
            Across {mix.merchant_name}&rsquo;s{" "}
            <span className="num">{total}</span> failed payments, the policy
            contacts a customer{" "}
            <span className="num text-mint">{contacted}</span> times. Every
            recoverable failure still has a quieter option available and the
            policy takes it; the rest are refused outright or handed to a
            person. A recovery product that phones people is a nuisance, and
            the cheapest workable channel wins by rule.
          </p>
        </Panel>
      </Stagger>

      {/* ── 2. the mix ── */}
      <Stagger i={1}>
        <div>
          <SectionHeader
            title="What the policy chose"
            sub="Cheapest workable channel first: retry, then a link, then a call, and only where the mandate permits it at all."
          />
          <div className="grid sm:grid-cols-3 gap-px bg-line rounded-lg overflow-hidden">
            {Object.entries(CHANNEL).map(([key, c]) => {
              const n = mix.mix[key] ?? 0;
              const v = mix.value_paise[key] ?? 0;
              return (
                <div key={key} className="bg-surface p-4">
                  <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                    {c.label}
                  </div>
                  <div className={`num text-[24px] font-semibold mt-1.5 ${c.tone}`}>
                    {n}
                  </div>
                  <div className="num text-[11px] text-faint mt-1">
                    {v ? inr(v, { compact: true }) : "—"}
                  </div>
                  <p className="text-[11px] text-muted mt-2 leading-snug">
                    {c.blurb}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </Stagger>

      {/* ── 3. voice, and the box around it ── */}
      <Stagger i={2}>
        <div>
          <SectionHeader
            title="Voice, and why it almost never fires"
            sub="Voice is a channel, not an intelligence. It cannot decide to call, call twice, offer anything, or report money."
            right={
              <div className="flex gap-2">
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  className="field h-8 text-[12px]"
                  aria-label="scenario"
                >
                  <option value="accepts">customer accepts</option>
                  <option value="disputes">customer disputes it</option>
                  <option value="asks_for_card">customer offers a card</option>
                  <option value="declines">customer declines</option>
                  <option value="unclear_then_accepts">unclear, then yes</option>
                </select>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="field h-8 text-[12px]"
                  aria-label="language"
                >
                  <option value="en">English</option>
                  <option value="hinglish">Hinglish</option>
                </select>
              </div>
            }
          />

          {!voice ? (
            <p className="text-[12px] text-faint">running the scenario…</p>
          ) : (
            <div className="space-y-5">
              {/* the provenance, before the transcript */}
              <div className="panel p-4 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="chip-projected">{voice.label}</span>
                  {voice.outcome && (
                    <span className="chip-projected">
                      {voice.outcome.label.toLowerCase()}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted leading-relaxed">
                  {voice.why_constructed}
                </p>
                <p className="text-[11.5px] text-faint leading-relaxed border-t border-line pt-2.5">
                  The mandate for this scenario permits{" "}
                  <span className="num">
                    {voice.mandate_permits.length} action types
                  </span>{" "}
                  and excludes{" "}
                  <span className="num text-rose">
                    {voice.mandate_excludes.join(", ")}
                  </span>
                  . It is signed with the merchant&rsquo;s own key — the kernel
                  refuses an unverifiable mandate before it checks anything
                  else, so a scenario running against an unsigned struct would
                  be testing nothing.
                </p>
              </div>

              {/* decision → gate → call */}
              <div className="grid sm:grid-cols-3 gap-px bg-line rounded-lg overflow-hidden">
                <Step
                  n="1"
                  label="Revenue Doctor decides"
                  value={voice.decision.chosen}
                  tone="text-iris"
                  sub={voice.decision.reason}
                />
                <Step
                  n="2"
                  label="The kernel rules"
                  value={voice.gate_decision}
                  tone={
                    voice.gate_decision === "deny"
                      ? "text-rose"
                      : voice.gate_decision === "step_up"
                      ? "text-amber"
                      : "text-mint"
                  }
                  sub={
                    voice.required_confirmation
                      ? `${voice.gate_reason} — above the auto-execute limit, so a person has to say yes before the call happens.`
                      : voice.gate_reason
                  }
                />
                <Step
                  n="3"
                  label="The channel executes"
                  value={voice.outcome ? voice.outcome.final_state : "no call"}
                  tone={
                    voice.outcome?.final_state === "completed"
                      ? "text-mint"
                      : voice.outcome?.final_state === "escalated"
                      ? "text-sky"
                      : "text-muted"
                  }
                  sub={
                    voice.outcome
                      ? `${voice.outcome.attempted} of ${voice.outcome.max_attempts} permitted contact attempts. Then it stops.`
                      : "The kernel did not permit a call, so none was made."
                  }
                />
              </div>

              {voice.outcome && (
                <>
                  <div className="space-y-2.5">
                    {voice.outcome.transcript.map((t: any) => (
                      <div
                        key={t.seq}
                        className={`flex gap-3 ${
                          t.speaker === "customer" ? "pl-8" : ""
                        }`}
                      >
                        <span
                          className={`ui text-[9.5px] uppercase tracking-[0.1em] shrink-0 w-16 pt-1 ${
                            t.speaker === "agent" ? "text-brand" : "text-faint"
                          }`}
                        >
                          {t.speaker}
                        </span>
                        <p
                          className={`text-[13px] leading-relaxed max-w-2xl ${
                            t.speaker === "agent" ? "text-ink" : "text-muted"
                          }`}
                        >
                          {t.text}
                          {t.intent && (
                            <span className="num text-[10px] text-faint ml-2">
                              → {t.intent}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* what it did NOT do */}
                  <div className="border-t border-line pt-4 grid sm:grid-cols-2 gap-6">
                    <div>
                      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                        Outcome
                      </div>
                      <div className="text-[13px] mt-1.5">
                        Accepted:{" "}
                        <span
                          className={
                            voice.outcome.customer_accepted
                              ? "text-mint"
                              : "text-muted"
                          }
                        >
                          {voice.outcome.customer_accepted ? "yes" : "no"}
                        </span>
                        {" · "}
                        Action:{" "}
                        <span className="num">{voice.outcome.action_taken}</span>
                      </div>
                      {voice.outcome.escalation_reason && (
                        <p className="text-[12px] text-sky mt-2 leading-relaxed">
                          {voice.outcome.escalation_reason}
                        </p>
                      )}
                    </div>
                    <div>
                      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
                        Recovered
                      </div>
                      <div className="num text-[24px] font-semibold mt-1 text-muted">
                        ₹0
                      </div>
                      <p className="text-[11.5px] text-faint mt-1.5 leading-snug">
                        {voice.outcome.recovery_basis}
                      </p>
                    </div>
                  </div>
                </>
              )}

              <Detail summary="What this agent is structurally unable to do">
                <ul className="space-y-1.5 text-[12.5px]">
                  <li>
                    Decide to call. It receives a channel decision and raises if
                    it is not <span className="num">voice</span>.
                  </li>
                  <li>
                    Call twice. The mandate caps remediation attempts per
                    payment and a call is one; the ceiling here is 1.
                  </li>
                  <li>
                    Ask for a card number, CVV, OTP, PIN or password. Every
                    outbound line is checked against a pattern list before it
                    is emitted, and a match raises rather than being logged and
                    sent.
                  </li>
                  <li>
                    Offer a discount or waive anything. Same check, same list.
                  </li>
                  <li>
                    Report money. A customer saying yes authorises a link and
                    nothing else; recovery is claimed only by an outcome event.
                  </li>
                  <li>
                    Improvise. There is no model behind it — five states and a
                    closed set of intents. Wiring real telephony replaces the
                    scripted customer with a speech classifier restricted to
                    the same set; the state machine and the guardrails do not
                    change.
                  </li>
                </ul>
              </Detail>
            </div>
          )}
        </div>
      </Stagger>

      {/* ── 4. one payment, all the way down ── */}
      <Stagger i={3}>
        <div>
          <SectionHeader
            title="Follow one payment"
            sub="From the batch row to the audit entry that closed it, including every event."
            right={
              <select
                value={trace ?? ""}
                onChange={(e) => setTrace(e.target.value || null)}
                className="field h-8 text-[12px] w-56"
                aria-label="payment to trace"
              >
                <option value="">pick a payment…</option>
                {(mix.sample ?? []).slice(0, 25).map((d: any) => (
                  <option key={d.txn_id} value={d.txn_id}>
                    {d.txn_id} · {inr(d.amount_paise)} · {d.chosen}
                  </option>
                ))}
              </select>
            }
          />
          {trace ? (
            <Lineage merchantId="cloudsync" txnId={trace} />
          ) : (
            <p className="text-[12px] text-faint">
              Pick a payment above to see every record that touched it.
            </p>
          )}
        </div>
      </Stagger>

      <ChainFooter />
    </>
  );
}

function Step({
  n,
  label,
  value,
  sub,
  tone,
}: {
  n: string;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="bg-surface p-4">
      <div className="ui text-[10px] uppercase tracking-[0.1em] text-faint">
        {n} · {label}
      </div>
      <div className={`num text-[17px] font-semibold mt-1.5 ${tone}`}>
        {value}
      </div>
      <p className="text-[11.5px] text-muted mt-2 leading-snug">{sub}</p>
    </div>
  );
}
