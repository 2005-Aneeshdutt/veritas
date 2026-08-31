"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Chrome";
import { inr } from "@/lib/types";

interface Preview {
  merchant_name: string;
  run_id: string;
  intent: "approve" | "reject";
  title: string;
  why: string;
  count: number;
  total_paise: number;
  already_applied: boolean;
  expires_at: number;
}

interface Outcome {
  ok: boolean;
  intent: string;
  headline: string;
  detail?: string;
  executed?: number;
  allowed?: number;
  stepped_up?: number;
  denied?: number;
  recovered_paise?: number;
  ledger_added?: number;
  chain_verified?: boolean;
}

/**
 * Where an Approve button in an email lands.
 *
 * It shows what the link would do and then stops. That is the whole reason
 * this page exists rather than the link acting directly: Gmail, Outlook and
 * corporate security scanners fetch every URL in a message before a person
 * ever opens it, so a link that applied a payment fix would fire on
 * delivery — in a scanner, with nobody having decided anything.
 *
 * So the fetch on load is a read, and acting takes a press. It is also the
 * more honest interface: a merchant clicking from their phone gets to see
 * the amount and the count before they commit to it.
 *
 * Deliberately signed-out. Whoever holds the link holds a signed grant for
 * one fix on one run, and asking them to log in to use a link we mailed them
 * would be theatre.
 */
export default function DecidePage({ params }: { params: { token: string } }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/decide/${params.token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail ?? "This link could not be read.");
        setPreview(d);
      })
      .catch((e) => setError(e.message));
  }, [params.token]);

  async function act() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/decide/${params.token}`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail ?? "That did not go through.");
      setOutcome(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const approving = preview?.intent === "approve";

  return (
    <div className="min-h-screen bg-canvas grid place-items-center px-5 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <Logo />
        </div>

        {error && (
          <div className="card p-6 border-l-2 border-l-rose">
            <div className="chip-warn">this link cannot be used</div>
            <p className="text-sm text-muted mt-3 leading-relaxed">{error}</p>
            <p className="text-[11px] text-faint mt-4 leading-relaxed">
              Links are signed and expire after seven days. Ask for a fresh
              report and it will carry new ones.
            </p>
          </div>
        )}

        {!error && !preview && (
          <div className="card p-6 text-sm text-muted animate-breathe">
            checking this link…
          </div>
        )}

        {preview && !outcome && (
          <div className="card p-7">
            <div className="eyebrow">
              {preview.merchant_name} · run {preview.run_id}
            </div>
            <h1 className="text-xl font-semibold mt-2">
              {approving ? "Approve this fix?" : "Reject this fix?"}
            </h1>

            <div className="card-raised p-4 mt-5">
              <div className="font-medium text-sm">{preview.title}</div>
              {preview.why && (
                <p className="text-sm text-muted mt-1.5 leading-relaxed">
                  {preview.why}
                </p>
              )}
              {/* Escalations and settings changes carry no per-payment
                  amount on purpose. "Rs 0 at stake" is true and reads as a
                  broken number, which costs more than the line is worth. */}
              <div
                className={`num text-sm mt-3 ${
                  preview.total_paise ? "text-amber" : "text-faint"
                }`}
              >
                {preview.total_paise > 0
                  ? `${inr(preview.total_paise)} at stake · ${preview.count} payment${
                      preview.count === 1 ? "" : "s"
                    }`
                  : `${preview.count} item${
                      preview.count === 1 ? "" : "s"
                    } · no money moves`}
              </div>
            </div>

            {preview.already_applied && (
              <p className="text-[13px] text-amber mt-4 leading-relaxed">
                This fix has already been applied on this run. Approving again
                will only re-gate anything still waiting.
              </p>
            )}

            <p className="text-sm text-muted mt-5 leading-relaxed">
              {approving
                ? "Every action is checked against the authorisation you signed, one at a time. Anything above your ceiling stays refused however many times it is approved, and all of it lands in an audit trail you can inspect."
                : "Nothing will be sent to any payment rail. The decision is recorded against the run so the agent does not propose it again."}
            </p>

            <button
              onClick={act}
              disabled={busy}
              className={`mt-6 h-10 px-5 text-sm ${
                approving ? "btn-primary" : "btn-secondary"
              }`}
            >
              {busy
                ? "working…"
                : approving
                ? "Yes, approve and run it"
                : "Yes, reject it"}
            </button>

            <p className="text-[11px] text-faint mt-4 leading-relaxed">
              Nothing has happened yet. This page only reads the link — opening
              it, including by a mail scanner, changes nothing.
            </p>
          </div>
        )}

        {outcome && (
          <div
            className={`card p-7 border-l-2 ${
              outcome.intent === "approve" ? "border-l-mint" : "border-l-line"
            }`}
          >
            <div
              className={
                outcome.intent === "approve" ? "chip-measured" : "chip-neutral"
              }
            >
              {outcome.intent === "approve" ? "approved" : "rejected"}
            </div>
            <h1 className="text-lg font-semibold mt-3 leading-snug">
              {outcome.headline}
            </h1>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              {outcome.detail}
            </p>

            {outcome.intent === "approve" && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                <Fig k="executed" v={String(outcome.executed ?? 0)} tone="text-mint" />
                <Fig k="need you" v={String(outcome.stepped_up ?? 0)} tone="text-amber" />
                <Fig k="denied" v={String(outcome.denied ?? 0)} tone="text-rose" />
                <Fig k="ledger rows" v={`+${outcome.ledger_added ?? 0}`} />
              </div>
            )}

            {outcome.chain_verified && (
              <p className="text-[11px] text-faint mt-5 leading-relaxed">
                The audit chain re-verified from genesis after these entries
                were written.
              </p>
            )}

            {/* Somewhere to go and check. A decision that ends on a page with
                no way back leaves the merchant taking the outcome on faith,
                when the whole point is that they can inspect it. */}
            {preview && (
              <div className="flex flex-wrap gap-2 mt-6 pt-5 border-t border-line">
                <Link
                  href={`/run/${preview.run_id}/authorise`}
                  className="btn-primary h-9 px-4 text-sm"
                >
                  See the audit trail →
                </Link>
                <Link href="/portfolio" className="btn-secondary h-9 px-4 text-sm">
                  Open the book
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Fig({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="card-raised p-3">
      <div className="eyebrow">{k}</div>
      <div className={`num text-lg font-semibold mt-1 ${tone ?? ""}`}>{v}</div>
    </div>
  );
}
