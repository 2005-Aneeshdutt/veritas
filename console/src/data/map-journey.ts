/**
 * Backend journey record -> the `JourneyCase` the existing screens already render.
 *
 * This file is the whole integration, because it is where the backend's
 * vocabulary becomes the UI's and every chance to lie about money lives.
 * Four rules it exists to enforce:
 *
 *   1. ALLOW IS NOT EXECUTION. Across the committed runs 169 allowed actions
 *      ended `exception` and 28 `escalated`. Claim state is therefore keyed off
 *      `final_outcome`, never off the gate decision alone.
 *
 *   2. EMPTY CHECKS ARE "NOT REACHED", NOT TWELVE FAILURES. A payment that no
 *      action was proposed for never reaches the kernel. Rendering that as
 *      0/12 would report the system refusing something it never considered.
 *
 *   3. NOTHING CLAIMS A GATEWAY. The journey payload does not record whether a
 *      run's retries were gateway-backed or synthetic, so gateway status is
 *      always UNCLAIMED here. `/api/recovery/{m}/{t}` carries a mode and can
 *      say more; history cannot, and guessing would fabricate the one claim
 *      this product exists to make unfakeable.
 *
 *   4. A STAGE THAT DID NOT HAPPEN IS NOT A STAGE THAT FAILED. A denial has no
 *      execution stamp, and that absence renders as `not-reached`, not as an
 *      error. Denial is the system working.
 */

import type { JourneyCheck, JourneyResponse, RunResponse } from "./api-types";
import { paise } from "@/domain/money";
import type {
  JourneyCase,
  JourneyStepSpec,
  PolicyCheck,
  SignalRow,
  StageId,
} from "@/domain/journey";
import type { ClaimState } from "@/domain/types";

/* ------------------------------------------------------------------ claim */

interface Claim {
  claim: ClaimState;
  amount: number;
  line: string;
  outcomeState: JourneyCase["outcome"]["state"];
}

/** The ledger's five outcomes, in the words the backend itself uses. */
const OUTCOME_WORD: Record<string, string> = {
  executed: "the agent acted",
  merchant_action: "waiting on a person",
  escalated: "flagged for a human",
  denied: "the kernel refused",
  exception: "could not be acted on",
};

export function deriveClaim(j: JourneyResponse): Claim {
  const decision = j.raw_entry?.gate_decision ?? "";
  const outcome = j.final_outcome;

  if (decision === "deny") {
    return {
      claim: "ABSTAINED",
      amount: 0,
      line:
        "Nothing is claimed. The mandate refused this action, so no money " +
        "moved and none is reported.",
      outcomeState: "ABSTAINED",
    };
  }
  if (outcome === "executed" && j.recovered_paise > 0) {
    return {
      claim: "MEASURED",
      amount: j.recovered_paise,
      line:
        "Marked against a result the engine could not see when it decided. " +
        "This is the only figure here that is money.",
      outcomeState: "MEASURED",
    };
  }
  if (outcome === "executed") {
    return {
      claim: "MEASURED",
      amount: 0,
      line: "The action was carried out and this payment did not convert. " + "Nothing is claimed.",
      outcomeState: "MEASURED",
    };
  }
  if (outcome === "merchant_action" || outcome === "escalated") {
    return {
      claim: "UNVERIFIED",
      amount: 0,
      line: "Nothing is claimed yet. This action is waiting on a person.",
      outcomeState: "UNVERIFIED",
    };
  }
  if (outcome === "exception") {
    return {
      claim: "UNVERIFIED",
      amount: 0,
      line:
        "Nothing is claimed. The action was permitted but could not be " +
        "carried out, so no money moved.",
      outcomeState: "UNVERIFIED",
    };
  }
  return {
    claim: "UNVERIFIED",
    amount: 0,
    line: "No action was recorded against this payment, so nothing is claimed.",
    outcomeState: "NOT REACHED",
  };
}

/* ------------------------------------------------------------------ checks */

/**
 * `compared` is one sentence naming both sides of the rule, e.g.
 * "Rs 24,816 against a ceiling of Rs 15,000". Split it where the backend's own
 * phrasing makes the halves unambiguous, and otherwise keep it whole rather
 * than guessing at a boundary.
 */
