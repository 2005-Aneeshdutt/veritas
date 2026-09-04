import { Link, useRouterState } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_GROUPS } from "./nav-config";
import { VeritasMark, VeritasWordmark } from "./logo";
import { cn } from "@/lib/utils";

/**
 * Routes that render one payment. Navigating between these should keep the
 * payment you are looking at — a console where the selected record silently
 * changes when you move around is worse than one that forgets it, because the
 * next screen looks right and is about something else.
 */
const CASE_ROUTES = new Set<string>([
  "/recovery-journey",
  "/diagnosis",
  "/plan",
  "/outcome",
  "/policy",
  "/evidence",
  "/prove",
  "/counterfactual-lab",
  "/audit-trail",
]);

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeCase = useRouterState({
    select: (s) => {
      const c = (s.location.search as Record<string, unknown>)["case"];
      return typeof c === "string" ? c : undefined;
    },
  });

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.title ?? `group-${gi}`}>
          {group.title && !collapsed && (
            <div className="mb-2 px-2">
              <div className="label-meta">{group.title}</div>
              {group.caption && (
                <div className="mt-0.5 text-[11px] text-muted-foreground/70">{group.caption}</div>
              )}
            </div>
          )}
          {group.title && collapsed && <div className="mx-2 mb-2 border-t border-hairline" />}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.to;
              // carry the payment only where the destination understands one
              const carry =
                activeCase && CASE_ROUTES.has(item.to)
                  ? { search: { case: activeCase } as never }
                  : {};
              const Icon = item.icon;
              const link = (
                <Link
                  to={item.to}
                  {...carry}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-foreground/[0.055] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute -left-3 top-1/2 h-4 w-px -translate-y-1/2 bg-measured"
                    />
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-measured" : "text-muted-foreground/70",
                    )}
                    aria-hidden="true"
                  />

                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
              return (
                <li key={item.to}>
                  {collapsed ? (
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="border border-hairline bg-popover text-popover-foreground"
                      >
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-hairline bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-hairline px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {collapsed ? (
          <Link to="/" aria-label="VERITAS home">
            <VeritasMark />
          </Link>
        ) : (
          <Link to="/" aria-label="VERITAS home" className="min-w-0">
            <VeritasWordmark subtitle />
          </Link>
        )}
      </div>

      <SidebarNav collapsed={collapsed} />

      <div className="border-t border-hairline p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
