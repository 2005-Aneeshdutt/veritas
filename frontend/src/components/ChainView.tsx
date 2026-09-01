"use client";

import { useState } from "react";

/**
 * The hash chain, drawn as a chain, verified in front of you.
 *
 * A ledger rendered as a table with a hash column proves that hashes exist.
 * It does not show that they are LINKED, which is the entire property. So
 * every entry's prev_hash sits directly under the previous entry's own hash,
 * the pair either matches or it does not, and the first one is sixty-four
 * zeros because that is where a chain provably starts.
 *
 * The verification is the page's existing client-side check — SHA-256
 * recomputed in the browser over the canonical encoding, the same way the
 * Python ledger does it. This component only paces the display of a result
 * that already happened, so a viewer can watch entries confirm rather than
 * being handed a green tick. Nothing here decides whether the chain is
 * intact.
 */

export interface Link {
  sequence: number;
  txn_id: string;
  gate_decision?: string;
  gate_reason?: string;
  outcome?: string;
  actor?: string;
  prev_hash: string;
  entry_hash: string;
  timestamp?: string;
  proposed_action?: { action_type?: string; amount_paise?: number };
}

const EDGE: Record<string, string> = {
  allow: "border-l-mint",
  step_up: "border-l-amber",
  deny: "border-l-rose",
};

const TONE: Record<string, string> = {
  allow: "text-mint",
  step_up: "text-amber",
  deny: "text-rose",
};

export function ChainView({
  entries,
  verifiedTo,
  onInspect,
  limit = 10,
}: {
  entries: Link[];
  /** How many entries the running verification has confirmed so far. */
  verifiedTo?: number;
  onInspect?: (e: Link) => void;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, limit);

  return (
    <div>
      <div className="flex items-center gap-2 pl-3 pb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-edge shrink-0" />
        <span className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
          genesis
        </span>
        <span className="num text-[10px] text-faint truncate">
          {"0".repeat(48)}…
        </span>
      </div>

      <ol>
        {shown.map((e, i) => {
          const confirmed = verifiedTo === undefined || i < verifiedTo;
          const linked = e.prev_hash === (i > 0 ? shown[i - 1].entry_hash : e.prev_hash);
          return (
            <li key={e.entry_hash ?? i}>
              {/* the link itself: this entry's prev, under the last one's hash */}
              <div className="flex items-center gap-2 pl-3.5">
                <span className="w-px h-3.5 bg-line shrink-0" />
                <span className="num text-[10px] text-faint truncate">
                  prev {e.prev_hash?.slice(0, 28)}…
                </span>
                {!linked && <span className="chip text-rose">BREAK</span>}
              </div>

              <button
                onClick={() => onInspect?.(e)}
                className={`w-full text-left border-l-2 pl-3 pr-2 py-1.5 rounded-r-md
                            transition-colors hover:bg-raised ${
                              EDGE[e.gate_decision ?? ""] ?? "border-l-line"
                            } ${onInspect ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className="flex items-center gap-2 flex-wrap text-[12px]">
                  <span
                    className={`num text-[10px] w-9 shrink-0 ${
                      confirmed ? "text-mint" : "text-faint"
                    }`}
                  >
                    {confirmed ? "✓" : "◌"} {e.sequence}
                  </span>
                  <span className="num text-[11px] truncate max-w-[11rem]">
                    {e.txn_id}
                  </span>
                  <span className="text-muted text-[11px] truncate">
                    {String(e.proposed_action?.action_type ?? "").replace(/_/g, " ")}
                  </span>
                  {e.gate_decision && (
                    <span className={`chip ${TONE[e.gate_decision] ?? "text-muted"}`}>
                      {e.gate_decision}
                    </span>
                  )}
                  <span className="text-[10px] text-faint ml-auto shrink-0">
                    {e.actor ?? "agent"}
                  </span>
                </div>
                <div className="num text-[10px] text-brand mt-0.5 truncate">
                  hash {e.entry_hash?.slice(0, 28)}…
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      {entries.length > limit && (
        <button
          onClick={() => setAll(!all)}
          className="text-[12px] text-brand mt-3 pl-3"
        >
          {all
            ? `show the first ${limit}`
            : `show all ${entries.length} links in the chain`}
        </button>
      )}
    </div>
  );
}

/**
 * Verification, counted rather than asserted.
 *
 * The check itself is whatever the caller passes in — the page's own
 * client-side SHA-256 pass. This walks a counter up to the number of entries
 * it confirmed, so an audience sees 1,057 entries go by instead of a boolean
 * turning green. If the check failed, the counter stops where it broke.
 */
export function VerifyProgress({
  total,
  verified,
  running,
  broken,
}: {
  total: number;
  verified: number;
  running: boolean;
  broken?: number | null;
}) {
  const pct = total ? (verified / total) * 100 : 0;
  const failed = broken !== null && broken !== undefined;

  return (
    <div className="panel p-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="ui text-[11px] uppercase tracking-[0.12em] text-muted">
          {running
            ? "Verifying from genesis"
            : failed
            ? "Chain broken"
            : verified
            ? "Chain intact"
            : "Not yet verified"}
        </span>
        <span
          className={`num text-[13px] ml-auto ${
            failed ? "text-rose" : verified === total && total ? "text-mint" : ""
          }`}
        >
          {verified.toLocaleString("en-IN")} / {total.toLocaleString("en-IN")}
        </span>
      </div>

      <div className="h-1 rounded-full bg-raised mt-3 overflow-hidden">
        <div
          className={`h-full transition-[width] duration-150 ${
            failed ? "bg-rose" : "bg-mint"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-[11px] text-muted mt-2.5 leading-relaxed">
        {failed
          ? `Entry ${broken} does not match the hash recorded for it. Every entry after it is unverifiable.`
          : running
          ? "Recomputing SHA-256 over each entry's canonical encoding, in this browser."
          : verified === total && total
          ? "Every entry re-hashed from genesis to head, in this browser — not read off a flag the server sent."
          : "Press verify to recompute every hash client-side."}
      </p>
    </div>
  );
}
