// Filter/sort logic: apply, upsert, move, match, property value helpers.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseItem,
  DocumentProperty,
  DocumentPropertyType,
  DocumentPropertyValue,
} from "@shared/api";
import {
  type ColumnKey,
  type DatabaseConditionMoveDirection,
  type DatabaseFilter,
  type DatabaseFilterMode,
  type DatabaseQuickFilterOperator,
  type DatabaseRowDensity,
  type FilterOperator,
  type SortDirection,
  type DatabaseSort,
} from "./types";
import { formulaValueText, isComputedPropertyType } from "@shared/properties";
import { calendarDateKey, propertyDateValue } from "./calendar-timeline";
export {
  normalizeClientDatabaseFilterMode,
  normalizeClientDatabaseRowDensity,
  normalizeClientDatabaseOpenPagesIn,
} from "./view-config";

export { type DatabaseConditionMoveDirection };

const DATABASE_QUICK_FILTER_OPERATORS: FilterOperator[] = [
  "is_empty",
  "is_not_empty",
  "is_checked",
  "is_unchecked",
];

export function applyDatabaseView(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  searchQuery: string,
  filters: DatabaseFilter[],
  sorts: DatabaseSort[],
  filterMode: DatabaseFilterMode = "and",
) {
  const query = searchQuery.trim().toLowerCase();
  const searched = query
    ? items.filter((item) =>
        databaseItemSearchText(item, properties).toLowerCase().includes(query),
      )
    : items;
  const activeFilters = filters.filter(isActiveFilter);
  const filtered = activeFilters.length
    ? searched.filter((item) =>
        filterMode === "or"
          ? activeFilters.some((filter) =>
              databaseItemMatchesFilter(item, properties, filter),
            )
          : activeFilters.every((filter) =>
              databaseItemMatchesFilter(item, properties, filter),
            ),
      )
    : searched;

  if (sorts.length === 0) return filtered;

  return [...filtered].sort((a, b) => {
    for (const sort of sorts) {
      const comparison = compareDatabaseSortValues(
        databaseItemSortValue(a, properties, sort.key),
        databaseItemSortValue(b, properties, sort.key),
      );
      if (comparison !== 0) {
        return sort.direction === "asc" ? comparison : -comparison;
      }
    }
    return 0;
  });
}

export function defaultDatabaseSort(): DatabaseSort {
  return {
    key: "name",
    label: "Name",
    direction: "asc",
  };
}

export function defaultDatabaseFilter(): DatabaseFilter {
  return {
    key: "name",
    label: "Name",
    operator: "contains",
    value: "",
  };
}

export function upsertDatabaseSort(
  sorts: DatabaseSort[],
  key: ColumnKey,
  label: string,
  direction: SortDirection,
) {
  return [
    { key, label, direction },
    ...sorts.filter((sort) => sort.key !== key),
  ];
}

export function clearDatabaseSort(sorts: DatabaseSort[], key: ColumnKey) {
  return sorts.filter((sort) => sort.key !== key);
}

export function moveDatabaseSort(
  sorts: DatabaseSort[],
  index: number,
  direction: DatabaseConditionMoveDirection,
) {
  return moveDatabaseCondition(sorts, index, direction);
}

export function appendDatabaseFilter(
  filters: DatabaseFilter[],
  key: ColumnKey,
  label: string,
  operator: FilterOperator,
  value = "",
) {
  return [...filters, { key, label, operator, value }];
}

export function moveDatabaseFilter(
  filters: DatabaseFilter[],
  index: number,
  direction: DatabaseConditionMoveDirection,
) {
  return moveDatabaseCondition(filters, index, direction);
}

function moveDatabaseCondition<T>(
  items: T[],
  index: number,
  direction: DatabaseConditionMoveDirection,
) {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const next = [...items];
  next[index] = items[targetIndex];
  next[targetIndex] = items[index];
  return next;
}

export function databaseQuickFilterOptionsForColumn(
  propertyType?: DocumentPropertyType,
): Array<{ operator: DatabaseQuickFilterOperator; label: string }> {
  if (propertyType === "checkbox") {
    return [
      { operator: "is_checked", label: "Filter checked" },
      { operator: "is_unchecked", label: "Filter unchecked" },
    ];
  }
  return [
    { operator: "is_empty", label: "Filter empty" },
    { operator: "is_not_empty", label: "Filter not empty" },
  ];
}

