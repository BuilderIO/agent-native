// Column footer calculations and result formatting.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseItem,
  ContentDatabaseViewType,
  DocumentProperty,
} from "@shared/api";
import { type DatabaseColumnCalculation } from "./types";
import { isEmptyPropertyValue } from "@shared/properties";
import { calendarDateKey, databaseItemPropertyById } from "./calendar-timeline";
import { propertyNumberValue, propertyValueText } from "./filter-sort";

export function databaseResultCountLabel(
  visibleCount: number,
  totalCount: number,
  constrained: boolean,
) {
  const countLabel = `${visibleCount} ${visibleCount === 1 ? "page" : "pages"}`;
  if (!constrained || visibleCount === totalCount) {
    return `Count ${countLabel}`;
  }
  return `Count ${countLabel} of ${totalCount}`;
}

export function databaseFooterVisibleCount(
  viewType: ContentDatabaseViewType,
  visibleItems: ContentDatabaseItem[],
  screenVisibleItems: ContentDatabaseItem[],
) {
  return viewType === "calendar" || viewType === "timeline"
    ? screenVisibleItems.length
    : visibleItems.length;
}

export function databaseCalculationOptionsForProperty(
  property: DocumentProperty,
): Array<{ value: DatabaseColumnCalculation; label: string }> {
  const options: Array<{ value: DatabaseColumnCalculation; label: string }> = [
    { value: "count_all", label: "Count all" },
    { value: "count_values", label: "Count values" },
    { value: "count_empty", label: "Count empty" },
    { value: "count_unique", label: "Count unique" },
    { value: "percent_filled", label: "Percent filled" },
    { value: "percent_empty", label: "Percent empty" },
  ];
  if (property.definition.type === "checkbox") {
    options.push(
      { value: "count_checked", label: "Checked" },
      { value: "count_unchecked", label: "Unchecked" },
      { value: "percent_checked", label: "Percent checked" },
      { value: "percent_unchecked", label: "Percent unchecked" },
    );
  }
  if (property.definition.type === "number") {
    options.push(
      { value: "sum", label: "Sum" },
      { value: "average", label: "Average" },
      { value: "median", label: "Median" },
      { value: "min", label: "Min" },
      { value: "max", label: "Max" },
      { value: "range", label: "Range" },
    );
  }
  if (property.definition.type === "date") {
    options.push(
      { value: "min", label: "Earliest" },
      { value: "max", label: "Latest" },
      { value: "date_range", label: "Date range" },
    );
  }
  return options;
}

