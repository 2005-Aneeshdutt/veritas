import { AlertTriangle } from "lucide-react";

/**
 * Says out loud that what is on screen is not the backend's answer.
 *
 * The hooks fall back to the walkthrough fixture when a request fails, which
 * keeps the app navigable during an outage — but silently substituted fixture
 * data is worse than an error, because every figure still looks authoritative.
 * A backend outage once showed ₹0 for a payment the backend records at ₹2,724,
 * with nothing on screen to say so.
 *
 * So wherever a fixture stands in for live data, this says which, and why.
 */
export function BackendNotice({
  isFixture,
  error,
  what,
}: {
  isFixture: boolean;
  error?: Error | null;
  what: string;
}) {
  if (!isFixture || !error) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-denied/40 bg-denied/5 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-denied" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">
          Showing the demo walkthrough, not live {what}.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {error.message} Figures below are fixtures and may disagree with the backend.
        </p>
      </div>
    </div>
  );
}
