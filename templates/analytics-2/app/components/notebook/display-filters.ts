import type { notebookMessages } from "@/i18n/messages/notebook";

import { compareNumericText } from "./CellOutputView.numeric-sort";

export type FilterColumn = { name: string; type?: string };
export type DisplayFilter = {
  id: number;
  column: number;
  operator: FilterOperator;
  value: string;
  end: string;
  values: string[];
};
export type FilterOperator =
  keyof typeof notebookMessages.notebook.displayFilters.operators;
export const NO_VALUE_OPERATORS: readonly FilterOperator[] = [
  "is_null",
  "not_null",
  "is_true",
  "is_false",
];
export const LIST_OPERATORS: readonly FilterOperator[] = [
  "one_of",
  "not_one_of",
];

const inferredColumnTypes = new WeakMap<
  readonly unknown[][],
  { length: number; types: Map<number, string> }
>();

export function columnFilterType(
  column: FilterColumn,
  rows: readonly unknown[][],
  index: number,
): string {
  const declared = column.type?.toLowerCase();
  if (
    declared &&
    /^(number|int(?:eger|32|64)?|bigint|numeric|decimal|float(?:32|64)?|double)$/.test(
      declared,
    )
  )
    return "number";
  if (declared === "bool" || declared === "boolean") return "boolean";
  if (declared === "date") return "date";
  if (declared === "datetime" || declared === "timestamp") return "datetime";
  if (declared !== undefined) return declared;
  let cached = inferredColumnTypes.get(rows);
  if (!cached || cached.length !== rows.length) {
    cached = { length: rows.length, types: new Map() };
    inferredColumnTypes.set(rows, cached);
  }
  const hit = cached.types.get(index);
  if (hit !== undefined) return hit;
  const inferred = typeof rows.find(
    (row) => row[index] !== null && row[index] !== undefined,
  )?.[index];
  cached.types.set(index, inferred);
  return inferred;
}
export function operatorsFor(type: string): FilterOperator[] {
  const common: FilterOperator[] = [
    "one_of",
    "not_one_of",
    "equal",
    "not_equal",
    "not_null",
    "is_null",
  ];
  if (type === "boolean") return ["is_true", "is_false", "not_null", "is_null"];
  if (type === "date" || type === "datetime")
    return [
      "after",
      "before",
      "on_or_after",
      "on_or_before",
      "between",
      "not_on",
      "on",
      "not_null",
      "is_null",
    ];
  if (type === "number")
    return ["greater", "greater_equal", "less", "less_equal", ...common];
  return [...common, "contains", "not_contains"];
}
export function defaultFilterOperator(type: string): FilterOperator {
  return type === "date" || type === "datetime"
    ? "on_or_after"
    : (operatorsFor(type)[0] ?? "equal");
}
export function isFilterConfigured(filter: DisplayFilter): boolean {
  if (NO_VALUE_OPERATORS.includes(filter.operator)) return true;
  if (LIST_OPERATORS.includes(filter.operator)) return filter.values.length > 0;
  return (
    filter.value.trim() !== "" &&
    (filter.operator !== "between" || filter.end !== "")
  );
}

function compareNumeric(value: unknown, target: string): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  return compareNumericText(String(value), target);
}
export function matchesDisplayFilter(
  value: unknown,
  filter: DisplayFilter,
  type: string,
): boolean {
  if (!isFilterConfigured(filter)) return true;
  const op = filter.operator;
  if (!operatorsFor(type).includes(op)) return false;
  if (op === "is_null") return value === null || value === undefined;
  if (op === "not_null") return value !== null && value !== undefined;
  if (value === null || value === undefined) return false;
  if (op === "is_true") return value === true;
  if (op === "is_false") return value === false;
  const text = String(value);
  if (op === "contains" || op === "not_contains") {
    const contains = text
      .toLowerCase()
      .includes(filter.value.trim().toLowerCase());
    return op === "contains" ? contains : !contains;
  }
  if (LIST_OPERATORS.includes(op)) {
    const found = filter.values.some((item) =>
      type === "number" ? compareNumeric(value, item) === 0 : item === text,
    );
    return op === "one_of" ? found : !found;
  }
  if (
    [
      "on",
      "not_on",
      "before",
      "after",
      "on_or_before",
      "on_or_after",
      "between",
    ].includes(op)
  ) {
    const day = text.slice(0, 10),
      start = filter.value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    if (op === "on") return day === start;
    if (op === "not_on") return day !== start;
    if (op === "before") return day < start;
    if (op === "after") return day > start;
    if (op === "on_or_before") return day <= start;
    if (op === "on_or_after") return day >= start;
    return day >= start && day <= filter.end.slice(0, 10);
  }
  if (type === "number") {
    const order = compareNumeric(value, filter.value);
    if (order === null) return false;
    if (op === "equal") return order === 0;
    if (op === "not_equal") return order !== 0;
    if (op === "greater") return order > 0;
    if (op === "greater_equal") return order >= 0;
    if (op === "less") return order < 0;
    if (op === "less_equal") return order <= 0;
  }
  const target =
    type === "boolean" ? filter.value.toLowerCase() === "true" : filter.value;
  return op === "not_equal" ? value !== target : value === target;
}
