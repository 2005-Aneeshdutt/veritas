"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SystemPulse, ActivityLine } from "@/components/SystemPulse";
import { ThemeToggle } from "@/components/Theme";

export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const box = size === "lg" ? "w-8 h-8 text-[13px]" : "w-[22px] h-[22px] text-[10px]";
  const text = size === "lg" ? "text-[15px]" : "text-[13px]";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${box} rounded bg-brand text-brand-ink grid place-items-center
                    font-semibold shrink-0`}
      >
        R
      </span>
      <span className={`font-display font-semibold ${text} tracking-tight`}>
        Revenue Doctor
      </span>
    </span>
  );
}

/**
 * The merchant the walkthrough is built around.
 *
 * Named rather than derived: picking dynamically -- by value, by gap, by
 * recency -- makes step 2 land somewhere different depending on the state of
 * the book, and a demo whose second click moves is a demo nobody can rehearse.
 */
const DEMO_MERCHANT = "cloudsync";

//: Where the resolved run is remembered for the rest of the session, so the
//: walkthrough's steps are never briefly dead on a fresh page.
const RUN_CACHE = "rd.run.canonical";

interface Item {
  href: string | null;
  label: string;
  /** Paths that light this row. */
  match?: string[];
}

/**
 * The product, down the left.
 *
 * Five numbered steps that are one continuous story, then two rooms you go to
 * when you stop believing it. The order is the demo:
 *
 *   1 Book       the problem, at the size of the whole book
 *   2 Diagnose   the agent finds one merchant's cause
 *   3 Authorise  it acts, inside limits somebody signed
 *   4 Platform   and across the book, here is what is Razorpay's to fix
 *   5 Prove      and none of it is memorised — here is a blind exam
 *
 * Three things this arrangement fixes.
 *
 * The live payment stream used to be step 2, which broke the only causal
 * link in the walkthrough: the Book names a merchant who is bleeding, and the
 * next thing you should see is that merchant. Live and bank drift are
 * portfolio-level surveillance, so they are lenses on the Book instead.
 *
 * "Whose fault" was filed under Reference, which reads as an appendix. It is
 * the most Razorpay-specific artefact in the product — a defect backlog no
 * merchant is standing anywhere to compute — so it is step 4.
 *
 * And there is no longer a second navigation inside a run. Steps 2 and 3 used
 * to both point into a four-tab strip, so a viewer watching one continuous
 * thing saw the step number change AND a tab change.
 *
 * Deliberately short. The competing entry in this track ships seventeen
 * destinations across five headings, several with nothing behind them.
 * Surface area photographs well and demos badly.
 */
export function Sidebar({ runHref }: { runHref?: string | null }) {
  const path = usePathname();
  const router = useRouter();
  const [fallback, setFallback] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  /**
   * Where Diagnose goes when you are not already inside a run.
   *
   * It used to follow /api/run-latest, which is whichever record was written
   * most recently. After a reset that is whichever merchant the loop happened
   * to finish last -- currently FuelStop, which is healthy, has a 0.57-point
   * gap and no retries at all. The walkthrough's second step landed on the one
   * merchant in the book with nothing to demonstrate.
   *
   * So it resolves to the canonical demo merchant's existing committed run.
   * This creates nothing and mints nothing: it reads the run_id already on
   * disk for that merchant, exactly as the Book's own rows do. The fallback to
   * run-latest is kept for a checkout where that merchant is absent, so the
   * step is never a dead end.
   *
   * Clicking a merchant in the Book is untouched and still opens whichever
   * merchant was clicked.
   */
  /**
   * Resolve once per session, then never wait again.
   *
   * The destination was fetched on every mount, and the sidebar remounts on
   * every navigation — so on each new page there was a window where Diagnose
   * and Authorise had no run yet and rendered as disabled spans. A person
   * clicking in that window pressed a control that looked like a nav item and
   * did nothing, which is the worst kind of broken: it fails silently and
   * intermittently, so it looks like the click was missed.
   *
   * The resolved run is cached in sessionStorage and read synchronously on
   * first render, so the window exists only on the very first page load of a
   * session and never again. It is cleared by Reset, which is the only thing
   * that can change the answer.
   */
  useEffect(() => {
    if (runHref) return;
    let cancelled = false;

    try {
      const cached = sessionStorage.getItem(RUN_CACHE);
      if (cached) setFallback(cached);
    } catch {
      /* private mode: fall through to the fetch */
    }

    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return null;
        const demo = (d.merchants ?? []).find(
          (m: { merchant_id: string }) => m.merchant_id === DEMO_MERCHANT
        );
        if (demo?.run_id) {
          const href = `/run/${demo.run_id}`;
          setFallback(href);
          try {
            sessionStorage.setItem(RUN_CACHE, href);
          } catch {
            /* nothing to cache into; the fetch still worked */
          }
          return null;
        }
        return fetch("/api/run-latest").then((r) => r.json());
      })
      .then((d) => {
        if (!cancelled && d?.run_id) {
          const href = `/run/${d.run_id}`;
          setFallback(href);
          try {
            sessionStorage.setItem(RUN_CACHE, href);
          } catch {
            /* nothing to cache into */
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [runHref]);

  useEffect(() => setOpen(false), [path]);

  const run = runHref ?? fallback;

  const steps: Item[] = [
    // Live and drift are lenses on the book, so they light this row too.
    { href: "/portfolio", label: "Book", match: ["/portfolio", "/live", "/drift"] },
    { href: run, label: "Diagnose", match: run ? [run] : [] },
    {
      href: run ? `${run}/authorise` : null,
      label: "Authorise",
      match: run ? [`${run}/authorise`] : [],
    },
    { href: "/platform", label: "Platform", match: ["/platform"] },
    { href: "/prove", label: "Prove", match: ["/prove"] },
  ];

  const reference: Item[] = [
    // Evidence is the numeric record; this is the same eight fixes as a
    // picture. Different jobs -- one is for checking, one is for seeing --
    // and the picture was buried in a column called forecast_error_pts.
    { href: "/impact", label: "Impact", match: ["/impact"] },
    { href: "/evidence", label: "Evidence", match: ["/evidence"] },
    { href: "/data", label: "Data", match: ["/data"] },
  ];

  const onAuthorise = path.includes("/authorise");
  const lit = (it: Item, isDiagnose: boolean) => {
    const hit = (it.match ?? []).some((m) => path === m || path.startsWith(m + "/"));
    // Diagnose and Authorise share a prefix, so the deeper one wins.
    return isDiagnose ? hit && !onAuthorise : hit;
  };

  /**
   * Left and right move through the walkthrough.
   *
   * A presenter with one hand on a clicker should not be hunting a 200px
   * target in a sidebar between steps. Ignored while typing, so the assistant
   * and every filter box still work.
   */
  const current = steps.findIndex((s, i) => lit(s, i === 1));
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (current < 0) return;
      const next = steps[current + (e.key === "ArrowRight" ? 1 : -1)];
      if (next?.href) {
        e.preventDefault();
        router.push(next.href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <ActivityLine />

      {/* the bar that exists only when the sidebar is hidden */}
      <div
        className="lg:hidden sticky top-0 z-30 h-12 px-4 flex items-center gap-3
                   border-b border-line bg-canvas/90 backdrop-blur-xl"
      >
        <button
          onClick={() => setOpen(true)}
          className="text-muted hover:text-ink"
          aria-label="Open navigation"
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path
              d="M2 4.5h14M2 9h14M2 13.5h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <Link href="/portfolio">
          <Logo />
        </Link>
      </div>

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 border-r border-line bg-subtle
                    flex flex-col transition-transform duration-200 lg:translate-x-0
                    ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-12 px-4 flex items-center shrink-0">
          <Link href="/portfolio" className="hover:opacity-80 transition-opacity">
            <Logo />
          </Link>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto no-scrollbar px-2.5 py-3 space-y-6">
          <Group title="Pipeline">
            {steps.map((it, i) => (
              <Row key={it.label} it={it} n={i + 1} on={lit(it, i === 1)} />
            ))}
          </Group>
          <Group title="Reference">
            {reference.map((it) => (
              <Row key={it.label} it={it} on={lit(it, false)} />
            ))}
          </Group>
        </nav>

        <div className="border-t border-line shrink-0">
          <SystemPulse />
        </div>

        <div className="px-2.5 py-2.5 border-t border-line shrink-0">
          <SystemStatus />
          <ResetDemo />
          <div className="flex items-center justify-between mt-1">
            <Account />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow px-2.5 pb-1.5">{title}</div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function Row({ it, n, on }: { it: Item; n?: number; on: boolean }) {
  const body = (
    <>
      {/* The active row is marked by a purple rail, not a filled block:
          purple means the system is doing something here. */}
      <span
        className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full transition-colors ${
          on ? "bg-brand" : "bg-transparent"
        }`}
      />
      {n !== undefined && (
        <span
          className={`w-5 text-[10px] num shrink-0 tracking-tight ${
            on ? "text-brand" : "text-faint"
          }`}
        >
          {String(n).padStart(2, "0")}
        </span>
      )}
      <span className="truncate">{it.label}</span>
    </>
  );
  const cls = `relative w-full flex items-center gap-2 pl-3.5 pr-2.5 py-[7px]
               rounded-md text-[13px] transition-colors ${
                 on
                   ? "bg-raised text-ink font-medium"
                   : "text-muted hover:text-ink hover:bg-raised/60"
               }`;
  return it.href ? (
    <Link href={it.href} className={cls} aria-current={on ? "page" : undefined}>
      {body}
    </Link>
  ) : (
    <span
      className={`${cls} opacity-40 cursor-not-allowed`}
      title="Diagnose a merchant first"
    >
      {body}
    </span>
  );
}

