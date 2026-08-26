"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
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
          <Account />
        </div>
      </div>
    </header>
  );
}

/** Who is signed in, and the way out. */
function Account() {
  const router = useRouter();
  const [who, setWho] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setWho(localStorage.getItem("rd-user"));
    } catch {
      /* private mode: just show the generic avatar */
    }
  }, []);

  function signOut() {
    try {
      localStorage.removeItem("rd-user");
    } catch {
      /* nothing to clear */
    }
    router.push("/");
  }

  const initial = (who || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Account"
        className="w-8 h-8 rounded-full border border-line bg-raised text-xs font-semibold
                   text-muted hover:text-ink hover:border-edge transition-colors"
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-10 z-50 w-56 card p-1 shadow-lift animate-rise"
          >
            <div className="px-3 py-2 border-b border-line">
              <div className="text-xs text-muted">Signed in as</div>
              <div className="text-sm truncate">{who || "a guest"}</div>
            </div>
            <button
              onClick={signOut}
              className="w-full text-left px-3 py-2 text-sm rounded-md
                         hover:bg-raised transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
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
