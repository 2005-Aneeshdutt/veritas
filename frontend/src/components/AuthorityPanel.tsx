"use client";

import { useEffect, useState } from "react";
import { Card, Detail, Eyebrow, SectionHeader } from "@/components/ui";
import { inr } from "@/lib/types";

interface Proposal {
  field: string;
  current_paise: number;
  proposed_paise: number;
  unlocks_count: number;
  unlocks_paise: number;
  recovery_low_paise: number;
  recovery_high_paise: number;
  calibration_note: string;
  exposure: string;
  rationale: string;
}

interface Review {
  merchant_id: string;
  blocked: { reason: string; count: number; total_paise: number }[];
  blocked_total_paise: number;
  held_count: number;
  held_total_paise: number;
  proposals: Proposal[];
  no_change_needed: boolean;
  headline: string;
  current_mandate: Record<string, any>;
  draft_mandate?: Record<string, any>;
  signing_payload_sha256?: string;
}

const LABEL: Record<string, string> = {
  max_amount_paise: "Hard ceiling",
  auto_execute_limit_paise: "Auto-execute limit",
};

const SUB: Record<string, string> = {
  max_amount_paise: "above this, the agent is refused outright",
  auto_execute_limit_paise: "above this, it stops and asks you",
};

/**
 * What the merchant's own limits cost them.
 *
 * Every other panel in this app reports on payments. This one reports on the
 * mandate itself, because the numbers on the audit page — 91 denied, 661
 * waiting — were a dead end for the person who signed it. They chose ₹300 and
 * ₹2,000 out of the air, since nobody has a method for setting an agent's
 * permissions.
 *
 * The one thing this must never do is sign. The draft is shown as a diff and
 * as the exact bytes a merchant's key would sign; producing the signature
 * needs a key this system has never held. An agent that could widen its own
 * authority would make the entire policy kernel decorative, so the panel ends
 * at a hash and a hand-off rather than at a confirmation.
 */
export function AuthorityPanel({ runId }: { runId: string }) {
  const [rv, setRv] = useState<Review | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/run/${runId}/authority`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRv)
      .catch(() => setErr(true));
  }, [runId]);

  if (err || !rv) return null;

  return (
    <Card>
      <SectionHeader
        eyebrow="What your own limits cost you"
        title="Mandate review"
        sub="Every protocol for agent payments says how to express an agent's authority. None says how to choose it. This reads your ledger back and prices the limits you picked."
      />

      <p className="text-[15px] leading-relaxed">{rv.headline}</p>

      {/* ── what the limits turned away ─────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <Stat
          k="denied outright"
          v={inr(rv.blocked_total_paise, { compact: true })}
          sub={`${rv.blocked.reduce((a, b) => a + b.count, 0)} actions`}
          tone={rv.blocked_total_paise ? "text-rose" : "text-muted"}
        />
        <Stat
          k="held for your click"
          v={inr(rv.held_total_paise, { compact: true })}
          sub={`${rv.held_count} actions`}
          tone={rv.held_count ? "text-amber" : "text-muted"}
        />
        <Stat
          k="proposed changes"
          v={String(rv.proposals.length)}
          sub={rv.no_change_needed ? "none needed" : "for you to sign"}
          tone={rv.proposals.length ? "text-brand" : "text-mint"}
        />
      </div>

      {/* ── the case for each change ────────────────────────────────── */}
      {rv.proposals.map((p) => (
        <div key={p.field} className="card-raised p-4 mt-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-semibold text-sm">{LABEL[p.field] ?? p.field}</span>
            <span className="text-[11px] text-faint">{SUB[p.field]}</span>
          </div>

          <div className="flex items-center gap-3 mt-2.5 flex-wrap">
            <span className="num text-lg text-muted line-through decoration-rose/50">
              {inr(p.current_paise)}
            </span>
            <span className="text-muted">→</span>
            <span className="num text-lg font-semibold text-brand">
              {inr(p.proposed_paise)}
            </span>
            <span className="chip-neutral">
              +{p.unlocks_count} actions · {inr(p.unlocks_paise, { compact: true })}
            </span>
          </div>

          <p className="text-sm text-muted mt-3 leading-relaxed">{p.rationale}</p>

          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <div>
              <Eyebrow>modelled recovery</Eyebrow>
              <div className="num text-sm mt-0.5">
                {inr(p.recovery_low_paise, { compact: true })} –{" "}
                {inr(p.recovery_high_paise, { compact: true })}
              </div>
              <p className="text-[11px] text-faint mt-1 leading-relaxed">
                {p.calibration_note}
              </p>
            </div>
            <div>
              <Eyebrow>what it exposes</Eyebrow>
              <p className="text-[11px] text-faint mt-1 leading-relaxed">
                {p.exposure}
              </p>
            </div>
          </div>
        </div>
      ))}

      {rv.no_change_needed && (
        <p className="text-sm text-muted mt-3 leading-relaxed">
          Nothing here is worth re-signing a mandate over. This is reported as a
          result rather than padded into a recommendation — a review that always
          tells you to widen your limits is not a review.
        </p>
      )}

      {/* ── the draft ───────────────────────────────────────────────── */}
      {rv.draft_mandate && (
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setOpen(!open)}
              className="btn-primary h-9 px-4 text-sm"
            >
              {open ? "Hide revised mandate" : "Review revised mandate →"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="btn-secondary h-9 px-4 text-sm"
            >
              Keep it as it is
            </button>
          </div>

          {open && (
            <div className="card-raised p-4 mt-3 animate-rise">
              <Eyebrow>the diff you would be signing</Eyebrow>
              <div className="font-mono text-[11px] mt-2 space-y-1">
                {Object.keys(rv.current_mandate).map((k) => {
                  const a = rv.current_mandate[k];
                  const b = rv.draft_mandate![k];
                  const same = JSON.stringify(a) === JSON.stringify(b);
                  if (same) return null;
                  return (
                    <div key={k} className="flex flex-wrap gap-2">
                      <span className="text-faint w-56 shrink-0">{k}</span>
                      <span className="text-rose">
                        − {typeof a === "number" ? inr(a) : String(a)}
                      </span>
                      <span className="text-mint">
                        + {typeof b === "number" ? inr(b) : String(b)}
                      </span>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="text-faint w-56 shrink-0">everything else</span>
                  <span className="text-muted">unchanged</span>
                </div>
              </div>

              <div className="border-t border-line mt-3 pt-3">
                <Eyebrow>sha-256 of the bytes your key would sign</Eyebrow>
                <div className="font-mono text-[11px] break-all mt-1 text-muted">
                  {rv.signing_payload_sha256}
                </div>
                <Detail summary="why the agent cannot sign this">
                  <p className="text-sm text-muted mt-3 leading-relaxed">
                  This is where the agent stops. Turning this draft into
                  authority takes your Ed25519 private key, which this system
                  has never held and cannot ask for — an agent able to sign its
                  own mandate would make every check on this page decorative.
                  Sign these bytes offline and the new mandate governs the next
                  run.
                </p>
                </Detail>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({
  k,
  v,
  sub,
  tone,
}: {
  k: string;
  v: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="card-raised p-3">
      <div className="eyebrow">{k}</div>
      <div className={`num text-xl font-semibold mt-1 ${tone ?? ""}`}>{v}</div>
      <div className="text-[11px] text-faint mt-0.5">{sub}</div>
    </div>
  );
}
