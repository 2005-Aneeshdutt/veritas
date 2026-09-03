import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeSwitcher } from "./theme-switcher";
import { SidebarNav } from "./app-sidebar";
import { VeritasWordmark } from "./logo";
import { groupTitleFor, navItemFor } from "./nav-config";
import { useState } from "react";

const NOTIFICATIONS = [
  { id: "n1", title: "2 exceptions awaiting review", meta: "Exception queue · 12m ago" },
  { id: "n2", title: "Evidence coverage dipped to 94.2%", meta: "Proof health · 1h ago" },
  { id: "n3", title: "Policy MANDATE_REPAIR_V2 updated", meta: "Policy kernel · 3h ago" },
];

export function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = navItemFor(pathname);
  const group = groupTitleFor(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-background/85 px-3 backdrop-blur sm:px-5">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          aria-label="Open navigation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground md:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[264px] border-hairline bg-sidebar p-0">
          <SheetTitle className="sr-only">VERITAS navigation</SheetTitle>
          <div className="flex h-14 items-center border-b border-hairline px-4">
            <VeritasWordmark subtitle />
          </div>
          <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-sm">
          <li className="shrink-0">
            <Link to="/" className="text-muted-foreground transition-colors hover:text-foreground">
              VERITAS
            </Link>
          </li>
          {group && (
            <>
              <li aria-hidden="true" className="text-muted-foreground/50">
                /
              </li>
              <li className="shrink-0 text-muted-foreground">{group}</li>
            </>
          )}
          {current && current.to !== "/" && (
            <>
              <li aria-hidden="true" className="text-muted-foreground/50">
                /
              </li>
              <li className="min-w-0 truncate font-medium text-foreground" aria-current="page">
                {current.label}
              </li>
            </>
          )}
          {current?.to === "/" && (
            <>
              <li aria-hidden="true" className="text-muted-foreground/50">
                /
              </li>
              <li className="font-medium text-foreground" aria-current="page">
                Overview
              </li>
            </>
          )}
        </ol>
      </nav>

      <button
        type="button"
        onClick={onOpenCommand}
        aria-label="Open command palette (Command or Control + K)"
        className="hidden h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground/80 transition-colors hover:bg-elevated hover:text-foreground sm:flex sm:w-56"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search or run a command</span>
        <kbd className="ml-auto rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={onOpenCommand}
        aria-label="Open command palette"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground sm:hidden"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Notifications, ${NOTIFICATIONS.length} unread`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-measured" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 border-hairline bg-popover">
          <DropdownMenuLabel className="label-meta">Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {NOTIFICATIONS.map((n) => (
            <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5 py-2">
              <span className="text-sm text-foreground">{n.title}</span>
              <span className="text-xs text-muted-foreground">{n.meta}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeSwitcher />

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="inline-flex h-9 items-center gap-2 rounded-md px-1.5 text-sm text-foreground transition-colors hover:bg-elevated"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-elevated text-[11px] font-semibold text-muted-foreground">
            AD
          </span>
          <span className="hidden max-w-28 truncate lg:inline">Operations</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 border-hairline bg-popover">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-sm">Aneesh Dutt</span>
            <span className="text-xs font-normal text-muted-foreground">Recovery operations</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings">Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/login">Sign out</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