export function upsertDatabaseQuickFilter(
  filters: DatabaseFilter[],
  key: ColumnKey,
  label: string,
  operator: DatabaseQuickFilterOperator,
) {
  return [
    ...filters.filter(
      (filter) =>
        filter.key !== key ||
        !DATABASE_QUICK_FILTER_OPERATORS.includes(filter.operator),
    ),
    { key, label, operator, value: "" },
  ];
}

export function clearDatabaseFiltersForColumn(
  filters: DatabaseFilter[],
  key: ColumnKey,
) {
  return filters.filter((filter) => filter.key !== key);
}

export function databaseColumnHeaderState(
  sorts: DatabaseSort[],
  filters: DatabaseFilter[],
  key: ColumnKey,
) {
  const sort = sorts.find((candidate) => candidate.key === key);
  return {
    sortDirection: sort?.direction ?? null,
    activeFilterCount: filters.filter(
      (filter) => filter.key === key && isActiveFilter(filter),
    ).length,
  };
}

function databaseColumnHeaderStateLabel(
  state: ReturnType<typeof databaseColumnHeaderState>,
) {
  const parts = [
    state.sortDirection
      ? `Sorted ${state.sortDirection === "asc" ? "ascending" : "descending"}`
      : "",
    state.activeFilterCount > 0
      ? `${state.activeFilterCount} active filter${state.activeFilterCount === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export { databaseColumnHeaderStateLabel };

export function activeDatabaseConstraintCount(
  searchQuery: string,
  sorts: DatabaseSort[],
  filters: DatabaseFilter[],
) {
  return (
    (searchQuery.trim() ? 1 : 0) +
    sorts.length +
    filters.filter(isActiveFilter).length
  );
}

export function isActiveFilter(
  filter: DatabaseFilter | null,
): filter is DatabaseFilter {
  if (!filter) return false;
  if (filterOperatorNeedsValue(filter.operator)) {
    return filter.value.trim().length > 0;
  }
  return true;
}

export function databasePropertyValuesForNewItem(
  filters: DatabaseFilter[],
  properties: DocumentProperty[],
  filterMode: DatabaseFilterMode = "and",
): Record<string, DocumentPropertyValue> {
  const propertyValues: Record<string, DocumentPropertyValue> = {};
  const activeFilters = filters.filter(isActiveFilter);
  if (filterMode === "or" && activeFilters.length > 1) {
    return propertyValues;
  }

  for (const filter of activeFilters) {
    if (filter.key === "name") continue;

    const property = properties.find(
      (candidate) => candidate.definition.id === filter.key,
    );
    if (!property?.editable) continue;
    if (isComputedPropertyType(property.definition.type)) continue;
    if (propertyValues[property.definition.id] !== undefined) continue;

    const value = databaseFilterDefaultValueForNewItem(filter, property);
    if (value !== undefined) {
      propertyValues[property.definition.id] = value;
    }
  }

  return propertyValues;
}

function databaseFilterDefaultValueForNewItem(
  filter: DatabaseFilter,
  property: DocumentProperty,
): DocumentPropertyValue | undefined {
  if (filter.operator === "is_checked") {
    return property.definition.type === "checkbox" ? true : undefined;
  }
  if (filter.operator === "is_unchecked") {
    return property.definition.type === "checkbox" ? false : undefined;
  }
  if (filter.operator !== "equals") return undefined;

  const value = filter.value.trim();
  if (!value) return undefined;

  const optionValue = databasePropertyOptionIdForFilterValue(property, value);
  if (property.definition.type === "multi_select") {
    return [optionValue ?? value];
  }
  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    return optionValue ?? value;
  }
  if (property.definition.type === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? { start: value, includeTime: false }
      : undefined;
  }
  if (property.definition.type === "checkbox") return undefined;

  return value;
}

function databasePropertyOptionIdForFilterValue(
  property: DocumentProperty,
  value: string,
) {
  return property.definition.options.options?.find(
    (option) =>
      option.id === value ||
      option.name.trim().toLowerCase() === value.trim().toLowerCase(),
  )?.id;
}

function databaseItemMatchesFilter(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  filter: DatabaseFilter,
) {
  const value = databaseItemFilterValue(item, properties, filter.key);
  const property = databaseItemFilterProperty(item, properties, filter.key);

  if (filter.operator === "is_empty") return !value.trim();
  if (filter.operator === "is_not_empty") return !!value.trim();

  if (filter.operator === "is_checked") return property?.value === true;
  if (filter.operator === "is_unchecked") return property?.value !== true;

  if (filter.operator === "greater_than" || filter.operator === "less_than") {
    const current = propertyNumberValue(property);
    const target = Number(filter.value.trim());
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return filter.operator === "greater_than"
      ? current > target
      : current < target;
  }

  if (filter.operator === "before" || filter.operator === "after") {
    const current = propertyDateValue(property);
    const target = new Date(filter.value.trim()).getTime();
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return filter.operator === "before" ? current < target : current > target;
  }

  const candidateValues = databaseItemFilterCandidateValues(
    item,
    properties,
    filter.key,
  ).map((candidate) => candidate.trim().toLowerCase());
  const normalizedValue = value.trim().toLowerCase();
  const normalizedFilter = filter.value.trim().toLowerCase();
  if (filter.operator === "equals") {
    return candidateValues.includes(normalizedFilter);
  }
  if (filter.operator === "does_not_equal") {
    return !candidateValues.includes(normalizedFilter);
  }
  return normalizedValue.includes(normalizedFilter);
}

function databaseItemSearchText(
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

function databaseItemSortValue(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return item.document.title || "";
  const property = properties.find(
    (candidate) => candidate.definition.id === key,
  );
  const itemProperty = item.properties.find(
    (candidate) => candidate.definition.id === key,
  );
  return propertyValueText(itemProperty ?? property ?? null);
}

function databaseItemFilterValue(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return item.document.title || "";
  return propertyValueText(databaseItemFilterProperty(item, properties, key));
}

function databaseItemFilterProperty(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return null;
  const property = properties.find(
    (candidate) => candidate.definition.id === key,
  );
  const itemProperty = item.properties.find(
    (candidate) => candidate.definition.id === key,
  );
  return itemProperty ?? property ?? null;
}

function databaseItemFilterCandidateValues(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return [item.document.title || ""];
  const property = databaseItemFilterProperty(item, properties, key);
  if (!property) return [""];
  const value = property.value;

  if (value === null || value === undefined || value === "") return [""];

  if (Array.isArray(value)) {
    return value.flatMap((id) => {
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
    const id = String(value);
    const optionName =
      property.definition.options.options?.find((option) => option.id === id)
        ?.name ?? id;
    return [id, optionName];
  }

  return [propertyValueText(property)];
}

export function propertyValueText(
  property: DocumentProperty | null | undefined,
) {
  if (!property) return "";
  const value = property.value;
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value
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
        (option) => option.id === String(value),
      )?.name ?? String(value)
    );
  }
  if (property.definition.type === "checkbox") {
    return value ? "Checked" : "Unchecked";
  }
  if (property.definition.type === "date") {
    return formulaValueText(value);
  }
  return formulaValueText(value);
}

function compareDatabaseSortValues(left: string, right: string) {
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

export function propertyNumberValue(
  property: DocumentProperty | null | undefined,
) {
  if (!property) return Number.NaN;
  if (
    property.value === null ||
    property.value === undefined ||
    property.value === ""
  ) {
    return Number.NaN;
  }
  const value =
    typeof property.value === "number"
      ? property.value
      : Number(String(property.value).trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

export function databaseFilterOptionChoices(
  key: string,
  properties: DocumentProperty[],
) {
  const property = databaseFilterOptionPropertyForKey(key, properties);
  return property?.definition.options.options ?? [];
}

export function databaseFilterOptionPropertyForKey(
  key: string,
  properties: DocumentProperty[],
) {
  const property = databaseFilterPropertyForKey(key, properties);
  if (!property) return null;
  if (
    property.definition.type !== "select" &&
    property.definition.type !== "status" &&
    property.definition.type !== "multi_select"
  ) {
    return null;
  }
  return property;
}

function databaseFilterValueLabel(
  filter: DatabaseFilter,
  properties: DocumentProperty[],
) {
  const option = databaseFilterOptionChoices(filter.key, properties).find(
    (candidate) =>
      candidate.id === filter.value || candidate.name === filter.value,
  );
  return (option?.name ?? filter.value) || "Choose option";
}

export { databaseFilterValueLabel };

export function databaseFilterChipLabel(
  filter: DatabaseFilter,
  properties: DocumentProperty[],
) {
  const operator = FILTER_OPERATOR_LABELS[filter.operator] ?? "Contains";
  if (!filterOperatorNeedsValue(filter.operator)) {
    return `${filter.label} ${operator.toLowerCase()}`;
  }
  return `${filter.label} ${operator.toLowerCase()} ${databaseFilterValueLabel(
    filter,
    properties,
  )}`;
}

function databaseFilterPropertyForKey(
  key: string,
  properties: DocumentProperty[],
) {
  if (key === "name") return null;
  return properties.find((property) => property.definition.id === key) ?? null;
}

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "Contains",
  equals: "Is",
  does_not_equal: "Is not",
  greater_than: "Greater than",
  less_than: "Less than",
  before: "Before",
  after: "After",
  is_checked: "Checked",
  is_unchecked: "Unchecked",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
};

export function filterOperatorsForKey(
  key: string,
  properties: DocumentProperty[],
): FilterOperator[] {
  const type = filterPropertyTypeForKey(key, properties);

  if (type === "checkbox") {
    return ["is_checked", "is_unchecked"];
  }

  if (type === "select" || type === "status" || type === "multi_select") {
    return ["equals", "does_not_equal", "is_empty", "is_not_empty"];
  }

  if (type === "number") {
    return [
      "equals",
      "does_not_equal",
      "greater_than",
      "less_than",
      "is_empty",
      "is_not_empty",
    ];
  }

  if (
    type === "date" ||
    type === "created_time" ||
    type === "last_edited_time"
  ) {
    return [
      "equals",
      "does_not_equal",
      "before",
      "after",
      "is_empty",
      "is_not_empty",
    ];
  }

  return ["contains", "equals", "does_not_equal", "is_empty", "is_not_empty"];
}

export function defaultFilterOperatorForKey(
  key: string,
  properties: DocumentProperty[],
): FilterOperator {
  return filterOperatorsForKey(key, properties)[0] ?? "contains";
}

export function filterPropertyTypeForKey(
  key: string,
  properties: DocumentProperty[],
): DocumentPropertyType {
  if (key === "name") return "text";
  return (
    properties.find((property) => property.definition.id === key)?.definition
      .type ?? "text"
  );
}

export function filterOperatorNeedsValue(operator: FilterOperator) {
  return !["is_empty", "is_not_empty", "is_checked", "is_unchecked"].includes(
    operator,
  );
}

export function filterValuePlaceholder(
  key: string,
  properties: DocumentProperty[],
) {
  const type = filterPropertyTypeForKey(key, properties);
  if (type === "number") return "Number";
  if (type === "person") return "Person or email";
  if (type === "place") return "City, venue, or address";
  if (type === "files_media") return "File or media link";
  if (type === "date" || type === "created_time" || type === "last_edited_time")
    return "YYYY-MM-DD";
  return "Value";
}

export function filterValueInputType(type: DocumentPropertyType) {
  if (type === "number") return "number";
  if (type === "date" || type === "created_time" || type === "last_edited_time")
    return "date";
  return "text";
}

export function databaseTableRowDensityClass(rowDensity: DatabaseRowDensity) {
  if (rowDensity === "compact") return "min-h-8";
  if (rowDensity === "comfortable") return "min-h-12";
  return "min-h-9";
}

export function databaseTableCellDensityClass(rowDensity: DatabaseRowDensity) {
  if (rowDensity === "compact") return "px-2 py-0.5";
  if (rowDensity === "comfortable") return "px-2.5 py-2";
  return "px-2 py-1";
}

export function databaseRowNameCellDensityClass(
  rowDensity: DatabaseRowDensity,
) {
  if (rowDensity === "compact") return "px-1 py-0.5";
  if (rowDensity === "comfortable") return "px-1.5 py-2";
  return "px-1 py-1";
}

export function databaseTitleButtonDensityClass(
  rowDensity: DatabaseRowDensity,
  wrapCells: boolean,
) {
  if (wrapCells) {
    if (rowDensity === "compact") return "min-h-6 py-0.5";
    if (rowDensity === "comfortable") return "min-h-9 py-1.5";
    return "min-h-7 py-1";
  }
  if (rowDensity === "compact") return "h-6";
  if (rowDensity === "comfortable") return "h-8";
  return "h-7";
}
