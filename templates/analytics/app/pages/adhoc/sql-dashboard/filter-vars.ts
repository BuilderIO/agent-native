import type { DashboardFilter, FilterPreset, FilterType } from "./types";

export const FILTER_PARAM_PREFIX = "f_";

// URL marker for a multi-select with every option unchecked. An absent param
// falls back to the filter default, so an empty selection needs its own value.
export const MULTI_SELECT_EMPTY = "__empty__";

// The one reduction of a multi-select value: the page, saved reports, and
// save-time validation all read the selection through it.
export function normalizeMultiSelectValue(raw: string): string {
  if (raw === MULTI_SELECT_EMPTY) return "";
  return raw.split(",").filter(Boolean).join(",");
}

const ALL_TIME_START = "1970-01-01";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FILTER_TYPES: ReadonlySet<FilterType> = new Set([
  "date",
  "date-range",
  "toggle-date",
]);
export const FILTER_TYPES: DashboardFilter["type"][] = [
  "date",
  "date-range",
  "select",
  "multi-select",
  "toggle",
  "text",
  "toggle-date",
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const MAX_FILTER_OPTIONS = 100;
// Each preset is a button in the dropdown, so a filter offers a short list.
export const MAX_FILTER_PRESETS = 20;

export function isDashboardFilter(value: unknown): value is DashboardFilter {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.label !== "string" ||
    !FILTER_TYPES.includes(value.type as DashboardFilter["type"]) ||
    (value.default !== undefined && typeof value.default !== "string")
  ) {
    return false;
  }
  return (
    (value.options === undefined ||
      (Array.isArray(value.options) &&
        value.options.length <= MAX_FILTER_OPTIONS &&
        value.options.every(
          (option) =>
            isRecord(option) &&
            typeof option.value === "string" &&
            typeof option.label === "string",
        ))) &&
    (value.presets === undefined ||
      (Array.isArray(value.presets) && value.presets.every(isFilterPreset)))
  );
}

export function isFilterPreset(value: unknown): value is FilterPreset {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    Array.isArray(value.values) &&
    value.values.every((v) => typeof v === "string")
  );
}

// The one usability check for presets, aligned with the input: null for a
// usable preset, else why not. Saves reject the first issue. The filter bar
// skips each unusable preset, because a config edited through the shared
// document reaches it unchecked and isDashboardFilter stays structural so it
// never drops the whole filter set.
export function filterPresetIssues(
  presets: readonly unknown[],
  optionValues: ReadonlySet<string>,
): (string | null)[] {
  const labels = new Set<string>();
  return presets.map((preset, index) => {
    if (index >= MAX_FILTER_PRESETS) {
      return `is past the limit of ${MAX_FILTER_PRESETS} presets`;
    }
    // Before isFilterPreset walks the values, so an oversized list costs nothing.
    if (
      isRecord(preset) &&
      Array.isArray(preset.values) &&
      preset.values.length > MAX_FILTER_OPTIONS
    ) {
      return `has more than ${MAX_FILTER_OPTIONS} values`;
    }
    if (
      !isFilterPreset(preset) ||
      preset.label.trim() === "" ||
      preset.values.length === 0
    ) {
      return "must be an object with a non-empty label and a non-empty values array";
    }
    if (labels.has(preset.label)) {
      return `label "${preset.label}" repeats an earlier preset`;
    }
    // A value with no checkbox would be applied to SQL unseen, as with the default.
    const unknown = preset.values.find((value) => !optionValues.has(value));
    if (unknown !== undefined) {
      return `names "${unknown}", which is not one of its options`;
    }
    labels.add(preset.label);
    return null;
  });
}

export function usableFilterPresets(
  presets: unknown,
  optionValues: ReadonlySet<string>,
): FilterPreset[] {
  if (!Array.isArray(presets)) return [];
  const bounded = presets.slice(0, MAX_FILTER_PRESETS);
  const issues = filterPresetIssues(bounded, optionValues);
  return bounded.filter(
    (preset, index): preset is FilterPreset => issues[index] === null,
  );
}

export function isDateRangePresetFilter(filter: DashboardFilter): boolean {
  if (filter.type !== "select" || !filter.options?.length) return false;
  const isRange = (value: string) => /^\d+d$/.test(value);
  return (
    filter.options.some((option) => isRange(option.value)) &&
    filter.options.every(
      (option) =>
        isRange(option.value) ||
        option.value === "all" ||
        option.value === "custom",
    )
  );
}

