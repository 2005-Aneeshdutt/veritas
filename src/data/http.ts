/**
 * The one place this frontend talks to the network.
 *
 * Components never call `fetch`. They call a service, the service calls the
 * adapter, the adapter calls this. That is three layers for what looks like a
 * one-line job, and it earns its keep the first time a route moves: there is
 * exactly one file to change, and the type error tells you every screen that
 * cared.
 *
 * The base URL is read once from `VITE_API_BASE_URL`. An empty value is not an
 * error -- it means demo mode, and `getAdapter()` routes elsewhere. Nothing
 * here falls back to a hardcoded localhost, because a build that silently
 * points at a developer's laptop is worse than one that plainly says it has no
 * backend.
 */

import { API_BASE_URL } from "./adapter";

/** A request that reached the backend and came back refused. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string,
  ) {
    super(detail || `${path} failed (${status})`);
    this.name = "ApiError";
  }
}

/** The backend is not configured or not reachable. Distinct from a refusal. */
export class ApiUnavailable extends Error {
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(`Could not reach the VERITAS backend (${path}).`);
    this.name = "ApiUnavailable";
    this.cause = cause;
  }
}

function base(): string {
  return API_BASE_URL.replace(/\/$/, "");
}

export function apiConfigured(): boolean {
  return Boolean(API_BASE_URL);
}

function query(params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * A GET that returns parsed JSON, or throws something a page can render.
 *
 * FastAPI puts its message in `detail`, so a 404 reads "no such run: x" rather
 * than "404". That string is written for a person and is passed through
 * untouched -- the frontend has nothing truer to say about a backend refusal
 * than what the backend said.
 */
export async function apiGet<T>(
  path: string,
  opts: {
    // `exactOptionalPropertyTypes` is on in this project, so an optional
    // property has to admit `undefined` explicitly rather than by omission.
    signal?: AbortSignal | undefined;
    params?: Record<string, string | number | boolean | undefined> | undefined;
  } = {},
): Promise<T> {
  if (!apiConfigured()) throw new ApiUnavailable(path);
  const url = `${base()}${path}${query(opts.params)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: opts.signal ?? null,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new ApiUnavailable(path, cause);
  }

  if (!res.ok) throw new ApiError(res.status, path, await detailOf(res));
  return (await res.json()) as T;
}

/**
 * A POST. Every mutating route on this backend takes its arguments as query
 * parameters rather than a body, so that is what this sends.
 */
export async function apiPost<T>(
  path: string,
  opts: {
    // `exactOptionalPropertyTypes` is on in this project, so an optional
    // property has to admit `undefined` explicitly rather than by omission.
    signal?: AbortSignal | undefined;
    params?: Record<string, string | number | boolean | undefined> | undefined;
  } = {},
): Promise<T> {
  if (!apiConfigured()) throw new ApiUnavailable(path);
  const url = `${base()}${path}${query(opts.params)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: opts.signal ?? null,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new ApiUnavailable(path, cause);
  }

  if (!res.ok) throw new ApiError(res.status, path, await detailOf(res));
  return (await res.json()) as T;
}

async function detailOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    /* a non-JSON error body is still an error; fall through to the status */
  }
  return `${res.status} ${res.statusText}`.trim();
}

/** The URL of a server-sent-event stream, for `new EventSource(...)`. */
export function streamUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  return `${base()}${path}${query(params)}`;
}
