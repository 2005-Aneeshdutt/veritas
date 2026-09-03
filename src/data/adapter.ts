import type { DemoCase, OverviewSnapshot } from "@/domain/types";

/**
 * The single seam between the VERITAS frontend and any data source.
 * Components never call fetch directly — they go through services in `services.ts`.
 */
export interface VeritasAdapter {
  readonly kind: "demo" | "backend";
  getOverview(signal?: AbortSignal): Promise<OverviewSnapshot>;
  /** Curated walkthrough cases. Empty when a real backend is connected. */
  getCases(): Promise<DemoCase[]>;
}

export const API_BASE_URL: string = import.meta.env["VITE_API_BASE_URL"] ?? "";
