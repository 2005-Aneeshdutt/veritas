"use client";

import { useEffect, useState } from "react";
import { AuthorityPanel } from "@/components/AuthorityPanel";
import { BarStrip } from "@/components/BarStrip";
import { Card, Detail, Eyebrow, Info, Loading, SectionHeader, Stagger } from "@/components/ui";
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
  const pendingStepUps = entries.filter(
    (e: any) => e.gate_decision === "step_up" && e.outcome === "merchant_action"
  ).length;
  const m = r.measured;
  const shown = entries.filter(
    (e) => filter === "all" || e.gate_decision === filter
  );

  return (
    <div className="space-y-6">
      <Stagger>
        <div>
          <Eyebrow>Compliance and provenance</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">Audit trail</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            Every decision the agent made — allowed, escalated and denied — is
            hash-chained. Denied actions are recorded too; a trail of only successes is
            a highlight reel.
          </p>
        </div>
      </Stagger>

      {/* ─────────────────────────────── verification */}
      <Stagger i={1}>
        <BarStrip rec={rec} />
      </Stagger>

      <Stagger i={1}>
        <Card className={result?.ok === false ? "border-rose/40" : ""}>
          <SectionHeader
            eyebrow="Do not take my word for it"
            title="Verify the chain in your own browser"
            sub="This recomputes SHA-256 over the canonical encoding of every entry, client-side, exactly the way the Python ledger does. It is not reading a boolean off the server."
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => verify()}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-mint-soft text-mint border border-mint/40
                         text-sm font-semibold hover:bg-mint/25 transition-colors disabled:opacity-50"
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
        <div className="grid sm:grid-cols-4 gap-3">
          <Sum label="ledger entries" v={m.ledger_entries} />
          <Sum
            label="mandate violations"
            v={m.mandate_violations}
            tone={m.mandate_violations === 0 ? "good" : "bad"}
            info="Actions executed outside what the merchant cryptographically authorised. Must be zero."
          />
          <Sum
            label="chain"
            v={m.chain_verified ? "verified" : "broken"}
            tone={m.chain_verified ? "good" : "bad"}
          />
          <Sum
            label="gated at diagnosis"
            v={Object.values(r.gate.decisions).reduce((a: any, b: any) => a + b, 0)}
            info={
              "Actions the kernel judged during the diagnosis run. Fixes you " +
              "approve afterwards are gated again and appended, so the ledger " +
              "below is longer than this once anything has been applied."
            }
          />
        </div>
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
          <Card className="border-l-2 border-l-amber">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <Eyebrow>Waiting on you</Eyebrow>
                <h2 className="text-lg font-semibold mt-1">
                  {pendingStepUps} actions the kernel held for your approval
                </h2>
                <p className="text-sm text-muted mt-1.5 max-w-2xl leading-relaxed">
                  Some are above your auto-execute limit; the rest are actions
                  the planner marked as needing your sign-off, which wait for you
                  at any limit. Confirming re-gates every one individually —
                  anything over the hard ceiling stays denied however many times
                  you confirm it.
                </p>
              </div>
              <button
                onClick={confirmAll}
                disabled={confirming}
                className="btn-primary shrink-0"
              >
                {confirming ? "gating…" : `Confirm all ${pendingStepUps} →`}
              </button>
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
          </Card>
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
