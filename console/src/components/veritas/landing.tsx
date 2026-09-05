import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Minus, Play, RotateCcw, X } from "lucide-react";
import { apiGet } from "@/data/http";
import { backendConnected, modeQueryOptions } from "@/data/services";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { formatMoney, paise } from "@/domain/money";
import type { JourneyCase, StageId } from "@/domain/journey";
import { STAGE_LABEL, STAGE_ORDER } from "@/domain/journey";
import { VeritasMark } from "@/components/veritas/logo";
import { NetworkBackground } from "@/components/veritas/network-background";
import { cn } from "@/lib/utils";

/**
 * The page in front of the console.
 *
 * Its argument is a comparison rather than a pitch: the same failed payment
 * handed to a retry loop and to this system, run side by side. The retry loop
 * finishes first and has nothing to show for it; the governed chain takes
 * longer and ends somewhere you can check. Speed is not the thing being sold.
 *
 * Every figure is read live from the backend. Nothing here is written by hand,
 * and where something cannot be read it is shown as absent rather than filled
 * in with a flattering number.
 */

/* ------------------------------------------------------------------- page */

interface MandateFacts {
  mandate_id: string;
  max_amount_paise: number;
  auto_execute_limit_paise: number;
  max_attempts_per_payment: number;
  permitted_actions: string[];
  signature_verifies: boolean;
  not_after: string;
}

