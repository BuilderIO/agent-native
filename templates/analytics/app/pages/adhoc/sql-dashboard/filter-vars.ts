import type { DashboardFilter, FilterType } from "./types";

const ALL_TIME_START = "1970-01-01";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FILTER_TYPES: ReadonlySet<FilterType> = new Set([
  "date",
  "date-range",
  "toggle-date",
]);
const FILTER_TYPES: DashboardFilter["type"][] = [
  "date",
  "date-range",
  "select",
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
    value.options === undefined ||
    (Array.isArray(value.options) &&
      value.options.length <= 100 &&
      value.options.every(
        (option) =>
          isRecord(option) &&
          typeof option.value === "string" &&
          typeof option.label === "string",
      ))
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
  return ISO_DATE_RE.test(resolved) ? resolved : "";
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
      out[startKey] =
        resolveDateValue(getParam(startKey), ALL_TIME_START) ||
        resolveDateValue(
          resolveDefault(filter.default, filter.type),
          ALL_TIME_START,
        );
      out[endKey] =
        resolveDateValue(getParam(endKey), daysAgo(0)) || daysAgo(0);
    } else if (filter.type === "toggle" || filter.type === "toggle-date") {
      out[filter.id] =
        filter.type === "toggle-date"
          ? resolveDateValue(getParam(filter.id), ALL_TIME_START)
          : getParam(filter.id);
    } else {
      const value = getParam(filter.id);
      out[filter.id] =
        filter.type === "date"
          ? resolveDateValue(value, ALL_TIME_START) ||
            resolveDateValue(
              resolveDefault(filter.default, filter.type),
              ALL_TIME_START,
            )
          : value || resolveDefault(filter.default, filter.type);
    }
  }
  return out;
}