/**
 * Put the book back the way it started.
 *
 * Approving writes to disk, so the second take of a demo begins wherever the
 * first one ended — queue empty, headline already moved, which is exactly the
 * state in which the story stops working.
 */
function ResetDemo() {
  const [state, setState] = useState<"idle" | "arm" | "busy" | "done">("idle");

  async function reset() {
    setState("busy");
    try {
      const r = await fetch("/api/demo/reset", { method: "POST" });
      if (!r.ok) throw new Error();
      try {
        sessionStorage.removeItem(RUN_CACHE);
      } catch {
        /* nothing cached to clear */
      }
      setState("done");
      setTimeout(() => window.location.reload(), 500);
    } catch {
      setState("idle");
    }
  }

  const label = {
    idle: "Reset the demo",
    arm: "Undo every approval?",
    busy: "resetting…",
    done: "reset ✓",
  }[state];

  return (
    <button
      onClick={() => (state === "idle" ? setState("arm") : state === "arm" ? reset() : null)}
      onBlur={() => state === "arm" && setState("idle")}
      className={`w-full text-left px-2.5 py-1.5 rounded text-[12px] transition-colors ${
        state === "arm" ? "text-rose bg-rose-soft" : "text-faint hover:text-ink hover:bg-surface/60"
      }`}
      title="Undo every approval and put the book back to its starting state"
    >
      {label}
    </button>
  );
}

