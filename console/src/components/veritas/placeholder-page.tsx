import { PageHeader } from "./page-header";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PlaceholderPage({
  title,
  description,
  phase,
  icon: Icon,
  capabilities,
  notice,
}: {
  title: string;
  description: string;
  phase: string;
  icon: LucideIcon;
  capabilities: string[];
  notice?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {notice}
      <section className="surface-panel p-8">
        <div className="flex max-w-2xl flex-col gap-4">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-hairline bg-elevated text-muted-foreground">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">Arriving in {phase}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This surface is reserved in the shell so navigation, permissions and proof
              conventions stay consistent. It will be wired to the VERITAS backend when the
              workflow phase lands.
            </p>
          </div>
          <ul className="mt-1 grid gap-2 sm:grid-cols-2">
            {capabilities.map((c) => (
              <li
                key={c}
                className="flex items-start gap-2 rounded-md border border-hairline bg-elevated/50 px-3 py-2 text-sm text-muted-foreground"
              >
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-measured/70" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
