"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

interface Item {
  href: string | null;
  label: string;
  hint?: string;
  /** Paths that light this row. */
  match?: string[];
  tag?: string;
}

/**
 * The product, down the left.
 *
 * Two groups, and the split is the argument. The first five are a
 * WALKTHROUGH: numbered, ordered, and the order is real — you cannot
 * authorise a recovery you have not diagnosed. The three under Reference are
 * where you go when you have stopped believing the walkthrough and want to
 * check something yourself.
 *
 * Deliberately short. The obvious move with a sidebar is to fill it; the
 * competing entry in this track ships seventeen destinations across five
 * headings and several are labels with nothing behind them. Surface area
 * photographs well and demos badly — nobody watching for five minutes can
 * hold seventeen places in their head, and one empty room costs more trust
 * than the extra row ever bought.
 */
export function Sidebar({ runHref }: { runHref?: string | null }) {
  const path = usePathname();
  const [fallback, setFallback] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Steps 3 and 4 need a run. There is almost always one on disk, so offering
  // a dead row without checking would grey out half the product for nothing.
  useEffect(() => {
    if (runHref) return;
    fetch("/api/run-latest")
      .then((r) => r.json())
      .then((d) => setFallback(d.run_id ? `/run/${d.run_id}` : null))
      .catch(() => {});
  }, [runHref]);

  useEffect(() => setOpen(false), [path]);

  const run = runHref ?? fallback;

  const steps: Item[] = [
    { href: "/portfolio", label: "Book", hint: "where the money leaks", match: ["/portfolio", "/drift"] },
    { href: "/live", label: "Watch", hint: "a bank going bad, live", match: ["/live"], tag: "live" },
    { href: run, label: "Diagnose", hint: "the agent works the case", match: run ? [run] : [] },
    {
      href: run ? `${run}/authorise` : null,
      label: "Authorise",
      hint: "what it may do, what you approve",
      match: run ? [`${run}/authorise`] : [],
    },
    { href: "/prove", label: "Prove", hint: "try to break it", match: ["/prove"] },
  ];

  const reference: Item[] = [
    { href: "/whose-fault", label: "Whose fault", hint: "the platform's own backlog", match: ["/whose-fault"] },
    { href: "/evidence", label: "Evidence", hint: "cost, ledger, accuracy", match: ["/evidence"] },
    { href: "/data", label: "Your own data", hint: "stop taking this on trust", match: ["/data"] },
  ];

  const onAuthorise = path.includes("/authorise");
  const lit = (it: Item, step3: boolean) => {
    const hit = (it.match ?? []).some((m) => path === m || path.startsWith(m + "/"));
    // Diagnose and Authorise share a prefix, so the deeper one wins.
    return step3 ? hit && !onAuthorise : hit;
  };

  return (
    <>
      {/* the bar that exists only when the sidebar is hidden */}
      <div
        className="lg:hidden sticky top-0 z-30 h-14 px-4 flex items-center gap-3
                   border-b border-line bg-canvas/90 backdrop-blur-xl"
      >
        <button
          onClick={() => setOpen(true)}
          className="text-muted hover:text-ink"
          aria-label="Open navigation"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <Link href="/portfolio">
          <Logo />
        </Link>
      </div>

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 border-r border-line bg-canvas
                    flex flex-col transition-transform duration-200 lg:translate-x-0
                    ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-14 px-4 flex items-center border-b border-line shrink-0">
          <Link href="/portfolio" className="hover:opacity-80 transition-opacity">
            <Logo />
          </Link>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto no-scrollbar px-2 py-4 space-y-5">
          <Group title="The walkthrough">
            {steps.map((it, i) => (
              <Row key={it.label} it={it} n={i + 1} on={lit(it, i === 2)} />
            ))}
          </Group>
          <Group title="Reference">
            {reference.map((it) => (
              <Row key={it.label} it={it} on={lit(it, false)} />
            ))}
          </Group>
        </nav>

        <div className="px-2 py-2 border-t border-line shrink-0 space-y-1">
          <ResetDemo />
          <div className="flex items-center justify-between px-1 pt-1">
            <Account />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow px-3 pb-1.5">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ it, n, on }: { it: Item; n?: number; on: boolean }) {
  const body = (
    <>
      {n !== undefined && (
        <span
          className={`w-5 h-5 rounded-full grid place-items-center text-[10px]
                      font-semibold shrink-0 transition-colors ${
                        on ? "bg-brand text-brand-ink" : "border border-line text-faint"
                      }`}
        >
          {n}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm truncate ${on ? "text-ink" : ""}`}>{it.label}</span>
        {it.hint && (
          <span className="block text-[11px] text-faint truncate leading-tight">{it.hint}</span>
        )}
      </span>
      {it.tag && <span className="chip-warn shrink-0">{it.tag}</span>}
    </>
  );
  const cls = `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${
    on ? "bg-raised text-ink" : "text-muted hover:text-ink hover:bg-raised/60"
  }`;
  return it.href ? (
    <Link href={it.href} className={cls} aria-current={on ? "page" : undefined}>
      {body}
    </Link>
  ) : (
    <span className={`${cls} opacity-45 cursor-not-allowed`} title="Diagnose a merchant first">
      {body}
    </span>
  );
}

/**
 * Put the book back the way it started.
 *
 * Approving writes to disk, so the second take of a demo begins wherever the
 * first one ended — queue empty, headline already moved, which is exactly the
 * state in which the story stops working. Doing it from a terminal between
 * takes is a thing to forget under a camera.
 */
function ResetDemo() {
  const [state, setState] = useState<"idle" | "arm" | "busy" | "done">("idle");

  async function reset() {
    setState("busy");
    try {
      const r = await fetch("/api/demo/reset", { method: "POST" });
      if (!r.ok) throw new Error();
      setState("done");
      setTimeout(() => window.location.reload(), 500);
    } catch {
      setState("idle");
    }
  }

  const label = {
    idle: "↺ Reset the demo",
    arm: "Undo every approval?",
    busy: "resetting…",
    done: "reset ✓",
  }[state];

  return (
    <button
      onClick={() => (state === "idle" ? setState("arm") : state === "arm" ? reset() : null)}
      onBlur={() => state === "arm" && setState("idle")}
      className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors ${
        state === "arm"
          ? "bg-rose-soft text-rose"
          : "text-muted hover:text-ink hover:bg-raised/60"
      }`}
      title="Undo every approval and put the book back to its starting state"
    >
      {label}
    </button>
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px]
                   text-muted hover:text-ink hover:bg-raised/60 transition-colors"
      >
        <span className="w-6 h-6 rounded-full border border-line bg-raised text-[11px]
                         font-semibold grid place-items-center shrink-0">
          {(who || "?").trim().charAt(0).toUpperCase()}
        </span>
        <span className="truncate max-w-[7.5rem]">{who || "a guest"}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-10 z-50 w-48 card p-1 shadow-lift animate-rise">
            <button
              onClick={signOut}
              className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-raised transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
