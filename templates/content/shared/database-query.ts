import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseFilterOperator,
  ContentDatabaseItem,
  ContentDatabaseSort,
  ContentDatabaseTableQuery,
  DocumentProperty,
} from "./api.js";
import {
  documentPropertyDateKey,
  documentPropertyDatePart,
  formulaValueText,
  type DocumentPropertyType,
} from "./properties.js";

const OPTION_FILTER_OPERATORS = [
  "contains",
  "does_not_equal",
  "is_empty",
  "is_not_empty",
] as const satisfies readonly ContentDatabaseFilterOperator[];

const DATE_FILTER_OPERATORS = [
  "equals",
  "does_not_equal",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "between",
  "is_within",
  "is_empty",
  "is_not_empty",
] as const satisfies readonly ContentDatabaseFilterOperator[];

const TEXT_FILTER_OPERATORS = [
  "contains",
  "does_not_contain",
  "equals",
  "does_not_equal",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
] as const satisfies readonly ContentDatabaseFilterOperator[];

const FILTER_OPERATORS_BY_TYPE: Partial<
  Record<DocumentPropertyType, readonly ContentDatabaseFilterOperator[]>
> = {
  text: TEXT_FILTER_OPERATORS,
  url: TEXT_FILTER_OPERATORS,
  email: TEXT_FILTER_OPERATORS,
  phone: TEXT_FILTER_OPERATORS,
  place: TEXT_FILTER_OPERATORS,
  formula: TEXT_FILTER_OPERATORS,
  id: TEXT_FILTER_OPERATORS,
  created_by: TEXT_FILTER_OPERATORS,
  last_edited_by: TEXT_FILTER_OPERATORS,
  checkbox: ["is_checked", "is_unchecked"],
  select: OPTION_FILTER_OPERATORS,
  status: OPTION_FILTER_OPERATORS,
  multi_select: OPTION_FILTER_OPERATORS,
  person: OPTION_FILTER_OPERATORS,
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
  date: DATE_FILTER_OPERATORS,
  created_time: DATE_FILTER_OPERATORS,
  last_edited_time: DATE_FILTER_OPERATORS,
};

const DEFAULT_FILTER_OPERATORS = [
  "contains",
  "equals",
  "does_not_equal",
  "is_empty",
  "is_not_empty",
] as const satisfies readonly ContentDatabaseFilterOperator[];

const VALUELESS_FILTER_OPERATORS: ReadonlySet<ContentDatabaseFilterOperator> =
  new Set(["is_empty", "is_not_empty", "is_checked", "is_unchecked"]);

const NUMBER_FILTER_COMPARISONS: Partial<
  Record<
    ContentDatabaseFilterOperator,
    (current: number, target: number) => boolean
  >
> = {
  greater_than: (current, target) => current > target,
  less_than: (current, target) => current < target,
  greater_than_or_equal: (current, target) => current >= target,
  less_than_or_equal: (current, target) => current <= target,
};

// Listed in menu order; the first entry is the operator a new filter starts with.
export function contentDatabaseFilterOperatorsForType(
  type: DocumentPropertyType,
): readonly ContentDatabaseFilterOperator[] {
  return FILTER_OPERATORS_BY_TYPE[type] ?? DEFAULT_FILTER_OPERATORS;
}

export function contentDatabaseFilterOperatorNeedsValue(
  operator: ContentDatabaseFilterOperator,
) {
  return !VALUELESS_FILTER_OPERATORS.has(operator);
}

// A "between" value is a JSON [start, end] pair. Read it by position: a
// one-day range repeats its date, so deduplicating would lose the end.
export function contentDatabaseFilterDateRangeValues(
  value: string,
): [string, string] {
  const trimmed = value.trim();
  if (!trimmed) return ["", ""];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [trimmed, ""];
    const start = typeof parsed[0] === "string" ? parsed[0].trim() : "";
    const end = typeof parsed[1] === "string" ? parsed[1].trim() : "";
    return [start, end];
  } catch {
    return [trimmed, ""];
  }
}

/** Values a single-date filter can hold in place of a date. */
export const CONTENT_DATABASE_RELATIVE_DATES = [
  "today",
  "tomorrow",
  "yesterday",
] as const;

export type ContentDatabaseRelativeDate =
  (typeof CONTENT_DATABASE_RELATIVE_DATES)[number];

/** The values an `is_within` date filter holds. */
export const CONTENT_DATABASE_RELATIVE_DATE_RANGES = [
  "past_7_days",
  "next_7_days",
  "past_30_days",
  "next_30_days",
  "last_week",
  "this_week",
  "next_week",
] as const;

