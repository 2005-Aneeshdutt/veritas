/**
 * Plain-English explanations, in one place.
 *
 * The engine is unusual enough that a number without a sentence next to it is
 * just a number. Every node, metric and jargon term the UI shows has an entry
 * here, so the interface teaches rather than asserts.
 */

export interface NodeDoc {
  title: string;
  kind: "llm" | "deterministic";
  /** One line, shown on the node card. */
  tagline: string;
  /** What actually happens, for someone reading it for the first time. */
  what: string;
  /** Why it is an LLM step, or pointedly why it is not. */
  why: string;
  /** What a reader should look at in the trace to check the claim. */
  inspect: string;
  model?: string;
}

export const NODE_DOCS: Record<string, NodeDoc> = {
  ingest: {
    title: "Ingest",
    kind: "deterministic",
    tagline: "Load the batch, pick the cohort",
    what:
      "Reads the merchant's month of payments, counts successes and failures, and looks up the MCC cohort this merchant will be compared against.",
    why:
      "No judgement involved — it is counting. A model here would add cost and a failure mode for nothing.",
    inspect:
      "Check `wilson_halfwidth_pts`. If the uncertainty on the success rate is large relative to the gap, everything downstream is on thin ice and the report says so.",
  },
  classify: {
    title: "Classify",
    kind: "llm",
    model: "Haiku 4.5",
    tagline: "What kind of failure is each error code?",
    what:
      "Sorts every failure into soft decline, hard decline, technical, or auth failure — and whether an agent acting alone could plausibly recover it.",
    why:
      "All 110 codes Razorpay publishes are hand-labelled and answered by a dictionary with zero API calls. The model exists for codes NOT in that taxonomy — gateways invent their own and new ones appear. That is why the eval holds out codes, not rows.",
    inspect:
      "`from_taxonomy` vs `from_llm` shows how many needed the model at all. Anything below 0.85 confidence routes to a human instead of being acted on.",
  },
  human_review: {
    title: "Human review",
    kind: "deterministic",
    tagline: "Low-confidence classifications stop here",
    what:
      "Any error code the classifier was unsure about is queued for a person rather than acted on automatically.",
    why:
      "A real branch, not a log line. When it is skipped you still see it — dashed and dimmed — because a node that vanishes from the trace looks identical to one that was never wired up.",
    inspect:
      "If this node is dashed, every classification cleared the 0.85 threshold.",
  },
  bank_health: {
    title: "Bank health",
    kind: "deterministic",
    tagline: "Join the merchant against real NPCI data",
    what:
      "For each bank the merchant's customers pay from, compares this merchant's failure rate against what NPCI publishes for that bank nationally.",
    why:
      "This is the join nobody makes. It is what separates “I have an SBI problem” from “everyone has an SBI problem right now”, and it needs no model — it is a lookup against 32 months of published tables.",
    inspect:
      "`worse_than_npci_baseline` lists banks where this merchant does materially worse than the country does on the same bank.",
  },
  decompose: {
    title: "Decompose",
    kind: "deterministic",
    tagline: "Split the gap across four causes, exactly",
    what:
      "Runs a Shapley-ordered Oaxaca-Blinder decomposition over all 16 coalitions of the four factors, attributing every point of the gap.",
    why:
      "Arithmetic with a checkable answer. The values provably sum to the total movement — the efficiency axiom — which is what makes converting them into rupees legitimate.",
    inspect:
      "All 16 coalition values are in the trace. Add up the four attributions and compare against v(N); they match to machine precision.",
  },
  hypothesise: {
    title: "Hypothesise",
    kind: "llm",
    model: "Sonnet 4.6",
    tagline: "Why, not just which",
    what:
      "Reads the decomposition, the NPCI bank table and the merchant profile, then names the underlying cause from a fixed list and explains it in the merchant's language.",
    why:
      "Shapley says the billing hour carries 3.2 points. It cannot say “your subscription cron fires at midnight and your customers' banks decline more in that window”. That step needs reasoning over context, and it is the one place a large model genuinely earns its cost.",
    inspect:
      "The full prompt and raw response are shown verbatim. The prompt forbids any number that is not in the supplied context — you can check that it obeyed.",
  },
  plan: {
    title: "Plan",
    kind: "deterministic",
    tagline: "Turn causes into typed actions — then withhold the weak ones",
    what:
      "Maps each cause to a concrete action, then applies the uncertainty gate: any attribution smaller than its own measured error is refused, not acted on.",
    why:
      "The model proposed these labels one node earlier; this step only maps them onto actions. It reads a closed enum, never a URL and never an API call, so a compromised model cannot smuggle an action that does not exist.",
    inspect:
      "`withheld_detail` is the interesting part — every fix the agent declined to make, and the measured error that stopped it.",
  },
  gate: {
    title: "Policy gate",
    kind: "deterministic",
    tagline: "Check every action against the signed mandate",
    what:
      "Verifies the merchant's Ed25519 signature, then checks scope, amount ceiling, attempt count, recovery window and expiry. Returns allow, step-up, or deny with a reason code.",
    why:
      "No model is consulted, ever. A model must never decide what it is allowed to do. A tampered mandate is rejected before scope or amount are even considered.",
    inspect:
      "`reason_codes` shows exactly which rule fired for each decision. This node is where the three-way branch happens.",
  },
  execute: {
    title: "Execute",
    kind: "deterministic",
    tagline: "Run the allowed actions, record every one",
    what:
      "Runs each approved action against the rail and appends it to a hash-chained ledger — including the ones that were denied.",
    why:
      "Denied actions are logged too. An audit trail that only records successes is a highlight reel.",
    inspect:
      "`chain_verified` recomputes every hash from genesis. The audit page lets you tamper with an entry and watch it break.",
  },
  report: {
    title: "Report",
    kind: "deterministic",
    tagline: "Separate what is measured from what is modelled",
    what:
      "Assembles the output into two buckets: measured against ground truth or cryptographically verified, versus modelled from stated assumptions.",
    why:
      "Enforced in the data structure, not left to the UI to remember. A rupee figure cannot end up on the measured side, because every rupee passes through an assumed retry-success model.",
    inspect:
      "Everything green is measured. Everything amber and hatched is projected. The wall between them is the whole argument.",
  },
};

