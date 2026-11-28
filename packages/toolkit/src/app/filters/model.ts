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
  "between",
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
  /** A row can hold several of the field's options at once. */
  manyPerRow?: boolean;
  dates?: "past" | "future" | "any";
  times?: boolean;
  operators?: readonly FilterOperator[];
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
  rules: FilterItem[];
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
    "between",
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

const UNLISTED_OPERATORS_BY_TYPE: Partial<
  Record<FilterFieldType, readonly FilterOperator[]>
> = {
  date: ["does_not_equal"],
};

export function filterOperatorsFor(
  field: Pick<FilterField<unknown>, "type" | "alwaysSet" | "operators">,
): readonly FilterOperator[] {
  const operators = field.operators ?? OPERATORS_BY_TYPE[field.type];
  return field.alwaysSet
    ? operators.filter((operator) => !EMPTINESS_OPERATORS.has(operator))
    : operators;
}

export function filterOperatorsAcceptedFor(
  field: Pick<FilterField<unknown>, "type" | "alwaysSet" | "operators">,
): readonly FilterOperator[] {
  if (field.operators) return filterOperatorsFor(field);
  const unlisted = UNLISTED_OPERATORS_BY_TYPE[field.type] ?? [];
  return [...filterOperatorsFor(field), ...unlisted];
}

export function filterOperatorTakesValue(operator: FilterOperator) {
  return !VALUELESS_OPERATORS.has(operator);
}

export function filterOperatorValueCount(operator: FilterOperator) {
  if (!filterOperatorTakesValue(operator)) return 0;
  return operator === "between" ? 2 : 1;
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
  field: Pick<FilterField<unknown>, "type" | "alwaysSet" | "operators">,
): FilterOperator {
  return filterOperatorsFor(field).at(0) ?? "equals";
}

export function isFilterOperator(value: string): value is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(value);
}

const itemIdSeed = Math.random().toString(36).slice(2, 8);
let lastItemId = 0;

export function filterItemId(prefix: "r" | "g") {
  lastItemId += 1;
  return `${prefix}-${itemIdSeed}-${lastItemId.toString(36)}`;
}

export function createFilterRule(
  field: Pick<FilterField<unknown>, "id" | "type" | "alwaysSet" | "operators">,
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
  rules: FilterItem[],
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
  if (!filterOperatorsAcceptedFor(field).includes(rule.operator)) return false;
  if (!filterOperatorTakesValue(rule.operator)) return true;
  if (rule.value.length === 0) return false;
  if (rule.value.some((value) => value.trim() === "")) return false;
  if (!filterOperatorTakesManyValues(field, rule.operator)) {
    if (rule.value.length !== filterOperatorValueCount(rule.operator)) {
      return false;
    }
  }
  if (field.type === "date") {
    if (rule.operator === "is_within") {
      return parseFilterDateRange(rule.value.at(0) ?? "") !== null;
    }
    return rule.value.every(
      (value) =>
        resolveFilterDateBound(value, "2000-01-01", { times: field.times }) !==
        null,
    );
  }
  if (field.type === "number") {
    return Number.isFinite(Number(rule.value.at(0)));
  }
  return true;
}

/** Every rule in an item, including those in groups inside a group. */
export function filterItemRules(item: FilterItem): FilterRule[] {
  return item.kind === "group" ? item.rules.flatMap(filterItemRules) : [item];
}

export function completeFilterRules(
  item: FilterItem,
  fields: readonly FilterField<never>[],
): FilterRule[] {
  return filterItemRules(item).filter((rule) =>
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
    activeFilterRuleCount(state, fields) === 0 &&
    changedPinnedFilterFields(state, fields).length === 0
  );
}

export function changedPinnedFilterFields(
  state: FilterState,
  fields: readonly FilterField<never>[],
): FilterField<never>[] {
  return fields.filter(
    (field) => field.pinned && !isPinnedFilterDefault(state, field),
  );
}

export function hasIncompleteFilterRules(
  state: FilterState,
  fields: readonly FilterField<never>[],
) {
  return state.items.some(
    (item) =>
      completeFilterRules(item, fields).length !== filterItemRules(item).length,
  );
}