export function reviewDashboardFilters(
  value: unknown,
): DashboardFilter[] | undefined {
  if (!isRecord(value) || value.filters === undefined) return [];
  return Array.isArray(value.filters) &&
    value.filters.length <= 100 &&
    value.filters.every(isDashboardFilter)
    ? value.filters
    : undefined;
}

export function reviewDashboardVariables(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value) || value.variables === undefined) return {};
  if (!isRecord(value.variables)) return undefined;
  const entries = Object.entries(value.variables);
  if (
    entries.length > 100 ||
    entries.some(([, variable]) => typeof variable !== "string")
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

// Keep value-filter defaults literal: a select value such as "90d" is not a date.
export function resolveDefault(
  raw: string | undefined,
  type: FilterType,
): string {
  if (!raw) return "";
  if (DATE_FILTER_TYPES.has(type)) {
    const match = /^(\d+)d$/.exec(raw);
    if (match) return daysAgo(parseInt(match[1], 10));
    if (raw === "today") return daysAgo(0);
  }
  return raw;
}

function resolveDateValue(
  raw: string | undefined,
  allTimeValue: string,
): string {
  const value = raw?.trim();
  if (!value) return "";
  if (value.toLowerCase() === "all") return allTimeValue;

  const resolved = resolveDefault(value, "date");
  if (!ISO_DATE_RE.test(resolved)) return "";
  const parsed = new Date(`${resolved}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === resolved
    ? resolved
    : "";
}

function resolveDateParam(
  raw: string,
  fallback: string,
  allTimeValue: string,
): string {
  return raw.trim()
    ? resolveDateValue(raw, allTimeValue)
    : resolveDateValue(fallback, allTimeValue);
}

function dateRangeStart(range: string): string {
  const days = /^(\d+)d$/.exec(range);
  return days ? daysAgo(Number(days[1])) : daysAgo(30);
}

export function resolveDefaultFilterVars(
  config: unknown,
): Record<string, string> | undefined {
  const filters = reviewDashboardFilters(config);
  const variables = reviewDashboardVariables(config);
  if (!filters || !variables) return undefined;
  return { ...variables, ...resolveFilterVars(filters, () => "") };
}

export function resolveFilterVars(
  filters: DashboardFilter[],
  getParam: (key: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const filter of filters) {
    if (filter.type === "date-range") {
      const startKey = `${filter.id}Start`;
      const endKey = `${filter.id}End`;
      out[startKey] = resolveDateParam(
        getParam(startKey),
        resolveDefault(filter.default, filter.type),
        ALL_TIME_START,
      );
      out[endKey] = resolveDateParam(getParam(endKey), daysAgo(0), daysAgo(0));
    } else if (filter.type === "toggle" || filter.type === "toggle-date") {
      out[filter.id] =
        filter.type === "toggle-date"
          ? resolveDateValue(getParam(filter.id), ALL_TIME_START)
          : getParam(filter.id);
    } else if (isDateRangePresetFilter(filter)) {
      const value =
        getParam(filter.id) || resolveDefault(filter.default, filter.type);
      const startKey = filter.id + "Start";
      const endKey = filter.id + "End";
      const defaultRange = value === "custom" ? filter.default || "30d" : value;
      const fallbackStart =
        value === "custom" ? "" : dateRangeStart(defaultRange);
      const fallbackEnd = value === "custom" ? "" : daysAgo(0);
      out[filter.id] = value;
      out[startKey] = resolveDateParam(
        getParam(startKey),
        fallbackStart,
        fallbackStart,
      );
      out[endKey] = resolveDateParam(
        getParam(endKey),
        fallbackEnd,
        fallbackEnd,
      );
    } else if (filter.type === "multi-select") {
      const value = getParam(filter.id);
      out[filter.id] = normalizeMultiSelectValue(
        value || resolveDefault(filter.default, filter.type),
      );
    } else {
      const value = getParam(filter.id);
      out[filter.id] =
        filter.type === "date"
          ? resolveDateParam(
              value,
              resolveDefault(filter.default, filter.type),
              ALL_TIME_START,
            )
          : value || resolveDefault(filter.default, filter.type);
    }
  }
  return out;
}