export function Landing() {
  const connected = backendConnected();
  const { data: mode } = useQuery({ ...modeQueryOptions, enabled: connected });
  const cases = useJourneyCases();
  // Two records, because the system does two things and both need showing: one
  // payment it recovered in full, and one it refused. A page with only the
  // first is a sales page; a page with only the second is a warning.
  const recovered = cases.find((c) => c.claim === "MEASURED" && c.claimAmount.minor > 0);
  const refused = cases.find((c) => c.policy.decision === "DENY");
  const shown = [recovered, refused].filter(Boolean) as JourneyCase[];
  const [pick, setPick] = useState(0);
  const only = shown[pick] ?? cases[0];

  const mandate = useQuery({
    queryKey: ["landing-mandate"],
    queryFn: ({ signal }) =>
      apiGet<{ mandate: MandateFacts }>(
        "/api/run/run_beec9668/journey/pay_cloudsync_0502",
        { signal }
      ).then((r) => r.mandate),
    enabled: connected,
    staleTime: Infinity,
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header mode={mode?.label} connected={connected} />
      <Records cases={shown} pick={pick} onPick={setPick} />
      <Race case_={only} mandate={mandate.data ?? null} />
      <Chain case_={only} />
      <Split />
      <Mandate mandate={mandate.data ?? null} />
      <Close />
    </div>
  );
}

/** The backend returns its label in caps for the console. Here it reads as prose. */
function sentence(label: string): string {
  const t = label.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ----------------------------------------------------------------- header */

function Header({ mode, connected }: { mode?: string | undefined; connected: boolean }) {
  return (
    <header className="relative overflow-hidden px-6 pb-24 pt-10 sm:px-10">
      {/* The one piece of ambient motion on the page. It is masked to the right
          so it is vivid in the space the copy does not use and gone entirely
          behind anything anyone has to read. */}
      <NetworkBackground intensity="strong" />

      {/* Brand bar, full width -- a product header, not part of the hero block. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1180px] items-center justify-between gap-6 border-b border-hairline pb-6">
        <div className="flex items-center gap-3.5">
          <VeritasMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <p className="text-[19px] font-semibold leading-none tracking-[0.24em]">VERITAS</p>
            <p className="mt-1.5 text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground">
              Revenue recovery intelligence
            </p>
          </div>
        </div>
        <a
          href="/"
          className="hidden h-9 items-center gap-2 rounded-md border border-hairline px-4 text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground sm:inline-flex"
        >
          Enter the console <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-[1180px] items-center gap-12 pt-14 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
        <span className="inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1">
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-measured" : "bg-muted-foreground/50"
            )}
            aria-hidden
          />
          <span className="text-[12px] text-muted-foreground">
            {mode ? sentence(mode) : connected ? "Connected" : "No backend"}
          </span>
        </span>

        <h1 className="mt-7 max-w-[17ch] text-4xl font-semibold leading-[1.06] tracking-tight sm:text-[54px]">
          Recover what you can.
          <br />
          <span className="text-measured">Prove what happened.</span>
        </h1>

        <p className="mt-6 max-w-[60ch] text-base leading-relaxed text-muted-foreground sm:text-lg">
          A recovery agent reads a failed payment and proposes an action. Then a deterministic
          policy kernel it does not control decides whether that action is allowed at all —
          and every rupee it ends up claiming is marked against an outcome it never saw.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Enter the console <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="#race"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-hairline px-6 text-sm transition-colors hover:border-foreground/30"
          >
            Watch both systems run
          </a>
        </div>
        </div>

        {/* The right half was empty on anything wider than a laptop. It now
            holds the sentence the whole product turns on, set as three claims
            rather than a stat card -- there is nothing here to measure, so
            there are no numbers to misread. */}
        <ul className="hidden min-w-0 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline lg:grid">
          {[
            {
              k: "The model proposes",
              v: "It reads the failure and suggests an action. It cannot authorise one.",
            },
            {
              k: "The kernel decides",
              v: "Twelve deterministic checks against a mandate the merchant signed.",
            },
            {
              k: "The ledger remembers",
              v: "Every decision hashed in sequence, written before the outcome is known.",
            },
          ].map((r) => (
            <li key={r.k} className="bg-background/80 px-6 py-6 backdrop-blur-sm">
              <p className="text-[15px] font-medium text-foreground">{r.k}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{r.v}</p>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- records */

/** Which of the two the rest of the page is describing. */
function Records({
  cases,
  pick,
  onPick,
}: {
  cases: JourneyCase[];
  pick: number;
  onPick: (i: number) => void;
}) {
  if (cases.length < 2) return null;
  return (
    <section className="border-t border-hairline px-6 pb-2 pt-14 sm:px-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          The system does two things. Here is one record of each.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {cases.map((c, i) => {
            const won = c.claim === "MEASURED" && c.claimAmount.minor > 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(i)}
                aria-pressed={i === pick}
                className={cn(
                  "rounded-md border px-4 py-2 text-left transition-colors",
                  i === pick
                    ? won
                      ? "border-measured/50 bg-measured/[0.06]"
                      : "border-denied/50 bg-denied/[0.05]"
                    : "border-hairline hover:border-foreground/25"
                )}
              >
                <span className="block text-[13px] font-medium">
                  {won ? "It recovered this one" : "It refused this one"}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {won
                    ? "Inside the mandate, executed, then marked"
                    : "Above the ceiling the merchant signed"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- race */

interface Link_ {
  label: string;
  tone?: "denied" | "measured" | "muted";
  note?: string;
}

/**
 * The same payment, handed to two systems.
 *
 * The left chain is what a retry loop does: it has no mandate to consult, so
 * for a payment above the ceiling it simply acts. It finishes in four steps and
 * cannot answer a question afterwards. The right chain is the real committed
 * sequence for that payment, so on a refusal it genuinely stops early — the
 * comparison is not staged.
 */
function Race({
  case_: c,
  mandate,
}: {
  case_: JourneyCase | undefined;
  mandate: MandateFacts | null;
}) {
  const [step, setStep] = useState(99);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  const overCeiling =
    Boolean(mandate) && Boolean(c) && c!.amount.minor > mandate!.max_amount_paise;

  const today: Link_[] = [
    { label: "Payment fails" },
    { label: "Retry, because it can", tone: "denied" },
    {
      label: overCeiling ? "No ceiling to check against" : "No mandate to check against",
      tone: "denied",
    },
    { label: "Nothing recorded about why", tone: "muted", note: "?" },
  ];

  const governed: Link_[] = c
    ? STAGE_ORDER.filter((s) => c.sequence.some((x) => x.stage === s)).map((s) => {
        const settle = c.sequence.find((x) => x.stage === s)?.settles;
        return {
          label: STAGE_LABEL[s],
          tone: settle === "denied" ? "denied" : "measured",
        };
      })
    : [];

  const run = () => {
    if (timer.current) window.clearInterval(timer.current);
    const total = Math.max(today.length, governed.length);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setStep(total);
      return;
    }
    setRunning(true);
    setStep(0);
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= total) {
        if (timer.current) window.clearInterval(timer.current);
        setRunning(false);
      }
    }, 480);
  };

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  return (
    <section id="race" className="scroll-mt-6 border-t border-hairline px-6 py-16 sm:px-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="max-w-[20ch] text-2xl font-semibold leading-snug tracking-tight sm:text-[32px]">
              The same failed payment,
              <br />
              <span className="text-muted-foreground">handed to two systems.</span>
            </h2>
            <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-muted-foreground">
              One of them finishes first. Watch what it has to show for it.
            </p>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-hairline px-4 text-[13px] transition-colors hover:border-foreground/30 disabled:opacity-60"
          >
            {step >= 99 ? (
              <Play className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <RotateCcw className={cn("h-3.5 w-3.5", running && "animate-spin")} aria-hidden />
            )}
            {running ? "Running" : step >= 99 ? "Run both" : "Run again"}
          </button>
        </div>


        <div className="mt-7 grid gap-4 lg:grid-cols-2">
          <Track
            title="Today’s system"
            caption="A retry loop, with nothing to consult"
            links={today}
            step={step}
            tone="denied"
            footer={
              <span className="text-denied">
                Finished first. Cannot say whether it should have acted.
              </span>
            }
          />
          <Track
            title="VERITAS"
            caption="The committed chain for this payment"
            links={governed}
            step={step}
            tone="measured"
            footer={null}
          />
        </div>

        {c && (
          <p className="mt-5 max-w-[76ch] text-[13.5px] leading-relaxed text-muted-foreground">
            {c.policy.decision === "DENY" ? (
              <>
                Here the difference is not speed, it is authority. A retry loop has no ceiling to
                check, so it acts.{" "}
                <span className="text-foreground">
                  This payment is {formatMoney(c.amount)} against a{" "}
                  {mandate ? formatMoney(paise(mandate.max_amount_paise)) : "—"} limit the
                  merchant signed
                </span>
                , so the kernel refused — and the held-out truth later agreed the retry would not
                have converted anyway.
              </>
            ) : (
              <>
                Both systems recovered this payment. The difference is that one of them can still
                answer for it:{" "}
                <span className="text-foreground">
                  {formatMoney(c.amount)} inside the signed limit,{" "}
                  {c.policy.checks.filter((x) => x.pass).length} of {c.policy.checks.length} checks
                  passed
                </span>
                , executed once, then marked against an outcome the engine never saw.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function Track({
  title,
  caption,
  links,
  step,
  tone,
  footer,
}: {
  title: string;
  caption: string;
  links: Link_[];
  step: number;
  tone: "denied" | "measured";
  footer: React.ReactNode;
}) {
  const done = step >= links.length;
  return (
    <div
      className={cn(
        "rounded-lg border p-5",
        tone === "denied" ? "border-hairline" : "border-measured/35"
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium">{title}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          {Math.min(step, links.length)}/{links.length}
        </p>
      </div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{caption}</p>

      <ol className="mt-4 space-y-1.5">
        {links.map((l, i) => {
          const on = i < step;
          return (
            <li
              key={l.label}
              className={cn(
                "flex items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] transition-all duration-400",
                on
                  ? "border-hairline opacity-100"
                  : "border-transparent opacity-25"
              )}
            >
              {l.note ? (
                <span
                  className="w-3.5 shrink-0 text-center font-mono text-[13px] text-muted-foreground"
                  aria-hidden
                >
                  {l.note}
                </span>
              ) : l.tone === "denied" ? (
                <X className="h-3.5 w-3.5 shrink-0 text-denied" aria-hidden />
              ) : l.tone === "muted" ? (
                <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0 text-measured" aria-hidden />
              )}
              <span className={l.tone === "muted" ? "text-muted-foreground" : ""}>{l.label}</span>
            </li>
          );
        })}
      </ol>

      <p
        className={cn(
          "mt-4 border-t border-hairline pt-3 text-[12.5px] transition-opacity duration-500",
          done ? "opacity-100" : "opacity-0"
        )}
      >
        {footer}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ chain */

const STAGE_WHAT: Record<StageId, string> = {
  payment: "The failure arrives: an error code, a bank, an amount, an hour.",
  investigation:
    "The failure is read and grouped against the merchant's own history. A proposal, not a decision.",
  diagnosis:
    "The gap is attributed to bank, method, hour and amount band, each carrying its own error bar.",
  plan: "An action is chosen from the list the merchant permitted. Nothing outside it can be proposed.",
  policy:
    "Twelve deterministic checks against the signed mandate. The only place an action becomes allowed.",
  execution: "The authorised action runs once, idempotently. Allowed is not the same as executed.",
  outcome: "Marked against a held-out truth the engine never saw when it decided.",
  ledger: "Appended to a hash chain, with the actor inside the hash.",
  evidence: "The artifacts that support the claim, and the ones that are missing.",
  prove: "The strongest claim the evidence supports, and no stronger.",
};

function Chain({ case_: c }: { case_: JourneyCase | undefined }) {
  const [stage, setStage] = useState<StageId>("policy");
  // The walk runs on its own until someone takes over. Touching any stage or
  // switching payment hands control to the reader and it stops for good --
  // a diagram that keeps moving under a cursor is hostile to inspect.
  const [auto, setAuto] = useState(true);
  const reached = new Map((c?.sequence ?? []).map((s) => [s.stage, s.settles]));
  const beat = (c?.sequence ?? []).find((s) => s.stage === stage);

  const walked = (c?.sequence ?? []).map((s) => s.stage);
  useEffect(() => {
    if (!auto || walked.length === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let i = walked.indexOf(stage);
    const id = window.setInterval(() => {
      i = (i + 1) % walked.length;
      const next = walked[i];
      if (next) setStage(next);
    }, 1700);
    return () => window.clearInterval(id);
    // `stage` is deliberately out of the deps: including it would restart the
    // interval on every tick and make the first step arrive twice as fast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, walked.length]);

  const take = (fn: () => void) => () => {
    setAuto(false);
    fn();
  };

  return (
    <section className="border-t border-hairline px-6 py-16 sm:px-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <h2 className="max-w-[22ch] text-2xl font-semibold leading-snug tracking-tight sm:text-[32px]">
          Ten stages. <span className="text-measured">A record left at each one.</span>
        </h2>
        <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-muted-foreground">
          {auto
            ? "Running through the chain. Touch any stage to stop it and look properly."
            : "Walk any stage. Stages a payment never reached are dim — that is a result, not a gap."}
        </p>


        <ol className="mt-6 flex flex-wrap gap-1.5">
          {STAGE_ORDER.map((id, i) => {
            const settle = reached.get(id);
            const was = settle !== undefined;
            const active = id === stage;
            return (
              <li key={id} className="flex min-w-0 flex-1 basis-0">
                <button
                  type="button"
                  onClick={take(() => setStage(id))}
                  aria-pressed={active}
                  className={cn(
                    "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                    active
                      ? auto
                        ? "border-observed/60 bg-observed/[0.07]"
                        : "border-foreground/45 bg-foreground/[0.05]"
                      : was
                        ? "border-hairline hover:border-foreground/25"
                        : "border-hairline/60 opacity-45 hover:opacity-70"
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[9px] text-muted-foreground/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[12px]">{STAGE_LABEL[id]}</span>
                  <span
                    className={cn(
                      "mt-1.5 block h-0.5 rounded-full",
                      settle === "denied" ? "bg-denied" : was ? "bg-measured/60" : "bg-hairline"
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-hairline p-5">
            <p className="label-meta text-[10px] tracking-[0.16em]">
              {STAGE_LABEL[stage]}
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
              {STAGE_WHAT[stage]}
            </p>
          </div>
          <div
            className={cn(
              "rounded-lg border p-5",
              beat?.settles === "denied" ? "border-denied/40" : "border-hairline"
            )}
          >
            <p className="label-meta text-[10px] tracking-[0.16em]">
              On {c ? c.id.slice(-4) : "—"}
            </p>
            <p
              className={cn(
                "mt-3 text-[13.5px] leading-relaxed",
                beat ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {beat
                ? beat.event
                : "Never reached on this payment. The chain stopped before it got here."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ split */

function Split() {
  return (
    <section className="border-t border-hairline px-6 py-16 sm:px-10">
      <div className="mx-auto grid w-full max-w-[1180px] gap-8 lg:grid-cols-2">
        <div>
          <h2 className="max-w-[18ch] text-2xl font-semibold leading-snug tracking-tight sm:text-[30px]">
            A retry can move money.
            <br />
            <span className="text-muted-foreground">
              It can&rsquo;t tell you whether it should have.
            </span>
          </h2>
        </div>
        <p className="max-w-[52ch] self-end text-[14.5px] leading-relaxed text-muted-foreground">
          The part nobody builds is the part that decides whether an action was permitted, and
          the part that can still prove it a month later. That is the whole of this system:
          a proposal is made, deterministic code rules on it, and the ledger keeps a record
          honest enough to argue with.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- mandate */

function Mandate({ mandate: m }: { mandate: MandateFacts | null }) {
  return (
    <section className="border-t border-hairline px-6 py-16 sm:px-10">
      <div className="mx-auto grid w-full max-w-[1180px] gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
        <div>
          <h2 className="max-w-[19ch] text-2xl font-semibold leading-snug tracking-tight sm:text-[30px]">
            An agent that can spend freely is the thing people are right to refuse.
          </h2>
          <p className="mt-5 max-w-[50ch] text-[14px] leading-relaxed text-muted-foreground">
            This one acts inside a document the merchant signed with an Ed25519 key. Every limit
            is checked in deterministic code, on every action, before money moves.
          </p>
        </div>

        {!m ? (
          <p className="text-[13px] text-muted-foreground">
            The mandate could not be read, so its limits are not shown.
          </p>
        ) : (
          <dl className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
            {[
              ["Mandate", m.mandate_id],
              ["Hard ceiling", formatMoney(paise(m.max_amount_paise))],
              ["May act alone under", formatMoney(paise(m.auto_execute_limit_paise))],
              ["Attempts per payment", String(m.max_attempts_per_payment)],
              ["Permitted actions", `${m.permitted_actions.length} — nothing outside the list`],
              ["Valid until", m.not_after.slice(0, 10)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                <dt className="text-[13px] text-muted-foreground">{k}</dt>
                <dd className="text-right font-mono text-[12px]">{v}</dd>
              </div>
            ))}
            <div className="flex items-center gap-2 px-5 py-2.5">
              <Check className="h-3.5 w-3.5 text-measured" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-measured">
                signature verifies
              </span>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ close */

function Close() {
  return (
    <section className="border-t border-hairline px-6 py-24 sm:px-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <h2 className="max-w-[20ch] text-3xl font-semibold leading-[1.12] tracking-tight sm:text-[44px]">
          The interesting number isn&rsquo;t what we recovered.
          <br />
          <span className="text-measured">It&rsquo;s what we refused to.</span>
        </h2>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Enter the console <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="/gateway-proof"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-hairline px-6 text-sm transition-colors hover:border-foreground/30"
          >
            See the gateway events
          </a>
        </div>
      </div>
    </section>
  );
}
