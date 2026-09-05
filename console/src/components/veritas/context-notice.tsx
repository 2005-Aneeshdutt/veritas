/**
 * Shows the filter context a user arrived with from the Overview, plus an honest
 * statement that detailed records need the backend. Presentation only.
 */
export function ContextNotice({
  filters,
  message = "Demo aggregation — detailed payment records require backend connection.",
}: {
  filters: { label: string; value: string }[];
  message?: string;
}) {
  if (filters.length === 0) return null;
  return (
    <section
      aria-label="Applied context"
      className="grid gap-3 border-l-2 border-measured/50 pl-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {filters.map((f) => (
          <span key={f.label} className="flex items-baseline gap-2">
            <span className="label-meta text-[10px] tracking-[0.14em]">{f.label}</span>
            <span className="text-sm text-foreground">{f.value}</span>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground/80">{message}</p>
    </section>
  );
}
