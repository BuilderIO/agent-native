import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import {
  FILTER_NOBODY,
  filterDateInstant,
  filterDateValueHasTime,
  filterOperatorTakesValue,
  filterToday,
  isFilterRelativeDay,
  parseFilterDateRange,
  type FilterDateUnit,
  type FilterField,
  type FilterOperator,
  type FilterRule,
} from "./model.js";

const SINGLE_VALUE_OPERATOR_KEYS: Record<FilterOperator, string> = {
  equals: "agentChat.filters.op.is",
  does_not_equal: "agentChat.filters.op.isNot",
  contains: "agentChat.filters.op.contains",
  does_not_contain: "agentChat.filters.op.doesNotContain",
  starts_with: "agentChat.filters.op.startsWith",
  ends_with: "agentChat.filters.op.endsWith",
  greater_than: "agentChat.filters.op.isMoreThan",
  less_than: "agentChat.filters.op.isLessThan",
  greater_than_or_equal: "agentChat.filters.op.isAtLeast",
  less_than_or_equal: "agentChat.filters.op.isAtMost",
  before: "agentChat.filters.op.isBefore",
  after: "agentChat.filters.op.isAfter",
  on_or_before: "agentChat.filters.op.isOnOrBefore",
  on_or_after: "agentChat.filters.op.isOnOrAfter",
  between: "agentChat.filters.op.isBetween",
  is_within: "agentChat.filters.op.isWithin",
  is_checked: "agentChat.filters.op.is",
  is_unchecked: "agentChat.filters.op.is",
  is_empty: "agentChat.filters.op.isEmpty",
  is_not_empty: "agentChat.filters.op.isNotEmpty",
};

function operatorKey(
  field: Pick<FilterField<never>, "type">,
  operator: FilterOperator,
  valueCount: number,
) {
  const many = valueCount > 1;
  switch (field.type) {
    case "choice":
    case "person":
      if (operator === "equals") {
        return many
          ? "agentChat.filters.op.isAnyOf"
          : "agentChat.filters.op.is";
      }
      if (operator === "does_not_equal") {
        return many
          ? "agentChat.filters.op.isNoneOf"
          : "agentChat.filters.op.isNot";
      }
      return SINGLE_VALUE_OPERATOR_KEYS[operator];
    case "multi":
      if (operator === "contains") return "agentChat.filters.op.hasAnyOf";
      if (operator === "does_not_contain")
        return "agentChat.filters.op.hasNoneOf";
      if (operator === "is_empty") return "agentChat.filters.op.hasNone";
      if (operator === "is_not_empty") return "agentChat.filters.op.hasSome";
      return SINGLE_VALUE_OPERATOR_KEYS[operator];
    case "date":
      if (operator === "equals") return "agentChat.filters.op.isOn";
      if (operator === "does_not_equal") return "agentChat.filters.op.isNotOn";
      return SINGLE_VALUE_OPERATOR_KEYS[operator];
    case "boolean":
    case "text":
    case "number":
      return SINGLE_VALUE_OPERATOR_KEYS[operator];
  }
}

function utcDay(day: string) {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, date);
  return result;
}

export type FilterText = ReturnType<typeof useFilterText>;

