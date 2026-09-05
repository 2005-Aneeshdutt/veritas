import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { apiPost } from "@/data/http";
import { backendConnected } from "@/data/services";
import { cn } from "@/lib/utils";

/** Fired after a successful reset so anything holding run results can drop them. */
export const DEMO_RESET_EVENT = "veritas:demo-reset";

/**
 * Put the book back.
 *
 * Approving the queue rewrites the committed runs, which is the point -- it is
 * what turns a projection into a measured outcome or a miss. But a rehearsal
 * that cannot be undone is a rehearsal you get one of, so `/api/demo/reset`
 * rebuilds every run deterministically from the cached model calls, reusing
 * each run id. The figures return to exactly what they were and every link
 * still resolves.
 *
 * It lives in the top bar rather than on one page because the demo ends
 * wherever it ends, and hunting for the undo is not a thing to do in front of
 * an audience. It fires on the first click for the same reason: this IS the
 * undo, and a confirmation step on the undo is a trap, not a guard.
 */
export function DemoReset() {
  const connected = backendConnected();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!connected) return null;

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await apiPost("/api/demo/reset");
      // Everything on screen was read from the runs that were just rebuilt.
      await qc.invalidateQueries();
      window.dispatchEvent(new CustomEvent(DEMO_RESET_EVENT));
      setDone(true);
      timer.current = window.setTimeout(() => setDone(false), 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The reset call failed.");
      timer.current = window.setTimeout(() => setError(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? "Resetting the book"
    : error
      ? error
      : done
        ? "Book restored"
        : "Reset the book to its committed state";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void reset()}
        disabled={busy}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors",
          "text-muted-foreground hover:bg-elevated hover:text-foreground",
          "disabled:opacity-60",
          error && "text-denied",
          done && "text-measured",
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="hidden lg:inline">{done ? "Restored" : "Reset"}</span>
      </button>

      {/* Says what happened without moving anything else in the bar. Rendered
          only when there is something to say: a message parked at opacity 0 is
          still in the DOM, the accessibility tree and any text search. */}
      {(error || done) && (
        <span
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px]",
            error
              ? "border-denied/40 bg-denied/10 text-denied"
              : "border-measured/40 bg-measured/10 text-measured",
          )}
        >
          {error ?? "Runs rebuilt — the figures are back to their committed values."}
        </span>
      )}
    </div>
  );
}
