export type DateCadence = "Daily" | "Weekly" | "Monthly" | "Quarterly";

export type ViewByOption =
  | "Page Type"
  | "Page Sub Type"
  | "Channel"
  | "Referrer Channel"
  | "Base URL"
  | "UTM Campaign"
  | "UTM Source"
  | "Referrer Sub Channel"
  | "Blog Author"
  | "Blog Persona"
  | "Blog Type"
  | "Blog Subtype"
  | "Blog Purpose";

export const DATE_CADENCE_OPTIONS: DateCadence[] = [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
];

export const VIEW_BY_OPTIONS: ViewByOption[] = [
  "Page Type",
  "Page Sub Type",
  "Channel",
  "Referrer Channel",
  "Base URL",
  "UTM Campaign",
  "UTM Source",
  "Referrer Sub Channel",
  "Blog Author",
  "Blog Persona",
  "Blog Type",
  "Blog Subtype",
  "Blog Purpose",
];

export interface FilterState {
  dateStart: string;
  dateEnd: string;
  pageType: string[];
  channel: string[];
  referrer: string[];
  baseUrl: string[];
  subPageType: string[];
}

export interface Tab3FilterState extends FilterState {
  utmMedium: string[];
  utmSource: string[];
  utmTerm: string[];
  utmCampaign: string[];
  utmContent: string[];
  author: string[];
  type: string[];
  subType: string[];
  purpose: string[];
  persona: string[];
  pubDateStart: string;
}

export interface Tab2FilterState {
  dateStart: string;
  dateEnd: string;
  coalesceChannel: string[];
  pageType: string[];
  referrer: string[];
  icpFlag: string[];
  paidSubFlag: string[];
  subscriptionAfterSignup: string[];
  spaceKind: string[];
  urlContainsFigma: string[];
}

export const CHART_COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#84cc16", // lime
  "#a855f7", // purple
  "#3b82f6", // blue
  "#e11d48", // rose
  "#22d3ee", // sky
  "#facc15", // yellow
  "#64748b", // slate
];

export function formatNumber(val: number | null | undefined): string {
  if (val == null) return "-";
  if (Number.isInteger(val)) return val.toLocaleString();
  return val.toFixed(2);
}

export function formatPercent(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${(val * 100).toFixed(1)}%`;
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

export function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}