export function useFilterText() {
  const translate = useT();
  const { formatDate, formatList, formatNumber } = useFormatters();
  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      translate(key, options);

    const fieldLabel = (field: FilterField<never>) =>
      field.shortLabel ?? field.label;

    const optionLabel = (field: FilterField<never>, id: string) => {
      if (id === FILTER_NOBODY) return t("agentChat.filters.nobody");
      return field.options?.find((option) => option.id === id)?.label ?? id;
    };

    const booleanLabel = (field: FilterField<never>, checked: boolean) => {
      if (checked)
        return field.booleanLabels?.checked ?? t("agentChat.filters.yes");
      return field.booleanLabels?.unchecked ?? t("agentChat.filters.no");
    };

    const operatorLabel = (
      field: FilterField<never>,
      operator: FilterOperator,
      valueCount = 1,
    ) => t(operatorKey(field, operator, valueCount));

    const dayLabel = (value: string) => {
      if (isFilterRelativeDay(value))
        return t(`agentChat.filters.date.${value}`);
      if (filterDateValueHasTime(value)) {
        const instant = filterDateInstant(value);
        if (Number.isNaN(instant)) return value;
        const sameYear =
          new Date(instant).getFullYear() === new Date().getFullYear();
        return formatDate(new Date(instant), {
          month: "short",
          day: "numeric",
          year: sameYear ? undefined : "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      }
      const date = utcDay(value);
      if (Number.isNaN(date.getTime())) return value;
      const sameYear = value.slice(0, 4) === filterToday().slice(0, 4);
      return formatDate(date, {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: sameYear ? undefined : "numeric",
      });
    };

    const rangeLabel = (token: string) => {
      const range = parseFilterDateRange(token);
      if (!range) return token;
      if (range.direction === "this")
        return t(`agentChat.filters.date.this.${range.unit}`);
      const duration = formatNumber(range.count, {
        style: "unit",
        unit: range.unit,
        unitDisplay: "long",
      });
      return t(
        range.direction === "past"
          ? "agentChat.filters.date.past"
          : "agentChat.filters.date.next",
        { duration },
      );
    };

    const unitName = (count: number, unit: FilterDateUnit) => {
      const duration = formatNumber(count, {
        style: "unit",
        unit,
        unitDisplay: "long",
      });
      return duration.replace(formatNumber(count), "").trim() || duration;
    };

    const optionList = (
      field: FilterField<never>,
      values: readonly string[],
      type: "conjunction" | "disjunction" = "disjunction",
    ) =>
      formatList(
        values.map((id) => optionLabel(field, id)),
        { type },
      );

    const valueLabel = (field: FilterField<never>, rule: FilterRule) => {
      if (field.type === "boolean") {
        return booleanLabel(field, rule.operator !== "is_unchecked");
      }
      if (!filterOperatorTakesValue(rule.operator)) {
        return operatorLabel(field, rule.operator);
      }
      const value = rule.value.at(0) ?? "";
      switch (field.type) {
        case "date":
          if (rule.operator === "is_within") return rangeLabel(value);
          if (rule.operator === "between") {
            return t("agentChat.filters.dateBetween", {
              start: dayLabel(value),
              end: dayLabel(rule.value.at(1) ?? ""),
            });
          }
          return dayLabel(value);
        case "text":
          return t("agentChat.filters.quoted", { value });
        case "number":
          return value;
        case "choice":
        case "person":
        case "multi":
          return optionList(field, rule.value);
      }
    };

    const ruleValueLabel = (field: FilterField<never>, rule: FilterRule) => {
      const value = valueLabel(field, rule);
      if (
        field.type === "boolean" ||
        !filterOperatorTakesValue(rule.operator) ||
        (field.type === "date" &&
          (rule.operator === "equals" ||
            rule.operator === "is_within" ||
            rule.operator === "between"))
      ) {
        return value;
      }
      if (
        field.type === "choice" ||
        field.type === "person" ||
        field.type === "multi"
      ) {
        return rule.operator === "does_not_equal" ||
          rule.operator === "does_not_contain"
          ? t("agentChat.filters.chipNot", { value })
          : value;
      }
      return t("agentChat.filters.chipOperator", {
        operator: operatorLabel(field, rule.operator),
        value,
      });
    };

    const ruleLabel = (field: FilterField<never>, rule: FilterRule) =>
      t("agentChat.filters.fieldValue", {
        field: fieldLabel(field),
        value: ruleValueLabel(field, rule),
      });

    return {
      t,
      formatList,
      formatNumber,
      fieldLabel,
      optionLabel,
      booleanLabel,
      operatorLabel,
      dayLabel,
      rangeLabel,
      unitName,
      optionList,
      valueLabel,
      ruleValueLabel,
      ruleLabel,
    };
  }, [formatDate, formatList, formatNumber, translate]);
}
