import { useJourneyCases } from "@/hooks/use-journey-cases";
import { cn } from "@/lib/utils";

/** Shared demo-case selector used across the proof-layer workspaces. */
export function CaseSwitcher({
  activeId,
  onSelect,
  label = "Demo cases",
}: {
  activeId: string;
  onSelect: (id: string) => void;
  label?: string;
}) {
  const cases = useJourneyCases();
  return (
    <section aria-label={label} className="flex flex-wrap items-center gap-2">

      {cases.map((c) => {
        const active = c.id === activeId;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(c.id)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[13px] transition-colors",
              active
                ? "border-foreground/40 text-foreground"
                : "border-hairline text-muted-foreground hover:border-foreground/25 hover:text-foreground",
            )}
          >
            <span className="label-meta text-[10px] tracking-[0.14em]">{c.kindLabel}</span>
          </button>
        );
      })}
    </section>
  );
}
