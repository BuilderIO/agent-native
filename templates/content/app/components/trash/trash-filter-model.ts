import {
  filterDateRangeDays,
  findFilterField,
  isFilterRuleComplete,
  parseFilterDateRange,
  resolveFilterDay,
  type FilterField,
  type FilterItem,
  type FilterOption,
  type FilterRule,
  type FilterState,
} from "@agent-native/toolkit/app/filters";
import type {
  ContentTrashFilterOptionsResponse,
  ContentTrashItem,
  ContentTrashWhere,
  ContentTrashWhereCondition,
} from "@shared/content-trash";

export const TRASH_DATE_OPERATORS = [
  "is_within",
  "equals",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "between",
] as const;

const ID_FIELDS = [
  "createdBy",
  "updatedBy",
  "deletedBy",
  "spaceId",
  "parentId",
] as const;
const VALUE_FIELDS = [...ID_FIELDS, "kind"] as const;

export interface TrashFilterLabels {
  createdBy: string;
  updatedBy: string;
  deletedBy: string;
  workspace: string;
  location: string;
  kind: string;
  page: string;
  collection: string;
  deletedAt: string;
}

export interface TrashFilterOptions {
  people: readonly FilterOption[];
  spaces: readonly FilterOption[];
  locations: readonly FilterOption[];
}

export function trashFilterFields(
  labels: TrashFilterLabels,
  options: TrashFilterOptions,
): FilterField<never>[] {
  const choice = (
    id: (typeof VALUE_FIELDS)[number],
    label: string,
    fieldOptions: readonly FilterOption[],
  ): FilterField<never> => ({
    id,
    label,
    type: "choice",
    operators: ["equals", "does_not_equal"],
    options: fieldOptions,
  });
  return [
    choice("createdBy", labels.createdBy, options.people),
    choice("updatedBy", labels.updatedBy, options.people),
    choice("deletedBy", labels.deletedBy, options.people),
    choice("spaceId", labels.workspace, options.spaces),
    choice("parentId", labels.location, options.locations),
    choice("kind", labels.kind, [
      { id: "page", label: labels.page },
      { id: "database", label: labels.collection },
    ]),
    {
      id: "deletedAt",
      label: labels.deletedAt,
      type: "date",
      dates: "past",
      operators: TRASH_DATE_OPERATORS,
    },
  ];
}

export function collectTrashFilterOptions(
  items: readonly ContentTrashItem[],
): Pick<TrashFilterOptions, "people" | "locations"> {
  const people = new Map<string, FilterOption>();
  const locations = new Map<string, FilterOption>();
  for (const item of items) {
    for (const [email, name] of [
      [item.createdBy, item.createdByName],
      [item.updatedBy, item.updatedByName],
      [item.trashedBy, item.trashedByName],
    ] as const) {
      if (email && (!people.has(email) || name))
        people.set(email, { id: email, label: name || email });
    }
    if (item.parentId && item.parentTitle)
      locations.set(item.parentId, {
        id: item.parentId,
        label: item.parentTitle,
      });
  }
  return {
    people: sortOptions(people.values()),
    locations: sortOptions(locations.values()),
  };
}

export function addTrashFilterOptions(
  previous: Pick<TrashFilterOptions, "people" | "locations">,
  response: ContentTrashFilterOptionsResponse,
  untitled: string,
): Pick<TrashFilterOptions, "people" | "locations"> {
  const people = new Map(previous.people.map((option) => [option.id, option]));
  const locations = new Map(
    previous.locations.map((option) => [option.id, option]),
  );
  for (const person of response.people)
    if (!people.has(person.email) || person.name)
      people.set(person.email, {
        id: person.email,
        label: person.name || person.email,
      });
  for (const location of response.locations)
    if (!locations.has(location.id))
      locations.set(location.id, {
        id: location.id,
        label: location.title || untitled,
      });
  return {
    people: sortOptions(people.values()),
    locations: sortOptions(locations.values()),
  };
}

export function trashFilterOptions(
  items: readonly ContentTrashItem[],
  response: ContentTrashFilterOptionsResponse | undefined,
  untitled: string,
): Pick<TrashFilterOptions, "people" | "locations"> {
  const loaded = collectTrashFilterOptions(items);
  return response ? addTrashFilterOptions(loaded, response, untitled) : loaded;
}

function sortOptions(options: Iterable<FilterOption>) {
  return [...options].sort((a, b) => a.label.localeCompare(b.label));
}

function localDayStart(day: string) {
  return new Date(`${day}T00:00:00`).getTime();
}

function localDayEnd(day: string) {
  return new Date(`${day}T23:59:59.999`).getTime();
}

function dateCondition(
  rule: FilterRule,
  today: string,
): ContentTrashWhereCondition | null {
  const iso = (time: number) => new Date(time).toISOString();
  const [first = "", second = ""] = rule.value;
  if (rule.operator === "is_within") {
    const range = parseFilterDateRange(first);
    if (!range) return null;
    const [start, end] = filterDateRangeDays(range, today);
    return {
      field: "deletedAt",
      from: iso(localDayStart(start)),
      to: iso(localDayEnd(end)),
    };
  }
  const day = resolveFilterDay(first, today);
  if (!day) return null;
  if (rule.operator === "equals")
    return {
      field: "deletedAt",
      from: iso(localDayStart(day)),
      to: iso(localDayEnd(day)),
    };
  if (rule.operator === "before")
    return { field: "deletedAt", to: iso(localDayStart(day) - 1) };
  if (rule.operator === "after")
    return { field: "deletedAt", from: iso(localDayEnd(day) + 1) };
  if (rule.operator === "on_or_before")
    return { field: "deletedAt", to: iso(localDayEnd(day)) };
  if (rule.operator === "on_or_after")
    return { field: "deletedAt", from: iso(localDayStart(day)) };
  if (rule.operator !== "between") return null;
  const other = resolveFilterDay(second, today);
  if (!other) return null;
  const [start = day, end = day] = [day, other].sort();
  return {
    field: "deletedAt",
    from: iso(localDayStart(start)),
    to: iso(localDayEnd(end)),
  };
}

function ruleCondition(
  rule: FilterRule,
  fields: readonly FilterField<never>[],
  today: string,
): ContentTrashWhereCondition | null {
  const field = findFilterField(fields, rule.field);
  if (!field || !isFilterRuleComplete(rule, field)) return null;
  if (field.id === "deletedAt") return dateCondition(rule, today);
  const operator = rule.operator === "does_not_equal" ? "isNot" : "is";
  if (field.id === "kind") {
    const kinds = rule.value.filter(
      (value): value is "page" | "database" =>
        value === "page" || value === "database",
    );
    return kinds.length ? { field: "kind", operator, values: kinds } : null;
  }
  const id = ID_FIELDS.find((candidate) => candidate === field.id);
  if (!id) return null;
  return { field: id, operator, values: rule.value };
}

export function trashWhereFromFilterState(
  state: FilterState,
  fields: readonly FilterField<never>[],
  today: string,
): ContentTrashWhere | undefined {
  const items = state.items.flatMap((item): ContentTrashWhere["items"] => {
    if (item.kind === "rule") {
      const condition = ruleCondition(item, fields, today);
      return condition ? [condition] : [];
    }
    const conditions = item.rules.flatMap((member: FilterItem) => {
      const condition =
        member.kind === "rule" ? ruleCondition(member, fields, today) : null;
      return condition ? [condition] : [];
    });
    return conditions.length ? [{ mode: item.mode, conditions }] : [];
  });
  return items.length ? { mode: state.mode, items } : undefined;
}
