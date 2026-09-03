import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleDashed, Copy, MinusCircle, Play } from "lucide-react";
import { JOURNEY_CASES, findJourneyCase } from "@/data/journey-cases";
import { evidenceFor, ledgerEntryForCase, proofFor, proofSteps } from "@/data/proof";
import { formatMoney } from "@/domain/money";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { RecoveryPassport } from "@/components/veritas/recovery-passport";
import { usePrefersReducedMotion } from "@/hooks/use-journey-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/prove")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prove — VERITAS" },
      {
        name: "description",
        content: "The strongest claim the evidence supports — measured, unverified or not authorized.",
      },
      { property: "og:title", content: "Prove — VERITAS" },
      {
        property: "og:description",
        content: "The strongest claim the evidence supports — measured, unverified or not authorized.",
      },
    ],
  }),
  component: ProvePage,
});

const CONTROL =
  "inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[13px] transition-colors";

function useProofAssembly(caseId: string, total: number, reducedMotion: boolean) {
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const run = useCallback(() => {
    clear();
    if (reducedMotion) {
      setDone(total);
      setRunning(false);
      return;
    }
    setDone(0);
    setRunning(true);
    const step = Math.max(180, Math.round(2600 / total));
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setDone(n);
      if (n >= total) {
        clear();
        setRunning(false);
      }
    }, step);
  }, [clear, reducedMotion, total]);

  // Assemble once per case, on open.
  useEffect(() => {
    run();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => clear, [clear]);

  return { done, running, run, complete: done >= total };
}

