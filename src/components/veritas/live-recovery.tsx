import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, ShieldCheck, Zap } from "lucide-react";
import { apiGet, apiPost } from "@/data/http";
import { backendConnected } from "@/data/services";
import { formatMoney, paise } from "@/domain/money";
import { cn } from "@/lib/utils";

/**
 * The loop, closed on real rails.
 *
 * Everything else in this product reports on a committed batch. This is the one
 * control that reaches outside: the kernel is asked whether the action is
 * inside the merchant's signed mandate, and only if it says so does the button
 * create an actual Razorpay test-mode payment link and append a ledger entry.
 *
 * Three rules it keeps:
 *
 *   * The gate is shown BEFORE the button. Authority first, action second — a
 *     control that executes and then explains has the argument backwards.
 *   * A created link is not money. `payment_link.created` appears here as an
 *     event, never as recovery, and the outcome stays `awaiting_outcome` until
 *     a gateway webhook settles it. The backend says the same thing in
 *     recovery.py: "payment_link.created is not money."
 *   * Whatever this recovers is NOT added to the portfolio's measured figure.
 *     That number is a marked batch; this is a live demonstration that the
 *     mechanism is real. Merging them would corrupt the only figure worth
 *     trusting.
 */

interface RecoveryPlan {
  txn_id: string;
  merchant_id: string;
  merchant_name: string;
  amount_paise: number;
  bank: string;
  mode_label: string;
  gate_decision: string;
  gate_reason: string;
  channel: string | null;
  executed: boolean;
  payment_link: string | null;
  recovered_paise: number;
  outcome_state: string;
  ledger_entry_hash: string | null;
  idempotent_skip: boolean;
  notes: string[];
}

export function LiveRecovery({
  merchantId = "cloudsync",
  txnId = "pay_cloudsync_0502",
}: {
  merchantId?: string;
  txnId?: string;
}) {
  const connected = backendConnected();
  const [result, setResult] = useState<RecoveryPlan | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const plan = useQuery({
    queryKey: ["recovery-plan", merchantId, txnId],
    queryFn: ({ signal }) =>
      apiGet<RecoveryPlan>(`/api/recovery/${merchantId}/${txnId}`, { signal }),
    enabled: connected,
    staleTime: 60_000,
    retry: 1,
  });

  const view = result ?? plan.data;
  if (!connected) return null;

  const allowed = view?.gate_decision === "allow";

  async function execute() {
    setRunning(true);
    setError(null);
    try {
      const r = await apiPost<RecoveryPlan>(`/api/recovery/${merchantId}/${txnId}`, {
        params: { confirmed: true, actor: "operator" },
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The recovery call failed.");
    } finally {
      setRunning(false);
      setArmed(false);
    }
  }

  return (
    <section
      aria-label="Live recovery"
      className="rounded-lg border border-hairline bg-background"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3 px-4 pb-2.5 pt-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-foreground">
            Live recovery — real gateway rails
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Creates an actual Razorpay test-mode payment link, only if the mandate allows it.
          </p>
        </div>
        <span className="label-meta shrink-0 text-[9px] tracking-[0.16em]">
          {view?.mode_label ?? "razorpay test mode"}
        </span>
      </header>

      {plan.isPending ? (
        <div className="h-20 animate-pulse border-t border-hairline" />
      ) : plan.error && !result ? (
        <p className="border-t border-hairline px-4 py-3 text-[12px] text-denied">
          The live recovery loop could not be reached.
        </p>
      ) : view ? (
        <>
          {/* authority first */}
          <div className="grid gap-px border-t border-hairline bg-hairline sm:grid-cols-4">
            <Cell label="Payment" value={view.txn_id.slice(-4)} note={view.merchant_name} mono />
            <Cell label="Amount" value={formatMoney(paise(view.amount_paise))} note={view.bank} />
            <Cell
              label="Kernel"
              value={view.gate_decision.toUpperCase()}
              note={view.gate_reason}
              tone={allowed ? "text-measured" : "text-denied"}
            />
            <Cell
              label="Outcome"
              value={view.outcome_state.replace(/_/g, " ")}
              note={
                view.recovered_paise > 0
                  ? formatMoney(paise(view.recovered_paise))
                  : "a link is not money"
              }
              tone={view.recovered_paise > 0 ? "text-measured" : undefined}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-4 py-3">
            {!allowed ? (
              <p className="text-[12px] text-denied">
                The kernel refuses this action, so there is nothing to execute.
              </p>
            ) : view.executed || view.payment_link ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-measured">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  Executed
                </span>
                {view.payment_link && (
                  <a
                    href={view.payment_link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[12px] text-foreground underline underline-offset-4"
                  >
                    Open the payment link <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </a>
                )}
                {view.ledger_entry_hash && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ledger {view.ledger_entry_hash.slice(0, 12)}…
                  </span>
                )}
                {view.idempotent_skip && (
                  <span className="text-[11px] text-muted-foreground">
                    Already executed — the second call changed nothing.
                  </span>
                )}
              </>
            ) : armed ? (
              <>
                <span className="text-[12px] text-foreground">
                  This creates a real payment link on the gateway. Proceed?
                </span>
                <button
                  type="button"
                  onClick={execute}
                  disabled={running}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-measured/50 px-3 text-[12px] text-measured transition-colors hover:bg-measured/10"
                >
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Zap className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {running ? "Executing" : "Yes, execute"}
                </button>
                <button
                  type="button"
                  onClick={() => setArmed(false)}
                  className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setArmed(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-foreground transition-colors hover:border-foreground/30"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden />
                Execute the authorised recovery
              </button>
            )}
          </div>

          {error && (
            <p className="border-t border-hairline px-4 py-2 text-[12px] text-denied">{error}</p>
          )}

          <p className="border-t border-hairline px-4 py-2 text-[10px] text-muted-foreground">
            Not counted in measured recovery. That figure is a marked batch; this proves the
            mechanism on live rails.
          </p>
        </>
      ) : null}
    </section>
  );
}

function Cell({
  label,
  value,
  note,
  tone,
  mono,
}: {
  label: string;
  value: string;
  note: string;
  // exactOptionalPropertyTypes is on: an optional prop must admit undefined
  tone?: string | undefined;
  mono?: boolean | undefined;
}) {
  return (
    <div className="bg-background px-4 py-2.5">
      <p className="label-meta text-[9px] tracking-[0.14em]">{label}</p>
      <p
        className={cn(
          "mt-1 text-[15px] font-semibold uppercase tabular-nums",
          mono && "font-mono",
          tone ?? "text-foreground"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80" title={note}>
        {note}
      </p>
    </div>
  );
}