function splitCompared(compared: string): { evaluated?: string; threshold?: string } {
  for (const sep of [
    " against a ceiling of ",
    " against ",
    " is in ",
    " is before ",
    " is after ",
  ]) {
    const i = compared.indexOf(sep);
    if (i > 0) {
      return {
        evaluated: compared.slice(0, i).trim(),
        threshold: compared.slice(i + sep.length).trim(),
      };
    }
  }
  return { evaluated: compared };
}

function toPolicyCheck(c: JourneyCheck): PolicyCheck {
  const { evaluated, threshold } = splitCompared(c.compared);
  // `exactOptionalPropertyTypes` is on, so an absent half is omitted rather
  // than set to undefined -- the two are different types here.
  return {
    n: c.n,
    label: c.label,
    pass: c.status === "pass",
    detail: c.compared,
    ...(evaluated === undefined ? {} : { evaluated }),
    ...(threshold === undefined ? {} : { threshold }),
  };
}

/* ---------------------------------------------------------------- sequence */

/**
 * Which stages this payment actually reached.
 *
 * Stages absent from the returned list render as `not-reached`. A denial
 * reaches the ledger -- a refusal is written down, which is the point of it --
 * but never reaches execution.
 */
function buildSequence(j: JourneyResponse): JourneyStepSpec[] {
  const entry = j.raw_entry ?? {};
  const decision = entry.gate_decision ?? "";
  const hasPlan = Boolean(entry.proposed_action);
  const hasPolicy = j.checks.length > 0;
  const hasLedger = entry.sequence !== undefined && entry.sequence !== null;
  const executed = j.final_outcome === "executed";

  const steps: {
    stage: StageId;
    event: string;
    settles: JourneyStepSpec["settles"];
    status: JourneyStepSpec["status"];
    ms: number;
  }[] = [
    {
      stage: "payment",
      event: `PAYMENT_FAILED · ${j.error_code}`,
      settles: "completed",
      status: "READY",
      ms: 420,
    },
    {
      stage: "investigation",
      event: `CLASSIFIED · ${j.error_class}`,
      settles: "completed",
      status: "INVESTIGATING",
      ms: 620,
    },
    {
      stage: "diagnosis",
      event: `RESPONSIBLE · ${j.fault_label}`,
      settles: "completed",
      status: "DIAGNOSING",
      ms: 780,
    },
  ];

  if (hasPlan) {
    steps.push({
      stage: "plan",
      event: `PLAN_PROPOSED · ${entry.proposed_action?.action_type ?? ""}`,
      settles: "completed",
      status: "PLANNING",
      ms: 640,
    });
  }
  if (hasPolicy) {
    steps.push({
      stage: "policy",
      event: `POLICY_EVALUATED · ${entry.gate_reason ?? ""}`,
      settles: decision === "deny" ? "denied" : "completed",
      status: "EVALUATING POLICY",
      ms: 900,
    });
  }
  if (executed) {
    steps.push({
      stage: "execution",
      event: `RECOVERY_EXECUTED · ${entry.actor ?? "agent"}`,
      settles: "completed",
      status: "EXECUTING",
      ms: 820,
    });
  } else if (decision && decision !== "deny") {
    steps.push({
      stage: "execution",
      event: `NOT_EXECUTED · ${OUTCOME_WORD[j.final_outcome] ?? j.final_outcome}`,
      settles: "exception",
      status: "EXECUTING",
      ms: 700,
    });
  }
  if (decision) {
    steps.push({
      stage: "outcome",
      event: `OUTCOME · ${OUTCOME_WORD[j.final_outcome] ?? j.final_outcome}`,
      settles: decision === "deny" ? "abstained" : executed ? "completed" : "exception",
      status: "OBSERVING OUTCOME",
      ms: 700,
    });
  }
  if (hasLedger) {
    steps.push({
      stage: "ledger",
      event: `LEDGER_COMMITTED · entry #${entry.sequence}`,
      settles: "completed",
      status: "RECORDING LEDGER",
      ms: 560,
    });
    steps.push({
      stage: "evidence",
      event: "EVIDENCE_ASSEMBLED",
      settles: "completed",
      status: "ASSEMBLING EVIDENCE",
      ms: 520,
    });
    steps.push({
      stage: "prove",
      event: "PROOF_READY",
      settles: "completed",
      status: "PROOF READY",
      ms: 480,
    });
  }

  return steps.map((s) => ({
    stage: s.stage,
    ms: s.ms,
    event: s.event,
    settles: s.settles,
    status: s.status,
  }));
}

