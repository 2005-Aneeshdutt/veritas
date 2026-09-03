import type { Money } from "./types";

export function inr(rupees: number): Money {
  return { minor: Math.round(rupees * 100), currency: "INR" };
}

/** Full Indian-grouped currency, e.g. ₹5,56,225. */
export function formatMoney(money: Money, opts?: { decimals?: boolean }): string {
  const value = money.minor / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(value);
}

/** Compact Indian notation, e.g. ₹64.25L / ₹1.2Cr. */
export function formatMoneyCompact(money: Money): string {
  const value = money.minor / 100;
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(value / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return formatMoney(money);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}
