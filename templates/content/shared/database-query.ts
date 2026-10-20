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
  "between",
  "is_empty",
  "is_not_empty",
] as const satisfies readonly ContentDatabaseFilterOperator[];

const FILTER_OPERATORS_BY_TYPE: Partial<
  Record<DocumentPropertyType, readonly ContentDatabaseFilterOperator[]>
> = {
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

export function applyContentDatabaseTableQuery(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  query: ContentDatabaseTableQuery,
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
  const filtered = filterTree
    ? searched.filter((item) =>
        reduceContentDatabaseFilterTree(
          filterTree,
          (filter) => itemMatchesFilter(item, properties, filter),
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
  return (
    filters.find(
      (filter) => filter.filterGroupId === groupId && filter.filterGroupMode,
    )?.filterGroupMode ??
    filters.find(
      (filter) =>
        filter.parentFilterGroupId === groupId && filter.parentFilterGroupMode,
    )?.parentFilterGroupMode ??
    viewMode
  );
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

  if (
    filter.operator === "before" ||
    filter.operator === "after" ||
    filter.operator === "between"
  ) {
    const current = propertyDateValue(property);
    if (!Number.isFinite(current)) return false;
    if (filter.operator === "between") {
      const range = filterDateRange(filter.value);
      return !!range && current >= range[0] && current <= range[1];
    }
    const target = new Date(filter.value.trim()).getTime();
    if (!Number.isFinite(target)) return false;
    return filter.operator === "before" ? current < target : current > target;
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
  return normalizedValue.includes(normalizedFilter);
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

function filterDateRange(value: string): [number, number] | null {
  const [startValue, endValue] = contentDatabaseFilterDateRangeValues(value);
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return start <= end ? [start, end] : [end, start];
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

function propertyDateValue(property: DocumentProperty | null | undefined) {
  if (!property || !property.value) return Number.NaN;
  const value = new Date(
    documentPropertyDatePart(property.value, "start") ||
      (typeof property.value === "string"
        ? property.value
        : (JSON.stringify(property.value) ?? "")),
  ).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}
