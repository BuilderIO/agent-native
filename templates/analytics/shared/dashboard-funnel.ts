import type { FunnelOutcomesConfig } from "../app/pages/adhoc/sql-dashboard/types";

export interface DashboardFunnelOutcomes {
  completed: number;
  skipped: number;
  /** Shown but neither completed, skipped nor left: went on another way. */
  movedOn: number;
  left: number;
  optional: boolean;
}

export interface DashboardFunnelItem {
  label: string;
  value: number;
  percentOfFirst: number;
  dropOffPercent: number | null;
  /** Set when `config.funnelOutcomes` applies and this stage's columns add up. */
  outcomes?: DashboardFunnelOutcomes;
}

export type DashboardFunnelOutcomeProblem =
  | "not-a-count"
  | "overfull"
  | "not-a-flag";

export interface DashboardFunnelOutcomeIssue {
  label: string;
  problem: DashboardFunnelOutcomeProblem;
}

export interface DashboardFunnelOutcomeSummary {
  keys: FunnelOutcomesConfig;
  /** Configured columns the result lacks; no stage splits while any is missing. */
  missingColumns: string[];
  /** Stages that draw a plain bar, or draw without their Optional tag. */
  issues: DashboardFunnelOutcomeIssue[];
}

export interface DashboardFunnelRows {
  labelKey: string;
  valueKey: string;
  items: DashboardFunnelItem[];
  /** Set only when the panel has a valid `config.funnelOutcomes`. */
  outcomes?: DashboardFunnelOutcomeSummary;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasNumericValue(
  rows: Array<Record<string, unknown>>,
  key: string,
): boolean {
  return rows.some((row) => {
    const value = finiteNumber(row[key]);
    return value !== null && value >= 0;
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The outcome keys a stored config names, or null when it names none usable. */
export function funnelOutcomeKeys(value: unknown): FunnelOutcomesConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !nonEmptyString(record.completedKey) ||
    !nonEmptyString(record.leftKey) ||
    (record.skippedKey !== undefined && !nonEmptyString(record.skippedKey)) ||
    (record.optionalKey !== undefined && !nonEmptyString(record.optionalKey))
  ) {
    return null;
  }
  return {
    completedKey: record.completedKey,
    leftKey: record.leftKey,
    ...(record.skippedKey ? { skippedKey: record.skippedKey } : {}),
    ...(record.optionalKey ? { optionalKey: record.optionalKey } : {}),
  };
}

export function funnelOutcomeColumns(keys: FunnelOutcomesConfig): string[] {
  return [
    keys.completedKey,
    keys.skippedKey,
    keys.leftKey,
    keys.optionalKey,
  ].filter((key): key is string => !!key);
}

function flagValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function count(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function resolveOutcomes(
  row: Record<string, unknown>,
  shown: number,
  keys: FunnelOutcomesConfig,
): DashboardFunnelOutcomes | DashboardFunnelOutcomeProblem {
  const completed = count(row[keys.completedKey]);
  const left = count(row[keys.leftKey]);
  const skipped = keys.skippedKey ? count(row[keys.skippedKey]) : 0;
  if (completed === null || left === null || skipped === null) {
    return "not-a-count";
  }
  const movedOn = shown - completed - skipped - left;
  if (movedOn < 0) return "overfull";
  return {
    completed,
    skipped,
    movedOn,
    left,
    optional: keys.optionalKey
      ? flagValue(row[keys.optionalKey]) === true
      : false,
  };
}

/** `part` as a percentage of the people shown a stage. */
export function funnelOutcomeShare(part: number, shown: number): number {
  return shown > 0 ? (part / shown) * 100 : 0;
}

export function resolveDashboardFunnelRows(
  rows: Array<Record<string, unknown>>,
  configuredLabelKey?: string,
  configuredValueKey?: string,
  configuredOutcomes?: unknown,
): DashboardFunnelRows {
  const outcomeKeys = funnelOutcomeKeys(configuredOutcomes);
  if (rows.length === 0) {
    return {
      labelKey: "",
      valueKey: "",
      items: [],
      ...(outcomeKeys
        ? { outcomes: { keys: outcomeKeys, missingColumns: [], issues: [] } }
        : {}),
    };
  }

  const columns = Object.keys(rows[0]);
  const columnSet = new Set(columns);
  const labelKey =
    (configuredLabelKey && columnSet.has(configuredLabelKey)
      ? configuredLabelKey
      : undefined) ||
    columns.find((key) =>
      rows.some((row) => typeof row[key] === "string" && row[key].trim()),
    ) ||
    columns[0] ||
    "";
  const valueKey =
    (configuredValueKey && columnSet.has(configuredValueKey)
      ? configuredValueKey
      : undefined) ||
    columns.find((key) => key !== labelKey && hasNumericValue(rows, key)) ||
    "";

  const missingColumns = outcomeKeys
    ? funnelOutcomeColumns(outcomeKeys).filter((key) => !columnSet.has(key))
    : [];
  const splitKeys =
    outcomeKeys && missingColumns.length === 0 ? outcomeKeys : null;
  const issues: DashboardFunnelOutcomeIssue[] = [];

  const parsed = rows.flatMap((row) => {
    const label = typeof row[labelKey] === "string" ? row[labelKey].trim() : "";
    const value = finiteNumber(row[valueKey]);
    if (!label || value === null || value < 0) return [];
    if (!splitKeys) return [{ label, value }];
    const outcomes = resolveOutcomes(row, value, splitKeys);
    if (typeof outcomes === "string") {
      issues.push({ label, problem: outcomes });
      return [{ label, value }];
    }
    if (
      splitKeys.optionalKey &&
      flagValue(row[splitKeys.optionalKey]) === null
    ) {
      issues.push({ label, problem: "not-a-flag" });
    }
    return [{ label, value, outcomes }];
  });
  const firstValue = parsed[0]?.value ?? 0;

  return {
    labelKey,
    valueKey,
    items: parsed.map((item, index) => {
      const previousValue = parsed[index - 1]?.value;
      return {
        ...item,
        percentOfFirst: firstValue > 0 ? (item.value / firstValue) * 100 : 0,
        dropOffPercent:
          previousValue && previousValue > 0
            ? ((previousValue - item.value) / previousValue) * 100
            : null,
      };
    }),
    ...(outcomeKeys
      ? { outcomes: { keys: outcomeKeys, missingColumns, issues } }
      : {}),
  };
}

const OUTCOME_PROBLEM_TEXT: Record<DashboardFunnelOutcomeProblem, string> = {
  "not-a-count":
    "an outcome column is not a non-negative count; shown without the outcome split",
  overfull:
    "completed, skipped and left add up to more than shown; shown without the outcome split",
  "not-a-flag":
    "the optional column is not true or false; shown without the Optional tag",
};

/**
 * Why `config.funnelOutcomes` does not fully apply, for the agent's panel checks
 * and emailed reports; null when every stage splits as configured.
 */
export function describeFunnelOutcomeProblems(
  summary: DashboardFunnelOutcomeSummary,
): string | null {
  if (summary.missingColumns.length > 0) {
    return `The result has no ${summary.missingColumns.join(", ")} column, so no stage splits into outcomes.`;
  }
  if (summary.issues.length === 0) return null;
  const byProblem = new Map<DashboardFunnelOutcomeProblem, string[]>();
  for (const issue of summary.issues) {
    byProblem.set(issue.problem, [
      ...(byProblem.get(issue.problem) ?? []),
      issue.label,
    ]);
  }
  return Array.from(
    byProblem,
    ([problem, labels]) =>
      `${labels.length === 1 ? "Stage" : "Stages"} ${labels.map((label) => `"${label}"`).join(", ")}: ${OUTCOME_PROBLEM_TEXT[problem]}.`,
  ).join(" ");
}
