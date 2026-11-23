import type { useT } from "@agent-native/core/client/i18n";

import type { ResultField } from "../../../shared/notebook-result-contract";
import type { PivotScalar } from "../../../shared/pivot-config";
import type {
  TableColumnPreference,
  TableFilter,
} from "../../../shared/table-visualization-config";
import {
  columnFilterType,
  matchesDisplayFilter,
  type FilterOperator,
} from "./display-filters";

export type TableColumn = {
  field: ResultField;
  index: number;
  label: string;
  settings: TableColumnPreference | undefined;
  choices: string[];
};

export const TABLE_FILTER_LABELS = {
  eq: "equal",
  neq: "not_equal",
  gt: "greater",
  gte: "greater_equal",
  lt: "less",
  lte: "less_equal",
  contains: "contains",
  "not-contains": "not_contains",
  in: "one_of",
  "not-in": "not_one_of",
  "is-null": "is_null",
  "is-not-null": "not_null",
} as const satisfies Record<TableFilter["op"], FilterOperator>;

export function tableFilterOperators(field: ResultField): TableFilter["op"][] {
  const type = columnFilterType(field, [], 0);
  const common = ["eq", "neq", "is-not-null", "is-null"] as const;
  if (type === "boolean") return [...common];
  const withList = [...common, "in", "not-in"] as const;
  if (type === "string") return [...withList, "contains", "not-contains"];
  if (type === "number" || type === "date" || type === "datetime")
    return [...withList, "gt", "gte", "lt", "lte"];
  return ["is-not-null", "is-null"];
}

export function makeTableFilter(
  field: ResultField,
  op: TableFilter["op"],
  value: string,
  values: string[],
): TableFilter | undefined {
  if (op === "is-null" || op === "is-not-null")
    return { fieldId: field.fieldId, op };

  function scalar(text: string): PivotScalar | undefined {
    if (field.type === "string") return text;
    const input = text.trim();
    if (!input) return;
    if (field.type === "boolean") {
      if (input === "true") return true;
      if (input === "false") return false;
      return;
    }
    if (field.type === "number") {
      const numeric = Number(input);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    if (field.type === "integer")
      return /^[+-]?\d+$/.test(input) ? input : undefined;
    if (field.type === "decimal")
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) ? input : undefined;
    if (field.type === "date" || field.type === "datetime") {
      if (!/^\d{4}-\d{2}-\d{2}/.test(input) || Number.isNaN(Date.parse(input)))
        return;
      return field.type === "date"
        ? input.slice(0, 10)
        : new Date(input).toISOString();
    }
  }

  if (op === "in" || op === "not-in") {
    const parsed = values.map(scalar);
    if (
      parsed.length === 0 ||
      parsed.length > 200 ||
      parsed.some((item) => item === undefined)
    )
      return;
    return {
      fieldId: field.fieldId,
      op,
      values: parsed.filter((item) => item !== undefined),
    };
  }
  const parsed = scalar(value);
  return parsed === undefined
    ? undefined
    : { fieldId: field.fieldId, op, value: parsed };
}

export function tableRuleMatches(
  rule: TableFilter,
  field: ResultField,
  value: unknown,
) {
  if (rule.op === "is-null") return value === null;
  if (value === null || value === undefined) return false;
  if (rule.op === "is-not-null") return true;
  if (field.type === "string" && "value" in rule) {
    if (rule.op === "eq") return value === rule.value;
    if (rule.op === "neq") return value !== rule.value;
  }
  if (field.type === "boolean" && "value" in rule)
    return rule.op === "eq" ? value === rule.value : value !== rule.value;
  const type = columnFilterType(field, [], 0);
  if (type === "date" || type === "datetime") {
    const left = Date.parse(String(value));
    if ("values" in rule) {
      const matches = rule.values.some(
        (item) => Date.parse(String(item)) === left,
      );
      return rule.op === "in" ? matches : !matches;
    }
    if (!("value" in rule)) return false;
    const right = Date.parse(String(rule.value));
    switch (rule.op) {
      case "eq":
        return left === right;
      case "neq":
        return left !== right;
      case "gt":
        return left > right;
      case "gte":
        return left >= right;
      case "lt":
        return left < right;
      case "lte":
        return left <= right;
      case "contains":
      case "not-contains":
        return false;
    }
  }
  return matchesDisplayFilter(
    value,
    {
      id: 0,
      column: 0,
      operator: TABLE_FILTER_LABELS[rule.op],
      value: "value" in rule ? String(rule.value) : "",
      values: "values" in rule ? rule.values.map(String) : [],
      end: "",
    },
    type,
  );
}

export function tableFilterText(
  rule: TableFilter,
  label: string,
  t: ReturnType<typeof useT>,
) {
  if (rule.op === "eq" && "value" in rule)
    return `${label} = ${String(rule.value)}`;
  const operator = t(
    `notebook.displayFilters.operators.${TABLE_FILTER_LABELS[rule.op]}`,
  );
  if ("value" in rule) return `${label} ${operator} ${String(rule.value)}`;
  if ("values" in rule) return `${label} ${operator} ${rule.values.join(", ")}`;
  return `${label} ${operator}`;
}
