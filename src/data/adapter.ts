import type { OverviewSnapshot } from "@/domain/types";

/**
 * The single seam between the VERITAS frontend and any data source.
 * Components never call fetch directly — they go through services in `services.ts`.
 */
export interface VeritasAdapter {
  readonly kind: "demo" | "backend";
  getOverview(signal?: AbortSignal): Promise<OverviewSnapshot>;
}

export const API_BASE_URL: string = import.meta.env["VITE_API_BASE_URL"] ?? "";
