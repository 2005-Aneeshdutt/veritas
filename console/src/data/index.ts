import { API_BASE_URL, type VeritasAdapter } from "./adapter";
import { backendAdapter } from "./backend-adapter";
import { demoAdapter } from "./demo-adapter";

/** Backend takes over automatically once VITE_API_BASE_URL is set. */
export function getAdapter(): VeritasAdapter {
  return API_BASE_URL ? backendAdapter : demoAdapter;
}

export { API_BASE_URL };
export type { VeritasAdapter };
