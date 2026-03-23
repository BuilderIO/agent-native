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
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(1)}k`;
  return `$${val.toFixed(0)}`;
}

export function formatDate(value: string): string {
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
