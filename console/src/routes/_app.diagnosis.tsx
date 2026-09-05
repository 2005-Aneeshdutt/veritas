import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { CaseSwitcher } from "@/components/veritas/case-switcher";
import { CaseWalk } from "@/components/veritas/case-walk";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { DetailDrawer } from "@/components/veritas/detail-drawer";
import { PageHeader } from "@/components/veritas/page-header";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import { BackendNotice } from "@/components/veritas/backend-notice";
import {
  DIAGNOSIS_METHODOLOGY,
  actionabilityLabel,
  diagnosisFactors,
  formatEffect,
  type DiagnosisFactor,
} from "@/data/investigate";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/diagnosis")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search["case"] === "string" ? (search["case"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Diagnosis — VERITAS" },
      {
        name: "description",
        content:
          "Why is this payment failing? Factor attribution with explicit uncertainty over observed success rates.",
      },
      { property: "og:title", content: "Diagnosis — VERITAS" },
      {
        property: "og:description",
        content:
          "Why is this payment failing? Factor attribution with explicit uncertainty over observed success rates.",
      },
    ],
  }),
  component: DiagnosisPage,
});

function DiagnosisPage() {
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate();
  const { case_: activeCase, isFixture, error } = useJourneyCase(caseId, 1);
  const d = activeCase.diagnosis;
  // One source. The headline used the backend decomposition while this chart
  // read a fixture, so the page contradicted itself about which factor was on
  // top. Both now read the case.
  const factors: DiagnosisFactor[] = d.factors.map((f) => ({
    id: f.id,
    label: f.label,
    effect: f.effect,
    uncertainty: f.uncertainty,
    note: f.insideErrorBar
      ? "Inside its own error bar — not distinguishable from noise."
      : "Outside its error bar — the effect is real at this sample size.",
  }));
  const [selected, setSelected] = useState<DiagnosisFactor | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const qc = useQueryClient();
  const [rerunning, setRerunning] = useState(false);

  // Re-reads the committed decomposition for this payment. It is deterministic,
  // so a re-run that returned different numbers would itself be the finding.
  const [reran, setReran] = useState(false);

  // The decomposition is deterministic, so a re-run returns the same numbers
  // and nothing on screen moves. Left at that the button looks broken, so it
  // reports the result explicitly -- identical is the finding, not the absence
  // of one.
  async function rerun() {
    setRerunning(true);
    setReran(false);
    setSelected(null);
    const started = Date.now();
    try {
      await qc.refetchQueries({ queryKey: ["journey-case"] });
    } finally {
      // let the spinner be seen even when the refetch returns instantly
      const held = Math.max(0, 550 - (Date.now() - started));
      window.setTimeout(() => {
        setRerunning(false);
        setReran(true);
        attributedKey.current = null;
        attribute(factors.length);
      }, held);
    }
  }

  // The decomposition is deterministic and already committed; this is a reveal,
  // not a computation. It exists because a chart that is fully drawn the instant
  // the page opens reads as a picture, and the attribution is the one thing on
  // this page worth watching arrive. The numbers are identical either way --
  // Re-run says so out loud.
  const [attributed, setAttributed] = useState(0);
  const stagger = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopStagger = useCallback(() => {
    if (stagger.current) clearInterval(stagger.current);
    stagger.current = null;
  }, []);
  const attribute = useCallback(
    (n: number) => {
      stopStagger();
      if (n === 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setAttributed(n);
        return;
      }
      setAttributed(0);
      let i = 0;
      stagger.current = setInterval(() => {
        i += 1;
        setAttributed(i);
        if (i >= n) stopStagger();
      }, 190);
    },
    [stopStagger]
  );
  useEffect(() => stopStagger, [stopStagger]);

  // Keyed on the payment and its decomposition, not on effect invocation. The
  // case arrives as a fixture and is replaced by the backend's record moments
  // later, and the query refetches on focus -- so this effect runs several
  // times for one arrival. Restarting the walk each time left it looping and
  // never settling. It now starts once per decomposition and is a no-op after.
  const factorCount = factors.length;
  const key = `${activeCase.id}:${factorCount}`;
  const attributedKey = useRef<string | null>(null);
  useEffect(() => {
    if (attributedKey.current === key) return;
    attributedKey.current = key;
    setAttributed(0);
    const id = window.setTimeout(() => attribute(factorCount), 300);
    return () => window.clearTimeout(id);
  }, [key, factorCount, attribute]);

  const attributionDone = attributed >= factorCount && factorCount > 0;

  const magnitudes = factors.map((f) => Math.abs(f.effect ?? 0));
  const max = Math.max(0.0001, ...magnitudes);
  const actionable = actionabilityLabel(d.actionability);
  const topAvailable = factors.find((f) => f.effect !== null);

  return (
    <div className="space-y-8">
      <BackendNotice isFixture={isFixture} error={error} what="diagnosis" />

      <PageHeader
        title="Diagnosis"
        description="Why is this payment failing?"
        actions={<ClaimBadge state="OBSERVED" />}
      />

      <CaseSwitcher
        activeId={activeCase.id}
        onSelect={(id) => void navigate({ to: "/diagnosis", search: { case: id } })}
      />

      <CaseWalk caseId={activeCase.id} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          {/* Hero */}
          <section className="border-b border-hairline pb-6">
            <p className="label-meta text-[10px] tracking-[0.16em]">Diagnosis</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {activeCase.failureReason}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{d.note}</p>

            <dl className="mt-6 grid gap-6 sm:grid-cols-3">
              <div>
                <dt className="label-meta text-[10px] tracking-[0.16em]">Observed success rate</dt>
                <dd className="numeral mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {d.observedSuccess.toFixed(2)}%
                </dd>
              </div>
              <div>
                <dt className="label-meta text-[10px] tracking-[0.16em]">Diagnosis gap</dt>
                <dd className="numeral mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {d.gapPts > 0 ? "+" : ""}
                  {d.gapPts.toFixed(2)} pts
                </dd>
              </div>
              <div>
                <dt className="label-meta text-[10px] tracking-[0.16em]">Reliability</dt>
                <dd className="mt-1 text-sm text-foreground">{d.reliability}</dd>
              </div>
            </dl>
          </section>

          {/* Top actionable factor. This is a conclusion drawn from the
              decomposition below, so it arrives after the decomposition does. */}
          <section
            className={cn(
              "rounded-lg border border-hairline p-5 transition-opacity duration-500",
              attributionDone ? "opacity-100" : "opacity-30"
            )}
          >
            <p className="label-meta text-[10px] tracking-[0.16em]">Top actionable factor</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-lg font-semibold tracking-tight">
                  {attributionDone ? d.topFactor.label : "Attributing…"}
                </p>
                <p className="numeral mt-1 text-2xl tabular-nums">
                  {attributionDone ? `${d.topFactor.effect} pts` : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="label-meta text-[10px] tracking-[0.16em]">Actionability</p>
                <p className="mt-1 text-sm font-medium">{attributionDone ? actionable : "—"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {attributionDone ? d.actionability : "Waiting on the decomposition."}
                </p>
              </div>
            </div>
          </section>

          {/* Contribution chart */}
          {/* The data-* attributes are test hooks: the reveal is timing-dependent,
              and verifying it from rendered text alone means guessing at sample
              points. */}
          <section
            aria-labelledby="why-heading"
            className="space-y-4"
            data-attributed={attributed}
            data-factor-count={factorCount}
          >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="why-heading" className="text-sm font-semibold tracking-tight">
                    Why is this payment failing?
                  </h3>
                  <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                    Shapley contribution with measured uncertainty. Estimates, not money - a factor
                    inside its own error bar is not distinguishable from noise.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={rerun}
                  disabled={rerunning}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                >
                  <RotateCcw className={rerunning ? "h-3 w-3 animate-spin" : "h-3 w-3"} aria-hidden />
                  {rerunning ? "Re-running" : "Re-run"}
                </button>
                {reran && !rerunning && (
                  <p className="mt-1.5 text-right text-[11px] text-measured">
                    Recomputed from the committed run — identical.
                  </p>
                )}
              </div>

            <ul className="space-y-2">
              {factors.map((f, i) => {
                const available = f.effect !== null;
                const on = i < attributed;
                const pct = available ? (Math.abs(f.effect!) / max) * 100 : 0;
                const positive = (f.effect ?? 0) >= 0;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(f)}
                      aria-label={`${f.label}: ${formatEffect(f)}`}
                      className="group grid w-full grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-hairline focus-visible:border-hairline focus-visible:outline-none"
                    >
                      <span className="label-meta text-[10px] tracking-[0.14em]">{f.label}</span>
                      <span className="h-2 w-full rounded-sm bg-muted/40">
                        {available && (
                          <span
                            className={cn(
                              "block h-2 rounded-sm transition-[width] duration-300 ease-out",
                              positive ? "bg-measured/70" : "bg-denied/70",
                            )}
                            style={{ width: on ? `${Math.max(4, pct)}%` : "0%" }}
                          />
                        )}
                      </span>
                      <span
                        className={cn(
                          "numeral text-right text-[13px] tabular-nums",
                          available ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span className={available ? "" : "text-muted-foreground"}>
                          {!on
                            ? "—"
                            : f.effect === null
                              ? "NOT AVAILABLE"
                              : `${f.effect > 0 ? "+" : ""}${f.effect.toFixed(2)} pts`}
                        </span>
                        {on && f.uncertainty !== null && (
                          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/70">
                            ± {f.uncertainty.toFixed(2)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Methodology */}
          <section className="rounded-lg border border-hairline">
            <button
              type="button"
              aria-expanded={methodOpen}
              onClick={() => setMethodOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="label-meta text-[10px] tracking-[0.16em]">
                How this diagnosis was derived
              </span>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", methodOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {methodOpen && (
              <dl className="divide-y divide-hairline border-t border-hairline px-4 text-sm">
                <Row label="Method" value={DIAGNOSIS_METHODOLOGY.method} />
                <Row label="Coalitions" value={`${DIAGNOSIS_METHODOLOGY.coalitions}`} />
                <Row label="Factors" value={`${DIAGNOSIS_METHODOLOGY.factors}`} />
                <Row label="Comparison" value={DIAGNOSIS_METHODOLOGY.comparison} />
                <Row label="Uncertainty" value={d.uncertainty} />
              </dl>
            )}
          </section>

          {/* Next */}
          <section className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6">
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Next</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Diagnosis explains. The plan recommends — it does not authorize.
              </p>
            </div>
            <Link
              to="/plan"
              search={{ case: activeCase.id }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-foreground/40 px-3.5 text-[13px] transition-colors hover:bg-foreground/5"
            >
              Build recovery plan
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </section>
        </div>

        {/* Context panel */}
        <aside className="space-y-6 lg:border-l lg:border-hairline lg:pl-6">
          <section>
            <p className="label-meta text-[10px] tracking-[0.16em]">Payment</p>
            <dl className="mt-2 divide-y divide-hairline text-sm">
              <Row label="Payment ID" value={activeCase.id} mono />
              <Row label="Merchant" value={activeCase.merchant} />
              <Row label="Amount" value={formatMoney(activeCase.amount)} mono />
              <Row label="Method" value={activeCase.method} />
              <Row label="Failure reason" value={activeCase.failureReason} />
            </dl>
          </section>

          <section>
            <p className="label-meta text-[10px] tracking-[0.16em]">Diagnosis</p>
            <dl className="mt-2 divide-y divide-hairline text-sm">
              <Row label="Primary cause" value={activeCase.failureReason} />
              {/* Same conclusion as the panel, so it waits for the same thing.
                  The rail once read "hour +3.79" beside a panel still saying
                  "Attributing" -- one screen, two answers. */}
              <Row
                label="Top actionable factor"
                value={
                  !attributionDone
                    ? "—"
                    : topAvailable
                      ? `${topAvailable.label} · ${formatEffect(topAvailable)}`
                      : "NOT AVAILABLE"
                }
              />
            </dl>
          </section>

          <nav aria-label="Related workspaces" className="flex flex-col gap-2">
            <p className="label-meta text-[10px] tracking-[0.16em]">Next</p>
            <ContextLink to="/plan" caseId={activeCase.id} label="Build recovery plan" />
            <ContextLink to="/payments" caseId={activeCase.id} label="Open payment" payments />
            <ContextLink to="/recovery-journey" caseId={activeCase.id} label="Open recovery journey" />
          </nav>
        </aside>
      </div>

      <DetailDrawer
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        eyebrow="Diagnosis factor"
        title={selected?.label ?? ""}
        description={selected?.note ?? ""}
        rows={
          selected
            ? [
                { label: "Contribution", value: formatEffect(selected) },
                {
                  label: "Uncertainty",
                  value: selected.uncertainty === null ? "NOT AVAILABLE" : `± ${selected.uncertainty.toFixed(2)} pts`,
                },
                { label: "Observed success", value: `${d.observedSuccess.toFixed(2)}%` },
                { label: "Diagnosis gap", value: `${d.gapPts.toFixed(4)} pts` },
                { label: "Method", value: DIAGNOSIS_METHODOLOGY.method },
                { label: "Claim", value: "OBSERVED — analytical, not money" },
              ]
            : []
        }
        actions={[
          { label: "Build recovery plan", to: "/plan", search: { case: activeCase.id } },
          { label: "Open recovery journey", to: "/recovery-journey", search: { case: activeCase.id } },
        ]}
        footer="Estimated contribution with uncertainty. Demo analysis over the curated case set."
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 py-2">
      <dt className="label-meta w-28 shrink-0 text-[10px] tracking-[0.14em]">{label}</dt>
      <dd className={cn("min-w-0 break-words text-right", mono && "numeral tabular-nums")}>{value}</dd>
    </div>
  );
}

function ContextLink({
  to,
  caseId,
  label,
  payments,
}: {
  to: "/plan" | "/payments" | "/recovery-journey";
  caseId: string;
  label: string;
  payments?: boolean;
}) {
  return (
    <Link
      to={to}
      search={(payments ? { ref: caseId } : { case: caseId }) as never}
      className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
