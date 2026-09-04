"use client";

/**
 * One payment's whole custody chain, on one artifact.
 *
 * Every other screen shows one link: the gate shows the rules, the ledger
 * shows the hash, the funnel shows the money. A reader who wants to know
 * whether ONE payment's claim is good has to assemble that themselves, and
 * assembling it is exactly the work the product exists to have already done.
 *
 * So this is the assembled version -- payment, diagnosis, plan, policy,
 * execution, gateway, ledger, claim -- as a passport rather than a dashboard
 * card. The stamps are the point. Each stage says what happened and what it
 * is worth, and the last one says what may now be claimed.
 *
 * The rule the whole component is built around:
 *
 *   A STAGE THAT DID NOT HAPPEN IS NOT A STAGE THAT FAILED.
 *
 * A denied payment has no execution stamp and no gateway stamp, and those
 * absences are rendered as absences -- "not reached", in the neutral hue --
 * rather than as red failures. Denial is the system working. Rendering it as
 * damage would teach a reader to read correct behaviour as breakage.
 *
 * The second rule, which is the one that would actually cost money if broken:
 *
 *   NEVER STAMP A GATEWAY THAT WAS NEVER ASKED.
 *
 * A synthetic batch has no gateway behind it, and NOTHING IN THE JOURNEY
 * PAYLOAD SAYS WHICH KIND OF BATCH A RUN WAS. The first version of this
 * component reached for `/api/mode` to decide -- which is wrong in a way
 * worth recording, because it looked right: `/api/mode` describes the server
 * answering right now, not the run being displayed. A committed synthetic run
 * would have been stamped "Razorpay test mode" purely because credentials
 * happened to be configured on the day someone opened the page.
 *
 * So the gateway stamp claims nothing unless a caller passes a `mode` it
 * actually knows for that record -- `/api/recovery/{merchant}/{txn}` returns
 * one, and a live recovery view can pass it. Journey-sourced passports pass
 * nothing and read "not asked". Uncertainty resolves toward claiming less,
 * because the failure that costs something here is the other one.
 */

import { useEffect, useState } from "react";

import { Claim, CLAIM_MEANS, Tag } from "./ui";
import { inr } from "@/lib/types";

export interface Check {
  n: number;
  key: string;
  label: string;
  compared: string;
  status: "pass" | "stopped" | "not_reached";
}

export interface Journey {
  found: boolean;
  txn_id: string;
  run_id: string;
  merchant_name: string;
  amount_paise: number;
  bank: string;
  method: string;
  hour: number;
  error_code: string;
  error_class: string;
  code_explanation: string;
  fault_label: string;
  fault_owner: string;
  final_outcome: string;
  final_reason: string;
  recovered_paise: number;
  would_have_converted: boolean;
  truth_note: string;
  checks: Check[];
  mandate: Record<string, unknown>;
  raw_entry: Record<string, unknown>;
  hash_preimage: string;
}

type StampTone = "good" | "warn" | "bad" | "idle";

interface Stamp {
  key: string;
  title: string;
  line: string;
  tone: StampTone;
  claim?: Claim;
  facts?: [string, string][];
}

const TONE: Record<StampTone, { dot: string; rail: string; word: string }> = {
  good: { dot: "bg-mint", rail: "border-l-mint/60", word: "text-mint" },
  warn: { dot: "bg-amber", rail: "border-l-amber/60", word: "text-amber" },
  bad: { dot: "bg-rose", rail: "border-l-rose/60", word: "text-rose" },
  idle: { dot: "bg-faint/50", rail: "border-l-edge", word: "text-faint" },
};

/* ------------------------------------------------------------------ stamps */

/**
 * The gateway stamp, which is the one with teeth.
 *
 * `mode` is the run's own label. In a synthetic batch nothing was ever asked
 * of a gateway, so the honest stamp is "not asked" -- never "verified", and
 * never red either, because nothing failed.
 */
function gatewayStamp(j: Journey, mode: string | null): Stamp {
  const executed = j.final_outcome === "executed";
  const live = mode === "razorpay_test";

  if (!executed) {
    return {
      key: "gateway",
      title: "Gateway",
      line: "Not reached. Nothing was executed, so no gateway was asked.",
      tone: "idle",
    };
  }
  if (!live) {
    return {
      key: "gateway",
      title: "Gateway",
      line:
        "Not claimed. This record does not say whether a payment gateway " +
        "stood behind the retry, so no gateway outcome is reported for it.",
      tone: "idle",
      claim: "unverified",
    };
  }
  return {
    key: "gateway",
    title: "Gateway",
    line: "Executed against Razorpay test mode. See the outcome events for " +
      "the confirmed state of this payment.",
    tone: "warn",
    claim: "observed",
  };
}

