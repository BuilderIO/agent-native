// Per-view property visibility, column calculations, grouping, collapsing, and ordering.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseView,
  ContentDatabaseItem,
  DocumentProperty,
} from "@shared/api";
import {
  type ColumnKey,
  type DatabaseColumnCalculation,
  type DatabaseDropSide,
  type DatabasePropertyMoveDirection,
} from "./types";
import { normalizeClientStringList } from "./view-config";
import { isEmptyPropertyValue } from "@shared/properties";

export { type DatabasePropertyMoveDirection };

function isTablePropertyVisible(
  property: DocumentProperty,
  items: ContentDatabaseItem[],
) {
  const visibility = property.definition.visibility;
  if (visibility === "always_hide") return false;
  if (visibility !== "hide_when_empty") return true;

  return items.some((item) => {
    const itemProperty =
      item.properties.find(
        (candidate) => candidate.definition.id === property.definition.id,
      ) ?? property;
    return !isEmptyPropertyValue(itemProperty.value);
  });
}

export function isDatabasePropertyVisibleInView(
  property: DocumentProperty,
  items: ContentDatabaseItem[],
  view: Pick<ContentDatabaseView, "hiddenPropertyIds">,
) {
  return (
    isTablePropertyVisible(property, items) &&
    !(view.hiddenPropertyIds ?? []).includes(property.definition.id)
  );
}

export function setDatabaseViewHiddenPropertyIds(
  view: ContentDatabaseView,
  propertyIds: string[],
  hidden: boolean,
): ContentDatabaseView {
  const hiddenPropertyIds = new Set(view.hiddenPropertyIds ?? []);
  for (const propertyId of propertyIds) {
    if (hidden) {
      hiddenPropertyIds.add(propertyId);
    } else {
      hiddenPropertyIds.delete(propertyId);
    }
  }
  return { ...view, hiddenPropertyIds: [...hiddenPropertyIds] };
}

export function setDatabaseViewColumnCalculation(
  view: ContentDatabaseView,
  key: ColumnKey,
  calculation: DatabaseColumnCalculation | null,
): ContentDatabaseView {
  const calculations = { ...(view.calculations ?? {}) };
  if (calculation) {
    calculations[key] = calculation;
  } else {
    delete calculations[key];
  }
  return { ...view, calculations };
}

export function setDatabaseViewGroupByProperty(
  view: ContentDatabaseView,
  propertyId: string | null,
): ContentDatabaseView {
  const nextPropertyId = propertyId?.trim() || null;
  if ((view.groupByPropertyId ?? null) === nextPropertyId) return view;

  return {
    ...view,
    groupByPropertyId: nextPropertyId,
    collapsedGroupIds: [],
  };
}

export function setDatabaseViewCollapsedGroup(
  view: ContentDatabaseView,
  groupId: string,
  collapsed: boolean,
): ContentDatabaseView {
  const collapsedGroupIds = new Set(view.collapsedGroupIds ?? []);
  if (collapsed) {
    collapsedGroupIds.add(groupId);
  } else {
    collapsedGroupIds.delete(groupId);
  }
  return { ...view, collapsedGroupIds: [...collapsedGroupIds] };
}

export function setDatabaseViewCollapsedGroups(
  view: ContentDatabaseView,
  groupIds: string[],
  collapsed: boolean,
): ContentDatabaseView {
  const collapsedGroupIds = new Set(view.collapsedGroupIds ?? []);
  for (const groupId of groupIds) {
    const normalizedGroupId = groupId.trim();
    if (!normalizedGroupId) continue;
    if (collapsed) {
      collapsedGroupIds.add(normalizedGroupId);
    } else {
      collapsedGroupIds.delete(normalizedGroupId);
    }
  }
  return { ...view, collapsedGroupIds: [...collapsedGroupIds] };
}

export function orderDatabasePropertiesForView(
  properties: DocumentProperty[],
  view: Pick<ContentDatabaseView, "propertyOrderIds">,
) {
  const propertyById = new Map(
    properties.map((property) => [property.definition.id, property]),
  );
  const ordered = normalizeClientStringList(view.propertyOrderIds)
    .map((id) => propertyById.get(id))
    .filter((property): property is DocumentProperty => !!property);
  const orderedIds = new Set(ordered.map((property) => property.definition.id));
  return [
    ...ordered,
    ...properties.filter((property) => !orderedIds.has(property.definition.id)),
  ];
}

export function moveDatabaseViewProperty(
  view: ContentDatabaseView,
  propertyId: string,
  direction: DatabasePropertyMoveDirection,
  properties: {
    allProperties: DocumentProperty[];
    visibleProperties: DocumentProperty[];
  },
): ContentDatabaseView {
  const visibleIds = properties.visibleProperties.map(
    (property) => property.definition.id,
  );
  const visibleIndex = visibleIds.indexOf(propertyId);
  const targetVisibleIndex =
    direction === "left" ? visibleIndex - 1 : visibleIndex + 1;
  const targetId = visibleIds[targetVisibleIndex];
  if (visibleIndex < 0 || !targetId) return view;

  const allIds = orderDatabasePropertiesForView(
    properties.allProperties,
    view,
  ).map((property) => property.definition.id);
  const currentIndex = allIds.indexOf(propertyId);
  const targetIndex = allIds.indexOf(targetId);
  if (currentIndex < 0 || targetIndex < 0) return view;

  const nextOrder = [...allIds];
  nextOrder[currentIndex] = targetId;
  nextOrder[targetIndex] = propertyId;
  return { ...view, propertyOrderIds: nextOrder };
}

export function reorderDatabaseViewProperty(
  view: ContentDatabaseView,
  sourcePropertyId: string,
  targetPropertyId: string,
  properties: {
    allProperties: DocumentProperty[];
    visibleProperties: DocumentProperty[];
  },
  side: DatabaseDropSide = "before",
): ContentDatabaseView {
  if (sourcePropertyId === targetPropertyId) return view;
  const visibleIds = properties.visibleProperties.map(
    (property) => property.definition.id,
  );
  if (
    !visibleIds.includes(sourcePropertyId) ||
    !visibleIds.includes(targetPropertyId)
  ) {
    return view;
  }

  const allIds = orderDatabasePropertiesForView(
    properties.allProperties,
    view,
  ).map((property) => property.definition.id);
  const sourceIndex = allIds.indexOf(sourcePropertyId);
  const targetIndex = allIds.indexOf(targetPropertyId);
  if (sourceIndex < 0 || targetIndex < 0) return view;

  const nextOrder = [...allIds];
  const [source] = nextOrder.splice(sourceIndex, 1);
  const nextTargetIndex = nextOrder.indexOf(targetPropertyId);
  nextOrder.splice(
    side === "after" ? nextTargetIndex + 1 : nextTargetIndex,
    0,
    source,
  );
  return { ...view, propertyOrderIds: nextOrder };
}

export function databaseGroupIsCollapsed(
  collapsedGroupIds: string[] | null | undefined,
  groupId: string,
) {
  return (collapsedGroupIds ?? []).includes(groupId);
}
