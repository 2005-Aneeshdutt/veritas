import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { apiPost } from "@/data/http";
import { DEMO_RESET_EVENT } from "./demo-reset";
import { backendConnected } from "@/data/services";
import { formatCount, formatMoney, paise } from "@/domain/money";
import { cn } from "@/lib/utils";

/**
 * The queue, approved — and put back afterwards.
 *
 * The 661 payments held for a person are the reason the headline is a
 * projection rather than a figure. Approving them is what makes the forecast
 * falsifiable: the same retries stop being "recoverable" and become measured or
 * not, one way or the other.
 *
 * Two things make this safe to put behind a button. The backend re-gates every
 * action individually against the mandate it was proposed under, so what the
 * kernel denied stays denied however many times it is approved — approving a
 * queue is a person saying yes to work already inside the agent's authority,
 * not granting more. And the top bar's reset rebuilds the runs
 * deterministically from cached model calls, reusing each run id, so a
 * rehearsal is undoable and every link still resolves -- from any page, which
 * is why the undo is not duplicated here.
 *
 * It writes to disk. That is why it asks twice.
 */

interface ApproveResult {
  executed: number;
  denied: number;
  groups: number;
  total_measured_paise: number;
  merchants: { merchant_id: string; executed: number; denied: number }[];
}

export function ApproveBook() {
  const connected = backendConnected();
  const qc = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<null | "approve">(null);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The top bar can reset the book from any page. This panel's summary line
  // outlives that reset otherwise, leaving "657 executed - measured now
  // ₹1,94,510" sitting under figures that have gone back to ₹39,834.
  useEffect(() => {
    const clear = () => {
      setResult(null);
      setError(null);
      setArmed(false);
    };
    window.addEventListener(DEMO_RESET_EVENT, clear);
    return () => window.removeEventListener(DEMO_RESET_EVENT, clear);
  }, []);

  if (!connected) return null;

  const refresh = () => qc.invalidateQueries();

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const r = await apiPost<ApproveResult>("/api/portfolio/approve", {
        params: { confirm: true },
      });
      setResult(r);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The approval call failed.");
    } finally {
      setBusy(null);
      setArmed(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {armed ? (
          <>
            <span className="text-[12px] text-foreground">
              Approves every queued action and rewrites the runs. Proceed?
            </span>
            <button
              type="button"
              onClick={approve}
              disabled={busy !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-measured/50 px-3 text-[12px] text-measured transition-colors hover:bg-measured/10"
            >
              {busy === "approve" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              {busy === "approve" ? "Approving" : "Yes, approve"}
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
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-3 text-[12px] text-foreground transition-colors hover:border-foreground/30 disabled:opacity-60"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Approve the whole book
          </button>
        )}

      </div>

      {result && (
        <p className="text-right text-[11px] text-muted-foreground">
          <span className="text-measured">{formatCount(result.executed)} executed</span> ·{" "}
          <span className="text-denied">{formatCount(result.denied)} still denied</span> ·{" "}
          measured now {formatMoney(paise(result.total_measured_paise))}
        </p>
      )}

      {error && <p className="text-right text-[11px] text-denied">{error}</p>}

      {!result && !error && (
        <p className={cn("text-right text-[11px] text-muted-foreground/70")}>
          Denials stay denied — approving grants no new authority.
        </p>
      )}
    </div>
  );
}
