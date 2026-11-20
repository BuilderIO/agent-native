import type { ReactNode } from "react";

export type FilterMode = "and" | "or";

export type FilterFieldType =
  | "choice"
  | "person"
  | "multi"
  | "boolean"
  | "date"
  | "text"
  | "number";

export const FILTER_OPERATORS = [
  "equals",
  "does_not_equal",
  "contains",
  "does_not_contain",
  "starts_with",
  "ends_with",
  "greater_than",
  "less_than",
  "greater_than_or_equal",
  "less_than_or_equal",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "is_within",
  "is_checked",
  "is_unchecked",
  "is_empty",
  "is_not_empty",
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FILTER_NOBODY = "~nobody";

export interface FilterOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

export type FilterCellValue =
  | string
  | number
  | boolean
  | Date
  | readonly string[]
  | null
  | undefined;

export interface FilterField<Row = never> {
  id: string;
  label: string;
  shortLabel?: string;
  type: FilterFieldType;
  icon?: ReactNode;
  options?: readonly FilterOption[];
  alwaysSet?: boolean;
  dates?: "past" | "future" | "any";
  valueNoun?: { one: string; other: string };
  booleanLabels?: { checked: string; unchecked: string };
  pinned?: { default: readonly string[]; allLabel?: string };
  get?: (row: Row) => FilterCellValue;
}

export interface FilterRule {
  kind: "rule";
  id: string;
  field: string;
  operator: FilterOperator;
  value: string[];
}

export interface FilterGroup {
  kind: "group";
  id: string;
  mode: FilterMode;
  rules: FilterRule[];
}

export type FilterItem = FilterRule | FilterGroup;

export interface FilterState {
  mode: FilterMode;
  items: FilterItem[];
  pinned: Partial<Record<string, string[]>>;
}

const OPERATORS_BY_TYPE: Record<FilterFieldType, readonly FilterOperator[]> = {
  choice: ["equals", "does_not_equal", "is_empty", "is_not_empty"],
  person: ["equals", "does_not_equal"],
  multi: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  boolean: ["is_checked", "is_unchecked"],
  date: [
    "is_within",
    "equals",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "is_empty",
    "is_not_empty",
  ],
  text: [
    "contains",
    "does_not_contain",
    "equals",
    "does_not_equal",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty",
  ],
  number: [
    "equals",
    "does_not_equal",
    "greater_than",
    "less_than",
    "greater_than_or_equal",
    "less_than_or_equal",
    "is_empty",
    "is_not_empty",
  ],
};

const VALUELESS_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "is_checked",
  "is_unchecked",
  "is_empty",
  "is_not_empty",
]);

const EMPTINESS_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "is_empty",
  "is_not_empty",
]);

export function filterOperatorsFor(
  field: Pick<FilterField<unknown>, "type" | "alwaysSet">,
): readonly FilterOperator[] {
  const operators = OPERATORS_BY_TYPE[field.type];
  return field.alwaysSet
    ? operators.filter((operator) => !EMPTINESS_OPERATORS.has(operator))
    : operators;
}

export function filterOperatorTakesValue(operator: FilterOperator) {
  return !VALUELESS_OPERATORS.has(operator);
}

export function filterOperatorTakesManyValues(
  field: Pick<FilterField<unknown>, "type">,
  operator: FilterOperator,
) {
  switch (field.type) {
    case "choice":
    case "person":
      return operator === "equals" || operator === "does_not_equal";
    case "multi":
      return operator === "contains" || operator === "does_not_contain";
    case "boolean":
    case "date":
    case "text":
    case "number":
      return false;
  }
}

export function defaultFilterOperator(
  field: Pick<FilterField<unknown>, "type" | "alwaysSet">,
): FilterOperator {
  return filterOperatorsFor(field).at(0) ?? "equals";
}

export function isFilterOperator(value: string): value is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(value);
}

let lastItemId = 0;

export function filterItemId(prefix: "r" | "g") {
  lastItemId += 1;
  return `${prefix}${lastItemId.toString(36)}`;
}

