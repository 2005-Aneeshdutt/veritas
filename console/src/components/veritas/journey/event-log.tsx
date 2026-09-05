import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { JourneyEvent } from "@/hooks/use-journey-engine";
import { cn } from "@/lib/utils";

export function EventLog({ events }: { events: JourneyEvent[] }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label="Live event log" className="border-t border-hairline pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="label-meta text-[10px] tracking-[0.16em]">
          Live event log · {events.length}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-[12px]">
              <span className="font-mono tabular-nums text-muted-foreground/70">{e.time}</span>
              <span className="min-w-0">
                <span className="text-foreground">{e.label}</span>
                {e.detail && <span className="ml-2 text-muted-foreground/80">{e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
