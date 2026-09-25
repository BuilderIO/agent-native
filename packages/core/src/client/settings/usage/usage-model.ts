/**
 * Data shaping for Settings › Usage: the `get-usage-metrics` result as the
 * page reads it, the display unit, and the per-day series the charts draw.
 * Pure functions, so the page and its tests agree on every number.
 */

export type UsageScope = "me" | "workspace";
export type UsageBillingUnit = "usd" | "builder-credits" | "mixed";
export type UsageDisplayUnit = "usd" | "credits";
export type UsageHistoryDimension = "feature" | "app" | "model";
export type UsageCallsDimension = "model" | "surface";

/** Mirrors `USAGE_OTHER_BREAKDOWN_KEY` on the server. */
export const USAGE_OTHER_KEY = "other";

export interface UsageBilling {
  unit: UsageBillingUnit;
  hardCostMarginMultiplier?: number;
  creditsPerUsd?: number;
}

export interface UsageAmounts {
  costCents: number;
  builderCredits?: number;
  estimatedBuilderCredits?: number;
  otherCostCents?: number;
}

export interface UsageMetricBucket extends UsageAmounts {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  activeUsers: number;
}

export interface UsageDailyMetric extends UsageAmounts {
  date: string;
  calls: number;
  tokens: number;
  otherCalls?: number;
}

export interface UsageDailyBreakdownRow extends UsageAmounts {
  date: string;
  key: string;
  calls: number;
  tokens: number;
}

/** Where a title or prompt came from; `unavailable` means the thread read failed. */
export type UsageTextSource =
  | "thread"
  | "thread-preview"
  | "not-captured"
  | "unavailable";

export interface UsageChatMetric extends UsageAmounts {
  threadId: string;
  title: string | null;
  titleSource: UsageTextSource;
  ownerEmail: string;
  app: string;
  lastActiveAt: number;
  calls: number;
}

export interface UsageRecentMetric extends UsageAmounts {
  id: number;
  createdAt: number;
  ownerEmail: string;
  app: string;
  model: string;
  prompt: string | null;
  promptSource: UsageTextSource;
}

export type UsageToolCallMetrics =
  | {
      status: "ok";
      daily: Array<{ date: string; key: string; calls: number }>;
    }
  | { status: "unavailable" };

export interface UsageMetricsData {
  builderCreditUsageEnabled: boolean;
  billing: UsageBilling;
  appScope: "all" | "app";
  appKey: string | null;
  currentAppKey: string | null;
  apps: Array<{ key: string; calls: number }>;
  viewScope: UsageScope;
  selectedUserEmail: string | null;
  sinceDays: number;
  generatedAt: number;
  access: {
    viewerEmail: string;
    canViewWorkspace: boolean;
  };
  totals: UsageAmounts & {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    activeUsers: number;
    otherCalls?: number;
  };
  byApp: UsageMetricBucket[];
  byUser: UsageMetricBucket[];
  daily: UsageDailyMetric[];
  dailyBy: Record<UsageHistoryDimension | "surface", UsageDailyBreakdownRow[]>;
  topChats: UsageChatMetric[];
  toolCalls: UsageToolCallMetrics;
  recent: UsageRecentMetric[];
}

const DAY_MS = 86_400_000;

export function displayUnit(billing: UsageBilling): UsageDisplayUnit {
  return billing.unit === "usd" ? "usd" : "credits";
}

/**
 * The amount in the display unit: dollars, or Builder.io credits. Mixed
 * billing counts only the credit side here; its provider spend is
 * `otherCostCents`, which the page shows on its own.
 */
export function usageAmount(entry: UsageAmounts, billing: UsageBilling) {
  if (billing.unit === "usd") return entry.costCents / 100;
  if (
    typeof entry.builderCredits === "number" ||
    typeof entry.estimatedBuilderCredits === "number"
  ) {
    return (entry.builderCredits ?? 0) + (entry.estimatedBuilderCredits ?? 0);
  }
  if (billing.unit === "mixed") return 0;
  return (
    (entry.costCents / 100) *
    (billing.hardCostMarginMultiplier ?? 1.25) *
    (billing.creditsPerUsd ?? 20)
  );
}

export function totalTokens(totals: UsageMetricsData["totals"]): number {
  return (
    totals.inputTokens +
    totals.outputTokens +
    (totals.cacheReadTokens ?? 0) +
    (totals.cacheWriteTokens ?? 0)
  );
}

/** Every UTC date in the lookback, oldest first, ending on `generatedAt`. */
export function lookbackDates(sinceDays: number, generatedAt: number) {
  const today = Math.floor(generatedAt / DAY_MS);
  const dates: string[] = [];
  for (let day = today - sinceDays + 1; day <= today; day++) {
    dates.push(new Date(day * DAY_MS).toISOString().slice(0, 10));
  }
  return dates;
}

export interface UsageSeriesTotal {
  key: string;
  value: number;
}

export interface UsageSeries {
  /** Series keys, largest total first, with `other` last. */
  keys: string[];
  /** One row per date; each series under `s{index}` of `keys`. */
  rows: Array<Record<string, number | string>>;
  totals: UsageSeriesTotal[];
  total: number;
}

export function seriesId(index: number): string {
  return `s${index}`;
}

/**
 * Pivot per-day, per-key rows into chart rows for every date in the range,
 * so days with no usage draw as zero instead of being skipped.
 */
export function buildDailySeries<T extends { date: string; key: string }>(
  entries: readonly T[],
  dates: readonly string[],
  value: (entry: T) => number,
): UsageSeries {
  const inRange = new Set(dates);
  const byKey = new Map<string, number>();
  const cells = new Map<string, number>();
  for (const entry of entries) {
    if (!inRange.has(entry.date)) continue;
    const amount = value(entry);
    byKey.set(entry.key, (byKey.get(entry.key) ?? 0) + amount);
    const cell = `${entry.date}\u0000${entry.key}`;
    cells.set(cell, (cells.get(cell) ?? 0) + amount);
  }
  const totals = [...byKey.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({ key, value: amount }))
    .sort((a, b) => {
      if (a.key === USAGE_OTHER_KEY) return 1;
      if (b.key === USAGE_OTHER_KEY) return -1;
      return b.value - a.value || a.key.localeCompare(b.key);
    });
  const keys = totals.map((total) => total.key);
  const rows = dates.map((date) => {
    const row: Record<string, number | string> = { date };
    keys.forEach((key, index) => {
      row[seriesId(index)] = cells.get(`${date}\u0000${key}`) ?? 0;
    });
    return row;
  });
  return {
    keys,
    rows,
    totals,
    total: totals.reduce((sum, entry) => sum + entry.value, 0),
  };
}

/** "agent-native-mail" and "google-docs" read as "Mail" and "Google Docs". */
export function humanizeKey(value: string): string {
  return value
    .replace(/^agent-native-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  slack: "Slack",
  telegram: "Telegram",
  discord: "Discord",
  whatsapp: "WhatsApp",
  teams: "Microsoft Teams",
  github: "GitHub",
  linear: "Linear",
  "google-docs": "Google Docs",
  "google-chat": "Google Chat",
};

/** Integration platform ids are product names, which stay untranslated. */
export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? humanizeKey(platform);
}
