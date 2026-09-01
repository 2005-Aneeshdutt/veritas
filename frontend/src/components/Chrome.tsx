"use client";

import { ReactNode } from "react";
import { Helpdesk } from "@/components/Helpdesk";
import { Logo, Sidebar } from "@/components/Sidebar";

export { Logo };

/**
 * The chrome every signed-in page shares.
 *
 * This was a top bar plus a five-step strip under it, which cost two rows of
 * height on every page and still had nowhere to put anything that was not a
 * step. The navigation moved left: the five steps keep their numbers and
 * their order, and the rooms you visit to check a claim — the defect backlog,
 * the evidence, your own data — get named instead of hidden behind a step
 * they do not belong to.
 *
 * What is left here is the page's own actions. It renders only when a page
 * has some, so most pages start at their heading.
 *
 * @param right    per-page actions, right-aligned.
 * @param runHref  the run in view, so steps 3 and 4 point at it.
 */
export function TopBar({ right, runHref }: { right?: ReactNode; runHref?: string | null }) {
  return (
    <>
      <Sidebar runHref={runHref} />
      {right && (
        <header className="sticky top-0 lg:top-0 z-20 bg-canvas/85 backdrop-blur-xl border-b border-line">
          <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-end gap-2">
            {right}
          </div>
        </header>
      )}
      <Helpdesk />
    </>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas lg:pl-60">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
