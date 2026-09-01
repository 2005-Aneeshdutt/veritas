"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthorityPanel } from "@/components/AuthorityPanel";
import { BarStrip } from "@/components/BarStrip";
import { Card, Detail, Eyebrow, Figure, Figures, Info, Loading, Notes, PageHead, Panel, SectionHeader, Stagger } from "@/components/ui";
import { GLOSSARY } from "@/lib/explain";
import { RunRecord, inr } from "@/lib/types";

/** Must match chitragupta/canonical.py: sorted keys, no whitespace. */
function canonical(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(obj[k]))
      .join(",") +
    "}"
  );
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function AuditPage({ params }: { params: { runId: string } }) {
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState<any>(null);

  function load() {
    return fetch(`/api/run/${params.runId}`)
      .then((r) => r.json())
      .then((d: RunRecord) => {
        setRec(d);
        setEntries(d.report.ledger ?? []);
      });
  }

  useEffect(() => {
    load();
  }, [params.runId]);

  /**
   * Refresh when this tab comes back to the front.
   *
   * A fix approved from an email lands in a different tab, so the audit page
   * a merchant switches back to is the one they left -- showing the ledger
   * from before the thing they just authorised. One request on focus stops
   * the page quietly describing the past.
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
  }, [params.runId]);

  /**
   * Release everything the kernel held for the merchant.
   *
   * The ledger showed dozens of step_up rows sitting at "merchant_action"
   * with no way to act on them from this page. The whole point of a step-up
   * is that a person decides, and there was nobody here to ask.
   *
   * Every group is re-gated individually on the way through, so this approves
   * the queue rather than widening the mandate -- anything above the hard
   * ceiling stays denied however many times it is confirmed.
   */
  async function confirmAll() {
    if (!rec || confirming) return;
    setConfirming(true);
    const totals = {
      executed: 0,
      denied: 0,
      ledger_added: 0,
      chain_verified: true,
      headline: "",
    };
    for (let i = 0; i < (rec.pending_actions?.length ?? 0); i++) {
      const r = await fetch(
        `/api/run/${params.runId}/apply?group_index=${i}&confirmed=true`,
        { method: "POST" }
      );
      const d = await r.json();
      totals.executed += d.executed ?? 0;
      totals.denied += d.denied ?? 0;
      totals.ledger_added += d.ledger_added ?? 0;
      totals.chain_verified = totals.chain_verified && (d.chain_verified ?? true);
      if (d.headline) totals.headline = d.headline;
    }
    setConfirmed(totals);
    setConfirming(false);
    await load();
  }

  /**
   * Decide one payment rather than a whole fix.
   *
   * "Confirm all 58" is the only control the page offered, which is an
   * all-or-nothing choice about other people's money. The endpoint routes
   * through the same apply_group the bulk button uses, narrowed to one
   * payment, so one and fifty are decided by identical rules.
   */
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});

  async function decideOne(txnId: string, decision: "approve" | "reject") {
    if (deciding) return;
    setDeciding(txnId);
    try {
      const r = await fetch(
        `/api/run/${params.runId}/action?txn_id=${encodeURIComponent(txnId)}&decision=${decision}`,
        { method: "POST" }
      );
      const d = await r.json();
      setDecided((m) => ({
        ...m,
        [txnId]: r.ok ? (decision === "approve" ? "approved" : "rejected") : "failed",
      }));
      if (r.ok) await load();
    } finally {
      setDeciding(null);
    }
  }

  async function verify(list = entries) {
    setBusy(true);
    setResult(null);
    let prev = "0".repeat(64);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.prev_hash !== prev) {
        setBrokenAt(i);
        setResult({ ok: false, msg: `chain broken at entry ${i} — prev_hash mismatch` });
        setBusy(false);
        return;
      }
      const { entry_hash, ...rest } = e;
      if ((await sha256Hex(canonical(rest))) !== entry_hash) {
        setBrokenAt(i);
        setResult({ ok: false, msg: `entry ${i} has been modified since it was written` });
        setBusy(false);
        return;
      }
      prev = entry_hash;
    }
    setBrokenAt(null);
    setResult({ ok: true, msg: `${list.length} entries recomputed from genesis` });
    setBusy(false);
  }

  function tamper() {
    const idx = Math.min(4, entries.length - 1);
    if (idx < 0) return;
    const copy = entries.map((e) => ({ ...e }));
    copy[idx] = {
      ...copy[idx],
      proposed_action: { ...copy[idx].proposed_action, amount_paise: 99999999 },
    };
    setEntries(copy);
    verify(copy);
  }

  function reset() {
    setEntries(rec?.report.ledger ?? []);
    setResult(null);
    setBrokenAt(null);
  }

  if (!rec) return <Loading label="loading ledger" />;

  const r = rec.report;

  /**
   * What is still genuinely waiting on a person.
   *
   * Counted per ACTION, not per ledger row. The ledger is append-only, so an
   * action that was held and then confirmed leaves its old merchant_action
   * entry behind for ever -- and counting rows meant the card still offered
   * "Confirm all 58" after all 58 had been confirmed, then reported "Already
   * applied, 0 executed" when you pressed it. The work had happened; the
   * page was describing the past.
   */
  const finalPerAction = new Map<string, any>();
  for (const e of entries as any[]) {
    finalPerAction.set(`${e.txn_id}|${e.proposed_action?.action_type}`, e);
  }
  const waiting = [...finalPerAction.values()].filter(
    (e: any) => e.outcome === "merchant_action"
  );
  const pendingStepUps = waiting.length;
  const m = r.measured;
  const shown = entries.filter(
    (e) => filter === "all" || e.gate_decision === filter
  );

  return (
    <div className="space-y-6">
      <Stagger>
        <PageHead
          title="Authorise"
          sub="Every decision the agent made — allowed, escalated and denied — is hash-chained. Denied actions are recorded too; a trail of only successes is a highlight reel."
        />
      </Stagger>

      {/* ─────────────────────────────── verification */}
      <Stagger i={1}>
        <BarStrip rec={rec} runId={params.runId} />
      </Stagger>

      <Stagger i={1}>
        <Card>
          <SectionHeader
            title="Verify the chain in your own browser"
            sub="This recomputes SHA-256 over the canonical encoding of every entry, client-side, exactly the way the Python ledger does. It is not reading a boolean off the server."
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => verify()}
              disabled={busy}
              className="btn-secondary"
            >
              {busy ? "verifying…" : "✓ Verify chain"}
            </button>
            <button
              onClick={tamper}
              className="px-4 py-2 rounded-lg bg-rose-soft text-rose border border-rose/40
                         text-sm font-semibold hover:bg-rose/25 transition-colors"
            >
              ⚡ Tamper with entry 4
            </button>
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg card-raised text-sm text-muted
                         hover:text-ink transition-colors"
            >
              reset
            </button>

            {result && (
              <div
                className={`ml-auto px-4 py-2 rounded-lg border text-sm font-mono
                  animate-rise ${
                    result.ok
                      ? "border-mint/40 bg-mint-soft text-mint"
                      : "border-rose/40 bg-rose-soft text-rose"
                  }`}
              >
                {result.ok ? "✓" : "✗"} {result.msg}
              </div>
            )}
          </div>

          {brokenAt !== null && (
            <p className="text-xs text-rose mt-3 leading-relaxed animate-rise">
              Note that every entry from {brokenAt} onward is now invalid, not just the
              one that was edited — each entry commits to the hash of the one before it.
              Repairing the tampered entry&apos;s own hash does not help: the next
              entry still points at the original.
            </p>
          )}
        </Card>
      </Stagger>

      {/* ─────────────────────────────── summary */}
      <Stagger i={2}>
        <Figures>
          <Figure label="ledger entries" value={m.ledger_entries} kind="measured" />
          <Figure
            label="mandate violations"
            value={m.mandate_violations}
            kind="measured"
            tone={m.mandate_violations === 0 ? "good" : "bad"}
            info="Actions executed outside what the merchant cryptographically authorised. Must be zero."
          />
          <Figure
            label="chain"
            value={m.chain_verified ? "verified" : "broken"}
            kind="measured"
            tone={m.chain_verified ? "good" : "bad"}
          />
          <Figure
            label="gated at diagnosis"
            value={(Object.values(r.gate.decisions) as number[]).reduce(
              (a, b) => a + b,
              0
            )}
            info={
              "Actions the kernel judged during the diagnosis run. Fixes you " +
              "approve afterwards are gated again and appended, so the ledger " +
              "below is longer than this once anything has been applied."
            }
          />
        </Figures>
      </Stagger>

      {/* ─────────────────────────────── mandate */}
      <Stagger i={3}>
        <Card>
          <SectionHeader
            eyebrow="The authority the agent is operating under"
            title="Signed mandate"
            sub="The merchant saying, cryptographically: this agent may take these actions, up to these amounts, until this instant. The agent cannot widen it — it does not hold the signing key."
          />
          <div className="flex flex-wrap gap-1.5">
            {r.gate.reason_codes.map((c: string) => (
              <span key={c} className="chip-neutral">{c}</span>
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mt-4">
            {Object.entries(r.gate.decisions).map(([k, v]: any) => (
              <div key={k} className="card-raised p-3">
                <div className="eyebrow flex items-center">
                  {k.replace("_", " ")}
                  {k === "step_up" && <Info text={GLOSSARY.step_up} />}
                </div>
                <div
                  className={`text-2xl font-display font-bold mt-1 ${
                    k === "allow"
                      ? "text-mint"
                      : k === "step_up"
                      ? "text-amber"
                      : "text-rose"
                  }`}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Stagger>

      {/* ──────────────────── what that authority cost them */}
      <Stagger i={3}>
        <AuthorityPanel runId={params.runId} />
      </Stagger>

      {/* ─────────────────────────────── the chain */}
      {pendingStepUps > 0 && (
        <Stagger i={3}>
          <Panel tone="note">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <Eyebrow>Waiting on a person</Eyebrow>
                <h2 className="text-lg font-semibold mt-1">
                  {pendingStepUps} actions the kernel held for approval
                </h2>
                <p className="text-sm text-muted mt-1.5 max-w-2xl leading-relaxed">
                  Some are above the merchant&rsquo;s auto-execute limit; the
                  rest are actions the planner marked as needing sign-off,
                  which wait at any limit. Approving re-gates every one
                  individually — anything over the hard ceiling stays denied
                  however many times it is approved.
                </p>
                {/* The question this page kept inviting: why can this console
                    approve at all, when the same fix is emailed to the
                    merchant with its own buttons? Because they are two
                    different people, and the ledger says which. */}
                <p className="text-[12px] text-faint mt-2 max-w-2xl leading-relaxed">
                  This is Razorpay&rsquo;s console, so approving here is
                  recorded as <strong>the platform acting on the
                  merchant&rsquo;s behalf</strong> — an account manager
                  clearing a queue after a phone call. The same fix goes to
                  the merchant by email with its own signed buttons, and a
                  decision made there is recorded as theirs. Both paths run
                  the identical kernel; the ledger keeps them apart, inside
                  the hash.
                </p>
              </div>
              {/* Two ways out of this queue, side by side, because they are
                  the two different people the ledger distinguishes. Approving
                  is the platform acting for the merchant; sending is asking
                  the merchant to decide it themselves. */}
              <div className="shrink-0 flex flex-col items-end gap-2">
                <button
                  onClick={confirmAll}
                  disabled={confirming}
                  className="btn-primary"
                >
                  {confirming
                    ? "gating…"
                    : `Approve all ${pendingStepUps} on their behalf →`}
                </button>
                <SendToMerchant runId={params.runId} held={pendingStepUps} />
              </div>
            </div>

            {/* One at a time, for anyone who does not want to say yes to
                fifty payments in a single press. */}
            <div className="mt-4 border-t border-line pt-3">
              <Eyebrow>or decide them one at a time</Eyebrow>
              <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-line/60">
                {waiting.slice(0, 40).map((e: any) => {
                  const state = decided[e.txn_id];
                  return (
                    <div
                      key={e.txn_id}
                      className="flex items-center gap-3 py-2 font-mono text-[11px]"
                    >
                      {/* Deciding one payment is easier with the file on it
                          open, so the id is the way in rather than a label. */}
                      <Link
                        href={`/run/${params.runId}/journey?txn=${encodeURIComponent(e.txn_id)}`}
                        className="text-faint hover:text-ink w-40 truncate shrink-0
                                   transition-colors"
                        title="See everything that happened to this payment"
                      >
                        {e.txn_id}
                      </Link>
                      <span className="num w-20 text-right shrink-0">
                        {inr(e.proposed_action?.amount_paise ?? 0)}
                      </span>
                      <span className="text-muted truncate flex-1">
                        {String(e.gate_reason ?? "")
                          .replace(/_/g, " ")
                          .toLowerCase()}
                      </span>
                      {state ? (
                        <span
                          className={`shrink-0 text-[11px] ${
                            state === "approved"
                              ? "text-mint"
                              : state === "rejected"
                              ? "text-faint"
                              : "text-rose"
                          }`}
                        >
                          {state}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => decideOne(e.txn_id, "approve")}
                            disabled={deciding === e.txn_id}
                            className="px-2 py-0.5 rounded bg-brand text-brand-ink
                                       text-[11px] disabled:opacity-50"
                          >
                            {deciding === e.txn_id ? "…" : "approve"}
                          </button>
                          <button
                            onClick={() => decideOne(e.txn_id, "reject")}
                            disabled={deciding === e.txn_id}
                            className="px-2 py-0.5 rounded card-raised text-[11px]
                                       disabled:opacity-50"
                          >
                            reject
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {waiting.length > 40 && (
                <p className="text-[11px] text-faint mt-2">
                  showing 40 of {waiting.length} — use Approve all for the rest
                </p>
              )}
            </div>

            {confirmed && (
              <div className="card-raised p-3 mt-4 animate-rise">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={confirmed.executed ? "chip-measured" : "chip-neutral"}>
                    {confirmed.executed} executed
                  </span>
                  {confirmed.denied > 0 && (
                    <span className="chip-warn">{confirmed.denied} still denied</span>
                  )}
                  <span className={confirmed.chain_verified ? "chip-measured" : "chip-warn"}>
                    chain {confirmed.chain_verified ? "verified" : "BROKEN"}
                  </span>
                  <span className="num text-[11px] text-faint ml-auto">
                    +{confirmed.ledger_added} rows
                  </span>
                </div>
                <p className="text-sm text-muted mt-2">{confirmed.headline}</p>
              </div>
            )}
        </Panel>
        </Stagger>
      )}

      <Stagger i={4}>
        <Card className="!p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-line flex items-center gap-3 flex-wrap">
            <span className="eyebrow">hash-chained ledger</span>
            <a
              href={`/api/run/${params.runId}/ledger.csv`}
              className="ml-auto card-raised px-2.5 py-1 text-[11px]
                         hover:border-brand/40 transition-colors"
            >
              CSV
            </a>
            <div className="flex gap-1">
              {["all", "allow", "step_up", "deny"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                    filter === f
                      ? "bg-brand-soft text-brand border border-brand/30"
                      : "text-muted hover:text-ink border border-transparent"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto divide-y divide-line/40">
            {shown.slice(0, 80).map((e) => {
              const broken = brokenAt !== null && e.sequence >= brokenAt;
              const isOpen = openRow === e.sequence;
              return (
                <div key={e.sequence}>
                  <button
                    onClick={() => setOpenRow(isOpen ? null : e.sequence)}
                    className={`w-full text-left px-5 py-2.5 font-mono text-[11px]
                      transition-colors ${
                        broken
                          ? "bg-rose-soft"
                          : isOpen
                          ? "bg-brand-soft"
                          : "hover:bg-raised"
                      }`}
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-faint w-8">#{e.sequence}</span>
                      <span
                        className={
                          e.gate_decision === "allow"
                            ? "text-mint"
                            : e.gate_decision === "step_up"
                            ? "text-amber"
                            : "text-rose"
                        }
                      >
                        {e.gate_decision}
                      </span>
                      <span className="text-ink">{e.proposed_action.action_type}</span>
                      <span className="text-muted truncate max-w-[180px]">
                        {e.txn_id}
                      </span>
                      <span className="text-amber">
                        {inr(e.proposed_action.amount_paise)}
                      </span>
                      <span className="text-faint">{e.gate_reason}</span>
                      <span className="ml-auto text-muted">{e.outcome}</span>
                      {broken && <span className="chip-warn">invalid</span>}
                      <span className="text-brand w-3">{isOpen ? "-" : "+"}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-4 pt-1 bg-subtle animate-rise space-y-3">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <LedgerField k="payment" v={e.txn_id} />
                        <LedgerField
                          k="amount"
                          v={inr(e.proposed_action.amount_paise)}
                        />
                        <LedgerField k="action" v={e.proposed_action.action_type} />
                        <LedgerField k="outcome" v={e.outcome} />
                        <LedgerField k="written at" v={e.timestamp} />
                        <LedgerField
                          k="target bank"
                          v={e.proposed_action.target_bank ?? "-"}
                        />
                      </div>

                      <div>
                        <div className="eyebrow mb-1">why the kernel decided this</div>
                        <div className="text-xs text-muted leading-relaxed">
                          {REASON_TEXT[e.gate_reason] ?? e.gate_reason}
                        </div>
                      </div>

                      <div>
                        <div className="eyebrow mb-1">reason the agent gave</div>
                        <div className="text-xs text-muted leading-relaxed">
                          {e.proposed_action.reason}
                        </div>
                      </div>

                      <div className="card-raised p-3 space-y-1">
                        <div className="eyebrow">hash chain</div>
                        <div className="text-[10px] text-faint break-all">
                          prev &nbsp;{e.prev_hash}
                        </div>
                        <div className="text-[10px] text-brand break-all">
                          this &nbsp;{e.entry_hash}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length > 80 && (
              <div className="px-5 py-3 eyebrow">
                {shown.length - 80} more entries not shown
              </div>
            )}
            {shown.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-muted">
                no entries with that decision
              </div>
            )}
          </div>
        </Card>
      </Stagger>

      <Stagger i={5}>
        <Card>
          <SectionHeader
            eyebrow="Scope, stated rather than implied"
            title="What this chain does and does not prove"
          />
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="card-raised p-3">
              <div className="text-mint text-xs font-semibold mb-1">✓ proves integrity</div>
              <p className="text-xs text-muted leading-relaxed">
                The log has not been edited after the fact. Any change to any historical
                entry invalidates every hash after it, and you just checked that
                yourself.
              </p>
            </div>
            <div className="card-raised p-3">
              <div className="text-amber text-xs font-semibold mb-1">✗ does not prove authenticity</div>
              <Detail summary="what this chain does not prove">
                <p className="text-xs text-muted leading-relaxed">
                Signing the chain head with the merchant key would add that. It is
                deliberately out of scope, and stated here rather than left for someone
                to discover.
              </p>
              </Detail>
            </div>
          </div>
        </Card>
      </Stagger>

      {/* The part that outlives the demo. Worth stating plainly rather than
          leaving a reader to work out that the mandate machinery is separable
          from the diagnosis it happens to be wrapped around here. */}
      <Stagger i={5}>
        <Card>
          <SectionHeader
            eyebrow="The part that is not about revenue recovery"
            title="This kernel does not know what a payment is"
            sub="Everything above — the signed mandate, the ten checks, the hash chain, the actor on each entry — is a general answer to 'what may this agent do on someone's behalf, and who says so'. Recovery is the first thing it was pointed at, not the only thing it fits."
          />

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="card-raised p-4">
              <div className="eyebrow">what the merchant signs</div>
              <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
                An Ed25519-signed document naming permitted action types, an
                auto-execute limit, a hard ceiling, an attempt cap and an
                expiry. The agent has never held the signing key, so it cannot
                widen its own authority — it can only be refused by it.
              </p>
            </div>
            <div className="card-raised p-4">
              <div className="eyebrow">what the kernel does</div>
              <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
                Ten deterministic checks in a fixed order, no model call,
                evaluated per action rather than per batch. It returns allow,
                step up, or deny with a reason code — and a deny cannot be
                confirmed into an allow by anybody, which is the property that
                makes the limit a limit.
              </p>
            </div>
            <div className="card-raised p-4">
              <div className="eyebrow">what is left behind</div>
              <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
                One append-only hash-chained entry per decision, carrying who
                caused it. Refusals are recorded as carefully as executions,
                because a log that only kept the approvals would be marketing.
              </p>
            </div>
          </div>

          <Detail summary="why this shape, and what it deliberately is not">
            <p>
              The industry is converging on roughly this shape for agent
              payments — a mandate the human signs, a credential the agent
              presents, limits enforced by something the agent does not
              control, and an audit trail somebody can check afterwards. This
              is an independent implementation of that idea against
              Razorpay&rsquo;s own error taxonomy; it is not an integration
              with any published protocol, and describing it as one would be
              a claim nothing here can support.
            </p>
            <p>
              What it deliberately is not: a signing service. The mandate is
              generated by a separate tool, the private key never enters this
              process, and the module that prices a merchant&rsquo;s own
              limits can draft a looser mandate but cannot sign one — there is
              a test that greps it for the ability. An agent that could issue
              its own authority would be an agent with no authority at all.
            </p>
            <p>
              What would make it a service rather than a demo: the chain head
              signed with the merchant key, so the log proves authenticity and
              not only integrity; mandates issued and revoked through an API
              rather than a CLI; and the kernel behind a network boundary so
              the thing being limited and the thing doing the limiting are not
              the same process. All three are absent, on purpose, and named
              here rather than left to be discovered.
            </p>
          </Detail>
        </Card>
      </Stagger>
    </div>
  );
}

const REASON_TEXT: Record<string, string> = {
  OK_WITHIN_MANDATE:
    "Inside every limit the merchant signed - scope, amount, attempts and time. The agent ran it unattended.",
  OK_ESCALATION:
    "Flagging something for a human is always permitted and never counts against the attempt cap. Exhausting retries is precisely when a person should see it.",
  OK_MERCHANT_ACTION:
    "Permitted, but this is a configuration change only the merchant can make. The agent records the recommendation and stops.",
  STEP_UP_ABOVE_AUTO_LIMIT:
    "Permitted in kind, but the amount is above the auto-execute limit, so the merchant has to confirm before it runs.",
  STEP_UP_MERCHANT_APPROVAL_REQUESTED:
    "The planner itself asked for sign-off on this one.",
  DENY_AMOUNT_ABOVE_CEILING:
    "Above the hard ceiling in the signed mandate. The agent cannot widen its own authority, so this is refused outright - and still recorded.",
  DENY_ACTION_NOT_PERMITTED:
    "This action type is not among the ones the merchant authorised.",
  DENY_MAX_ATTEMPTS:
    "This payment has already been attempted the maximum number of times, counting retries the merchant made themselves.",
  DENY_OUTSIDE_RECOVERY_WINDOW:
    "The original failure is older than the 7-day recovery window.",
  DENY_MANDATE_EXPIRED: "The mandate has expired. Expiry is absolute.",
  DENY_MANDATE_NOT_YET_VALID: "The mandate is not in force yet.",
  DENY_SIGNATURE_INVALID:
    "The mandate signature did not verify, so everything is denied before any other check runs.",
  DENY_BANK_DEGRADED_HOLD:
    "This bank is under a degradation hold - retrying into it would just burn an attempt.",
};

function LedgerField({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="eyebrow">{k}</div>
      <div className="text-xs num mt-0.5 break-all">{v}</div>
    </div>
  );
}

function Sum({
  label,
  v,
  tone,
  info,
}: {
  label: string;
  v: any;
  tone?: "good" | "bad";
  info?: string;
}) {
  return (
    <div className="card p-4">
      <div className="eyebrow flex items-center">
        {label}
        {info && <Info text={info} />}
      </div>
      <div
        className={`text-2xl font-display font-bold mt-1 ${
          tone === "good" ? "text-mint" : tone === "bad" ? "text-rose" : "text-ink"
        }`}
      >
        {v}
      </div>
    </div>
  );
}

/**
 * Hand the queue back to the person it belongs to.
 *
 * The console can approve these, and the ledger records that as the platform
 * acting on the merchant's behalf. The other option — the one an account
 * manager actually wants most mornings — is to let the merchant decide, and
 * that meant navigating to a different page to find the mail panel.
 *
 * The report carries a signed approve and reject button per fix, so a
 * decision made from the inbox comes back through the same kernel and is
 * recorded as the merchant's own.
 */
function SendToMerchant({ runId, held }: { runId: string; held: number }) {
  const [to, setTo] = useState("");
  const [state, setState] = useState<
    { sent?: boolean; configured?: boolean; detail?: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/run/${runId}/email`)
      .then((r) => r.json())
      .then((d) => d.default_to && setTo((cur) => cur || d.default_to))
      .catch(() => {});
  }, [runId]);

  async function send() {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/run/${runId}/email/send?to=${encodeURIComponent(to)}`,
        { method: "POST" }
      );
      setState(await r.json());
    } catch {
      setState({ sent: false, configured: true, detail: "Could not reach the API." });
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary">
        Email the merchant to decide →
      </button>
    );

  return (
    <div className="panel p-3 w-[22rem] text-left">
      <div className="eyebrow">send the report, with signed buttons</div>
      <p className="text-[11px] text-faint mt-1 leading-relaxed">
        {held} held actions, each with an approve and a reject link only they
        can use. A decision made there is recorded as the merchant&rsquo;s.
      </p>
      <div className="flex items-center gap-1.5 mt-2">
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="merchant@example.com"
          className="field flex-1"
        />
        <button
          onClick={send}
          disabled={busy || !to}
          className="btn-primary shrink-0"
        >
          {busy ? "sending…" : "Send"}
        </button>
      </div>
      {state && (
        <div
          className={`text-[11px] mt-2 leading-relaxed ${
            state.sent ? "text-mint" : state.configured ? "text-rose" : "text-muted"
          }`}
        >
          {state.sent ? "✓ " : ""}
          {state.detail}
        </div>
      )}
      <div className="flex gap-3 mt-2">
        <a href={`/api/run/${runId}/email.eml`} className="text-[11px] text-brand">
          download .eml
        </a>
        <button
          onClick={async () => {
            setBusy(true);
            const r = await fetch("/api/email/verify", { method: "POST" });
            setState(await r.json());
            setBusy(false);
          }}
          className="text-[11px] text-muted hover:text-ink"
        >
          test credentials
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-[11px] text-faint hover:text-ink ml-auto"
        >
          close
        </button>
      </div>
    </div>
  );
}