export function createFilterRule(
  field: Pick<FilterField<unknown>, "id" | "type" | "alwaysSet">,
  value: string[] = [],
  operator: FilterOperator = defaultFilterOperator(field),
): FilterRule {
  return {
    kind: "rule",
    id: filterItemId("r"),
    field: field.id,
    operator,
    value,
  };
}

export function createFilterGroup(
  rules: FilterRule[],
  mode: FilterMode = "or",
): FilterGroup {
  return { kind: "group", id: filterItemId("g"), mode, rules };
}

export function createFilterState(
  fields: readonly FilterField<never>[],
): FilterState {
  const pinned: Partial<Record<string, string[]>> = {};
  for (const field of fields) {
    if (field.pinned) pinned[field.id] = [...field.pinned.default];
  }
  return { mode: "and", items: [], pinned };
}

export function findFilterField<Row>(
  fields: readonly FilterField<Row>[],
  id: string,
): FilterField<Row> | undefined {
  return fields.find((field) => field.id === id);
}

export function isFilterRuleComplete(
  rule: FilterRule,
  field: FilterField<never> | undefined,
) {
  if (!field || field.pinned) return false;
  if (!filterOperatorsFor(field).includes(rule.operator)) return false;
  if (!filterOperatorTakesValue(rule.operator)) return true;
  if (rule.value.length === 0) return false;
  if (rule.value.some((value) => value.trim() === "")) return false;
  if (!filterOperatorTakesManyValues(field, rule.operator)) {
    if (rule.value.length !== 1) return false;
  }
  if (field.type === "date") {
    const [value = ""] = rule.value;
    return rule.operator === "is_within"
      ? parseFilterDateRange(value) !== null
      : resolveFilterDay(value, "2000-01-01") !== null;
  }
  if (field.type === "number") {
    return Number.isFinite(Number(rule.value.at(0)));
  }
  return true;
}

export function completeFilterRules(
  item: FilterItem,
  fields: readonly FilterField<never>[],
): FilterRule[] {
  const rules = item.kind === "group" ? item.rules : [item];
  return rules.filter((rule) =>
    isFilterRuleComplete(rule, findFilterField(fields, rule.field)),
  );
}

export function activeFilterRuleCount(
  state: FilterState,
  fields: readonly FilterField<never>[],
) {
  return state.items.reduce(
    (count, item) => count + completeFilterRules(item, fields).length,
    0,
  );
}

function sameValues(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

export function pinnedFilterValue(
  state: FilterState,
  field: FilterField<never>,
): string[] {
  return state.pinned[field.id] ?? [...(field.pinned?.default ?? [])];
}

export function isPinnedFilterDefault(
  state: FilterState,
  field: FilterField<never>,
) {
  return sameValues(
    pinnedFilterValue(state, field),
    field.pinned?.default ?? [],
  );
}

export function pinnedFilterCoversAll(
  value: readonly string[],
  field: FilterField<never>,
) {
  const options = field.options ?? [];
  return (
    options.length > 0 && options.every((option) => value.includes(option.id))
  );
}

export function isDefaultFilterState(
  state: FilterState,
  fields: readonly FilterField<never>[],
) {
  return (
    state.mode === "and" &&
    activeFilterRuleCount(state, fields) === 0 &&
    fields.every(
      (field) => !field.pinned || isPinnedFilterDefault(state, field),
    )
  );
}

export function hasIncompleteFilterRules(
  state: FilterState,
  fields: readonly FilterField<never>[],
) {
  return state.items.some(
    (item) =>
      completeFilterRules(item, fields).length !==
      (item.kind === "group" ? item.rules.length : 1),
  );
}

export function pruneFilterState(
  state: FilterState,
  fields: readonly FilterField<never>[],
): FilterState {
  const items: FilterItem[] = [];
  for (const item of state.items) {
    const rules = completeFilterRules(item, fields);
    if (rules.length === 0) continue;
    items.push(item.kind === "group" ? { ...item, rules } : item);
  }
  return { ...state, items };
}

function mapRules(
  state: FilterState,
  map: (rule: FilterRule) => FilterRule,
): FilterState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === "group"
        ? { ...item, rules: item.rules.map(map) }
        : map(item),
    ),
  };
}