export function databaseColumnCalculationResult(
  calculation: DatabaseColumnCalculation,
  items: ContentDatabaseItem[],
  property: DocumentProperty,
) {
  const itemProperties = items.map((item) =>
    databaseItemPropertyById(item, [property], property.definition.id),
  );
  const filledCount = databaseCalculationFilledCount(itemProperties);

  if (calculation === "count_all") {
    return `${items.length} row${items.length === 1 ? "" : "s"}`;
  }
  if (calculation === "count_values") {
    return `${filledCount} value${filledCount === 1 ? "" : "s"}`;
  }
  if (calculation === "count_empty") {
    const emptyCount = items.length - filledCount;
    return `${emptyCount} empty`;
  }
  if (calculation === "count_unique") {
    const uniqueCount = databaseCalculationUniqueValues(itemProperties).size;
    return `${uniqueCount} unique`;
  }
  if (calculation === "percent_filled") {
    return items.length === 0
      ? "0% filled"
      : `${Math.round((filledCount / items.length) * 100)}% filled`;
  }
  if (calculation === "percent_empty") {
    const emptyCount = items.length - filledCount;
    return items.length === 0
      ? "0% empty"
      : `${Math.round((emptyCount / items.length) * 100)}% empty`;
  }

  if (property.definition.type === "checkbox") {
    const checkedCount = itemProperties.filter(
      (itemProperty) => itemProperty?.value === true,
    ).length;
    if (calculation === "count_checked") {
      return `${checkedCount} checked`;
    }
    if (calculation === "count_unchecked") {
      const uncheckedCount = items.length - checkedCount;
      return `${uncheckedCount} unchecked`;
    }
    if (calculation === "percent_checked") {
      return items.length === 0
        ? "0% checked"
        : `${Math.round((checkedCount / items.length) * 100)}% checked`;
    }
    if (calculation === "percent_unchecked") {
      const uncheckedCount = items.length - checkedCount;
      return items.length === 0
        ? "0% unchecked"
        : `${Math.round((uncheckedCount / items.length) * 100)}% unchecked`;
    }
  }

  if (property.definition.type === "number") {
    const numbers = itemProperties
      .map((itemProperty) => propertyNumberValue(itemProperty))
      .filter(Number.isFinite);
    if (numbers.length === 0) return "Empty";
    if (calculation === "sum") {
      return `Sum ${formatDatabaseCalculationNumber(
        numbers.reduce((sum, value) => sum + value, 0),
      )}`;
    }
    if (calculation === "average") {
      return `Avg ${formatDatabaseCalculationNumber(
        numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
      )}`;
    }
    if (calculation === "median") {
      return `Median ${formatDatabaseCalculationNumber(
        databaseCalculationMedianNumber(numbers),
      )}`;
    }
    if (calculation === "min") {
      return `Min ${formatDatabaseCalculationNumber(Math.min(...numbers))}`;
    }
    if (calculation === "max") {
      return `Max ${formatDatabaseCalculationNumber(Math.max(...numbers))}`;
    }
    if (calculation === "range") {
      return `Range ${formatDatabaseCalculationNumber(
        Math.max(...numbers) - Math.min(...numbers),
      )}`;
    }
  }

  if (property.definition.type === "date") {
    const dateKeys = itemProperties
      .map((itemProperty) => calendarDateKey(itemProperty?.value ?? null))
      .filter((value): value is string => !!value)
      .sort();
    if (dateKeys.length === 0) return "Empty";
    if (calculation === "min") return `Earliest ${dateKeys[0]}`;
    if (calculation === "max") return `Latest ${dateKeys[dateKeys.length - 1]}`;
    if (calculation === "date_range") {
      const days = databaseCalculationDateRangeDays(
        dateKeys[0],
        dateKeys[dateKeys.length - 1],
      );
      return `Range ${days} day${days === 1 ? "" : "s"}`;
    }
  }

  return "Calculate";
}

function databaseCalculationFilledCount(
  itemProperties: Array<DocumentProperty | null>,
) {
  return itemProperties.filter(
    (itemProperty) => itemProperty && !isEmptyPropertyValue(itemProperty.value),
  ).length;
}

function databaseCalculationUniqueValues(
  itemProperties: Array<DocumentProperty | null>,
) {
  const values = new Set<string>();
  for (const itemProperty of itemProperties) {
    if (!itemProperty || isEmptyPropertyValue(itemProperty.value)) continue;
    const value = itemProperty.value;
    if (Array.isArray(value)) {
      for (const item of value) values.add(item);
      continue;
    }
    values.add(propertyValueText(itemProperty));
  }
  return values;
}

function formatDatabaseCalculationNumber(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function databaseCalculationMedianNumber(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function databaseCalculationDateRangeDays(startKey: string, endKey: string) {
  const start = new Date(`${startKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${endKey}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function databaseViewHasNoMatchingPages(
  visibleCount: number,
  hasSearch: boolean,
  activeFilterCount: number,
) {
  return visibleCount === 0 && (hasSearch || activeFilterCount > 0);
}

export function databaseCalculationSummaries(
  calculations: Record<string, DatabaseColumnCalculation> | undefined,
  items: ContentDatabaseItem[],
  visibleProperties: DocumentProperty[],
) {
  if (!calculations) return [];
  return Object.entries(calculations).flatMap(([propertyId, calculation]) => {
    const property = visibleProperties.find(
      (candidate) => candidate.definition.id === propertyId,
    );
    if (!property) return [];
    return [
      {
        propertyId,
        name: property.definition.name,
        type: property.definition.type,
        calculation,
        result: databaseColumnCalculationResult(calculation, items, property),
      },
    ];
  });
}
