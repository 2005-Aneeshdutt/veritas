"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, SectionHeader } from "@/components/ui";

/**
 * The last mile. A diagnosis nobody reads is worth nothing, and what gets read
 * is a short email with one number and one action.
 *
 * Composed deterministically on the server from the report — every figure is
 * copied from a field, so the email cannot drift from the diagnosis or invent
 * a statistic. Nothing is sent from here: that would need credentials this
 * project deliberately does not hold, which is the same principle as the agent
 * never holding the merchant's signing key.
 */
export function EmailPanel({ runId }: { runId: string }) {
  const [email, setEmail] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [sendState, setSendState] = useState<any>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && !email) {
      fetch(`/api/run/${runId}/email`).then((r) => r.json()).then(setEmail);
    }
  }, [open, email, runId]);

  return (
    <Card>
      <SectionHeader
        eyebrow="The last mile"
        title="Send the merchant their diagnosis"
        sub="Composed from the report field by field, so it cannot quote a number the decomposition does not support."
        right={
          <button
            onClick={() => setOpen(!open)}
            className="card-raised px-3 py-1.5 text-xs hover:border-brand/40 transition-colors"
          >
            {open ? "hide" : "compose email"}
          </button>
        }
      />

      {open && (
        <div className="animate-rise">
          {!email ? (
            <div className="shimmer h-40" />
          ) : (
            <>
              <div className="card-raised overflow-hidden">
                <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
                  <span className="eyebrow">subject</span>
                  <span className="text-sm truncate">{email.subject}</span>
                </div>
                <pre className="p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap
                                text-muted max-h-80 overflow-y-auto">
                  {email.body}
                </pre>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${email.subject}\n\n${email.body}`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-xs font-semibold
                             hover:brightness-110 transition-colors"
                >
                  {copied ? "✓ copied" : "Copy"}
                </button>
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
                    email.subject
                  )}&body=${encodeURIComponent(email.body)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg card-raised text-xs
                             hover:border-brand/40 transition-colors"
                >
                  Open in Gmail ↗
                </a>
                <a
                  href={`/api/run/${runId}/email.eml`}
                  className="px-3 py-1.5 rounded-lg card-raised text-xs
                             hover:border-brand/40 transition-colors"
                >
                  ↓ .eml
                </a>
                <a
                  href={`/api/run/${runId}/ledger.csv`}
                  className="px-3 py-1.5 rounded-lg card-raised text-xs
                             hover:border-brand/40 transition-colors"
                >
                  ↓ audit trail as CSV
                </a>
              </div>

              {/* Real sending, opt-in. Off unless SMTP is configured, and it
                  says so rather than pretending. */}
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="merchant@example.com"
                  className="card-raised px-3 py-1.5 text-xs flex-1 min-w-[200px]
                             placeholder:text-faint"
                />
                <button
                  onClick={async () => {
                    setSending(true);
                    const r = await fetch(
                      `/api/run/${runId}/email/send?to=${encodeURIComponent(to)}`,
                      { method: "POST" }
                    );
                    setSendState(await r.json());
                    setSending(false);
                  }}
                  disabled={sending || !to}
                  className="px-3 py-1.5 rounded-lg card-raised text-xs
                             hover:border-brand/40 transition-colors disabled:opacity-50"
                >
                  {sending ? "sending…" : "Send via SMTP"}
                </button>

                {/* Check the credentials without mailing a real merchant.
                    A typo'd App Password fails exactly like a missing one,
                    and finding that out mid-demo is the wrong time. */}
                <button
                  onClick={async () => {
                    setSending(true);
                    const r = await fetch("/api/email/verify", { method: "POST" });
                    setSendState(await r.json());
                    setSending(false);
                  }}
                  disabled={sending}
                  className="px-3 py-1.5 rounded-lg card-raised text-xs
                             hover:border-brand/40 transition-colors disabled:opacity-50"
                  title="Sign in to the mail server without sending anything"
                >
                  Test credentials
                </button>
              </div>

              {sendState && (
                <div
                  className={`mt-2 text-[11px] leading-relaxed ${
                    sendState.sent
                      ? "text-mint"
                      : sendState.configured
                      ? "text-rose"
                      : "text-muted"
                  }`}
                >
                  {sendState.sent ? "✓ " : ""}
                  {sendState.detail}
                </div>
              )}

              <p className="text-[11px] text-faint mt-3 leading-relaxed">
                The Gmail link opens a pre-filled compose window and sends nothing.
                SMTP sending is opt-in and off by default — this project does not
                need to hold a mail credential to be demonstrated, which is the
                same principle as the agent never holding the signing key.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