export function addFilterRule(
  state: FilterState,
  rule: FilterRule,
  groupId?: string,
): FilterState {
  if (!groupId) return { ...state, items: [...state.items, rule] };
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === "group" && item.id === groupId
        ? { ...item, rules: [...item.rules, rule] }
        : item,
    ),
  };
}

export function addFilterGroup(
  state: FilterState,
  group: FilterGroup,
): FilterState {
  return { ...state, items: [...state.items, group] };
}

export type FilterRulePatch = Partial<
  Pick<FilterRule, "field" | "operator" | "value">
>;

export function patchFilterRule(
  rule: FilterRule,
  patch: FilterRulePatch,
  fields: readonly FilterField<never>[],
): FilterRule {
  if (patch.field !== undefined && patch.field !== rule.field) {
    const field = findFilterField(fields, patch.field);
    if (!field) return rule;
    return {
      ...rule,
      field: field.id,
      operator: patch.operator ?? defaultFilterOperator(field),
      value: patch.value ?? [],
    };
  }
  const field = findFilterField(fields, rule.field);
  const operator = patch.operator ?? rule.operator;
  let value = patch.value ?? rule.value;
  if (patch.operator !== undefined && patch.value === undefined && field) {
    if (!filterOperatorTakesValue(operator)) value = [];
    else if (
      field.type === "date" &&
      (operator === "is_within") !== (rule.operator === "is_within")
    ) {
      value = [];
    } else if (!filterOperatorTakesManyValues(field, operator)) {
      value = value.slice(0, 1);
    }
  }
  return { ...rule, operator, value };
}

export function findFilterRule(
  state: FilterState,
  ruleId: string,
): FilterRule | undefined {
  for (const item of state.items) {
    if (item.kind === "rule" && item.id === ruleId) return item;
    if (item.kind === "group") {
      const rule = item.rules.find((candidate) => candidate.id === ruleId);
      if (rule) return rule;
    }
  }
  return undefined;
}

export function updateFilterRule(
  state: FilterState,
  ruleId: string,
  patch: FilterRulePatch,
  fields: readonly FilterField<never>[],
): FilterState {
  return mapRules(state, (rule) =>
    rule.id === ruleId ? patchFilterRule(rule, patch, fields) : rule,
  );
}

export function removeFilterItem(state: FilterState, id: string): FilterState {
  const items: FilterItem[] = [];
  for (const item of state.items) {
    if (item.id === id) continue;
    if (item.kind === "group") {
      const rules = item.rules.filter((rule) => rule.id !== id);
      if (rules.length === 0) continue;
      items.push(
        rules.length === item.rules.length ? item : { ...item, rules },
      );
    } else {
      items.push(item);
    }
  }
  return { ...state, items };
}

export function setFilterMode(
  state: FilterState,
  mode: FilterMode,
  groupId?: string,
): FilterState {
  if (!groupId) return { ...state, mode };
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === "group" && item.id === groupId ? { ...item, mode } : item,
    ),
  };
}

export function setPinnedFilter(
  state: FilterState,
  fieldId: string,
  value: string[],
): FilterState {
  return { ...state, pinned: { ...state.pinned, [fieldId]: value } };
}

export const FILTER_RELATIVE_DAYS = ["today", "yesterday", "tomorrow"] as const;

export type FilterRelativeDay = (typeof FILTER_RELATIVE_DAYS)[number];

export const FILTER_DATE_UNITS = ["day", "week", "month", "year"] as const;

export type FilterDateUnit = (typeof FILTER_DATE_UNITS)[number];

export const FILTER_DATE_RANGE_MAX_COUNT = 999;

export type FilterDateRange =
  | { direction: "past" | "next"; count: number; unit: FilterDateUnit }
  | { direction: "this"; unit: FilterDateUnit };

const DATE_UNIT_PATTERN = FILTER_DATE_UNITS.join("|");

const DATE_RANGE_TOKEN = new RegExp(
  `^(?:(past|next)_([1-9]\\d{0,2})_(${DATE_UNIT_PATTERN})s?|this_(${DATE_UNIT_PATTERN}))$`,
);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const RELATIVE_DAY_OFFSETS: Record<FilterRelativeDay, number> = {
  yesterday: -1,
  today: 0,
  tomorrow: 1,
};

