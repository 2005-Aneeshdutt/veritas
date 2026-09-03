import {
  BadgeCheck,
  CircleSlash,
  Eye,
  HelpCircle,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClaimState } from "@/domain/types";

interface ClaimMeta {
  icon: LucideIcon;
  definition: string;
  classes: string;
}

export const CLAIM_META: Record<ClaimState, ClaimMeta> = {
  VERIFIED: {
    icon: ShieldCheck,
    definition: "Evidence sufficiently verified.",
    classes: "border-verified/40 bg-verified/10 text-verified",
  },
  MEASURED: {
    icon: BadgeCheck,
    definition: "Actual result/recovery observed and recorded.",
    classes: "border-measured/40 bg-measured/10 text-measured",
  },
  PROJECTED: {
    icon: TrendingUp,
    definition: "Expected or estimated future recovery.",
    classes: "border-projected/40 bg-projected/10 text-projected",
  },
  OBSERVED: {
    icon: Eye,
    definition: "Observed state/event without necessarily proving monetary recovery.",
    classes: "border-observed/40 bg-observed/10 text-observed",
  },
  UNVERIFIED: {
    icon: HelpCircle,
    definition: "Action/result exists but recovery cannot be established.",
    classes: "border-denied/40 bg-denied/10 text-denied",
  },
  ABSTAINED: {
    icon: CircleSlash,
    definition: "No recovery claim is made.",
    classes: "border-hairline bg-elevated text-muted-foreground",
  },
};

export function ClaimBadge({
  state,
  size = "md",
  iconOnly = false,
  className,
}: {
  state: ClaimState;
  size?: "sm" | "md";
  iconOnly?: boolean;
  className?: string;
}) {
  const meta = CLAIM_META[state];
  const Icon = meta.icon;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="note"
          aria-label={`${state}: ${meta.definition}`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium uppercase tracking-[0.09em]",
            size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
            meta.classes,
            className,
          )}
        >
          <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
          {!iconOnly && <span>{state}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] border border-hairline bg-popover text-popover-foreground">
        <span className="font-semibold">{state}</span> — {meta.definition}
      </TooltipContent>
    </Tooltip>
  );
}
