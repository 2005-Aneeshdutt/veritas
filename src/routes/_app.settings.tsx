import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";
import { PageHeader } from "@/components/veritas/page-header";
import { ClaimBadge, CLAIM_META } from "@/components/veritas/claim-badge";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { API_BASE_URL } from "@/data";
import { getAdapter } from "@/data";
import type { ClaimState } from "@/domain/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — VERITAS" },
      {
        name: "description",
        content: "Appearance, data source and claim vocabulary settings for the VERITAS workspace.",
      },
      { property: "og:title", content: "Settings — VERITAS" },
      { property: "og:description", content: "Workspace, theme and connection settings." },
    ],
  }),
  component: SettingsPage,
});

const THEMES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "system", label: "System", icon: Monitor },
];

const STATES: ClaimState[] = [
  "VERIFIED",
  "MEASURED",
  "PROJECTED",
  "OBSERVED",
  "UNVERIFIED",
  "ABSTAINED",
];

function SettingsPage() {
  const { mode, setMode } = useTheme();
  const adapter = getAdapter();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Appearance, data source and the claim vocabulary used across VERITAS."
      />

      <section className="surface-panel p-5" aria-label="Appearance">
        <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          VERITAS is dark-first. Your choice is stored on this device.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button
              key={t.mode}
              type="button"
              onClick={() => setMode(t.mode)}
              aria-pressed={mode === t.mode}
              className={cn(
                "flex items-center gap-2.5 rounded-md border px-3 py-3 text-sm transition-colors",
                mode === t.mode
                  ? "border-measured/50 bg-measured/10 text-foreground"
                  : "border-hairline bg-elevated/50 text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
              {mode === t.mode && (
                <span className="ml-auto text-[10px] uppercase tracking-[0.09em] text-measured">
                  Active
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-panel p-5" aria-label="Data source">
        <h2 className="text-sm font-semibold text-foreground">Data source</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The frontend reads through a single adapter. The VERITAS backend is separate; it takes
          over automatically once an API base URL is configured.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-hairline bg-elevated/50 p-3">
            <dt className="label-meta">Active adapter</dt>
            <dd className="mt-1 font-mono text-sm text-foreground">{adapter.kind}Adapter</dd>
          </div>
          <div className="rounded-md border border-hairline bg-elevated/50 p-3">
            <dt className="label-meta">VITE_API_BASE_URL</dt>
            <dd className="mt-1 truncate font-mono text-sm text-foreground">
              {API_BASE_URL || "not configured"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="surface-panel p-5" aria-label="Claim vocabulary">
        <h2 className="text-sm font-semibold text-foreground">Claim vocabulary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every financial value in VERITAS carries a claim state. Text and icon always accompany
          colour.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {STATES.map((s) => (
            <li
              key={s}
              className="flex items-start gap-3 rounded-md border border-hairline bg-elevated/50 p-3"
            >
              <ClaimBadge state={s} size="sm" />
              <span className="text-sm text-muted-foreground">{CLAIM_META[s].definition}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
