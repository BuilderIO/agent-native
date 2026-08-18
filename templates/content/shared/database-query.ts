import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseItem,
  ContentDatabaseSort,
  ContentDatabaseTableQuery,
  DocumentProperty,
} from "./api.js";
import { documentPropertyDatePart, formulaValueText } from "./properties.js";

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
  const activeFilters = query.filters.filter(isActiveFilter);
  const filtered = activeFilters.length
    ? searched.filter((item) =>
        itemMatchesFilterTree(
          item,
          properties,
          activeFilters,
          query.filterMode,
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

function itemMatchesFilterTree(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  filters: ContentDatabaseFilter[],
  filterMode: ContentDatabaseFilterMode,
) {
  const rootFilters = filters.filter((filter) => !filter.parentFilterGroupId);
  const nestedGroups = new Map<string, ContentDatabaseFilter[]>();
  for (const filter of filters) {
    if (!filter.parentFilterGroupId || !filter.filterGroupId) continue;
    nestedGroups.set(filter.filterGroupId, [
      ...(nestedGroups.get(filter.filterGroupId) ?? []),
      filter,
    ]);
  }
  const matches = [
    ...rootFilters.map((filter) => itemMatchesFilter(item, properties, filter)),
    ...[...nestedGroups.values()].map((group) =>
      combineMatches(
        group.map((filter) => itemMatchesFilter(item, properties, filter)),
        filterMode,
      ),
    ),
  ];
  return combineMatches(matches, filterMode);
}

function combineMatches(
  matches: boolean[],
  filterMode: ContentDatabaseFilterMode,
) {
  if (matches.length === 0) return true;
  return filterMode === "or" ? matches.some(Boolean) : matches.every(Boolean);
}

function isActiveFilter(filter: ContentDatabaseFilter) {
  if (
    !["is_empty", "is_not_empty", "is_checked", "is_unchecked"].includes(
      filter.operator,
    )
  ) {
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

  if (filter.operator === "greater_than" || filter.operator === "less_than") {
    const current = propertyNumberValue(property);
    const target = Number(filter.value.trim());
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return filter.operator === "greater_than"
      ? current > target
      : current < target;
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
  const values = selectedFilterValues(value);
  const start = new Date(values[0] ?? "").getTime();
  const end = new Date(values[1] ?? "").getTime();
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
    const id = String(property.value);
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
        (option) => option.id === String(property.value),
      )?.name ?? String(property.value)
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
      : Number(String(property.value).trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

function propertyDateValue(property: DocumentProperty | null | undefined) {
  if (!property || !property.value) return Number.NaN;
  const value = new Date(
    documentPropertyDatePart(property.value, "start") || String(property.value),
  ).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}