export type ContentDatabaseRelativeDateRange =
  (typeof CONTENT_DATABASE_RELATIVE_DATE_RANGES)[number];

const RELATIVE_DATE_OFFSETS: Record<ContentDatabaseRelativeDate, number> = {
  yesterday: -1,
  today: 0,
  tomorrow: 1,
};

// Each "N days" range is N calendar days counting today. Weeks start on
// Sunday, like the calendar view's grid.
const RELATIVE_DATE_RANGES: Record<
  ContentDatabaseRelativeDateRange,
  (today: string, weekStart: string) => [string, string]
> = {
  past_7_days: (today) => [addDays(today, -6), today],
  next_7_days: (today) => [today, addDays(today, 6)],
  past_30_days: (today) => [addDays(today, -29), today],
  next_30_days: (today) => [today, addDays(today, 29)],
  last_week: (_today, weekStart) => [
    addDays(weekStart, -7),
    addDays(weekStart, -1),
  ],
  this_week: (_today, weekStart) => [weekStart, addDays(weekStart, 6)],
  next_week: (_today, weekStart) => [
    addDays(weekStart, 7),
    addDays(weekStart, 13),
  ],
};

const DATE_COMPARISONS = {
  equals: "=",
  does_not_equal: "<>",
  before: "<",
  after: ">",
  on_or_before: "<=",
  on_or_after: ">=",
} as const satisfies Partial<Record<ContentDatabaseFilterOperator, string>>;

type DateComparisonOperator = keyof typeof DATE_COMPARISONS;

const DATE_PROPERTY_TYPES: ReadonlySet<DocumentPropertyType> = new Set([
  "date",
  "created_time",
  "last_edited_time",
]);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isContentDatabaseRelativeDate(
  value: string,
): value is ContentDatabaseRelativeDate {
  return (CONTENT_DATABASE_RELATIVE_DATES as readonly string[]).includes(value);
}

export function isContentDatabaseRelativeDateRange(
  value: string,
): value is ContentDatabaseRelativeDateRange {
  return (CONTENT_DATABASE_RELATIVE_DATE_RANGES as readonly string[]).includes(
    value,
  );
}

/**
 * Whether a date filter holds a time. Such a filter can match other rows for a
 * caller in another time zone, since a time without an offset is read in the
 * caller's zone and a day against a time is the day it falls on there.
 */
export function contentDatabaseFilterHasTime(filter: ContentDatabaseFilter) {
  if (
    !contentDatabaseFilterComparesDates(filter) ||
    filter.operator === "is_within"
  ) {
    return false;
  }
  const values =
    filter.operator === "between"
      ? contentDatabaseFilterDateRangeValues(filter.value)
      : [filter.value];
  return values.some((value) => DATE_TIME.test(value.trim()));
}

/** Whether the rows a filter matches depend on the day it is read. */
export function contentDatabaseFilterIsRelative(filter: ContentDatabaseFilter) {
  if (filter.operator === "is_within") return true;
  if (filter.operator === "between") {
    return contentDatabaseFilterDateRangeValues(filter.value).some(
      isContentDatabaseRelativeDate,
    );
  }
  return (
    filter.operator in DATE_COMPARISONS &&
    isContentDatabaseRelativeDate(filter.value.trim())
  );
}

/**
 * The calendar day ("YYYY-MM-DD") relative date filters count from: today in
 * `timeZone`, or in this machine's zone when there is none or it is one this
 * runtime does not know.
 */
export function contentDatabaseFilterToday(
  timeZone?: string,
  now = new Date(),
) {
  return dayInTimeZone(now, timeZone);
}