/**
 * The ledger's own outcome vocabulary, kept in the words the rest of the
 * product already uses. An ALLOW is not an execution: 169 allowed actions in
 * the committed runs ended as `exception` and 28 as `escalated`, so keying
 * this off the gate decision alone would report work that never happened.
 */
const OUTCOME_WORD: Record<string, string> = {
  executed: "the agent acted",
  merchant_action: "waiting on a person",
  escalated: "flagged for a human",
  denied: "the kernel refused",
  exception: "could not be acted on",
};

const EXECUTION_LINE: Record<string, string> = {
  denied: "Not executed. The mandate refused the action.",
  merchant_action:
    "Not executed. This action needs the merchant, and is waiting on them.",
  escalated: "Not executed. It was flagged for a human instead.",
  exception:
    "Not executed. The action was permitted but could not be carried out.",
};

/** What may honestly be claimed at the end of this chain. */
function claimStamp(j: Journey): Stamp {
  const decision = String(j.raw_entry?.gate_decision ?? "");
  const outcome = j.final_outcome;

  if (outcome && outcome !== "executed" && decision !== "deny") {
    const waiting = outcome === "merchant_action" || outcome === "escalated";
    return {
      key: "claim",
      title: "Claim",
      line: waiting
        ? "Nothing is claimed yet. This action is waiting on a person."
        : "Nothing is claimed. The action was permitted but never carried " +
          "out, so no money moved.",
      tone: waiting ? "warn" : "idle",
      claim: "unverified",
      facts: [["recovered", inr(0)]],
    };
  }

  if (decision === "deny") {
    return {
      key: "claim",
      title: "Claim",
      line:
        "Nothing is claimed. The mandate refused this action, so no money " +
        "was moved and none is reported.",
      tone: "idle",
      claim: "abstained",
      facts: [["recovered", inr(0)]],
    };
  }
  if (decision === "step_up") {
    return {
      key: "claim",
      title: "Claim",
      line:
        "Nothing is claimed yet. This action needs a person, and none has " +
        "acted on it.",
      tone: "warn",
      claim: "unverified",
      facts: [["recovered", inr(0)]],
    };
  }
  if (j.recovered_paise > 0) {
    return {
      key: "claim",
      title: "Claim",
      line:
        "Marked against a result the engine could not see when it decided. " +
        "This is the only figure on this passport that is money.",
      tone: "good",
      claim: "measured",
      facts: [["recovered", inr(j.recovered_paise)]],
    };
  }
  return {
    key: "claim",
    title: "Claim",
    line:
      "The action was permitted and did not recover this payment. Nothing " +
      "is claimed.",
    tone: "idle",
    claim: "measured",
    facts: [["recovered", inr(0)]],
  };
}

function buildStamps(j: Journey, mode: string | null): Stamp[] {
  const entry = j.raw_entry ?? {};
  const action = (entry.proposed_action ?? {}) as Record<string, unknown>;
  const decision = String(entry.gate_decision ?? "");
  const passed = j.checks.filter((c) => c.status === "pass").length;
  const stopper = j.checks.find((c) => c.status === "stopped");

  const gateTone: StampTone =
    decision === "allow" ? "good" : decision === "deny" ? "bad" : "warn";
  const gateWord =
    decision === "allow"
      ? "AUTO-ALLOW"
      : decision === "deny"
      ? "DENY"
      : decision === "step_up"
      ? "HOLD"
      : "NOT EVALUATED";

  const stamps: Stamp[] = [
    {
      key: "payment",
      title: "Payment",
      line: `${j.error_code} on ${j.bank} via ${j.method}.`,
      tone: "bad",
      facts: [
        ["amount", inr(j.amount_paise)],
        ["class", j.error_class],
        ["hour", String(j.hour).padStart(2, "0") + ":00"],
      ],
    },
    {
      key: "diagnosis",
      title: "Diagnosis",
      line: j.code_explanation || j.fault_label,
      tone: "idle",
      facts: [["responsible", j.fault_label]],
    },
  ];

  if (decision) {
    stamps.push({
      key: "plan",
      title: "Recovery plan",
      line: String(action.reason ?? "No reason recorded."),
      tone: "idle",
      claim: "projected",
      facts: [
        ["action", String(action.action_type ?? "-")],
        ["on", inr(Number(action.amount_paise ?? 0))],
      ],
    });
    stamps.push({
      key: "policy",
      title: "Policy kernel",
      line: stopper
        ? `Stopped at check ${stopper.n}: ${stopper.compared}`
        : `All ${passed} checks passed. ${j.final_reason}`,
      tone: gateTone,
      facts: [
        ["decision", gateWord],
        ["checks", `${passed}/${j.checks.length} passed`],
      ],
    });
    stamps.push({
      key: "execution",
      title: "Execution",
      line:
        j.final_outcome === "executed"
          ? `Carried out by ${String(entry.actor ?? "unknown")}.`
          : EXECUTION_LINE[j.final_outcome] ??
            "Not executed. No outcome was recorded for this action.",
      tone: j.final_outcome === "executed" ? "good" : "idle",
      facts: [
        ["outcome", OUTCOME_WORD[j.final_outcome] ?? j.final_outcome ?? "none"],
        ...(j.final_outcome === "executed"
          ? ([["at", String(entry.timestamp ?? "-").slice(11, 19)]] as [
              string,
              string
            ][])
          : []),
      ],
    });
    stamps.push(gatewayStamp(j, mode));
    stamps.push({
      key: "ledger",
      title: "Ledger",
      line:
        "Written into the hash chain, with the actor inside the hash, before " +
        "the outcome was known.",
      tone: "good",
      claim: "verified",
      facts: [
        ["entry", `#${String(entry.sequence ?? "-")}`],
        ["prev", String(entry.prev_hash ?? "").slice(0, 12) || "-"],
      ],
    });
    stamps.push(claimStamp(j));
  } else {
    stamps.push({
      key: "policy",
      title: "Policy kernel",
      line:
        "Not reached. No action was proposed for this payment, so the " +
        "mandate was never consulted.",
      tone: "idle",
    });
    stamps.push({
      key: "claim",
      title: "Claim",
      line: "Nothing was attempted and nothing is claimed.",
      tone: "idle",
      claim: "abstained",
      facts: [["recovered", inr(0)]],
    });
  }
  return stamps;
}

