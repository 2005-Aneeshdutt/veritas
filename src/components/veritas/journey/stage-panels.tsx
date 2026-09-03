import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ShieldAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { ClaimBadge } from "@/components/veritas/claim-badge";
import { formatMoney } from "@/domain/money";
import { STAGE_LABEL, type JourneyCase, type StageId, type StageStatus } from "@/domain/journey";
import { cn } from "@/lib/utils";

function Shell({
  stage,
  eyebrow,
  title,
  children,
}: {
  stage: StageId;
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={STAGE_LABEL[stage]} className="min-w-0">
      <p className="label-meta text-[10px] tracking-[0.16em]">{eyebrow ?? STAGE_LABEL[stage]}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: { label: string; value: ReactNode; tone?: string | undefined }[] }) {
  return (
    <dl className="divide-y divide-hairline border-y border-hairline">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-4 py-2.5">
          <dt className="label-meta text-[10px] tracking-[0.14em]">{r.label}</dt>
          <dd className={cn("min-w-0 text-sm text-foreground", r.tone)}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Unreached({ stage, reason }: { stage: StageId; reason: string }) {
  return (
    <Shell stage={stage} title={`${STAGE_LABEL[stage]} — not reached`}>
      <div className="border-l-2 border-hairline pl-4">
        <p className="label-meta text-[10px] tracking-[0.16em] text-muted-foreground/70">Not reached</p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{reason}</p>
        <p className="mt-3 text-xs text-muted-foreground/70">
          Not reached is not failure. No information is shown because none exists.
        </p>
      </div>
    </Shell>
  );
}

function Pending({ stage }: { stage: StageId }) {
  return (
    <Shell stage={stage} title={`${STAGE_LABEL[stage]} — pending`}>
      <div className="border-l-2 border-hairline pl-4">
        <p className="label-meta text-[10px] tracking-[0.16em] text-muted-foreground/70">Pending</p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          This stage has not happened yet in the current run. Start the journey to see it.
        </p>
      </div>
    </Shell>
  );
}

export function StagePanel({
  c,
  stage,
  status,
  reducedMotion,
}: {
  c: JourneyCase;
  stage: StageId;
  status: StageStatus;
  reducedMotion: boolean;
}) {
  if (status === "pending" || status === "current") {
    if (status === "pending") return <Pending stage={stage} />;
  }
  if (status === "not-reached") {
    const reason =
      c.policy.decision === "DENY"
        ? "Policy denied the action before execution."
        : "The journey stopped before this stage.";
    return <Unreached stage={stage} reason={reason} />;
  }

  switch (stage) {
    case "payment":
      return (
        <Shell stage="payment" title={c.title}>
          <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-2">
            <span className="numeral text-4xl font-semibold leading-none text-foreground sm:text-5xl">
              {formatMoney(c.amount)}
            </span>
            <span className="label-meta text-[10px] tracking-[0.16em]">Payment value at stake</span>
          </div>
          <Rows
            rows={[
              { label: "Payment ID", value: <span className="font-mono text-[13px]">{c.id}</span> },
              { label: "Merchant", value: c.merchant },
              { label: "Method", value: c.method },
              { label: "Status", value: c.paymentStatus },
              { label: "Failure reason", value: c.failureReason },
              { label: "Detected", value: new Date(c.detectedAt).toLocaleString("en-IN") },
            ]}
          />
          <Link
            to="/payment/$paymentId"
            params={{ paymentId: c.id }}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            Open payment
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Shell>
      );

    case "investigation":
      return (
        <Shell stage="investigation" eyebrow="Agent investigates" title="Structured signal review">
          <Rows
            rows={c.investigation.map((s) => ({
              label: s.label,
              value: s.value,
              tone:
                s.tone === "warn"
                  ? "text-observed"
                  : s.tone === "good"
                    ? "text-measured"
                    : undefined,
            }))}
          />
          <p className="mt-4 text-xs text-muted-foreground/80">
            Signals only. The agent recommends; it does not authorize.
          </p>
        </Shell>
      );

    case "diagnosis":
      return (
        <Shell stage="diagnosis" title="Why this payment failed">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Diagnosis gap</p>
              <p className="numeral mt-1.5 text-3xl font-semibold text-foreground">
                {c.diagnosis.gapPts > 0 ? `+${c.diagnosis.gapPts.toFixed(2)}` : "—"}
                {c.diagnosis.gapPts > 0 && <span className="ml-1 text-sm text-muted-foreground">pts</span>}
              </p>
            </div>
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Observed success</p>
              <p className="numeral mt-1.5 text-3xl font-semibold text-foreground">
                {c.diagnosis.observedSuccess > 0 ? `${c.diagnosis.observedSuccess.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="label-meta text-[10px] tracking-[0.16em]">Top actionable factor</p>
              <p className="mt-1.5 text-sm text-foreground">{c.diagnosis.topFactor.label}</p>
              <p className="numeral text-sm text-projected">{c.diagnosis.topFactor.effect}</p>
            </div>
          </div>
          <div className="mt-6">
            <Rows
              rows={[
                { label: "Reliability", value: c.diagnosis.reliability },
                { label: "Uncertainty", value: c.diagnosis.uncertainty },
                { label: "Actionability", value: c.diagnosis.actionability },
              ]}
            />
          </div>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">{c.diagnosis.note}</p>
        </Shell>
      );

    case "plan":
      return (
        <Shell stage="plan" title={`Recommended recovery — ${c.plan.recommended}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-y border-hairline text-sm">
              <thead>
                <tr className="label-meta text-[10px] tracking-[0.14em]">
                  <th className="py-2 text-left font-normal">Channel</th>
                  <th className="py-2 text-right font-normal">Expected</th>
                  <th className="py-2 text-right font-normal">Cost</th>
                  <th className="py-2 text-right font-normal">Net</th>
                  <th className="py-2 text-right font-normal">Eligibility</th>
                  <th className="py-2 text-right font-normal">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {c.plan.channels.map((ch) => (
                  <tr key={ch.id} className={cn(!ch.eligible && "text-muted-foreground/60")}>
                    <td className="py-2.5 text-foreground">
                      {ch.label}
                      {ch.recommended && (
                        <span className="label-meta ml-2 text-[10px] text-projected">Recommended</span>
                      )}
                    </td>
                    <td className="numeral py-2.5 text-right">{formatMoney(ch.expected)}</td>
                    <td className="numeral py-2.5 text-right">{formatMoney(ch.cost)}</td>
                    <td className="numeral py-2.5 text-right">{formatMoney(ch.net)}</td>
                    <td className="py-2.5 text-right">{ch.eligible ? "Eligible" : "Not eligible"}</td>
                    <td className="py-2.5 text-right uppercase text-[11px] tracking-[0.1em]">{ch.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ClaimBadge state="PROJECTED" size="sm" />
            <p className="text-xs text-muted-foreground/80">{c.plan.note}</p>
          </div>
        </Shell>
      );

    case "policy": {
      const passed = c.policy.checks.filter((k) => k.pass).length;
      const denied = c.policy.decision === "DENY";
      const firstFailIndex = c.policy.checks.findIndex((k) => !k.pass);
      return (
        <Shell stage="policy" eyebrow="Policy kernel · deterministic authority" title={`${c.policy.version}`}>
          <div
            className={cn(
              "mb-6 flex flex-wrap items-center justify-between gap-4 border-l-2 pl-4",
              denied ? "border-denied" : "border-measured",
            )}
          >
            <div>
              <p className={cn("text-2xl font-semibold tracking-tight", denied ? "text-denied" : "text-measured")}>
                {c.policy.decision}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {passed} / {c.policy.checks.length} checks passed
              </p>
            </div>
            {denied ? (
              <ShieldAlert className="h-6 w-6 text-denied" aria-hidden="true" />
            ) : (
              <Check className="h-6 w-6 text-measured" aria-hidden="true" />
            )}
          </div>
          <ol className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            {c.policy.checks.map((k, i) => {
              const halted = firstFailIndex !== -1 && i > firstFailIndex && denied;
              return (
                <li
                  key={k.n}
                  className={cn(
                    "grid grid-cols-[2rem_1rem_minmax(0,1fr)] items-baseline gap-2 border-b border-hairline py-2 text-sm",
                    halted && "opacity-45",
                    !reducedMotion && "transition-opacity",
                  )}
                >
                  <span className="label-meta text-[10px] tabular-nums">{String(k.n).padStart(2, "0")}</span>
                  {k.pass ? (
                    <Check className="h-3.5 w-3.5 text-measured" aria-label="passed" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-denied" aria-label="failed" />
                  )}
                  <span className="min-w-0">
                    <span className={cn(k.pass ? "text-muted-foreground" : "text-foreground")}>{k.label}</span>
                    {k.detail && <span className="block text-[11px] text-denied">{k.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {denied && (
            <p className="mt-5 text-sm text-denied">
              STOP — {c.policy.firstFailure}. Evaluation halted; nothing downstream was authorized.
            </p>
          )}
          <p className="mt-4 max-w-xl text-xs text-muted-foreground/80">{c.policy.note}</p>
        </Shell>
      );
    }

    case "execution":
      return (
        <Shell stage="execution" title="Execution record">
          <p
            className={cn(
              "text-2xl font-semibold tracking-tight",
              c.execution.state === "EXECUTED"
                ? "text-measured"
                : c.execution.state === "EXCEPTION"
                  ? "text-observed"
                  : "text-muted-foreground",
            )}
          >
            {c.execution.state}
          </p>
          <div className="mt-5">
            <Rows
              rows={[
                { label: "Actor", value: c.execution.actor },
                { label: "Action", value: c.execution.action },
                {
                  label: "Timestamp",
                  value: c.execution.at ? new Date(c.execution.at).toLocaleString("en-IN") : "—",
                },
                { label: "Status", value: c.execution.state },
              ]}
            />
          </div>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">{c.execution.note}</p>
        </Shell>
      );

    case "outcome":
      return (
        <Shell stage="outcome" title="Observed outcome">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <span
              className={cn(
                "numeral text-4xl font-semibold leading-none sm:text-5xl",
                c.outcome.state === "MEASURED" ? "text-measured" : "text-foreground",
              )}
            >
              {formatMoney(c.outcome.amount)}
            </span>
            <span className="label-meta text-[10px] tracking-[0.16em]">{c.outcome.state}</span>
          </div>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">{c.outcome.note}</p>
          {c.principle && (
            <p className="mt-6 border-l-2 border-observed/60 pl-4 text-sm text-foreground">{c.principle}</p>
          )}
        </Shell>
      );

    case "ledger":
      return (
        <Shell stage="ledger" title={c.ledger.entry}>
          <Rows
            rows={[
              { label: "Entry", value: c.ledger.entry },
              { label: "Actor", value: c.ledger.actor },
              { label: "Action", value: c.ledger.action },
              { label: "Timestamp", value: new Date(c.ledger.at).toLocaleString("en-IN") },
              { label: "Previous hash", value: <span className="font-mono text-[12px]">{c.ledger.prevHash}</span> },
              { label: "Current hash", value: <span className="font-mono text-[12px]">{c.ledger.hash}</span> },
              {
                label: "Verification",
                value: <span className="text-verified">{c.ledger.verification}</span>,
              },
            ]}
          />
        </Shell>
      );

    case "evidence":
      return (
        <Shell stage="evidence" title="Supporting evidence">
          <ul className="divide-y divide-hairline border-y border-hairline">
            {c.evidence.map((e) => (
              <li key={e.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2.5">
                <span className="min-w-0">
                  <span className="text-sm text-foreground">{e.label}</span>
                  <span className="block text-[11px] text-muted-foreground/80">{e.note}</span>
                </span>
                <span
                  className={cn(
                    "label-meta shrink-0 text-[10px] tracking-[0.14em]",
                    e.status === "VERIFIED" && "text-verified",
                    e.status === "AVAILABLE" && "text-measured",
                    e.status === "UNAVAILABLE" && "text-muted-foreground/60",
                    e.status === "UNCLAIMED" && "text-observed",
                  )}
                >
                  {e.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground/80">
            Gateway is {c.gateway.toLowerCase()} for this record. A signed event is not gateway truth.
          </p>
        </Shell>
      );

    case "prove":
      return (
        <Shell stage="prove" title="Proof preview">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <span className="numeral text-4xl font-semibold leading-none text-foreground sm:text-5xl">
              {formatMoney(c.claimAmount)}
            </span>
            <ClaimBadge state={c.claim} size="sm" />
          </div>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">{c.claimLine}</p>
          <div className="mt-6">
            <Rows rows={c.completion.rows.map((r) => ({ label: r.label, value: r.value }))} />
          </div>
          <Link
            to="/prove"
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-hairline px-3 text-[13px] text-foreground transition-colors hover:border-foreground/30"
          >
            Open proof
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Shell>
      );
  }
}