function dayInTimeZone(date: Date, timeZone: string | undefined) {
  const parts = (
    (timeZone ? zoneFormatters(timeZone)?.day : undefined) ??
    new Intl.DateTimeFormat("en-CA", DAY_FORMAT)
  ).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DAY_FORMAT = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

const CLOCK_FORMAT = {
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

type ZoneFormatters = {
  day: Intl.DateTimeFormat;
  clock: Intl.DateTimeFormat;
};

// Building a formatter costs far more than using one, and a table query
// compares every row, so each zone's formatters are built once. Zone names
// arrive in request headers, so the cache is emptied rather than left to grow.
const zoneFormatterCache = new Map<string, ZoneFormatters | null>();

/** The formatters for `timeZone`, or null when this runtime doesn't know it. */
function zoneFormatters(timeZone: string) {
  const cached = zoneFormatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  let formatters: ZoneFormatters | null;
  try {
    formatters = {
      day: new Intl.DateTimeFormat("en-CA", { ...DAY_FORMAT, timeZone }),
      clock: new Intl.DateTimeFormat("en-US", { ...CLOCK_FORMAT, timeZone }),
    };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    formatters = null;
  }
  if (zoneFormatterCache.size >= 100) zoneFormatterCache.clear();
  zoneFormatterCache.set(timeZone, formatters);
  return formatters;
}

/** `timeZone` when this runtime knows it, otherwise this machine's zone. */
function knownTimeZone(timeZone: string | undefined) {
  if (timeZone && zoneFormatters(timeZone)) return timeZone;
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// An ISO date and time: minutes, optional seconds and fraction, and an
// optional offset. A space may stand for the "T", as in the database's own
// timestamps ("2026-10-22 12:34:56+00").
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment a date filter value or a row's date stands for, in milliseconds,
 * or NaN when it isn't an ISO date and time that exists.
 *
 * A time written without an offset is a wall-clock time, the way date
 * properties store one, so it is read in `timeZone`: the caller's zone.
 * Without a zone, or with one this runtime does not know, it is read in this
 * machine's zone, which in the browser is the caller's. A time a
 * daylight-saving change skips moves forward by the change, and a time it
 * repeats is the first of the two, as JavaScript's own dates do.
 */
export function contentDatabaseFilterInstant(value: string, timeZone?: string) {
  const match = DATE_TIME.exec(value.trim());
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
  // Rejects a day or time past its end, such as February 30th or 24:00.
  if (
    new Date(asUtc).toISOString().slice(0, 19) !==
    `${year}-${month}-${day}T${hour}:${minute}:${second.padStart(2, "0")}`
  ) {
    return Number.NaN;
  }
  if (offset) {
    if (/^z$/i.test(offset)) return asUtc;
    const [, sign, hours, minutes = "0"] = /^([+-])(\d{2}):?(\d{2})?$/.exec(
      offset,
    )!;
    if (Number(hours) > 23 || Number(minutes) > 59) return Number.NaN;
    const ms = (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
    return sign === "+" ? asUtc - ms : asUtc + ms;
  }
  const clock = timeZone && zoneFormatters(timeZone)?.clock;
  if (!clock) return new Date(...fields).getTime();
  // The zone's offsets a day either side; a real zone changes at most once
  // between them, so the same offset on both sides holds throughout.
  // Otherwise a candidate is right when the zone's clock reads the wall time
  // at that moment.
  const offsetBefore = timeZoneOffset(asUtc - DAY_MS, clock);
  const offsetAfter = timeZoneOffset(asUtc + DAY_MS, clock);
  if (offsetBefore === offsetAfter) return asUtc - offsetBefore;
  const before = asUtc - offsetBefore;
  const after = asUtc - offsetAfter;
  const valid = [before, after].filter(
    (time) => time + timeZoneOffset(time, clock) === asUtc,
  );
  // Neither is right inside a skipped hour: keep the offset from before it,
  // which moves the time forward.
  return valid.length > 0 ? Math.min(...valid) : before;
}

/** How far a zone's clock is ahead of UTC at `time`, in milliseconds. */
function timeZoneOffset(time: number, clock: Intl.DateTimeFormat) {
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

/**
 * A date filter value read for comparison: a whole calendar day, or a moment
 * (as an ISO time in UTC) when the value is written with a time.
 */
export type ContentDatabaseDateFilterBound =
  | { day: string }
  | { instant: string };

export type ContentDatabaseDateFilterCheck =
  | {
      op: (typeof DATE_COMPARISONS)[DateComparisonOperator];
      bound: ContentDatabaseDateFilterBound;
    }
  | {
      op: "between";
      start: ContentDatabaseDateFilterBound;
      end: ContentDatabaseDateFilterBound;
    };

export type ContentDatabaseDateComparisonFilter = ContentDatabaseFilter & {
  operator: DateComparisonOperator | "between" | "is_within";
};

export function contentDatabaseFilterComparesDates(
  filter: ContentDatabaseFilter,
): filter is ContentDatabaseDateComparisonFilter {
  return (
    filter.operator in DATE_COMPARISONS ||
    filter.operator === "between" ||
    filter.operator === "is_within"
  );
}

/** `timeZone` reads a time without an offset; see `contentDatabaseFilterInstant`. */
export function contentDatabaseFilterDateBound(
  value: string,
  today: string,
  timeZone?: string,
): ContentDatabaseDateFilterBound | null {
  const trimmed = value.trim();
  if (isContentDatabaseRelativeDate(trimmed)) {
    return { day: addDays(today, RELATIVE_DATE_OFFSETS[trimmed]) };
  }
  if (DAY_PATTERN.test(trimmed)) {
    return addDays(trimmed, 0) === trimmed ? { day: trimmed } : null;
  }
  const time = trimmed
    ? contentDatabaseFilterInstant(trimmed, timeZone)
    : Number.NaN;
  return Number.isFinite(time)
    ? { instant: new Date(time).toISOString() }
    : null;
}

/**
 * Why a filter on a property of `type` can't be saved: it holds a date no
 * comparison can read, such as "2026-02-30" or "soon". Null when it can, or
 * when the property isn't a date. Empty values pass, since a filter still being
 * filled in has them.
 */
export function contentDatabaseDateFilterValueError(
  filter: ContentDatabaseFilter,
  type: DocumentPropertyType,
) {
  if (!DATE_PROPERTY_TYPES.has(type)) return null;
  if (filter.operator === "is_within") {
    const token = filter.value.trim();
    return token && !isContentDatabaseRelativeDateRange(token)
      ? `Filter on "${filter.key}" uses is_within with "${token}"; use one of ${CONTENT_DATABASE_RELATIVE_DATE_RANGES.join(", ")}.`
      : null;
  }
  if (!contentDatabaseFilterComparesDates(filter)) return null;
  const values =
    filter.operator === "between"
      ? contentDatabaseFilterDateRangeValues(filter.value)
      : [filter.value.trim()];
  // Any day will do: only relative values read it, and every day reads them.
  const unreadable = values.find(
    (value) => value && !contentDatabaseFilterDateBound(value, "2000-01-01"),
  );
  return unreadable
    ? `Filter on "${filter.key}" has a date that cannot be read: "${unreadable}". Use YYYY-MM-DD, an ISO date and time, or one of ${CONTENT_DATABASE_RELATIVE_DATES.join(", ")}.`
    : null;
}

/**
 * The first `contentDatabaseDateFilterValueError` among the filters a save adds
 * or changes. A filter already in `savedFilters` passes, so a view still
 * holding a date saved before these checks can be saved with other changes.
 * `typeOfKey` gives a filter key's property type; filters without one pass.
 */
export function contentDatabaseChangedDateFilterValueError(
  filters: readonly ContentDatabaseFilter[],
  savedFilters: readonly ContentDatabaseFilter[],
  typeOfKey: (key: string) => DocumentPropertyType | undefined,
) {
  const saved = new Set(savedFilters.map(filterValueIdentity));
  for (const filter of filters) {
    const type = typeOfKey(filter.key);
    if (!type || saved.has(filterValueIdentity(filter))) continue;
    const error = contentDatabaseDateFilterValueError(filter, type);
    if (error) return error;
  }
  return null;
}

function filterValueIdentity(filter: ContentDatabaseFilter) {
  return JSON.stringify([filter.key, filter.operator, filter.value]);
}

/**
 * How a date filter compares a row's date once relative values are resolved
 * against `today`. A value without a time covers its whole day, so it is
 * compared with the row's calendar day, the date the row's value is written
 * on; a value with a time is compared as a moment. Null when the value cannot
 * be read, and the filter then matches no row. The shared evaluator and the
 * Files navigation SQL both read this, so they agree on every boundary.
 * `timeZone` reads a time without an offset; see `contentDatabaseFilterInstant`.
 */
export function contentDatabaseDateFilterCheck(
  filter: ContentDatabaseDateComparisonFilter,
  today: string,
  timeZone?: string,
): ContentDatabaseDateFilterCheck | null {
  if (filter.operator === "is_within") {
    const token = filter.value.trim();
    if (!isContentDatabaseRelativeDateRange(token)) return null;
    const weekStart = addDays(today, -dayDate(today).getUTCDay());
    const [start, end] = RELATIVE_DATE_RANGES[token](today, weekStart);
    return { op: "between", start: { day: start }, end: { day: end } };
  }
  if (filter.operator === "between") {
    const [startValue, endValue] = contentDatabaseFilterDateRangeValues(
      filter.value,
    );
    const start = contentDatabaseFilterDateBound(startValue, today, timeZone);
    const end = contentDatabaseFilterDateBound(endValue, today, timeZone);
    if (!start || !end) return null;
    // A day runs from its first moment to its last in the caller's zone, so a
    // range is backwards only when its start begins after its end is over.
    return dateBoundEdge(start, "first", timeZone) <=
      dateBoundEdge(end, "last", timeZone)
      ? { op: "between", start, end }
      : { op: "between", start: end, end: start };
  }
  const bound = contentDatabaseFilterDateBound(filter.value, today, timeZone);
  return bound ? { op: DATE_COMPARISONS[filter.operator], bound } : null;
}

function dateBoundEdge(
  bound: ContentDatabaseDateFilterBound,
  edge: "first" | "last",
  timeZone: string | undefined,
) {
  if ("instant" in bound) return new Date(bound.instant).getTime();
  return edge === "first"
    ? contentDatabaseFilterInstant(`${bound.day}T00:00`, timeZone)
    : contentDatabaseFilterInstant(`${addDays(bound.day, 1)}T00:00`, timeZone) -
        1;
}

function dayDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!));
}

function addDays(day: string, days: number) {
  const date = dayDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function applyContentDatabaseTableQuery(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  query: ContentDatabaseTableQuery,
  options: {
    /** The caller's time zone; defaults to this machine's. */
    timeZone?: string;
    /** The day relative date filters count from; defaults to today in `timeZone`. */
    today?: string;
  } = {},
) {
  const search = query.search.trim().toLowerCase();
  const searched = search
    ? items.filter((item) =>
        itemSearchText(item, properties).toLowerCase().includes(search),
      )
    : items;
  const filterTree = query.filters.some(isActiveFilter)
    ? contentDatabaseFilterTree(query.filters, query.filterMode)
    : null;
  // Looked up on the first date comparison. A missing or unknown zone becomes
  // this machine's by name, so its formatters are cached as well.
  let timeZone: string | undefined;
  let today = options.today;
  const dateChecks = new Map<
    ContentDatabaseFilter,
    ContentDatabaseDateFilterCheck | null
  >();
  const dateMatches = (
    current: string,
    filter: ContentDatabaseDateComparisonFilter,
  ) => {
    timeZone ??= knownTimeZone(options.timeZone);
    if (!dateChecks.has(filter)) {
      today ??= contentDatabaseFilterToday(timeZone);
      dateChecks.set(
        filter,
        contentDatabaseDateFilterCheck(filter, today, timeZone),
      );
    }
    return dateFilterMatches(current, dateChecks.get(filter)!, timeZone);
  };
  const filtered = filterTree
    ? searched.filter((item) =>
        reduceContentDatabaseFilterTree(
          filterTree,
          (filter) => itemMatchesFilter(item, properties, filter, dateMatches),
          combineMatches,
        ),
      )
    : searched;

  if (query.sorts.length === 0) return filtered;
  return [...filtered].sort((left, right) => {
    for (const sort of query.sorts) {
      const comparison = compareSortValues(
        itemSortValue(left, properties, sort),
        itemSortValue(right, properties, sort),
      );
      if (comparison !== 0) {
        return sort.direction === "asc" ? comparison : -comparison;
      }
    }
    return 0;
  });
}

export function contentDatabaseTableQueryUsesProperties(
  query: ContentDatabaseTableQuery,
  propertyIds: ReadonlySet<string>,
) {
  if (propertyIds.size === 0) return false;
  if (query.search.trim()) return true;
  return [...query.filters, ...query.sorts].some(
    (constraint) =>
      constraint.key !== "name" && propertyIds.has(constraint.key),
  );
}

// A filter group's And/Or lives on its rules, because filter objects survive
// every save path while new view-level keys do not: `filterGroupMode` names the
// mode of the rule's `filterGroupId`, and `parentFilterGroupMode` the mode of
// its `parentFilterGroupId`. Older clients add rules without either field and
// can leave a group's rules disagreeing, so the first rule that carries a mode
// decides, and a group without one inherits the view's mode.
export function contentDatabaseFilterGroupMode(
  filters: readonly ContentDatabaseFilter[],
  groupId: string,
  viewMode: ContentDatabaseFilterMode,
): ContentDatabaseFilterMode {
  for (const filter of filters) {
    if (filter.filterGroupId === groupId && filter.filterGroupMode) {
      return filter.filterGroupMode;
    }
    if (
      filter.parentFilterGroupId === groupId &&
      filter.parentFilterGroupMode
    ) {
      return filter.parentFilterGroupMode;
    }
  }
  return viewMode;
}

export function withContentDatabaseFilterGroupMode<
  T extends ContentDatabaseFilter,
>(
  filters: readonly T[],
  groupId: string,
  mode: ContentDatabaseFilterMode,
): T[] {
  return filters.map((filter) => {
    let next = filter;
    if (filter.filterGroupId === groupId && filter.filterGroupMode !== mode) {
      next = { ...next, filterGroupMode: mode };
    }
    if (
      filter.parentFilterGroupId === groupId &&
      filter.parentFilterGroupMode !== mode
    ) {
      next = { ...next, parentFilterGroupMode: mode };
    }
    return next;
  });
}

/**
 * Writes every group's current mode onto all of its rules, so a later change
 * to the view's mode no longer reaches groups that were inheriting it.
 */
export function materializeContentDatabaseFilterGroupModes<
  T extends ContentDatabaseFilter,
>(filters: readonly T[], viewMode: ContentDatabaseFilterMode): T[] {
  const groupIds = new Set<string>();
  for (const filter of filters) {
    if (filter.filterGroupId) groupIds.add(filter.filterGroupId);
    if (filter.parentFilterGroupId) groupIds.add(filter.parentFilterGroupId);
  }
  let next = [...filters];
  for (const groupId of groupIds) {
    next = withContentDatabaseFilterGroupMode(
      next,
      groupId,
      contentDatabaseFilterGroupMode(filters, groupId, viewMode),
    );
  }
  return next;
}

export interface ContentDatabaseFilterGroup<
  T extends ContentDatabaseFilter = ContentDatabaseFilter,
> {
  /** Null for the view level. */
  id: string | null;
  mode: ContentDatabaseFilterMode;
  filters: T[];
  groups: ContentDatabaseFilterGroup<T>[];
}

/**
 * Builds the view's filter tree from its active rules. The view level holds
 * ungrouped rules and every top-level group: a `filterGroupId` used without a
 * parent, or a `parentFilterGroupId` that nested rules name. A nested group
 * sits under its parent, or at the view level when that parent is itself only
 * a nested group, so the tree never grows deeper or loops. A rule with a
 * parent but no group of its own belongs nowhere and is ignored. Modes are
 * read from every rule, active or not.
 */
export function contentDatabaseFilterTree<T extends ContentDatabaseFilter>(
  filters: readonly T[],
  viewMode: ContentDatabaseFilterMode,
  isActive: (filter: T) => boolean = isActiveFilter,
): ContentDatabaseFilterGroup<T> {
  const group = (id: string): ContentDatabaseFilterGroup<T> => ({
    id,
    mode: contentDatabaseFilterGroupMode(filters, id, viewMode),
    filters: [],
    groups: [],
  });
  const viewFilters: T[] = [];
  const topLevel = new Map<string, ContentDatabaseFilterGroup<T>>();
  const nested = new Map<
    string,
    { parentId: string; group: ContentDatabaseFilterGroup<T> }
  >();
  for (const filter of filters) {
    if (!isActive(filter)) continue;
    if (filter.parentFilterGroupId) {
      if (!filter.filterGroupId) continue;
      let entry = nested.get(filter.filterGroupId);
      if (!entry) {
        entry = {
          parentId: filter.parentFilterGroupId,
          group: group(filter.filterGroupId),
        };
        nested.set(filter.filterGroupId, entry);
      }
      entry.group.filters.push(filter);
    } else if (filter.filterGroupId) {
      let entry = topLevel.get(filter.filterGroupId);
      if (!entry) {
        entry = group(filter.filterGroupId);
        topLevel.set(filter.filterGroupId, entry);
      }
      entry.filters.push(filter);
    } else {
      viewFilters.push(filter);
    }
  }
  const viewGroups: ContentDatabaseFilterGroup<T>[] = [];
  const directTopLevelIds = new Set(topLevel.keys());
  for (const { parentId, group: nestedGroup } of nested.values()) {
    if (nested.has(parentId) && !directTopLevelIds.has(parentId)) {
      viewGroups.push(nestedGroup);
      continue;
    }
    let parent = topLevel.get(parentId);
    if (!parent) {
      parent = group(parentId);
      topLevel.set(parentId, parent);
    }
    parent.groups.push(nestedGroup);
  }
  return {
    id: null,
    mode: viewMode,
    filters: viewFilters,
    groups: [...topLevel.values(), ...viewGroups],
  };
}

export function reduceContentDatabaseFilterTree<
  T extends ContentDatabaseFilter,
  R,
>(
  group: ContentDatabaseFilterGroup<T>,
  leaf: (filter: T) => R,
  combine: (mode: ContentDatabaseFilterMode, members: R[]) => R,
): R {
  return combine(group.mode, [
    ...group.filters.map(leaf),
    ...group.groups.map((child) =>
      reduceContentDatabaseFilterTree(child, leaf, combine),
    ),
  ]);
}

/**
 * The active rules every matching row satisfies: each level on the rule's
 * path combines with "and" or has exactly one member.
 */
export function contentDatabaseRequiredFilters<T extends ContentDatabaseFilter>(
  filters: readonly T[],
  viewMode: ContentDatabaseFilterMode,
  isActive: (filter: T) => boolean = isActiveFilter,
): Set<T> {
  const required = new Set<T>();
  const visit = (group: ContentDatabaseFilterGroup<T>) => {
    if (group.mode === "or" && group.filters.length + group.groups.length > 1)
      return;
    for (const filter of group.filters) required.add(filter);
    for (const child of group.groups) visit(child);
  };
  visit(contentDatabaseFilterTree(filters, viewMode, isActive));
  return required;
}

function combineMatches(
  filterMode: ContentDatabaseFilterMode,
  matches: boolean[],
) {
  if (matches.length === 0) return true;
  return filterMode === "or" ? matches.some(Boolean) : matches.every(Boolean);
}

function isActiveFilter(filter: ContentDatabaseFilter) {
  if (contentDatabaseFilterOperatorNeedsValue(filter.operator)) {
    return selectedFilterValues(filter.value).length > 0;
  }
  return true;
}

function itemMatchesFilter(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  filter: ContentDatabaseFilter,
  dateMatches: (
    current: string,
    filter: ContentDatabaseDateComparisonFilter,
  ) => boolean,
) {
  const value = itemFilterValue(item, properties, filter.key);
  const property = itemFilterProperty(item, properties, filter.key);
  if (filter.operator === "is_empty") return !value.trim();
  if (filter.operator === "is_not_empty") return !!value.trim();
  if (filter.operator === "is_checked") return property?.value === true;
  if (filter.operator === "is_unchecked") return property?.value !== true;

  const compareNumbers = NUMBER_FILTER_COMPARISONS[filter.operator];
  if (compareNumbers) {
    const current = propertyNumberValue(property);
    const target = Number(filter.value.trim());
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return compareNumbers(current, target);
  }

  // "Is" and "is not" compare dates only on date properties; elsewhere they
  // compare text below.
  if (
    contentDatabaseFilterComparesDates(filter) &&
    ((filter.operator !== "equals" && filter.operator !== "does_not_equal") ||
      (property && DATE_PROPERTY_TYPES.has(property.definition.type)))
  ) {
    return dateMatches(propertyDateText(property), filter);
  }

  const candidateValues = itemFilterCandidateValues(
    item,
    properties,
    filter.key,
  ).map((candidate) => candidate.trim().toLowerCase());
  const selectedValues = selectedFilterValues(filter.value).map((candidate) =>
    candidate.trim().toLowerCase(),
  );
  const normalizedValue = value.trim().toLowerCase();
  const normalizedFilter = selectedValues[0] ?? "";
  const usesDiscreteValues =
    property?.definition.type === "select" ||
    property?.definition.type === "status" ||
    property?.definition.type === "multi_select" ||
    property?.definition.type === "person";
  if (
    usesDiscreteValues &&
    (filter.operator === "equals" || filter.operator === "contains")
  ) {
    return selectedValues.some((filterValue) =>
      candidateValues.includes(filterValue),
    );
  }
  if (usesDiscreteValues && filter.operator === "does_not_equal") {
    return selectedValues.every(
      (filterValue) => !candidateValues.includes(filterValue),
    );
  }
  if (filter.operator === "equals") {
    return candidateValues.includes(normalizedFilter);
  }
  if (filter.operator === "does_not_equal") {
    return !candidateValues.includes(normalizedFilter);
  }
  // Like "is not", "does not contain" matches empty values.
  if (filter.operator === "does_not_contain") {
    return !normalizedValue.includes(normalizedFilter);
  }
  if (filter.operator === "starts_with") {
    return normalizedValue.startsWith(normalizedFilter);
  }
  if (filter.operator === "ends_with") {
    return normalizedValue.endsWith(normalizedFilter);
  }
  return normalizedValue.includes(normalizedFilter);
}

// Rows with no date match only "is not".
function dateFilterMatches(
  current: string,
  check: ContentDatabaseDateFilterCheck | null,
  timeZone: string | undefined,
) {
  if (!check) return false;
  if (!current) return check.op === "<>";
  if (check.op === "between") {
    return (
      compareDateToBound(current, check.start, timeZone) >= 0 &&
      compareDateToBound(current, check.end, timeZone) <= 0
    );
  }
  const comparison = compareDateToBound(current, check.bound, timeZone);
  switch (check.op) {
    case "=":
      return comparison === 0;
    case "<>":
      return comparison !== 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
  }
}

/** Negative, zero, or positive; NaN when the row's date cannot be read. */
function compareDateToBound(
  current: string,
  bound: ContentDatabaseDateFilterBound,
  timeZone: string | undefined,
) {
  if ("day" in bound) {
    // The written date, as the Files navigation SQL reads it; only a value in
    // another format is parsed.
    const day =
      /^\d{4}-\d{2}-\d{2}/.exec(current)?.[0] ??
      documentPropertyDateKey(current);
    if (!day) return Number.NaN;
    return day < bound.day ? -1 : day > bound.day ? 1 : 0;
  }
  // A row without a time covers its whole day, so it is compared by day as
  // well: the day the moment falls on in the caller's zone.
  if (DAY_PATTERN.test(current.trim())) {
    const day = dayInTimeZone(new Date(bound.instant), timeZone);
    const rowDay = current.trim();
    return rowDay < day ? -1 : rowDay > day ? 1 : 0;
  }
  return Math.sign(
    contentDatabaseFilterInstant(current, timeZone) -
      new Date(bound.instant).getTime(),
  );
}

function selectedFilterValues(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [trimmed];
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [trimmed];
  }
}

function itemSearchText(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
) {
  return [
    item.document.title || "Untitled",
    ...properties.map((property) =>
      propertyValueText(
        item.properties.find(
          (candidate) => candidate.definition.id === property.definition.id,
        ) ?? property,
      ),
    ),
  ].join(" ");
}

function itemSortValue(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  sort: ContentDatabaseSort,
) {
  if (sort.key === "name") return item.document.title || "";
  return propertyValueText(
    item.properties.find((candidate) => candidate.definition.id === sort.key) ??
      properties.find((candidate) => candidate.definition.id === sort.key) ??
      null,
  );
}

function itemFilterValue(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return item.document.title || "";
  return propertyValueText(itemFilterProperty(item, properties, key));
}

function itemFilterProperty(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return null;
  return (
    item.properties.find((candidate) => candidate.definition.id === key) ??
    properties.find((candidate) => candidate.definition.id === key) ??
    null
  );
}

function itemFilterCandidateValues(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return [item.document.title || ""];
  const property = itemFilterProperty(item, properties, key);
  if (!property || property.value === null || property.value === undefined) {
    return [""];
  }
  if (Array.isArray(property.value)) {
    return property.value.flatMap((id) => {
      const optionName =
        property.definition.options.options?.find((option) => option.id === id)
          ?.name ?? id;
      return [id, optionName];
    });
  }
  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    const id =
      typeof property.value === "string"
        ? property.value
        : (JSON.stringify(property.value) ?? "");
    const optionName =
      property.definition.options.options?.find((option) => option.id === id)
        ?.name ?? id;
    return [id, optionName];
  }
  return [propertyValueText(property)];
}

function propertyValueText(property: DocumentProperty | null | undefined) {
  if (!property || property.value === null || property.value === undefined) {
    return "";
  }
  if (Array.isArray(property.value)) {
    return property.value
      .map(
        (id) =>
          property.definition.options.options?.find(
            (option) => option.id === id,
          )?.name ?? id,
      )
      .join(" ");
  }
  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    return (
      property.definition.options.options?.find(
        (option) =>
          option.id ===
          (typeof property.value === "string"
            ? property.value
            : (JSON.stringify(property.value) ?? "")),
      )?.name ??
      (typeof property.value === "string"
        ? property.value
        : (JSON.stringify(property.value) ?? ""))
    );
  }
  if (property.definition.type === "checkbox") {
    return property.value ? "Checked" : "Unchecked";
  }
  return formulaValueText(property.value);
}

function compareSortValues(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (
    left.trim() &&
    right.trim() &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber)
  ) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function propertyNumberValue(property: DocumentProperty | null | undefined) {
  if (
    !property ||
    property.value === null ||
    property.value === undefined ||
    property.value === ""
  ) {
    return Number.NaN;
  }
  const value =
    typeof property.value === "number"
      ? property.value
      : Number(
          (typeof property.value === "string"
            ? property.value
            : (JSON.stringify(property.value) ?? "")
          ).trim(),
        );
  return Number.isFinite(value) ? value : Number.NaN;
}

function propertyDateText(property: DocumentProperty | null | undefined) {
  if (!property || !property.value) return "";
  return documentPropertyDatePart(property.value, "start");
}
