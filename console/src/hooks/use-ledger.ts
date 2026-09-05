import { useQuery } from "@tanstack/react-query";
import { LEDGER_ENTRIES, type LedgerEntry } from "@/data/proof";
import { auditQueryOptions, backendConnected } from "@/data/services";
import type { AuditEntry, AuditResponse } from "@/data/api-types";
import { paise } from "@/domain/money";
import type { ClaimState } from "@/domain/types";

/**
 * The audit ledger, from the backend when there is one.
 *
 * One distinction this deliberately preserves: chain verification is not
 * recovery verification. `chains_verified` says the hash chain is intact — that
 * the record has not been altered — and says nothing at all about whether money
 * moved. They are different claims about different things, and a screen that
 * merges them would let an intact chain imply a recovered rupee.
 */
function claimOf(e: AuditEntry): ClaimState {
  if (e.gate_decision === "deny") return "ABSTAINED";
  return "VERIFIED"; // the ENTRY is verified: it is in the chain, hashed and ordered
}

function mapEntry(e: AuditEntry, i: number): LedgerEntry {
  return {
    n: e.sequence,
    entry: `#${e.sequence}`,
    at: e.timestamp,
    actor: e.merchant ? "agent" : "agent",
    payment: e.txn_id,
    action: e.action_type,
    decision: e.gate_decision,
    outcome: e.gate_decision === "deny" ? "refused" : "recorded",
    // The audit feed reports the amount the ACTION was proposed on, which is
    // not a recovered amount. It is shown as the action's value, never as a
    // claim of money moved.
    amount: paise(e.amount_paise),
    claim: claimOf(e),
    prevHash: "",
    hash: "",
    status: e.run_id,
    caseId: e.txn_id,
    ...(i >= 0 ? {} : {}),
  };
}

export function useLedger(limit = 60): {
  entries: LedgerEntry[];
  summary: AuditResponse | null;
  isFixture: boolean;
  isPending: boolean;
} {
  const connected = backendConnected();
  const query = useQuery({ ...auditQueryOptions(limit), enabled: connected });

  if (connected && query.data) {
    return {
      entries: query.data.recent.map(mapEntry),
      summary: query.data,
      isFixture: false,
      isPending: false,
    };
  }
  return {
    entries: LEDGER_ENTRIES,
    summary: null,
    isFixture: true,
    isPending: connected && query.isPending,
  };
}