/* ------------------------------------------------------------------- main */

export function mapJourneyToCase(
  j: JourneyResponse,
  index: number,
  run?: RunResponse | null,
): JourneyCase {
  const entry = j.raw_entry ?? {};
  const action = entry.proposed_action;
  const decision = entry.gate_decision ?? "";
  const executed = j.final_outcome === "executed";
  const claim = deriveClaim(j);
  const checks = j.checks.map(toPolicyCheck);
  const stopper = j.checks.find((c) => c.status === "stopped");

  const kind: JourneyCase["kind"] =
    decision === "deny"
      ? "DENIAL"
      : claim.claim === "MEASURED" && claim.amount > 0
        ? "SUCCESS"
        : "UNVERIFIED";

  const investigation: SignalRow[] = [
    { label: "Bank", value: j.bank },
    { label: "Method", value: j.method.replace(/_/g, " ") },
    { label: "Hour", value: `${String(j.hour).padStart(2, "0")}:00` },
    { label: "Error code", value: j.error_code, tone: "warn" },
    { label: "Class", value: j.error_class.replace(/_/g, " ") },
    { label: "Responsible", value: j.fault_label },
  ];

  const dec = run?.report?.decomposition;
  const top = dec?.factors?.slice().sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0];

  return {
    id: j.txn_id,
    index,
    kind,
    kindLabel:
      kind === "DENIAL"
        ? "Refused by policy"
        : kind === "SUCCESS"
          ? "Recovered"
          : "Not established",
    title: j.code_explanation || j.fault_label || j.error_code,
    merchant: j.merchant_name,
    amount: paise(j.amount_paise),
    method: j.method.replace(/_/g, " "),
    paymentStatus: j.error_class.replace(/_/g, " ").toUpperCase(),
    failureReason: j.error_code,
    detectedAt: entry.timestamp ?? "",
    attempts: [],

    investigation,

    diagnosis: {
      gapPts: dec?.gap_pts ?? 0,
      observedSuccess: run?.report?.measured?.observed_success_pct ?? 0,
      topFactor: top
        ? {
            label: top.factor,
            effect: `${top.points >= 0 ? "+" : ""}${top.points.toFixed(2)} pts ± ${(top.mae ?? 0).toFixed(2)}`,
          }
        : { label: "unavailable", effect: "—" },
        // Strongest first, so the chart and the headline cannot disagree about
        // which factor is on top - they are now the same list.
        factors: (dec?.factors ?? [])
          .slice()
          .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
          .map((f) => ({
            id: f.factor,
            label: f.factor.replace(/_/g, " "),
            effect: f.points,
            uncertainty: f.mae ?? null,
            insideErrorBar: Boolean(f.inside_error_bar),
          })),
      reliability: dec
        ? dec.reliable
          ? "Decomposition reliable"
          : "Decomposition not reliable"
        : "unavailable",
      uncertainty: top
        ? top.inside_error_bar
          ? "Inside its own error bar — not acted on"
          : "Outside its own error bar"
        : "unavailable",
      actionability: j.code_next_steps || j.fault_label,
      note: j.code_explanation,
    },

    plan: {
      recommended: action?.action_type ?? "none proposed",
      channels: [],
      note: action?.reason ?? "No action was proposed for this payment.",
    },

    policy: {
      version: entry.gate_reason ?? "",
      checks,
      decision: decision === "deny" ? "DENY" : decision === "allow" ? "AUTO-ALLOW" : "ALLOW",
      ...(stopper ? { firstFailure: `Check ${stopper.n}: ${stopper.compared}` } : {}),
      note: checks.length
        ? `${checks.filter((c) => c.pass).length}/${checks.length} checks passed. ${j.final_reason}`
        : "NOT REACHED — no action was proposed, so the mandate was never consulted.",
    },

    execution: {
      state: executed
        ? "EXECUTED"
        : decision === "deny"
          ? "NOT REACHED"
          : j.final_outcome === "escalated"
            ? "ESCALATED"
            : j.final_outcome === "exception"
              ? "EXCEPTION"
              : "NOT EXECUTED",
      actor: entry.actor ?? "—",
      action: action?.action_type ?? "—",
      ...(entry.timestamp === undefined ? {} : { at: entry.timestamp }),
      note: executed
        ? `Carried out by ${entry.actor ?? "the agent"}.`
        : decision === "deny"
          ? "Not reached. The mandate refused the action, so nothing was executed."
          : `Not executed — ${OUTCOME_WORD[j.final_outcome] ?? j.final_outcome}.`,
    },

    outcome: {
      state: claim.outcomeState,
      amount: paise(claim.amount),
      note: j.truth_note || claim.line,
    },

    ledger: {
      entry: entry.sequence !== undefined ? `#${entry.sequence}` : "—",
      actor: entry.actor ?? "—",
      action: action?.action_type ?? "—",
      at: entry.timestamp ?? "",
      prevHash: entry.prev_hash ?? "",
      hash: j.hash_preimage ? j.hash_preimage.slice(0, 32) : "",
      verification:
        entry.sequence !== undefined
          ? "Written into the hash chain, with the actor inside the hash, before the outcome was known."
          : "No ledger entry: nothing was proposed for this payment.",
    },

    // The labels are a CONTRACT, not prose: `evidenceFor` in proof.ts looks
    // each one up in a fixed dictionary keyed by exactly these seven words.
    // Emitting friendlier names produced `undefined` there and took the whole
    // Evidence and Prove pages down with a non-null assertion hiding it from
    // the type checker.
    evidence: [
      {
        label: "Payment",
        status: "AVAILABLE",
        note: `${j.error_code} on ${j.bank}`,
      },
      {
        label: "Diagnosis",
        status: j.code_explanation ? "AVAILABLE" : "UNAVAILABLE",
        note: j.code_explanation || "No explanation was recorded.",
      },
      {
        label: "Policy",
        status: checks.length ? "VERIFIED" : "NOT REACHED",
        note: checks.length
          ? `${checks.length} rules recorded, each with both compared values`
          : "The kernel was never consulted for this payment",
      },
      {
        label: "Execution",
        status: executed ? "VERIFIED" : "NOT REACHED",
        note: executed
          ? `Carried out by ${entry.actor ?? "the agent"}`
          : `Not executed — ${OUTCOME_WORD[j.final_outcome] ?? j.final_outcome}`,
      },
      {
        label: "Outcome",
        status: executed ? "AVAILABLE" : "NOT REACHED",
        note: j.truth_note || claim.line,
      },
      {
        label: "Ledger",
        status: entry.sequence !== undefined ? "VERIFIED" : "NOT REACHED",
        note:
          entry.sequence !== undefined
            ? `Entry #${entry.sequence} in the hash chain`
            : "No ledger entry: nothing was proposed",
      },
      {
        // Never VERIFIED from history: the journey record does not say whether
        // a gateway stood behind the retry.
        label: "Gateway",
        status: "UNCLAIMED",
        note: "This record does not say whether a payment gateway stood behind the retry.",
      },
    ],

    gateway: "UNCLAIMED",
    claim: claim.claim,
    claimAmount: paise(claim.amount),
    claimLine: claim.line,

    sequence: buildSequence(j),
    unreachedStatus: "not-reached",
    finalStatus:
      decision === "deny" ? "STOPPED BY POLICY" : executed ? "PROOF READY" : "OPEN EXCEPTION",

    completion: {
      title:
        decision === "deny"
          ? "Refused by the mandate"
          : executed && claim.amount > 0
            ? "Recovery measured"
            : "Nothing established",
      tone: decision === "deny" ? "denied" : claim.amount > 0 ? "measured" : "unverified",
      rows: [
        { label: "Claim", value: claim.claim },
        {
          label: "Amount",
          value: claim.amount ? `₹${(claim.amount / 100).toLocaleString("en-IN")}` : "₹0",
        },
        { label: "Policy", value: entry.gate_reason ?? "not reached" },
        { label: "Outcome", value: OUTCOME_WORD[j.final_outcome] ?? j.final_outcome ?? "none" },
      ],
      cta: {
        label: decision === "deny" ? "See the rule that refused it" : "See the evidence",
        target: decision === "deny" ? "policy" : "evidence",
      },
    },
  };
}
