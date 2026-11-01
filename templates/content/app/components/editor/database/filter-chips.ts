// Filter chips on one option property: the chip "+ Filter" reopens instead of
// adding a second, and the chips that fold into one because they say the same.
// Pure logic — no React.
import type { DocumentProperty, DocumentPropertyType } from "@shared/api";

import type {
  ColumnKey,
  DatabaseFilter,
  DatabaseFilterMode,
  FilterOperator,
} from "./types";

// Properties whose filter values are options, so one chip can hold several:
// "Status is not done, dropped".
const OPTION_FILTER_PROPERTY_TYPES: ReadonlySet<DocumentPropertyType> = new Set(
  ["select", "status", "multi_select", "person"],
);

// The operators whose chip takes several options: "is" matches any of them,
// "is not" matches none of them.
const MULTI_VALUE_FILTER_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "contains",
  "does_not_equal",
]);

export function databaseFilterSelectedValues(value: string) {
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

export function databaseFilterEncodeSelectedValues(values: string[]) {
  const normalized = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  const [only] = normalized;
  if (only === undefined) return "";
  if (normalized.length === 1) return only;
  return JSON.stringify(normalized);
}

// A chip in the filter row, not a rule inside the advanced filter or a group,
// on a property whose values are options.
function isOptionFilterChip(
  filter: DatabaseFilter,
  properties: DocumentProperty[],
) {
  if (filter.filterGroupId || filter.parentFilterGroupId) return false;
  const type = properties.find(
    (property) => property.definition.id === filter.key,
  )?.definition.type;
  return !!type && OPTION_FILTER_PROPERTY_TYPES.has(type);
}

/**
 * The chip "+ Filter" opens for `key` instead of adding a second one: a chip
 * on the same option property that can take another value. Null when there is
 * none, and the menu adds a chip as before. Dates, numbers and text still get a
 * second chip, so they can bound a range.
 */
export function databaseFilterChipToReopen(
  filters: DatabaseFilter[],
  key: ColumnKey,
  properties: DocumentProperty[],
): number | null {
  const index = filters.findIndex(
    (filter) =>
      filter.key === key &&
      MULTI_VALUE_FILTER_OPERATORS.has(filter.operator) &&
      isOptionFilterChip(filter, properties),
  );
  return index === -1 ? null : index;
}

/**
 * Folds chips on one option property that mean the same as a single chip.
 * Under All, "is not done" and "is not dropped" become "is not done, dropped";
 * under Any, "is A" and "is B" become "is A, B". Other pairs mean something
 * else together and stay apart. Returns `filters` itself when nothing folds.
 */
export function foldDatabaseFilterChips(
  filters: DatabaseFilter[],
  filterMode: DatabaseFilterMode,
  properties: DocumentProperty[],
): DatabaseFilter[] {
  const operator: FilterOperator =
    filterMode === "or" ? "contains" : "does_not_equal";
  const chipIndexByKey = new Map<ColumnKey, number>();
  const result: DatabaseFilter[] = [];
  let folded = false;
  for (const filter of filters) {
    if (
      filter.operator !== operator ||
      !isOptionFilterChip(filter, properties)
    ) {
      result.push(filter);
      continue;
    }
    const chipIndex = chipIndexByKey.get(filter.key);
    const chip = chipIndex === undefined ? undefined : result[chipIndex];
    if (chipIndex === undefined || !chip) {
      chipIndexByKey.set(filter.key, result.length);
      result.push(filter);
      continue;
    }
    result[chipIndex] = {
      ...chip,
      value: databaseFilterEncodeSelectedValues(
        uniqueIgnoringCase([
          ...databaseFilterSelectedValues(chip.value),
          ...databaseFilterSelectedValues(filter.value),
        ]),
      ),
    };
    folded = true;
  }
  return folded ? result : filters;
}

// Values match options by name without regard to case, so "Done" and "done"
// are one value.
function uniqueIgnoringCase(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
