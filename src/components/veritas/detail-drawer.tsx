import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AppRoute } from "./nav-config";

export interface DrawerAction {
  label: string;
  to: AppRoute;
  search?: Record<string, string>;
}

export function DetailDrawer({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  rows,
  actions,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow?: string;
  title: string;
  description?: string;
  rows: { label: string; value: ReactNode }[];
  actions?: DrawerAction[];
  footer?: string;
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-5 overflow-y-auto border-hairline bg-background sm:max-w-md"
      >
        <SheetHeader className="space-y-2 border-b border-hairline pb-4">
          {eyebrow && <p className="label-meta text-[10px] tracking-[0.16em]">{eyebrow}</p>}
          <SheetTitle className="text-lg font-semibold tracking-tight">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-sm leading-relaxed">{description}</SheetDescription>
          )}
        </SheetHeader>

        <dl className="divide-y divide-hairline">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4 py-2.5">
              <dt className="label-meta w-32 shrink-0 text-[10px] tracking-[0.14em]">{r.label}</dt>
              <dd className="min-w-0 break-words text-right text-sm text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>

        {children && <div>{children}</div>}

        {actions && actions.length > 0 && (
          <nav aria-label="Related workspaces" className="flex flex-col gap-2">
            {actions.map((a) => (
              <Link
                key={`${a.to}-${a.label}`}
                to={a.to}
                search={a.search as never}
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 items-center justify-between rounded-md border border-hairline px-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
              >
                {a.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        )}

        {footer && <p className="text-xs text-muted-foreground/80">{footer}</p>}
      </SheetContent>
    </Sheet>
  );
}