function StepIcon({ state, revealed }: { state: "ok" | "caution" | "absent"; revealed: boolean }) {
  if (!revealed) return <CircleDashed className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />;
  if (state === "ok") return <Check className="h-4 w-4 text-measured" aria-hidden="true" />;
  if (state === "caution") return <CircleDashed className="h-4 w-4 text-projected" aria-hidden="true" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

function ProvePage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/prove" });
  const c = findJourneyCase(caseId) ?? JOURNEY_CASES[0]!;
  const reducedMotion = usePrefersReducedMotion();

  const steps = proofSteps(c);
  const proof = proofFor(c);
  const ledger = ledgerEntryForCase(c.id);
  const evidence = evidenceFor(c);
  const assembly = useProofAssembly(c.id, steps.length, reducedMotion);

  const [showEvidence, setShowEvidence] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }

  const verdictTone =
    proof.verdict === "RECOVERY CONFIRMED"
      ? "text-measured"
      : proof.verdict === "RECOVERY NOT AUTHORIZED"
        ? "text-denied"
        : "text-projected";

  const stepTarget: Record<string, { to: "/payments" | "/diagnosis" | "/policy" | "/recovery-journey" | "/outcome" | "/audit-trail" | "/evidence"; search: Record<string, string> }> = {
    payment: { to: "/payments", search: { ref: c.id } },
    diagnosis: { to: "/diagnosis", search: { case: c.id } },
    policy: { to: "/policy", search: { case: c.id } },
    execution: { to: "/recovery-journey", search: { case: c.id } },
    outcome: { to: "/outcome", search: { case: c.id } },
    ledger: { to: "/audit-trail", search: { case: c.id } },
    evidence: { to: "/evidence", search: { case: c.id } },
  };

  const liveStatus = assembly.running
    ? "ASSEMBLING PROOF"
    : proof.complete
      ? "PROOF READY"
      : "PROOF INCOMPLETE";

  return (
    <div className="space-y-9">
      {/* Cinematic proof surface — dark in every theme */}
      <section
        aria-label="Proof"
        className="rounded-lg border border-white/10 bg-[#08090b] p-6 text-neutral-200 sm:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div>
            <p className="label-meta text-[10px] tracking-[0.2em] text-neutral-500">VERITAS PROOF</p>
            <h1 className="mt-2 text-sm font-medium uppercase tracking-[0.16em] text-neutral-400">
              Recovery claim
            </h1>
            <p className="numeral mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {formatMoney(c.claimAmount)}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-3">
              <ClaimBadge state={c.claim} />
              <span className={cn("label-meta text-[11px] tracking-[0.16em]", verdictTone)}>
                {proof.verdict}
              </span>
            </p>
            {c.claim === "MEASURED" && (
              <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
                Not projected. Not estimated. Not inferred.
              </p>
            )}
            {c.claim === "UNVERIFIED" && (
              <p className="mt-3 border-l-2 border-projected/60 pl-3 text-[13px] text-neutral-300">
                Permission to act is not proof that the action succeeded.
              </p>
            )}
            {c.policy.decision === "DENY" && (
              <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
                Policy denied the recovery action. First failed rule: {c.policy.firstFailure}. Execution{" "}
                {c.execution.state.toLowerCase()}.
              </p>
            )}
          </div>

          <span
            className={cn(
              "label-meta inline-flex items-center gap-2 rounded-full border border-white/15 px-2.5 py-1 text-[10px] tracking-[0.16em]",
              assembly.running ? "text-projected" : proof.complete ? "text-measured" : "text-projected",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-current",
                assembly.running && !reducedMotion && "animate-pulse",
              )}
            />
            {liveStatus}
          </span>
        </div>

        {/* Proof chain */}
        <ol className="mt-7 space-y-0 border-t border-white/10" aria-label="Proof chain">
          {steps.map((s, i) => {
            const revealed = i < assembly.done;
            const t = stepTarget[s.key]!;
            return (
              <li key={s.key} className="border-b border-white/10">
                <Link
                  to={t.to}
                  search={t.search as never}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-4 py-3 transition-colors hover:bg-white/[0.04]"
                >
                  <span className="translate-y-0.5">
                    <StepIcon state={s.state} revealed={revealed} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-neutral-100">
                      {revealed ? s.label : `${s.checkingLabel}…`}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-neutral-500">
                      {revealed ? s.value : "—"}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
          <li className="flex items-baseline justify-between py-3">
            <span className="label-meta text-[10px] tracking-[0.16em] text-neutral-500">Proof</span>
            <span
              className={cn(
                "label-meta text-[11px] tracking-[0.16em]",
                proof.complete ? "text-measured" : "text-projected",
              )}
            >
              {assembly.running ? "ASSEMBLING…" : proof.complete ? "PROOF READY" : "PROOF INCOMPLETE"}
            </span>
          </li>
        </ol>

        {!proof.complete && !assembly.running && (
          <div className="mt-4 rounded-md border border-white/10 p-4">
            <p className="label-meta text-[10px] tracking-[0.16em] text-projected">Proof incomplete</p>
            <ul className="mt-2 space-y-1 text-[12px] text-neutral-400">
              {proof.missing.map((m) => (
                <li key={m.label}>
                  {m.label} — {m.state}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-neutral-500">
              VERITAS refuses to overclaim: the missing artifacts above are not treated as proof.
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={assembly.run}
            className={cn(CONTROL, "border-white/20 text-neutral-200 hover:border-white/40")}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Re-run proof assembly
          </button>
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            aria-expanded={showEvidence}
            className={cn(CONTROL, "border-white/20 text-neutral-200 hover:border-white/40")}
          >
            {showEvidence ? "Hide supporting evidence" : "View supporting evidence"}
          </button>
          <button
            type="button"
            onClick={() => copy("proof", proof.proofId)}
            className={cn(CONTROL, "border-white/20 text-neutral-200 hover:border-white/40")}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied === "proof" ? "Proof ID copied" : "Copy proof ID"}
          </button>
          <button
            type="button"
            onClick={() => copy("payment", c.id)}
            className={cn(CONTROL, "border-white/20 text-neutral-200 hover:border-white/40")}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied === "payment" ? "Payment ID copied" : "Copy payment ID"}
          </button>
          <Link
            to="/recovery-journey"
            search={{ case: c.id } as never}
            className={cn(CONTROL, "border-white/20 text-neutral-200 hover:border-white/40")}
          >
            View recovery journey
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link
            to="/audit-trail"
            search={{ case: c.id } as never}
            className={cn(CONTROL, "border-white/20 text-neutral-200 hover:border-white/40")}
          >
            Open audit ledger
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        {showEvidence && (
          <div className="mt-5 border-t border-white/10 pt-4" aria-label="Supporting evidence">
            <p className="label-meta text-[10px] tracking-[0.16em] text-neutral-500">
              Claim {formatMoney(c.claimAmount)} · {c.claim} — supported by
            </p>
            <ul className="mt-3 divide-y divide-white/10">
              {evidence.map((e) => (
                <li key={e.category} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-neutral-200">
                      {e.category} — {e.source}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-neutral-500">
                      {e.reference}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "label-meta shrink-0 text-[10px] tracking-[0.14em]",
                      e.status === "VERIFIED" || e.status === "AVAILABLE"
                        ? "text-measured"
                        : e.status === "UNCLAIMED"
                          ? "text-projected"
                          : "text-neutral-500",
                    )}
                  >
                    {e.status}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              to="/evidence"
              search={{ case: c.id } as never}
              className="mt-3 inline-flex items-center gap-2 text-[13px] text-neutral-300 underline-offset-4 hover:underline"
            >
              Open data room
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        )}

        {/* Certificate */}
        <div className="mt-7 border-t border-white/10 pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="label-meta text-[10px] tracking-[0.16em] text-neutral-500">
              Proof certificate
            </p>
            <p className="label-meta text-[10px] tracking-[0.16em] text-neutral-500">
              Demo proof record
            </p>
          </div>
          <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {[
              { k: "Proof ID", v: proof.proofId },
              { k: "Payment", v: c.id },
              { k: "Claim amount", v: formatMoney(c.claimAmount) },
              { k: "Claim state", v: c.claim },
              {
                k: "Policy decision",
                v: `${c.policy.decision} · ${c.policy.checks.filter((x) => x.pass).length}/12`,
              },
              { k: "Execution", v: c.execution.state },
              { k: "Outcome", v: c.outcome.state },
              { k: "Ledger entry", v: ledger ? `${ledger.entry} · ${ledger.status}` : c.ledger.entry },
              {
                k: "Evidence",
                v: `${evidence.filter((e) => e.status === "AVAILABLE" || e.status === "VERIFIED").length} of ${evidence.length} present`,
              },
              { k: "Gateway", v: c.gateway },
              { k: "Timestamp", v: proof.sealedAt },
              { k: "Verification", v: proof.complete ? "PROOF READY" : "PROOF INCOMPLETE" },
            ].map((r) => (
              <div
                key={r.k}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4 border-b border-white/[0.06] py-1.5"
              >
                <dt className="label-meta w-32 shrink-0 text-[10px] tracking-[0.14em] text-neutral-500">
                  {r.k}
                </dt>
                <dd className="min-w-0 break-words text-right font-mono text-[12px] text-neutral-200">
                  {r.v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-white/10 px-4 py-3">
            <span className="label-meta text-[10px] tracking-[0.16em] text-neutral-400">
              Proof sealed
            </span>
            <span className="font-mono text-[12px] text-neutral-300">{proof.seal}</span>
            <span className="text-[11px] text-neutral-500">
              Reference to the demo evidence record — not a cryptographic proof of a live transaction.
            </span>
          </div>
        </div>
      </section>

      <CaseSwitcher activeId={c.id} onSelect={(id) => navigate({ to: ".", search: { case: id } })} />

      <RecoveryPassport journeyCase={c} showOpenProof={false} />

      <p className="text-xs text-muted-foreground/80">
        Frontend demonstration only. VERITAS proves the strongest claim the evidence supports — nothing more.
      </p>
    </div>
  );
}
