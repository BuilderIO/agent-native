export type DateCadence = "Daily" | "Weekly" | "Monthly" | "Quarterly";

export const DATE_CADENCE_OPTIONS: DateCadence[] = [
  "Weekly",
  "Monthly",
  "Quarterly",
];

export function formatNumber(val: number | null | undefined): string {
  if (val == null) return "-";
  if (Number.isInteger(val)) return val.toLocaleString();
  return val.toFixed(1);
}

export function formatPercent(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${(val * 100).toFixed(2)}%`;
}

export function formatCurrency(val: number | null | undefined): string {
  if (val == null) return "-";
  const abs = Math.abs(val);
  const rounded = Math.round(val);
  const sign = val < 0 && (abs >= 1_000 || rounded !== 0) ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.abs(rounded)}`;
}

export function formatDate(value: any): string {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
}

export function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}
