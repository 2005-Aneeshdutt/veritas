"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Backdrop } from "@/components/Backdrop";
import { Logo } from "@/components/Chrome";
import { ThemeToggle } from "@/components/Theme";

/**
 * Entry screen.
 *
 * Deliberately not real authentication: there is no account system behind
 * this, so it does not ask for a password or pretend to check one. It takes a
 * name so the book view can address you, and says plainly that it is a demo.
 * A sign-in form that looks real but accepts anything would be the wrong thing
 * to build.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  function enter(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      if (email.trim()) localStorage.setItem("rd-user", email.trim());
    } catch {
      /* private mode is fine */
    }
    router.push("/portfolio");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.1fr] bg-canvas">
      {/* The drifting field lives on the front door only. Inside the console
          the motion budget is spent on the lattice and the live stream, and a
          background that competes with those made both pages worse. */}
      <Backdrop />
      {/* ─────────────────────────────────────────────── form */}
      <div className="flex flex-col px-6 sm:px-12 lg:px-16 py-8">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto lg:mx-0 animate-rise">
            <h1 className="text-[24px] font-semibold tracking-tightest">
              Sign in
            </h1>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              Payment recovery for merchant books. Find the gap, prove the cause,
              recover what the mandate allows.
            </p>

            <form onSubmit={enter} className="mt-8 space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-medium text-ink mb-1.5"
                >
                  Work email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="field"
                  autoComplete="email"
                />
              </div>

              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? "Opening…" : "Continue"}
              </button>
            </form>

            <div className="mt-6 rounded-lg border border-line bg-raised p-3">
              <p className="text-xs text-muted leading-relaxed">
                <span className="text-ink font-medium">This is a demo.</span>{" "}
                There is no account system and no password is asked for, because
                there is nothing to authenticate against. Continue with any
                address, or none.
              </p>
            </div>

            <button
              onClick={() => enter()}
              className="mt-4 text-xs link-quiet underline underline-offset-4"
            >
              Skip and open the demo book →
            </button>
          </div>
        </div>

        <div className="text-xs text-faint">
          Built on published NPCI and Razorpay data. Every figure reproduces from
          the repository.
        </div>
      </div>

      {/* ─────────────────────────────────────────────── panel */}
      <aside className="relative overflow-hidden border-t lg:border-t-0 lg:border-l border-line">
        <div className="absolute inset-0 bg-spectrum opacity-[0.16]" />
        <div
          className="absolute inset-0 bg-grid opacity-40"
          style={{ backgroundSize: "44px 44px" }}
        />

        <div className="relative h-full flex flex-col justify-center px-8 py-14 lg:px-16 lg:py-0">
          <div className="max-w-lg">
            <div className="eyebrow">What it does</div>
            <h2 className="text-[24px] font-semibold tracking-tightest mt-3 leading-[1.15]">
              Every merchant can see their success rate.
              <br />
              Nobody tells them what it should be.
            </h2>

            <div className="mt-10 space-y-5">
              <Point
                k="Finds the gap"
                v="Compares each merchant against what their category actually achieves, and splits the shortfall across four causes that provably sum to the whole."
              />
              <Point
                k="Recovers under mandate"
                v="Executes only what the merchant cryptographically authorised. Every allowed, escalated and denied action lands in a hash-chained audit trail."
              />
              <Point
                k="Reports its own error"
                v="Measured on 200 merchants with known answers — and it refuses to act on any signal smaller than its own error bar."
              />
            </div>

            <div className="mt-10 pt-6 border-t border-line">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-[24px] font-semibold tracking-tightest text-brand">
                    ₹5.56L
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    recoverable, found across 8 merchants
                  </div>
                </div>
                <div>
                  <div className="text-[24px] font-semibold tracking-tightest text-mint">
                    ₹1.94L
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    recovered — and marked against known truth
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4 pt-5 border-t border-line">
                <Stat k="± 0.57" v="attribution error, points" />
                <Stat k="97.5%" v="primary cause found" />
                <Stat k="0" v="mandate violations" />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Point({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
      <div>
        <div className="text-sm font-medium">{k}</div>
        <div className="text-sm text-muted leading-relaxed mt-0.5">{v}</div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tracking-tightest">{k}</div>
      <div className="text-xs text-muted mt-0.5 leading-snug">{v}</div>
    </div>
  );
}