function isFilterDateUnit(value: string): value is FilterDateUnit {
  return (FILTER_DATE_UNITS as readonly string[]).includes(value);
}

export function isFilterRelativeDay(value: string): value is FilterRelativeDay {
  return (FILTER_RELATIVE_DAYS as readonly string[]).includes(value);
}

export function parseFilterDateRange(token: string): FilterDateRange | null {
  const match = DATE_RANGE_TOKEN.exec(token);
  if (!match) return null;
  const [, direction, count, unit, thisUnit] = match;
  if (thisUnit && isFilterDateUnit(thisUnit)) {
    return { direction: "this", unit: thisUnit };
  }
  if (
    (direction === "past" || direction === "next") &&
    unit &&
    isFilterDateUnit(unit)
  ) {
    return { direction, count: Number(count), unit };
  }
  return null;
}

export function filterDateRangeToken(range: FilterDateRange) {
  if (range.direction === "this") return `this_${range.unit}`;
  const unit = range.count === 1 ? range.unit : `${range.unit}s`;
  return `${range.direction}_${range.count}_${unit}`;
}

function dayDate(day: string) {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

function addDays(day: string, days: number) {
  const date = dayDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(day: string, months: number) {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
}

function addUnits(day: string, count: number, unit: FilterDateUnit) {
  switch (unit) {
    case "day":
      return addDays(day, count);
    case "week":
      return addDays(day, count * 7);
    case "month":
      return addMonths(day, count);
    case "year":
      return addMonths(day, count * 12);
  }
}

export function filterDateRangeDays(
  range: FilterDateRange,
  today: string,
): [string, string] {
  if (range.direction === "past") {
    return [addDays(addUnits(today, -range.count, range.unit), 1), today];
  }
  if (range.direction === "next") {
    const end = addUnits(today, range.count, range.unit);
    const shortened =
      (range.unit === "month" || range.unit === "year") &&
      end.slice(8) !== today.slice(8);
    return [today, shortened ? end : addDays(end, -1)];
  }
  switch (range.unit) {
    case "day":
      return [today, today];
    case "week": {
      const weekStart = addDays(today, -dayDate(today).getUTCDay());
      return [weekStart, addDays(weekStart, 6)];
    }
    case "month": {
      const monthStart = `${today.slice(0, 7)}-01`;
      return [monthStart, addDays(addMonths(monthStart, 1), -1)];
    }
    case "year":
      return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
  }
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string | undefined) {
  const key = timeZone ?? "";
  const cached = dayFormatters.get(key);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  dayFormatters.set(key, formatter);
  return formatter;
}

function dayOfDate(date: Date, timeZone: string | undefined) {
  const parts = dayFormatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function filterToday(timeZone?: string, now = new Date()) {
  return dayOfDate(now, timeZone);
}

export function resolveFilterDay(value: string, today: string): string | null {
  const trimmed = value.trim();
  if (isFilterRelativeDay(trimmed)) {
    return addDays(today, RELATIVE_DAY_OFFSETS[trimmed]);
  }
  if (!DAY_PATTERN.test(trimmed)) return null;
  return Number.isNaN(dayDate(trimmed).getTime()) ? null : trimmed;
}

export interface FilterDatePreset {
  operator: "equals" | "is_within";
  value: string;
}

export function filterDatePresets(
  field: Pick<FilterField<unknown>, "dates">,
): FilterDatePreset[] {
  const dates = field.dates ?? "any";
  const past: FilterDatePreset[] = [
    { operator: "equals", value: "today" },
    { operator: "equals", value: "yesterday" },
    { operator: "is_within", value: "past_7_days" },
    { operator: "is_within", value: "past_30_days" },
    { operator: "is_within", value: "this_week" },
    { operator: "is_within", value: "this_month" },
    { operator: "is_within", value: "this_year" },
  ];
  const future: FilterDatePreset[] = [
    { operator: "equals", value: "today" },
    { operator: "equals", value: "tomorrow" },
    { operator: "is_within", value: "next_7_days" },
    { operator: "is_within", value: "next_30_days" },
    { operator: "is_within", value: "this_week" },
    { operator: "is_within", value: "this_month" },
  ];
  if (dates === "past") return past;
  if (dates === "future") return future;
  const seen = new Set<string>();
  return [...past, ...future].filter((preset) => {
    const key = `${preset.operator}:${preset.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cellValues(value: FilterCellValue): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (value instanceof Date) return [value.toISOString()];
  return value.filter((entry) => entry.trim() !== "");
}

function cellDay(value: FilterCellValue, timeZone: string | undefined) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : dayOfDate(date, timeZone);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (DAY_PATTERN.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : dayOfDate(date, timeZone);
}

function cellNumber(value: FilterCellValue) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cellText(value: FilterCellValue) {
  return cellValues(value).join(" ").toLowerCase();
}

function cellChecked(value: FilterCellValue) {
  if (typeof value === "string") return value !== "" && value !== "false";
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function hasAnyOption(cell: readonly string[], options: readonly string[]) {
  return options.some((option) =>
    option === FILTER_NOBODY ? cell.length === 0 : cell.includes(option),
  );
}

export interface FilterMatchContext {
  today: string;
  timeZone?: string;
}

const DAY_COMPARISONS: Partial<
  Record<FilterOperator, (day: string, target: string) => boolean>
> = {
  equals: (day, target) => day === target,
  before: (day, target) => day < target,
  after: (day, target) => day > target,
  on_or_before: (day, target) => day <= target,
  on_or_after: (day, target) => day >= target,
};

const TEXT_COMPARISONS: Partial<
  Record<FilterOperator, (text: string, query: string) => boolean>
> = {
  contains: (text, query) => text.includes(query),
  does_not_contain: (text, query) => !text.includes(query),
  equals: (text, query) => text === query,
  does_not_equal: (text, query) => text !== query,
  starts_with: (text, query) => text.startsWith(query),
  ends_with: (text, query) => text.endsWith(query),
};

const NUMBER_COMPARISONS: Partial<
  Record<FilterOperator, (number: number, target: number) => boolean>
> = {
  equals: (number, target) => number === target,
  does_not_equal: (number, target) => number !== target,
  greater_than: (number, target) => number > target,
  less_than: (number, target) => number < target,
  greater_than_or_equal: (number, target) => number >= target,
  less_than_or_equal: (number, target) => number <= target,
};

function matchesOptions(cell: readonly string[], rule: FilterRule) {
  if (rule.operator === "is_empty") return cell.length === 0;
  if (rule.operator === "is_not_empty") return cell.length > 0;
  const hit = hasAnyOption(cell, rule.value);
  return rule.operator === "does_not_equal" ||
    rule.operator === "does_not_contain"
    ? !hit
    : hit;
}

function matchesDay(
  day: string | null,
  rule: FilterRule,
  context: FilterMatchContext,
) {
  if (rule.operator === "is_empty") return day === null;
  if (rule.operator === "is_not_empty") return day !== null;
  if (day === null) return false;
  const value = rule.value.at(0) ?? "";
  if (rule.operator === "is_within") {
    const range = parseFilterDateRange(value);
    if (!range) return true;
    const [start, end] = filterDateRangeDays(range, context.today);
    return day >= start && day <= end;
  }
  const target = resolveFilterDay(value, context.today);
  const compare = DAY_COMPARISONS[rule.operator];
  return target === null || !compare ? true : compare(day, target);
}

function matchesText(text: string, rule: FilterRule) {
  if (rule.operator === "is_empty") return text.trim() === "";
  if (rule.operator === "is_not_empty") return text.trim() !== "";
  const compare = TEXT_COMPARISONS[rule.operator];
  return compare ? compare(text, (rule.value.at(0) ?? "").toLowerCase()) : true;
}

function matchesNumber(number: number | null, rule: FilterRule) {
  if (rule.operator === "is_empty") return number === null;
  if (rule.operator === "is_not_empty") return number !== null;
  if (number === null) return false;
  const compare = NUMBER_COMPARISONS[rule.operator];
  return compare ? compare(number, Number(rule.value.at(0))) : true;
}

export function matchesFilterRule<Row>(
  row: Row,
  rule: FilterRule,
  field: FilterField<Row>,
  context: FilterMatchContext,
): boolean {
  const raw = field.get ? field.get(row) : undefined;
  switch (field.type) {
    case "choice":
    case "person":
    case "multi":
      return matchesOptions(cellValues(raw), rule);
    case "boolean":
      return rule.operator === "is_unchecked"
        ? !cellChecked(raw)
        : cellChecked(raw);
    case "date":
      return matchesDay(cellDay(raw, context.timeZone), rule, context);
    case "text":
      return matchesText(cellText(raw), rule);
    case "number":
      return matchesNumber(cellNumber(raw), rule);
  }
}

function matchesItems<Row>(
  row: Row,
  state: FilterState,
  fields: readonly FilterField<Row>[],
  context: FilterMatchContext,
  skipField?: string,
): boolean {
  const tests: (() => boolean)[] = [];
  for (const item of state.items) {
    const rules = completeFilterRules(item, fields).filter(
      (rule) => rule.field !== skipField,
    );
    if (rules.length === 0) continue;
    const ruleTests = rules.map((rule) => () => {
      const field = findFilterField(fields, rule.field);
      return field ? matchesFilterRule(row, rule, field, context) : true;
    });
    if (item.kind === "group") {
      tests.push(() =>
        item.mode === "or"
          ? ruleTests.some((test) => test())
          : ruleTests.every((test) => test()),
      );
    } else {
      tests.push(...ruleTests);
    }
  }
  if (tests.length === 0) return true;
  return state.mode === "or"
    ? tests.some((test) => test())
    : tests.every((test) => test());
}

function matchesPinned<Row>(
  row: Row,
  state: FilterState,
  fields: readonly FilterField<Row>[],
  skipField?: string,
) {
  return fields.every((field) => {
    if (!field.pinned || field.id === skipField) return true;
    const value = pinnedFilterValue(state, field);
    if (value.length === 0 || pinnedFilterCoversAll(value, field)) return true;
    return hasAnyOption(cellValues(field.get?.(row)), value);
  });
}

export function matchesFilter<Row>(
  row: Row,
  state: FilterState,
  fields: readonly FilterField<Row>[],
  context: FilterMatchContext,
) {
  return (
    matchesPinned(row, state, fields) &&
    matchesItems(row, state, fields, context)
  );
}

export interface FilterCounts {
  matching: number;
  hiddenByPinned: number;
  option(fieldId: string, optionId: string): number | undefined;
}

export function countFilter<Row>(
  rows: readonly Row[],
  state: FilterState,
  fields: readonly FilterField<Row>[],
  context: FilterMatchContext,
): FilterCounts {
  let matching = 0;
  let hiddenByPinned = 0;
  for (const row of rows) {
    if (!matchesItems(row, state, fields, context)) continue;
    if (matchesPinned(row, state, fields)) matching += 1;
    else hiddenByPinned += 1;
  }
  const optionCounts = new Map<string, Map<string, number>>();
  const countsFor = (field: FilterField<Row>) => {
    const cached = optionCounts.get(field.id);
    if (cached) return cached;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const visible = field.pinned
        ? matchesPinned(row, state, fields, field.id) &&
          matchesItems(row, state, fields, context)
        : matchesPinned(row, state, fields) &&
          (state.mode === "or" ||
            matchesItems(row, state, fields, context, field.id));
      if (!visible) continue;
      const cell = cellValues(field.get?.(row));
      if (cell.length === 0) {
        counts.set(FILTER_NOBODY, (counts.get(FILTER_NOBODY) ?? 0) + 1);
      }
      for (const value of new Set(cell)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    optionCounts.set(field.id, counts);
    return counts;
  };
  return {
    matching,
    hiddenByPinned,
    option(fieldId, optionId) {
      const field = findFilterField(fields, fieldId);
      if (!field?.get) return undefined;
      return countsFor(field).get(optionId) ?? 0;
    },
  };
}