/** Order the flow page walks through. */
export const FLOW_ORDER = [
  "ingest",
  "classify",
  "human_review",
  "bank_health",
  "decompose",
  "hypothesise",
  "plan",
  "gate",
  "execute",
  "report",
];

/** Short definitions for terms that appear as labels. */
export const GLOSSARY: Record<string, string> = {
  gap: "How far this merchant's success rate sits below what a well-run merchant in the same category achieves.",
  s_star:
    "The cohort's achievable success rate. An input from cohort data, not a discovery — and the attributions are provably invariant to its level.",
  residual:
    "The part of the gap the decomposition cannot account for. Always shown. A decomposition that sums to exactly 100% is hiding something.",
  process_gap:
    "Recoverable failures the merchant never retried. Computed directly from the batch rather than decomposed, because “no retry policy” is not a distribution over transactions.",
  mae: "Mean absolute error of this engine on this factor, measured across 200 merchants where the true answer was known by construction.",
  not_identified:
    "This merchant has effectively one value for this factor — so there is nothing to compare against, and the number is unmeasurable rather than small.",
  inside_error_bar:
    "The estimate is smaller than this engine's own measured error, so it cannot be told apart from zero. The agent refuses to act on it.",
  clamp_rate:
    "How often a single transaction's influence had to be capped. High values mean this merchant sits far from the cohort profile.",
  step_up:
    "Permitted by the mandate, but large enough that the merchant must confirm before it runs.",
  wilson:
    "A confidence interval that stays honest at small sample sizes, unlike the normal approximation.",
  measured:
    "Computed against ground truth, or verified cryptographically. Reproducible from the committed repo.",
  projected:
    "Modelled from stated assumptions. Shipped as a range across three calibrations, never as a single confident number.",
};

export const FACTOR_DOCS: Record<
  string,
  { label: string; short: string; fix: string }
> = {
  bank: {
    label: "Bank concentration",
    short:
      "Too much volume sits on issuing banks that decline more than the national mix does.",
    fix: "Enable multi-bank routing so failures spread instead of stacking.",
  },
  method: {
    label: "Payment method mix",
    short:
      "The rails this merchant collects on perform worse than the ones that work for this category.",
    fix: "Shift the default method or add a fallback rail at checkout.",
  },
  hour: {
    label: "Billing window",
    short:
      "Payments cluster in the 23:00–06:00 window, where bank declines run higher.",
    fix: "Move the billing cron into business hours.",
  },
  amount_band: {
    label: "Ticket size",
    short:
      "High-value payments fail at a higher rate than the rest of the book.",
    fix: "Route high-ticket payments differently and retry them on a longer horizon.",
  },
  process_gap: {
    label: "No soft-decline retry",
    short:
      "Recoverable failures were never retried at all — money left untouched on the table.",
    fix: "Retry soft declines on a funding-aware schedule.",
  },
  residual: {
    label: "Unexplained",
    short: "The decomposition cannot attribute this part of the gap.",
    fix: "Reported rather than redistributed.",
  },
};