/* --------------------------------------------------------------- component */

export function RecoveryPassport({
  journey,
  /** Only pass this when the record itself carries a mode. See the note above. */
  mode = null,
  onOpen,
}: {
  journey: Journey;
  mode?: string | null;
  onOpen?: () => void;
}) {
  const j = journey;
  const stamps = buildStamps(j, mode);
  const final = stamps[stamps.length - 1];

  return (
    <section
      className="card p-0 overflow-hidden"
      aria-label={`Recovery passport for ${j.txn_id}`}
    >
      <header className="px-5 py-4 border-b border-line flex flex-wrap
                         items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">Recovery passport</p>
          <p className="text-2xl font-semibold tabular-nums mt-0.5">
            {inr(j.amount_paise)}
          </p>
          <p className="font-mono text-[12px] text-muted mt-0.5">{j.txn_id}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Claim</p>
          <div className="mt-1 flex items-center gap-2 justify-end">
            {final.claim && <Tag kind={final.claim} />}
            <span className={`text-sm font-semibold ${TONE[final.tone].word}`}>
              {final.facts?.[0]?.[1] ?? "—"}
            </span>
          </div>
        </div>
      </header>

      <ol className="divide-y divide-line">
        {stamps.map((s, i) => (
          <li
            key={s.key}
            className={`px-5 py-3.5 border-l-2 ${TONE[s.tone].rail}`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                  TONE[s.tone].dot
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-faint tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[13px] font-semibold">{s.title}</h3>
                  {s.claim && <Tag kind={s.claim} />}
                </div>
                <p className="text-[13px] text-muted mt-1 leading-relaxed">
                  {s.line}
                </p>
                {s.facts && (
                  <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                    {s.facts.map(([k, v]) => (
                      <div key={k} className="flex items-baseline gap-1.5">
                        <dt className="eyebrow">{k}</dt>
                        <dd className="font-mono text-[12px] tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <footer className="px-5 py-3 border-t border-line flex flex-wrap
                         items-center justify-between gap-3">
        <p className="text-[12px] text-faint">
          {final.claim ? CLAIM_MEANS[final.claim] : ""}
        </p>
        {onOpen && (
          <button className="btn-quiet text-[12px]" onClick={onOpen}>
            View full passport →
          </button>
        )}
      </footer>
    </section>
  );
}

/* ------------------------------------------------------------------ loader */

/** Fetches one journey and renders its passport. Used where only an id is held. */
export function RecoveryPassportFor({
  runId,
  txnId,
  mode,
}: {
  runId: string;
  txnId: string;
  mode?: string | null;
}) {
  const [j, setJ] = useState<Journey | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setJ(null);
    setErr(null);
    fetch(`/api/run/${runId}/journey/${encodeURIComponent(txnId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Journey) => {
        if (!live) return;
        if (!d.found) setErr("No record of this payment in this run.");
        else setJ(d);
      })
      .catch(() => live && setErr("Could not load this payment's record."));
    return () => {
      live = false;
    };
  }, [runId, txnId]);

  if (err) return <div className="card p-5 text-[13px] text-muted">{err}</div>;
  if (!j) return <div className="card p-5 text-[13px] text-faint">Loading…</div>;
  return <RecoveryPassport journey={j} mode={mode} />;
}
