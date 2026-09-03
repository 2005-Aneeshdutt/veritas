import { API_BASE_URL, type VeritasAdapter } from "./adapter";
import type { OverviewSnapshot } from "@/domain/types";

/**
 * Thin client for the real (separate, frozen) VERITAS backend.
 * Only active when VITE_API_BASE_URL is configured. No backend is bundled here.
 */
export const backendAdapter: VeritasAdapter = {
  kind: "backend",
  async getOverview(signal) {
    const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/overview`, {
      signal: signal ?? null,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Overview request failed (${res.status})`);
    const data = (await res.json()) as OverviewSnapshot;
    return { ...data, source: "backend" };
  },
  async getCases() {
    // Walkthrough cases are a demo-mode affordance only.
    return [];
  },
};
