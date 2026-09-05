/**
 * What a root error boundary should say about the thing it caught.
 *
 * Production React does not rethrow boundary-caught errors to `window.onerror`,
 * so anything that reaches the root component is the last chance to describe it.
 * The only subtlety worth keeping: loaders and server functions commonly throw a
 * raw `Response`, and `String(it)` on one of those is the opaque
 * "[object Response]" — which is how a 404 from a data route ends up looking
 * like a mystery. Pull the status and URL out instead.
 */

export function describeError(error: unknown): { message: string; stack?: string } {
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return stack === undefined ? { message } : { message, stack };
}

export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const { message, stack } = describeError(error);
  console.error("[veritas] " + message, {
    route: window.location.pathname,
    ...context,
    ...(stack !== undefined && { stack }),
  });
}
