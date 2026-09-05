import { Check, CircleDot, Minus, Slash, TriangleAlert, X } from "lucide-react";
import { STAGE_LABEL, STAGE_ORDER, type StageId, type StageStatus } from "@/domain/journey";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<StageStatus, string> = {
  current: "In progress",
  completed: "Completed",
  pending: "Pending",
  "not-reached": "Not reached",
  abstained: "Abstained",
  exception: "Exception",
  denied: "Denied",
};

const STATUS_TONE: Record<StageStatus, string> = {
  current: "text-projected border-projected/60",
  completed: "text-measured border-measured/40",
  pending: "text-muted-foreground/60 border-hairline",
  "not-reached": "text-muted-foreground/50 border-hairline border-dashed",
  abstained: "text-muted-foreground border-hairline",
  exception: "text-observed border-observed/50",
  denied: "text-denied border-denied/60",
};

const STATUS_ICON: Record<StageStatus, typeof Check> = {
  current: CircleDot,
  completed: Check,
  pending: Minus,
  "not-reached": Slash,
  abstained: Slash,
  exception: TriangleAlert,
  denied: X,
};

export function StageTimeline({
  activeStage,
  statusOf,
  onSelect,
  reducedMotion,
}: {
  activeStage: StageId;
  statusOf: (stage: StageId) => StageStatus;
  onSelect: (stage: StageId) => void;
  reducedMotion: boolean;
}) {
  return (
    <nav aria-label="Recovery journey stages">
      <ol className="relative">
        {STAGE_ORDER.map((stage, i) => {
          const status = statusOf(stage);
          const Icon = STATUS_ICON[status];
          const isActive = stage === activeStage;
          const num = String(i + 1).padStart(2, "0");
          return (
            <li key={stage} className="relative">
              {i < STAGE_ORDER.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[11px] top-[26px] h-[calc(100%-18px)] w-px",
                    status === "completed" || status === "denied" || status === "exception"
                      ? "bg-hairline"
                      : "bg-hairline/50",
                  )}
                />
              )}
              <button
                type="button"
                onClick={() => onSelect(stage)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "group grid w-full grid-cols-[24px_minmax(0,1fr)] items-start gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors",
                  "hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06]",
                  isActive && "bg-foreground/[0.06]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border bg-background",
                    STATUS_TONE[status],
                    status === "current" && !reducedMotion && "animate-pulse",
                  )}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="label-meta text-[10px] tabular-nums text-muted-foreground/70">{num}</span>
                    <span
                      className={cn(
                        "truncate text-[13px]",
                        isActive ? "text-foreground" : "text-muted-foreground",
                        status === "pending" && "text-muted-foreground/60",
                      )}
                    >
                      {STAGE_LABEL[stage]}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[10px] uppercase tracking-[0.14em]",
                      status === "denied" && "text-denied",
                      status === "exception" && "text-observed",
                      status === "completed" && "text-measured/80",
                      status === "current" && "text-projected",
                      (status === "pending" || status === "not-reached" || status === "abstained") &&
                        "text-muted-foreground/60",
                    )}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
