import type {
  FilterField,
  FilterFieldType,
  FilterItem,
  FilterOperator as KitFilterOperator,
  FilterOption,
  FilterRule,
  FilterState,
} from "@agent-native/toolkit/app/filters";
import {
  filterItemRules,
  filterOperatorTakesValue,
} from "@agent-native/toolkit/app/filters";
import type { DocumentProperty, DocumentPropertyType } from "@shared/api";
import {
  contentDatabaseFilterDateRangeValues,
  contentDatabaseFilterOperatorsForType,
  contentDatabaseFilterTree,
  type ContentDatabaseFilterGroup,
} from "@shared/database-query";
import { useMemo, useState } from "react";

import {
  databaseFilterEncodeSelectedValues,
  databaseFilterSelectedValues,
} from "./filter-chips";
import type {
  DatabaseFilter,
  DatabaseFilterMode,
  FilterOperator as ContentFilterOperator,
} from "./types";

const NAME_KEY = "name";

const KIT_FIELD_TYPES: Partial<Record<DocumentPropertyType, FilterFieldType>> =
  {
    checkbox: "boolean",
    select: "choice",
    status: "choice",
    multi_select: "multi",
    person: "multi",
    number: "number",
    date: "date",
    created_time: "date",
    last_edited_time: "date",
  };

export interface ContentFilterChoice {
  id: string;
  name: string;
  filterValue?: string | undefined;
}

export interface ContentFilterFieldOptions {
  nameLabel: string;
  choices: (property: DocumentProperty) => readonly ContentFilterChoice[];
}

export function contentFilterFields(
  properties: readonly DocumentProperty[],
  { nameLabel, choices }: ContentFilterFieldOptions,
): FilterField<never>[] {
  return [
    {
      id: NAME_KEY,
      label: nameLabel,
      type: "text",
      operators: contentDatabaseFilterOperatorsForType("text"),
    },
    ...properties.map((property) =>
      contentFilterField(property, choices(property)),
    ),
  ];
}

function contentFilterField(
  property: DocumentProperty,
  choices: readonly ContentFilterChoice[],
): FilterField<never> {
  const { id, name, type } = property.definition;
  const kitType = KIT_FIELD_TYPES[type] ?? "text";
  const field: FilterField<never> = { id, label: name, type: kitType };
  switch (kitType) {
    case "text":
      return {
        ...field,
        operators: contentDatabaseFilterOperatorsForType(type),
      };
    case "date":
      return { ...field, times: true, dates: type === "date" ? "any" : "past" };
    case "choice":
    case "multi":
      return { ...field, options: kitOptions(choices) };
    case "boolean":
    case "number":
    case "person":
      return field;
  }
}

function kitOptions(choices: readonly ContentFilterChoice[]): FilterOption[] {
  const seen = new Set<string>();
  const options: FilterOption[] = [];
  for (const choice of choices) {
    const id = choice.filterValue ?? choice.id;
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label: choice.name });
  }
  return options;
}

function propertyTypeFor(
  key: string,
  properties: readonly DocumentProperty[],
): DocumentPropertyType {
  if (key === NAME_KEY) return "text";
  return (
    properties.find((property) => property.definition.id === key)?.definition
      .type ?? "text"
  );
}

function picksOneOption(type: DocumentPropertyType) {
  return type === "select" || type === "status";
}

function picksManyOptions(type: DocumentPropertyType) {
  return type === "multi_select" || type === "person";
}

export function kitFilterOperator(
  operator: ContentFilterOperator,
  type: DocumentPropertyType,
): KitFilterOperator {
  if (picksOneOption(type) && operator === "contains") return "equals";
  if (picksManyOptions(type)) {
    if (operator === "equals") return "contains";
    if (operator === "does_not_equal") return "does_not_contain";
  }
  return operator;
}

export function contentFilterOperator(
  operator: KitFilterOperator,
  type: DocumentPropertyType,
): ContentFilterOperator {
  if (picksOneOption(type) && operator === "equals") return "contains";
  if (picksManyOptions(type) && operator === "does_not_contain") {
    return "does_not_equal";
  }
  return operator;
}

function kitValue(value: string, operator: KitFilterOperator): string[] {
  if (!filterOperatorTakesValue(operator)) return [];
  if (operator === "between") {
    const range = contentDatabaseFilterDateRangeValues(value);
    return range.some(Boolean) ? range : [];
  }
  return databaseFilterSelectedValues(value);
}

function contentValue(rule: FilterRule): string {
  if (!filterOperatorTakesValue(rule.operator)) return "";
  if (rule.operator === "between") {
    const [start = "", end = ""] = rule.value;
    return start || end ? JSON.stringify([start, end]) : "";
  }
  return databaseFilterEncodeSelectedValues(rule.value);
}

