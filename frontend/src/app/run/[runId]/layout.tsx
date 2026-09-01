"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { Segmented } from "@/components/ui";
import { Merchant } from "@/lib/types";

/**
 * Two lenses on one merchant, not a second navigation.
 *
 * This was a four-tab strip — Findings, How it worked, One payment,
 * Authorise — sitting under a sidebar that already numbered the walkthrough.
 * Sidebar steps 2 and 3 both pointed into it, so a viewer watching one
 * continuous thing saw the step number change AND a tab change. That is the
 * exact problem the sidebar was built to remove, reappearing a level down.
 *
 * Two of the four left:
 *
 *   * Authorise is step 3. It is a different stage of the story, not a
 *     different view of this one, and it belongs where the numbers are
 *   * One payment is a detail view. It is reached by clicking a payment —
 *     from the held queue, or from the ledger on Evidence — which is where
 *     someone actually wants it, and nobody navigates to "some payment"
 *
 * What is left is genuinely two views of the same object, so it is drawn the
 * same way the book's three lenses are: a segmented control, not a tab rail.
 * Merging them into one page was the other option and it would have been a
 * fifteen-hundred-line scroll, which is the complaint this rework started
 * from wearing a different hat.
 */
const LENSES = [
  { value: "", label: "Findings" },
  { value: "/flow", label: "How it worked" },
];

export default function RunLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { runId: string };
}) {
  const path = usePathname();
  const router = useRouter();
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

  // Authorise and the payment file live under the same prefix but are not
  // lenses, so the control hides rather than showing a wrong selection.
  const lensed = path === base || path === `${base}/flow`;
  const lens = path === `${base}/flow` ? "/flow" : "";

  return (
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar
        right={
          <>
            {switching && <span className="eyebrow animate-breathe">re-running…</span>}
            <label className="sr-only" htmlFor="merchant">
              Merchant
            </label>
            <select
              id="merchant"
              value={current}
              disabled={switching || merchants.length === 0}
              onChange={(e) => switchTo(e.target.value)}
              className="field h-8 py-0 pr-8 text-[13px] max-w-[14rem]"
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

      <main className="max-w-[1180px] mx-auto px-8 py-8">
        {lensed && (
          <div className="flex justify-end -mb-2">
            <Segmented
              options={LENSES}
              value={lens}
              onChange={(v) => router.push(base + v)}
            />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
