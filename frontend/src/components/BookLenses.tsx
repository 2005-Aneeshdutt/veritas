"use client";

import { useRouter, usePathname } from "next/navigation";
import { Segmented } from "@/components/ui";

/**
 * Three lenses on one object.
 *
 * Live and bank drift were a numbered step and an orphan link respectively.
 * Neither is a stage in the walkthrough — they are the book right now rather
 * than the book this month, and putting the live stream between "the Book
 * says CloudSync is bleeding" and "here is CloudSync" broke the only causal
 * link the demo has.
 *
 * They stay separate routes so deep links keep working and so a page with a
 * live SSE connection is not mounted while nobody is looking at it. What
 * changes is that they read as one destination.
 */
const LENSES = [
  { value: "/portfolio", label: "Ranked" },
  { value: "/live", label: "Live", tag: "live" },
  { value: "/drift", label: "Bank drift" },
] as const;

export function BookLenses() {
  const router = useRouter();
  const path = usePathname();
  const current =
    (LENSES.find((l) => l.value === path)?.value ?? "/portfolio") as string;

  return (
    <Segmented
      options={LENSES.map((l) => ({ ...l, value: l.value as string }))}
      value={current}
      onChange={(v) => router.push(v)}
    />
  );
}
