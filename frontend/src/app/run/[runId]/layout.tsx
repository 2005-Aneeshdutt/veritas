"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
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
    if (!id || id === current) return;
    setSwitching(true);
    const r = await fetch(`/api/run?merchant=${id}`, { method: "POST" });
    const rec = await r.json();
    const tail = path.replace(base, "");
    window.location.href = `/run/${rec.run_id}${tail}`;
  }

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar
        right={
          <>
            {switching && (
              <span className="eyebrow animate-breathe">re-running…</span>
            )}
            <label className="sr-only" htmlFor="merchant">
              Merchant
            </label>
            <select
              id="merchant"
              value={current}
              disabled={switching || merchants.length === 0}
              onChange={(e) => switchTo(e.target.value)}
              className="field h-8 py-0 pr-8 text-sm max-w-[15rem]"
            >
              {merchants.length === 0 && <option value="">Loading…</option>}
              {merchants.map((m) => (
                <option key={m.merchant_id} value={m.merchant_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        }
      />

      {/* sub-nav — the six views of one merchant */}
      <div className="sticky top-14 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-6 flex items-center gap-1 -mb-px overflow-x-auto">
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
                    ? "border-brand text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
