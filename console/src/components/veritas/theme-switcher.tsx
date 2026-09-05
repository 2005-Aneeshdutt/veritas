import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "system", label: "System", icon: Monitor },
];

export function ThemeSwitcher() {
  const { mode, resolved, setMode } = useTheme();
  const Icon = mode === "system" ? Monitor : resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${mode}. Change theme`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-surface text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 border-hairline bg-popover">
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.mode}
            onSelect={() => setMode(o.mode)}
            className={cn("gap-2 text-sm", mode === o.mode && "text-measured")}
          >
            <o.icon className="h-4 w-4" aria-hidden="true" />
            {o.label}
            {mode === o.mode && <span className="ml-auto text-[10px] uppercase">Active</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
