import {
  completeFilterRules,
  createFilterGroup,
  createFilterState,
  filterItemId,
  findFilterField,
  isFilterOperator,
  isFilterRuleComplete,
  isPinnedFilterDefault,
  pinnedFilterCoversAll,
  pinnedFilterValue,
  type FilterField,
  type FilterGroup,
  type FilterItem,
  type FilterMode,
  type FilterRule,
  type FilterState,
} from "./model.js";

export interface FilterParamOptions {
  prefix?: string | undefined;
}

const ALL_PINNED = "all";

const ALL_OPTION_ID = "%61ll";

function paramNames(
  fields: readonly FilterField<never>[],
  options: FilterParamOptions,
) {
  const prefix = options.prefix ?? "";
  return {
    match: `${prefix}match`,
    group: `${prefix}g`,
    rule: `${prefix}r`,
    pinned: (field: FilterField<never>) => `${prefix}${field.id}`,
    all: new Set([
      `${prefix}match`,
      `${prefix}g`,
      `${prefix}r`,
      ...fields
        .filter((field) => field.pinned)
        .map((field) => `${prefix}${field.id}`),
    ]),
  };
}

function encodeRule(rule: FilterRule) {
  const values = rule.value.map(encodeURIComponent).join(",");
  return `${encodeURIComponent(rule.field)}:${rule.operator}${
    values ? `:${values}` : ""
  }`;
}

function encodePinnedValue(value: readonly string[]) {
  return value
    .map((id) => (id === ALL_PINNED ? ALL_OPTION_ID : encodeURIComponent(id)))
    .join(",");
}

function modeParam(mode: FilterMode) {
  return mode === "or" ? "any" : "all";
}

export function filterStateToParams(
  state: FilterState,
  fields: readonly FilterField<never>[],
  options: FilterParamOptions = {},
): [string, string][] {
  const names = paramNames(fields, options);
  const params: [string, string][] = [];
  for (const field of fields) {
    if (!field.pinned || isPinnedFilterDefault(state, field)) continue;
    const value = pinnedFilterValue(state, field);
    params.push([
      names.pinned(field),
      pinnedFilterCoversAll(value, field)
        ? ALL_PINNED
        : encodePinnedValue(value),
    ]);
  }
  if (state.mode === "or") params.push([names.match, "any"]);
  const pushItems = (items: readonly FilterItem[], group: string | null) => {
    let groupNumber = 0;
    for (const item of items) {
      if (completeFilterRules(item, fields).length === 0) continue;
      if (item.kind === "rule") {
        params.push([
          names.rule,
          group === null ? encodeRule(item) : `${group}/${encodeRule(item)}`,
        ]);
        continue;
      }
      groupNumber += 1;
      const number =
        group === null ? `${groupNumber}` : `${group}.${groupNumber}`;
      params.push([names.group, `${number}:${modeParam(item.mode)}`]);
      pushItems(item.rules, number);
    }
  };
  pushItems(state.items, null);
  return params;
}

function decodeParamValue(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function decodeRule(
  raw: string,
  fields: readonly FilterField<never>[],
): { group: string | null; rule: FilterRule } | null {
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const slash = raw.indexOf("/");
  const group = slash !== -1 && slash < colon ? raw.slice(0, slash) : null;
  const body = group === null ? raw : raw.slice(slash + 1);
  const [rawFieldId = "", operator = "", ...rest] = body.split(":");
  const fieldId = decodeParamValue(rawFieldId);
  const field = fieldId === null ? undefined : findFilterField(fields, fieldId);
  if (!field || !isFilterOperator(operator)) return null;
  const joined = rest.join(":");
  const value: string[] = [];
  for (const part of joined ? joined.split(",") : []) {
    const decoded = decodeParamValue(part);
    if (decoded === null) return null;
    value.push(decoded);
  }
  const rule: FilterRule = {
    kind: "rule",
    id: filterItemId("r"),
    field: field.id,
    operator,
    value,
  };
  return isFilterRuleComplete(rule, field) ? { group, rule } : null;
}

export function readFilterParams(
  search: string | URLSearchParams,
  fields: readonly FilterField<never>[],
  options: FilterParamOptions = {},
): FilterState {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const names = paramNames(fields, options);
  const state = createFilterState(fields);
  const groups = new Map<string, FilterGroup>();
  for (const field of fields) {
    if (!field.pinned) continue;
    const raw = params.get(names.pinned(field));
    if (raw === null) continue;
    const known = new Set((field.options ?? []).map((option) => option.id));
    const value =
      raw === ALL_PINNED
        ? [...known]
        : raw
            .split(",")
            .map(decodeParamValue)
            .filter((entry): entry is string => entry !== null)
            .filter((entry) => known.has(entry));
    if (value.length > 0) state.pinned[field.id] = value;
  }
  if (params.get(names.match) === "any") state.mode = "or";
  const members: (
    | { kind: "group"; number: string; parent: string | null }
    | { kind: "rule"; group: string | null; rule: FilterRule }
  )[] = [];
  for (const [key, raw] of params) {
    if (key === names.group) {
      const [number = "", mode = ""] = raw.split(":");
      if (!number || groups.has(number)) continue;
      if (mode !== "all" && mode !== "any") continue;
      const parts = number.split(".");
      const top = parts.at(0) ?? "";
      const nested = parts.at(1);
      if (!top || nested === "" || parts.length > 2) continue;
      groups.set(number, createFilterGroup([], mode === "all" ? "and" : "or"));
      members.push({
        kind: "group",
        number,
        parent: nested === undefined ? null : top,
      });
    } else if (key === names.rule) {
      const decoded = decodeRule(raw, fields);
      if (decoded) members.push({ kind: "rule", ...decoded });
    }
  }
  for (const member of members) {
    if (member.kind === "rule") {
      if (member.group === null) state.items.push(member.rule);
      else groups.get(member.group)?.rules.push(member.rule);
      continue;
    }
    const group = groups.get(member.number);
    if (!group) continue;
    if (member.parent === null) state.items.push(group);
    else groups.get(member.parent)?.rules.push(group);
  }
  const dropEmpty = (items: readonly FilterItem[]): FilterItem[] =>
    items.flatMap((item): FilterItem[] => {
      if (item.kind === "rule") return [item];
      const rules = dropEmpty(item.rules);
      return rules.length > 0 ? [{ ...item, rules }] : [];
    });
  state.items = dropEmpty(state.items);
  return state;
}

function encodeParam(value: string) {
  return encodeURIComponent(value)
    .replace(/%3A/gi, ":")
    .replace(/%2C/gi, ",")
    .replace(/%2F/gi, "/");
}

export function serializeSearch(params: readonly [string, string][]) {
  if (params.length === 0) return "";
  return `?${params
    .map(([key, value]) => `${encodeParam(key)}=${encodeParam(value)}`)
    .join("&")}`;
}

export function writeFilterSearch(
  search: string,
  state: FilterState,
  fields: readonly FilterField<never>[],
  options: FilterParamOptions = {},
) {
  const names = paramNames(fields, options);
  const kept = [...new URLSearchParams(search)].filter(
    ([key]) => !names.all.has(key),
  );
  return serializeSearch([
    ...kept,
    ...filterStateToParams(state, fields, options),
  ]);
}

export function filterStateKey(
  state: FilterState,
  fields: readonly FilterField<never>[],
) {
  return serializeSearch(filterStateToParams(state, fields));
}

export function filterSearchKey(
  search: string,
  fields: readonly FilterField<never>[],
  options: FilterParamOptions = {},
) {
  return filterStateKey(readFilterParams(search, fields, options), fields);
}
