// i18n-raw-literal-disable-file -- unused pure helper copy; live database editor owns localized UI.
// Filter/sort helpers: apply, upsert, quick filters, property values.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseItem,
  DocumentProperty,
  DocumentPropertyType,
} from "@shared/api";
import { applyContentDatabaseTableQuery } from "@shared/database-query";
import { formulaValueText } from "@shared/properties";

import {
  type ColumnKey,
  type DatabaseFilter,
  type DatabaseFilterMode,
  type DatabaseQuickFilterOperator,
  type FilterOperator,
  type SortDirection,
  type DatabaseSort,
} from "./types";

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
  return applyContentDatabaseTableQuery(items, properties, {
    search: searchQuery,
    filters,
    sorts,
    filterMode,
  });
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
        (option) =>
          option.id ===
          (typeof value === "string" ? value : (JSON.stringify(value) ?? "")),
      )?.name ??
      (typeof value === "string" ? value : (JSON.stringify(value) ?? ""))
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
      : Number(
          (typeof property.value === "string"
            ? property.value
            : (JSON.stringify(property.value) ?? "")
          ).trim(),
        );
  return Number.isFinite(value) ? value : Number.NaN;
}
