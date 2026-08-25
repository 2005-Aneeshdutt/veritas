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
            className="glass-raised px-3 py-1.5 text-xs hover:border-gold/40 transition-colors"
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
              <div className="glass-raised overflow-hidden">
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
                  className="px-3 py-1.5 rounded-lg bg-gold text-void text-xs font-semibold
                             hover:bg-gold-glow transition-colors"
                >
                  {copied ? "✓ copied" : "Copy"}
                </button>
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
                    email.subject
                  )}&body=${encodeURIComponent(email.body)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg glass-raised text-xs
                             hover:border-gold/40 transition-colors"
                >
                  Open in Gmail ↗
                </a>
                <a
                  href={`/api/run/${runId}/email.eml`}
                  className="px-3 py-1.5 rounded-lg glass-raised text-xs
                             hover:border-gold/40 transition-colors"
                >
                  ↓ .eml
                </a>
                <a
                  href={`/api/run/${runId}/ledger.csv`}
                  className="px-3 py-1.5 rounded-lg glass-raised text-xs
                             hover:border-gold/40 transition-colors"
                >
                  ↓ audit trail as CSV
                </a>
              </div>

              <p className="text-[11px] text-faint mt-3 leading-relaxed">
                Opens a pre-filled Gmail compose window — nothing is sent
                automatically, and this app never holds your mail credentials.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
