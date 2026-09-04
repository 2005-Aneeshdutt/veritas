import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CaseBar } from "@/components/veritas/case-bar";
import { PageHeader } from "@/components/veritas/page-header";
import { BackendNotice } from "@/components/veritas/backend-notice";
import { useJourneyCase } from "@/hooks/use-journey-case";
import { useJourneyCases } from "@/hooks/use-journey-cases";
import type { JourneyCase } from "@/domain/journey";

/**
 * Everything every case screen needs, resolved once.
 *
 * Nine surfaces answer questions about one payment, and before this each of
 * them resolved the case itself. That is how a fixture ₹0 came to sit beside a
 * live ₹2,724 on the same screen: two resolutions, two answers, both rendered
 * as fact. One shell now owns selection, the sticky case bar, the loading and
 * failure states, and hands the page a single resolved case.
 *
 * Selection lives in the URL, so switching case updates every page the same
 * way and a link carries its context with it.
 */
export function CaseShell({
  route,
  caseId,
  title,
  description,
  children,
}: {
  /** The page's own path, so `?case=` is written back to the right route. */
  route: string;
  caseId: string | undefined;
  title: string;
  description?: string;
  children: (case_: JourneyCase, caseId: string) => ReactNode;
}) {
  const navigate = useNavigate();
  const cases = useJourneyCases();
  const activeId = caseId ?? cases[0]?.id ?? "";
  const { case_, isFixture, isPending, error } = useJourneyCase(activeId, 0);

  const select = (id: string) =>
    navigate({ to: route, search: { case: id } as never, replace: true });

  return (
    <div>
      {activeId && <CaseBar activeId={activeId} onSelect={select} />}

      <PageHeader title={title} {...(description ? { description } : {})} />

      <div className="mt-6 space-y-6">
        <BackendNotice isFixture={isFixture} error={error} what="case data" />
        {isPending ? (
          <div className="h-40 animate-pulse rounded-lg border border-hairline bg-elevated/30" />
        ) : (
          children(case_, activeId)
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ primitives */

/** A labelled fact. The workhorse of every inspectable surface. */
export function Fact({
  k,
  v,
  mono,
  tone,
  wide,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
  tone?: "measured" | "denied" | "projected" | "muted";
  wide?: boolean;
}) {
  const toneClass =
    tone === "measured"
      ? "text-measured"
      : tone === "denied"
        ? "text-denied"
        : tone === "projected"
          ? "text-projected"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className={wide ? "col-span-full" : undefined}>
      <dt className="label-meta text-[10px] tracking-[0.16em]">{k}</dt>
      <dd className={`mt-1 text-[13px] ${mono ? "font-mono" : ""} ${toneClass}`}>{v}</dd>
    </div>
  );
}

/** A bordered section with a small caps heading. */
export function Block({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-hairline ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <h2 className="label-meta text-[10px] tracking-[0.16em]">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Three states a value can be in without pretending it is a fourth. */
export function Absent({ children = "NOT AVAILABLE" }: { children?: ReactNode }) {
  return <span className="text-[13px] text-muted-foreground">{children}</span>;
}
