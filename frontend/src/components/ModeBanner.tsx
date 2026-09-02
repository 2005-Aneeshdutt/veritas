"use client";

import { useEffect, useState } from "react";

/**
 * Which world the numbers on this page came from.
 *
 * The product has always been careful about measured versus projected. This
 * is the second distinction, and it is harder to see: a recovered rupee from
 * a deterministic replay and one from a real gateway render identically, and
 * only one of them means an external system agreed with us.
 *
 * So it sits in the sidebar on every page rather than on a settings screen.
 * A judge should never have to wonder which mode they are looking at, and the
 * answer should never be more than one glance away.
 *
 * Deliberately not a toast, a modal, or a coloured bar across the top. It is
 * a status line — the kind of thing an operator glances at and stops noticing
 * until it changes, which is exactly the job.
 */
export function ModeBanner() {
  const [m, setM] = useState<any>(null);

  useEffect(() => {
    fetch("/api/mode")
      .then((r) => r.json())
      .then(setM)
      .catch(() => {});
  }, []);

  if (!m) return null;

  const test = m.mode === "razorpay_test";

  return (
    <div className="px-3 py-2.5 border-t border-line">
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            test ? "bg-sky" : "bg-amber"
          }`}
        />
        <span
          className={`ui text-[9.5px] uppercase tracking-[0.1em] font-medium ${
            test ? "text-sky" : "text-amber"
          }`}
        >
          {m.label}
        </span>
      </div>
      <p className="text-[10px] text-faint mt-1 leading-snug">
        {test
          ? "Payment facts come from a Razorpay test-mode account."
          : "Every payment and rupee is generated and replayed. No gateway was contacted."}
      </p>
    </div>
  );
}

/**
 * The same fact, inline, for a page that shows money.
 *
 * @param source  when a single figure has its own provenance — a synthetic
 *                link created while the process is in test mode, say — pass
 *                it so the chip reports the figure rather than the process.
 */
export function ModeChip({ source }: { source?: string }) {
  const [m, setM] = useState<any>(null);

  useEffect(() => {
    if (source) return;
    fetch("/api/mode")
      .then((r) => r.json())
      .then(setM)
      .catch(() => {});
  }, [source]);

  const label = source
    ? source === "razorpay_test"
      ? "razorpay test mode"
      : "synthetic"
    : m?.label?.toLowerCase();
  if (!label) return null;

  return (
    <span className={label.includes("test mode") ? "chip-det" : "chip-projected"}>
      {label}
    </span>
  );
}
