// Board grouping logic: group definitions, item assignment, board-specific helpers.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseItem,
  ContentDatabaseView,
  DocumentProperty,
  DocumentPropertyType,
  DocumentPropertyValue,
} from "@shared/api";
import { type DatabaseBoardGroup, BOARD_UNGROUPED_VALUE } from "./types";
import { createDatabaseView } from "./view-config";
import { isDatabasePropertyVisibleInView } from "./view-state";

export { BOARD_UNGROUPED_VALUE };

export function databaseViewGroupableProperties(
  properties: DocumentProperty[],
) {
  return databaseBoardGroupableProperties(properties);
}

export function databaseViewItemGroups(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  groupByPropertyId?: string | null,
): DatabaseBoardGroup[] {
  if (!groupByPropertyId) {
    return [
      {
        id: "all",
        label: "All pages",
        property: null,
        value: BOARD_UNGROUPED_VALUE,
        items,
      },
    ];
  }
  return databaseBoardGroups(items, properties, groupByPropertyId);
}

export function databaseVisibleGroups(
  groups: DatabaseBoardGroup[],
  hideEmptyGroups: boolean,
) {
  return hideEmptyGroups
    ? groups.filter((group) => group.items.length > 0)
    : groups;
}

export function databaseBoardGroupableProperties(
  properties: DocumentProperty[],
) {
  return properties.filter((property) =>
    ["status", "select", "multi_select", "checkbox"].includes(
      property.definition.type,
    ),
  );
}

export function databaseBoardCanCreateGroup(property: DocumentProperty | null) {
  if (!property) return false;
  return ["status", "select", "multi_select"].includes(
    property.definition.type,
  );
}

export function databaseViewGroupingProperty(
  view: Pick<ContentDatabaseView, "groupByPropertyId" | "type">,
  properties: DocumentProperty[],
) {
  if (
    view.type !== "table" &&
    view.type !== "list" &&
    view.type !== "gallery"
  ) {
    return null;
  }
  if (!view.groupByPropertyId) return null;
  return (
    databaseViewGroupableProperties(properties).find(
      (property) => property.definition.id === view.groupByPropertyId,
    ) ?? null
  );
}

export function databaseBoardGroupingProperty(
  view: ContentDatabaseView,
  properties: DocumentProperty[],
) {
  const groupable = databaseBoardGroupableProperties(properties);
  return (
    groupable.find(
      (property) => property.definition.id === view.groupByPropertyId,
    ) ??
    groupable.find((property) => property.definition.type === "status") ??
    groupable[0] ??
    null
  );
}

export function databaseBoardGroups(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  groupByPropertyId?: string | null,
): DatabaseBoardGroup[] {
  const groupProperty =
    databaseBoardGroupingProperty(
      createDatabaseView("Board", "board", { groupByPropertyId }, "board"),
      properties,
    ) ?? null;

  if (!groupProperty) {
    return [
      {
        id: "all",
        label: "No grouping",
        property: null,
        value: BOARD_UNGROUPED_VALUE,
        items,
      },
    ];
  }

  const groups = databaseBoardGroupDefinitions(groupProperty).map((group) => ({
    ...group,
    property: groupProperty,
    items: [] as ContentDatabaseItem[],
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const optionIds = new Set(
    groupProperty.definition.options.options?.map((option) => option.id) ?? [],
  );

  for (const item of items) {
    const values = databaseBoardItemGroupValues(item, groupProperty, optionIds);
    for (const value of values) {
      const group = groupById.get(databaseBoardGroupId(groupProperty, value));
      if (group) group.items.push(item);
    }
  }

  return groups;
}

function databaseBoardGroupDefinitions(property: DocumentProperty) {
  if (property.definition.type === "checkbox") {
    return [
      {
        id: databaseBoardGroupId(property, false),
        label: "Unchecked",
        value: false,
      },
      {
        id: databaseBoardGroupId(property, true),
        label: "Checked",
        value: true,
      },
    ];
  }

  return [
    ...(property.definition.options.options ?? []).map((option) => ({
      id: databaseBoardGroupId(property, option.id),
      label: option.name,
      value: option.id,
    })),
    {
      id: databaseBoardGroupId(property, BOARD_UNGROUPED_VALUE),
      label: "No " + property.definition.name,
      value: BOARD_UNGROUPED_VALUE,
    },
  ];
}

function databaseBoardItemGroupValues(
  item: ContentDatabaseItem,
  property: DocumentProperty,
  optionIds: Set<string>,
): Array<DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE> {
  const value =
    item.properties.find(
      (candidate) => candidate.definition.id === property.definition.id,
    )?.value ?? null;

  if (property.definition.type === "checkbox") {
    return [value === true];
  }

  if (property.definition.type === "multi_select") {
    if (!Array.isArray(value) || value.length === 0) {
      return [BOARD_UNGROUPED_VALUE];
    }
    const knownValues = value.filter(
      (id): id is string => typeof id === "string" && optionIds.has(id),
    );
    return knownValues.length > 0 ? knownValues : [BOARD_UNGROUPED_VALUE];
  }

  if (typeof value === "string" && optionIds.has(value)) return [value];
  return [BOARD_UNGROUPED_VALUE];
}

function databaseBoardGroupId(
  property: DocumentProperty,
  value: DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE,
) {
  return `${property.definition.id}:${String(value)}`;
}

export function boardGroupValueForProperty(
  property: DocumentProperty,
  value: DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE,
): DocumentPropertyValue {
  if (value === BOARD_UNGROUPED_VALUE) {
    return property.definition.type === "multi_select" ? [] : null;
  }
  if (
    property.definition.type === "multi_select" &&
    typeof value === "string"
  ) {
    return [value];
  }
  if (property.definition.type === "checkbox") {
    return value === true;
  }
  return value;
}

export function databaseBoardCanManageGroup(group: DatabaseBoardGroup) {
  return !!databaseBoardOptionForGroup(group);
}

export function databaseBoardVisibleCardProperties(
  properties: DocumentProperty[],
  items: ContentDatabaseItem[],
  activeView: Pick<ContentDatabaseView, "hiddenPropertyIds">,
  groupPropertyId: string | null,
) {
  return properties.filter(
    (property) =>
      property.definition.id !== groupPropertyId &&
      isDatabasePropertyVisibleInView(property, items, activeView),
  );
}

export function databaseBoardOptionForGroup(group: DatabaseBoardGroup) {
  if (!group.property || typeof group.value !== "string") return null;
  if (group.value === BOARD_UNGROUPED_VALUE) return null;
  if (!databaseBoardCanCreateGroup(group.property)) return null;
  return (
    group.property.definition.options.options?.find(
      (option) => option.id === group.value,
    ) ?? null
  );
}

const CALENDAR_DATE_PROPERTY_TYPES: DocumentPropertyType[] = [
  "date",
  "created_time",
  "last_edited_time",
];

export const CALENDAR_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export function databaseCalendarDateProperties(properties: DocumentProperty[]) {
  return properties.filter((property) =>
    CALENDAR_DATE_PROPERTY_TYPES.includes(property.definition.type),
  );
}

export function databaseCalendarDateProperty(
  view: Pick<ContentDatabaseView, "datePropertyId">,
  properties: DocumentProperty[],
) {
  const dateProperties = databaseCalendarDateProperties(properties);
  return (
    dateProperties.find(
      (property) => property.definition.id === view.datePropertyId,
    ) ??
    dateProperties.find((property) => property.definition.type === "date") ??
    dateProperties[0] ??
    null
  );
}
