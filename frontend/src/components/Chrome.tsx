"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { ThemeToggle } from "@/components/Theme";

export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const box = size === "lg" ? "w-9 h-9 text-base" : "w-6 h-6 text-[11px]";
  const text = size === "lg" ? "text-lg" : "text-sm";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${box} rounded-md bg-brand text-brand-ink grid place-items-center
                    font-bold shrink-0`}
      >
        R
      </span>
      <span className={`font-display font-semibold ${text} tracking-tightest`}>
        Revenue Doctor
      </span>
    </span>
  );
}

const NAV = [
  { href: "/portfolio", label: "Book" },
  { href: "/drift", label: "Drift" },
];

/** The top bar every signed-in page shares. */
export function TopBar({ right }: { right?: ReactNode }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-6">
        <Link href="/portfolio" className="hover:opacity-80 transition-opacity">
          <Logo />
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                path.startsWith(n.href)
                  ? "text-ink bg-raised"
                  : "text-muted hover:text-ink hover:bg-raised"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {right}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