function optionIds(
  values: string[],
  field: FilterField<never> | undefined,
): string[] {
  const options = field?.options ?? [];
  return values.map((value) => {
    if (options.some((option) => option.id === value)) return value;
    const wanted = value.trim().toLowerCase();
    return (
      options.find(
        (option) =>
          option.id.toLowerCase() === wanted ||
          option.label.trim().toLowerCase() === wanted,
      )?.id ?? value
    );
  });
}

export function contentFiltersToKitState(
  filters: readonly DatabaseFilter[],
  filterMode: DatabaseFilterMode,
  properties: readonly DocumentProperty[],
  fields: readonly FilterField<never>[] = [],
): FilterState {
  const places = new Map(filters.map((filter, index) => [filter, index]));
  const rule = (filter: DatabaseFilter): FilterRule => {
    const operator = kitFilterOperator(
      filter.operator,
      propertyTypeFor(filter.key, properties),
    );
    return {
      kind: "rule",
      id: `content-${places.get(filter) ?? 0}`,
      field: filter.key,
      operator,
      value: optionIds(
        kitValue(filter.value, operator),
        fields.find((field) => field.id === filter.key),
      ),
    };
  };
  const items = (group: ContentDatabaseFilterGroup<DatabaseFilter>) => [
    ...group.filters.map(rule),
    ...group.groups.map(
      (child): FilterItem => ({
        kind: "group",
        id: child.id ?? "",
        mode: child.mode,
        rules: items(child),
      }),
    ),
  ];
  return {
    mode: filterMode,
    items: items(contentDatabaseFilterTree(filters, filterMode, () => true)),
    pinned: {},
  };
}

export function kitStateToContentFilters(
  state: FilterState,
  properties: readonly DocumentProperty[],
  {
    nameLabel,
    previous = [],
  }: { nameLabel: string; previous?: readonly DatabaseFilter[] },
): DatabaseFilter[] {
  const labels = new Map<string, string>();
  for (const filter of previous) labels.set(filter.key, filter.label);
  labels.set(NAME_KEY, nameLabel);
  for (const property of properties) {
    labels.set(property.definition.id, property.definition.name);
  }
  const filter = (rule: FilterRule): DatabaseFilter => ({
    key: rule.field,
    label: labels.get(rule.field) ?? rule.field,
    operator: contentFilterOperator(
      rule.operator,
      propertyTypeFor(rule.field, properties),
    ),
    value: contentValue(rule),
  });
  const filters: DatabaseFilter[] = [];
  for (const item of state.items) {
    if (item.kind === "rule") {
      filters.push(filter(item));
      continue;
    }
    for (const member of item.rules) {
      if (member.kind === "rule") {
        filters.push({
          ...filter(member),
          filterGroupId: item.id,
          filterGroupMode: item.mode,
        });
        continue;
      }
      for (const rule of filterItemRules(member)) {
        filters.push({
          ...filter(rule),
          filterGroupId: member.id,
          filterGroupMode: member.mode,
          parentFilterGroupId: item.id,
          parentFilterGroupMode: item.mode,
        });
      }
    }
  }
  return filters;
}

export function contentFilterQueryKey(
  filters: readonly DatabaseFilter[],
  filterMode: DatabaseFilterMode,
  properties: readonly DocumentProperty[],
  nameLabel: string,
) {
  const canonical = kitStateToContentFilters(
    contentFiltersToKitState(filters, filterMode, properties),
    properties,
    { nameLabel, previous: filters },
  );
  return JSON.stringify([filterMode, canonical]);
}

export function useContentFilterKitState({
  filters,
  filterMode,
  properties,
  fields,
  nameLabel,
  onChange,
}: {
  filters: readonly DatabaseFilter[];
  filterMode: DatabaseFilterMode;
  properties: readonly DocumentProperty[];
  fields: readonly FilterField<never>[];
  nameLabel: string;
  onChange: (filters: DatabaseFilter[], filterMode: DatabaseFilterMode) => void;
}) {
  const [edited, setEdited] = useState<{
    key: string;
    state: FilterState;
  } | null>(null);
  const key = contentFilterQueryKey(filters, filterMode, properties, nameLabel);
  const saved = useMemo(
    () => contentFiltersToKitState(filters, filterMode, properties, fields),
    [filters, filterMode, properties, fields],
  );
  const state = edited?.key === key ? edited.state : saved;
  const setState = (next: FilterState) => {
    const nextFilters = kitStateToContentFilters(next, properties, {
      nameLabel,
      previous: filters,
    });
    setEdited({
      key: contentFilterQueryKey(nextFilters, next.mode, properties, nameLabel),
      state: next,
    });
    onChange(nextFilters, next.mode);
  };
  return { state, setState };
}
