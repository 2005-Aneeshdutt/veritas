import { cn } from "@/lib/utils";

/**
 * VERITAS mark — a geometric shield built from an authority chevron and a
 * verification tick. Currency-plate feel, no AI iconography.
 */
export function VeritasMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("h-6 w-6", className)}
    >
      <path
        d="M16 2.5 28 7v9.2c0 6.6-4.8 11.6-12 13.3C8.8 27.8 4 22.8 4 16.2V7L16 2.5Z"
        className="fill-measured/10 stroke-measured"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 15.6l4.1 4.2 7.1-8"
        className="stroke-measured"
        strokeWidth="2.1"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path d="M16 2.5V29.5" className="stroke-measured/25" strokeWidth="1" />
    </svg>
  );
}

export function VeritasWordmark({
  className,
  subtitle = false,
}: {
  className?: string;
  subtitle?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <VeritasMark />
      <div className="min-w-0 leading-none">
        <div className="text-[15px] font-semibold tracking-[0.18em] text-foreground">
          VERITAS
        </div>
        {subtitle && (
          <div className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Revenue Recovery Intelligence
          </div>
        )}
      </div>
    </div>
  );
}
