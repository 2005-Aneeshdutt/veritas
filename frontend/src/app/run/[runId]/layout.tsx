"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Merchant } from "@/lib/types";

const TABS = [
  { href: "", label: "Overview", hint: "the money and the gap" },
  { href: "/flow", label: "Agent flow", hint: "watch all ten nodes run" },
  { href: "/diagnosis", label: "Diagnosis", hint: "why, with the arithmetic" },
  { href: "/validation", label: "Validation", hint: "how often it is wrong" },
  { href: "/audit", label: "Audit", hint: "verify the chain yourself" },
  { href: "/exceptions", label: "Exceptions", hint: "what it could not fix" },
];

export default function RunLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { runId: string };
}) {
  const path = usePathname();
  const base = `/run/${params.runId}`;
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/merchants").then((r) => r.json()).then(setMerchants).catch(() => {});
    fetch(`/api/run/${params.runId}`)
      .then((r) => r.json())
      .then((d) => setCurrent(d.merchant_id))
      .catch(() => {});
  }, [params.runId]);

  async function switchTo(id: string) {
    if (id === current) return;
    setSwitching(true);
    const r = await fetch(`/api/run?merchant=${id}`, { method: "POST" });
    const rec = await r.json();
    const tail = path.replace(base, "");
    window.location.href = `/run/${rec.run_id}${tail}`;
  }

  return (
    <div className="min-h-screen">
      <div
        className="pointer-events-none fixed inset-0 bg-grid opacity-40"
        style={{
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(900px 500px at 50% 0%, #000, transparent 70%)",
        }}
      />

      <nav className="sticky top-0 z-40 border-b border-line bg-void/85 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-6">
          {/* row 1 — identity + merchant switcher */}
          <div className="flex items-center gap-4 h-14">
            <Link href="/" className="flex items-center gap-2 shrink-0 group">
              <span className="w-6 h-6 rounded-md bg-gradient-to-br from-gold to-gold-dim
                               flex items-center justify-center text-void text-xs font-bold">
                R
              </span>
              <span className="font-display font-bold text-sm group-hover:text-gold transition-colors">
                Revenue Doctor
              </span>
            </Link>

            <Link
              href="/portfolio"
              className="text-xs text-muted hover:text-gold transition-colors whitespace-nowrap"
            >
              book view
            </Link>

            <div className="h-5 w-px bg-line" />

            <div className="flex items-center gap-1 overflow-x-auto">
              {merchants.map((m) => (
                <button
                  key={m.merchant_id}
                  onClick={() => switchTo(m.merchant_id)}
                  disabled={switching}
                  className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors
                    ${
                      m.merchant_id === current
                        ? "bg-gold/15 text-gold border border-gold/30"
                        : "text-muted hover:text-ink hover:bg-white/[0.04] border border-transparent"
                    }`}
                >
                  {m.name}
                </button>
              ))}
              {switching && (
                <span className="eyebrow ml-2 animate-breathe">re-running…</span>
              )}
            </div>
          </div>

          {/* row 2 — pages */}
          <div className="flex items-center gap-1 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const href = base + t.href;
              const active = path === href;
              return (
                <Link
                  key={t.href}
                  href={href}
                  title={t.hint}
                  className={`px-3 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                    active
                      ? "border-gold text-ink"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="relative max-w-[1400px] mx-auto px-6 py-7">{children}</div>
    </div>
  );
}
