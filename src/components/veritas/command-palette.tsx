import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Monitor, Moon, Sun } from "lucide-react";
import { NAV_GROUPS } from "./nav-config";
import { useTheme } from "@/lib/theme";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { setMode } = useTheme();

  const go = (to: string) => {
    onOpenChange(false);
    void navigate({ to });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {NAV_GROUPS.map((group, gi) => (
          <CommandGroup key={group.title ?? `g${gi}`} heading={group.title ?? "General"}>
            {group.items.map((item) => (
              <CommandItem
                key={item.to}
                value={`${item.label} ${item.description}`}
                onSelect={() => go(item.to)}
              >
                <item.icon className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
                <span className="ml-2 truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Appearance">
          <CommandItem
            value="Dark theme"
            onSelect={() => {
              setMode("dark");
              onOpenChange(false);
            }}
          >
            <Moon className="mr-2 h-4 w-4" aria-hidden="true" /> Dark theme
          </CommandItem>
          <CommandItem
            value="Light theme"
            onSelect={() => {
              setMode("light");
              onOpenChange(false);
            }}
          >
            <Sun className="mr-2 h-4 w-4" aria-hidden="true" /> Light theme
          </CommandItem>
          <CommandItem
            value="System theme"
            onSelect={() => {
              setMode("system");
              onOpenChange(false);
            }}
          >
            <Monitor className="mr-2 h-4 w-4" aria-hidden="true" /> System theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