export function incompleteFilterRuleIds(
  state: FilterState,
  fields: readonly FilterField<never>[],
): Set<string> {
  const ids = new Set<string>();
  for (const item of state.items) {
    for (const rule of filterItemRules(item)) {
      if (!isFilterRuleComplete(rule, findFilterField(fields, rule.field))) {
        ids.add(rule.id);
      }
    }
  }
  return ids;
}

function pruneItems(
  items: readonly FilterItem[],
  fields: readonly FilterField<never>[],
  keep: ReadonlySet<string>,
): FilterItem[] {
  const kept: FilterItem[] = [];
  for (const item of items) {
    if (item.kind === "rule") {
      if (
        keep.has(item.id) ||
        isFilterRuleComplete(item, findFilterField(fields, item.field))
      ) {
        kept.push(item);
      }
      continue;
    }
    const rules = pruneItems(item.rules, fields, keep);
    if (rules.length > 0) kept.push({ ...item, rules });
  }
  return kept;
}

/** Drops unfinished rules and the groups they leave empty; rules whose ids are in `keep` stay. */
export function pruneFilterState(
  state: FilterState,
  fields: readonly FilterField<never>[],
  keep: ReadonlySet<string> = new Set(),
): FilterState {
  return { ...state, items: pruneItems(state.items, fields, keep) };
}

/** The state once a filter closes, without its unfinished rules other than those in `keep`; undefined when no rule goes. */
export function filterStateAfterClose(
  state: FilterState,
  fields: readonly FilterField<never>[],
  keep: ReadonlySet<string>,
): FilterState | undefined {
  if (!hasIncompleteFilterRules(state, fields)) return undefined;
  const pruned = pruneFilterState(state, fields, keep);
  return incompleteFilterRuleIds(pruned, fields).size !==
    incompleteFilterRuleIds(state, fields).size
    ? pruned
    : undefined;
}

export function pruneFilterGroup(
  state: FilterState,
  groupId: string,
  fields: readonly FilterField<never>[],
  keep: ReadonlySet<string> = new Set(),
): FilterState {
  return {
    ...state,
    items: state.items.flatMap((item) =>
      item.id === groupId ? pruneItems([item], fields, keep) : [item],
    ),
  };
}

function mapItemRules(
  item: FilterItem,
  map: (rule: FilterRule) => FilterRule,
): FilterItem {
  if (item.kind === "rule") return map(item);
  return {
    ...item,
    rules: item.rules.map((member) => mapItemRules(member, map)),
  };
}

function mapRules(
  state: FilterState,
  map: (rule: FilterRule) => FilterRule,
): FilterState {
  return {
    ...state,
    items: state.items.map((item) => mapItemRules(item, map)),
  };
}

function updateGroup(
  items: readonly FilterItem[],
  groupId: string,
  update: (group: FilterGroup) => FilterGroup,
): FilterItem[] {
  return items.map((item) => {
    if (item.kind === "rule") return item;
    if (item.id === groupId) return update(item);
    return { ...item, rules: updateGroup(item.rules, groupId, update) };
  });
}

export function findFilterGroup(
  state: FilterState,
  groupId: string,
): FilterGroup | undefined {
  const search = (items: readonly FilterItem[]): FilterGroup | undefined => {
    for (const item of items) {
      if (item.kind === "rule") continue;
      if (item.id === groupId) return item;
      const nested = search(item.rules);
      if (nested) return nested;
    }
    return undefined;
  };
  return search(state.items);
}

export function addFilterRule(
  state: FilterState,
  rule: FilterRule,
  groupId?: string,
): FilterState {
  if (!groupId) return { ...state, items: [...state.items, rule] };
  return {
    ...state,
    items: updateGroup(state.items, groupId, (group) => ({
      ...group,
      rules: [...group.rules, rule],
    })),
  };
}

function nestsDeeperThan(group: FilterGroup, depth: number): boolean {
  return (
    depth < 1 ||
    group.rules.some(
      (member) => member.kind === "group" && nestsDeeperThan(member, depth - 1),
    )
  );
}

