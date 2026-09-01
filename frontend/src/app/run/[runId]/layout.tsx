"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { Merchant } from "@/lib/types";

/**
 * Three views, not six.
 *
 * The six tabs split one story across six screens, and the demo had to visit
 * four of them in order while the top bar offered four more destinations of
 * its own. These three map onto steps 3 and 4 of the spine: what the agent
 * found, how it worked, and what happens next. Validation and Exceptions are
 * sections inside them now rather than places to go.
 */
const TABS = [
  { href: "", label: "Findings" },
  { href: "/flow", label: "How it worked" },
  { href: "/authorise", label: "Authorise" },
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
    <div className="min-h-screen bg-canvas lg:pl-60">
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
        runHref={base}
      />

      {/* sub-nav — three views of one merchant */}
      <div className="border-b border-line bg-canvas">
        <div className="max-w-[1400px] mx-auto px-6 flex items-center gap-1 -mb-px overflow-x-auto no-scrollbar">
          {TABS.map((t) => {
            const href = base + t.href;
            const active = path === href;
            return (
              <Link
                key={t.href}
                href={href}
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