/**
 * Is the engine reachable, and is the evidence intact.
 *
 * Reads /api/health, which reports the commit it is serving and whether the
 * validation sweep is present. A console that cannot tell you it is healthy is
 * asking you to assume it, and this product does not ask anyone to assume
 * anything.
 */
function SystemStatus() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [commit, setCommit] = useState<string>("");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        setOk(Boolean(d.ok));
        setCommit(d.commit ?? "");
      })
      .catch(() => setOk(false));
  }, []);

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5" title={commit && "commit " + commit}>
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          ok === null ? "bg-faint" : ok ? "bg-mint" : "bg-rose"
        }`}
      />
      <span className="text-[11px] text-muted truncate">
        {ok === null
          ? "checking…"
          : ok
          ? "All systems operational"
          : "API unreachable"}
      </span>
      {commit && <span className="num text-[10px] text-faint ml-auto">{commit}</span>}
    </div>
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
        className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px]
                   text-faint hover:text-ink hover:bg-surface/60 transition-colors"
      >
        <span
          className="w-5 h-5 rounded-full border border-line bg-surface text-[10px]
                     font-medium grid place-items-center shrink-0"
        >
          {(who || "?").trim().charAt(0).toUpperCase()}
        </span>
        <span className="truncate max-w-[6.5rem]">{who || "a guest"}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-9 z-50 w-44 panel p-1 shadow-lift animate-rise">
            <button
              onClick={signOut}
              className="w-full text-left px-2.5 py-1.5 text-[13px] rounded
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