/**
 * Adds a group at the top level, or inside the top-level group `parentGroupId`.
 * Groups nest no deeper, as in links and Content's saved views.
 */
export function addFilterGroup(
  state: FilterState,
  group: FilterGroup,
  parentGroupId?: string,
): FilterState {
  if (nestsDeeperThan(group, parentGroupId ? 1 : 2)) return state;
  if (!parentGroupId) return { ...state, items: [...state.items, group] };
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === "group" && item.id === parentGroupId
        ? { ...item, rules: [...item.rules, group] }
        : item,
    ),
  };
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
      dateValueShape(operator) !== dateValueShape(rule.operator)
    ) {
      value =
        dateValueShape(rule.operator) === "pair" &&
        dateValueShape(operator) === "date"
          ? value.filter((day) => day.trim() !== "").slice(0, 1)
          : [];
    } else if (!filterOperatorTakesManyValues(field, operator)) {
      value = value.slice(0, filterOperatorValueCount(operator));
    }
  }
  return { ...rule, operator, value };
}

function dateValueShape(operator: FilterOperator) {
  if (operator === "is_within") return "range";
  return operator === "between" ? "pair" : "date";
}

export function findFilterRule(
  state: FilterState,
  ruleId: string,
): FilterRule | undefined {
  for (const item of state.items) {
    const rule = filterItemRules(item).find(
      (candidate) => candidate.id === ruleId,
    );
    if (rule) return rule;
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

function removeItem(items: readonly FilterItem[], id: string): FilterItem[] {
  const kept: FilterItem[] = [];
  for (const item of items) {
    if (item.id === id) continue;
    if (item.kind === "rule") {
      kept.push(item);
      continue;
    }
    const rules = removeItem(item.rules, id);
    if (rules.length === 0) continue;
    const unchanged =
      rules.length === item.rules.length &&
      rules.every((member, index) => member === item.rules[index]);
    kept.push(unchanged ? item : { ...item, rules });
  }
  return kept;
}

export function removeFilterItem(state: FilterState, id: string): FilterState {
  return { ...state, items: removeItem(state.items, id) };
}

export function setFilterMode(
  state: FilterState,
  mode: FilterMode,
  groupId?: string,
): FilterState {
  if (!groupId) return { ...state, mode };
  return {
    ...state,
    items: updateGroup(state.items, groupId, (group) => ({ ...group, mode })),
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
  `^(?:(past|next)_([1-9]\\d*)_(${DATE_UNIT_PATTERN})s?|this_(${DATE_UNIT_PATTERN}))$`,
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
    isFilterDateUnit(unit) &&
    Number(count) <= FILTER_DATE_RANGE_MAX_COUNT
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

function utcDate(year: number, monthIndex: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function dayDate(day: string) {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return utcDate(year, month - 1, date);
}

function addDays(day: string, days: number) {
  const date = dayDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(day: string, months: number) {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  const target = utcDate(year, month - 1 + months, 1);
  const lastDay = utcDate(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
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

const dayFormatters = new Map<string | undefined, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const cached = dayFormatters.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch (error) {
    if (!(error instanceof RangeError) || timeZone === undefined) throw error;
    formatter = dayFormatter(undefined);
  }
  dayFormatters.set(timeZone, formatter);
  return formatter;
}

function dayOfDate(date: Date, timeZone: string | undefined) {
  const parts = dayFormatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
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
  const date = dayDate(trimmed);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === trimmed
    ? trimmed
    : null;
}

const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

const DAY_MS = 24 * 60 * 60 * 1000;

const clockFormatters = new Map<string, Intl.DateTimeFormat | null>();

function clockFormatter(timeZone: string) {
  const cached = clockFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    formatter = null;
  }
  clockFormatters.set(timeZone, formatter);
  return formatter;
}

function zoneOffset(time: number, clock: Intl.DateTimeFormat) {
  const parts = clock.formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const reading = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return reading - Math.floor(time / 1000) * 1000;
}

export function filterDateValueHasTime(value: string) {
  return DATE_TIME_PATTERN.test(value.trim());
}

/**
 * The moment a date-and-time filter value stands for, in milliseconds, or NaN
 * when it isn't one that exists. A time without an offset is a wall-clock time
 * in `timeZone` (this machine's zone without one, or when this runtime doesn't
 * know it), as Content reads its date
 * filters. A time a daylight-saving change skips moves forward by the change,
 * and a time it repeats is the first of the two, as JavaScript's dates do.
 */
export function filterDateInstant(value: string, timeZone?: string) {
  const match = DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second = "0", fraction = ""] = match;
  const offset = match[8];
  const fields = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0").slice(0, 3)),
  ] as const;
  const asUtc = Date.UTC(...fields);
  if (
    new Date(asUtc).toISOString().slice(0, 19) !==
    `${year}-${month}-${day}T${hour}:${minute}:${second.padStart(2, "0")}`
  ) {
    return Number.NaN;
  }
  if (offset) {
    if (/^z$/i.test(offset)) return asUtc;
    const [, sign, hours = "0", minutes = "0"] =
      /^([+-])(\d{2}):?(\d{2})?$/.exec(offset) ?? [];
    if (Number(hours) > 23 || Number(minutes) > 59) return Number.NaN;
    const ms = (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
    return sign === "+" ? asUtc - ms : asUtc + ms;
  }
  if (timeZone === "UTC") return asUtc;
  const clock = timeZone ? clockFormatter(timeZone) : null;
  if (!clock) return new Date(...fields).getTime();
  const offsetBefore = zoneOffset(asUtc - DAY_MS, clock);
  const offsetAfter = zoneOffset(asUtc + DAY_MS, clock);
  if (offsetBefore === offsetAfter) return asUtc - offsetBefore;
  const before = asUtc - offsetBefore;
  const after = asUtc - offsetAfter;
  const valid = [before, after].filter(
    (time) => time + zoneOffset(time, clock) === asUtc,
  );
  return valid.length > 0 ? Math.min(...valid) : before;
}

export type FilterDateBound = { day: string } | { instant: number };

/**
 * A date filter value read for comparison: a whole day, or, on a field with
 * `times`, a moment when the value is written with a time. Null when it can't
 * be read.
 */
export function resolveFilterDateBound(
  value: string,
  today: string,
  options: { times?: boolean | undefined; timeZone?: string | undefined } = {},
): FilterDateBound | null {
  const day = resolveFilterDay(value, today);
  if (day !== null) return { day };
  if (!options.times) return null;
  const instant = filterDateInstant(value, options.timeZone);
  return Number.isFinite(instant) ? { instant } : null;
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

function cellInstant(value: FilterCellValue, timeZone: string | undefined) {
  if (value instanceof Date || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || DAY_PATTERN.test(trimmed)) return null;
  const time = filterDateValueHasTime(trimmed)
    ? filterDateInstant(trimmed, timeZone)
    : new Date(trimmed).getTime();
  return Number.isNaN(time) ? null : time;
}

function cellDay(
  value: FilterCellValue,
  instant: number | null,
  timeZone: string | undefined,
) {
  if (typeof value === "string" && DAY_PATTERN.test(value.trim())) {
    return value.trim();
  }
  return instant === null ? null : dayOfDate(new Date(instant), timeZone);
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

const DATE_COMPARISONS: Partial<
  Record<FilterOperator, (comparison: number) => boolean>
> = {
  equals: (comparison) => comparison === 0,
  does_not_equal: (comparison) => comparison !== 0,
  before: (comparison) => comparison < 0,
  after: (comparison) => comparison > 0,
  on_or_before: (comparison) => comparison <= 0,
  on_or_after: (comparison) => comparison >= 0,
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

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function boundDay(bound: FilterDateBound, timeZone: string | undefined) {
  return "day" in bound
    ? bound.day
    : dayOfDate(new Date(bound.instant), timeZone);
}

function compareBounds(
  a: FilterDateBound,
  b: FilterDateBound,
  timeZone: string | undefined,
) {
  if ("instant" in a && "instant" in b) return Math.sign(a.instant - b.instant);
  return compareText(boundDay(a, timeZone), boundDay(b, timeZone));
}

function filterRuleDateBounds(
  rule: FilterRule,
  field: Pick<FilterField<never>, "times">,
  context: FilterMatchContext,
): FilterDateBound[] | null {
  if (rule.operator === "is_within") {
    const range = parseFilterDateRange(rule.value.at(0) ?? "");
    if (!range) return null;
    const [start, end] = filterDateRangeDays(range, context.today);
    return [{ day: start }, { day: end }];
  }
  const options = { times: field.times, timeZone: context.timeZone };
  const bounds: FilterDateBound[] = [];
  for (const value of rule.value) {
    const bound = resolveFilterDateBound(value, context.today, options);
    if (!bound) return null;
    bounds.push(bound);
  }
  const start = bounds.at(0);
  const end = bounds.at(1);
  if (rule.operator !== "between" || !start || !end) return bounds;
  return compareBounds(start, end, context.timeZone) <= 0
    ? [start, end]
    : [end, start];
}

const ruleDateBounds = new WeakMap<
  FilterRule,
  { key: string; bounds: FilterDateBound[] | null }
>();

function cachedRuleDateBounds(
  rule: FilterRule,
  field: Pick<FilterField<never>, "times">,
  context: FilterMatchContext,
) {
  const key = `${field.times === true}|${context.timeZone ?? ""}|${context.today}`;
  const cached = ruleDateBounds.get(rule);
  if (cached?.key === key) return cached.bounds;
  const bounds = filterRuleDateBounds(rule, field, context);
  ruleDateBounds.set(rule, { key, bounds });
  return bounds;
}

function compareCellToBound(
  day: string,
  instant: number | null,
  bound: FilterDateBound,
  timeZone: string | undefined,
) {
  if ("day" in bound || instant === null) {
    return compareText(day, boundDay(bound, timeZone));
  }
  return Math.sign(instant - bound.instant);
}

function matchesDate(
  raw: FilterCellValue,
  rule: FilterRule,
  field: Pick<FilterField<never>, "times">,
  context: FilterMatchContext,
) {
  const instant = cellInstant(raw, field.times ? context.timeZone : "UTC");
  const day = cellDay(raw, instant, context.timeZone);
  if (rule.operator === "is_empty") return day === null;
  if (rule.operator === "is_not_empty") return day !== null;
  if (day === null) return rule.operator === "does_not_equal";
  const bounds = cachedRuleDateBounds(rule, field, context);
  if (!bounds) return true;
  const compare = (bound: FilterDateBound) =>
    compareCellToBound(day, instant, bound, context.timeZone);
  const start = bounds.at(0);
  const end = bounds.at(1);
  if (!start) return true;
  if (end) return compare(start) >= 0 && compare(end) <= 0;
  const test = DATE_COMPARISONS[rule.operator];
  return test ? test(compare(start)) : true;
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
      return matchesDate(raw, rule, field, context);
    case "text":
      return matchesText(cellText(raw), rule);
    case "number":
      return matchesNumber(cellNumber(raw), rule);
  }
}

function matchesMembers<Row>(
  row: Row,
  items: readonly FilterItem[],
  mode: FilterMode,
  fields: readonly FilterField<Row>[],
  context: FilterMatchContext,
  skipField: string | undefined,
): boolean | null {
  let counted = false;
  for (const item of items) {
    let result: boolean | null;
    if (item.kind === "group") {
      result = matchesMembers(
        row,
        item.rules,
        item.mode,
        fields,
        context,
        skipField,
      );
    } else {
      const field = findFilterField(fields, item.field);
      result =
        field && item.field !== skipField && isFilterRuleComplete(item, field)
          ? matchesFilterRule(row, item, field, context)
          : null;
    }
    if (result === null) continue;
    counted = true;
    if (mode === "or" && result) return true;
    if (mode === "and" && !result) return false;
  }
  if (!counted) return null;
  return mode === "and";
}

function matchesItems<Row>(
  row: Row,
  state: FilterState,
  fields: readonly FilterField<Row>[],
  context: FilterMatchContext,
  skipField?: string,
): boolean {
  return (
    matchesMembers(row, state.items, state.mode, fields, context, skipField) ??
    true
  );
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
