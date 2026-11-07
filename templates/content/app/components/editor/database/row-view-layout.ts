import type { ContentDatabaseView, DocumentProperty } from "@shared/api";
import { databaseTableColumnIds } from "@shared/database-table-columns";

import { normalizeClientStringList } from "./view-config";
import { orderDatabasePropertiesForView } from "./view-state";

/** What a row's Properties take from the view it was opened from. */
export type DatabaseRowView = Pick<
  ContentDatabaseView,
  "type" | "hiddenPropertyIds" | "propertyOrderIds" | "tableColumnOrderIds"
>;

/**
 * A row's Properties as its view lays them out: a table's columns left to
 * right, or any other view's property order. A Property the view hasn't placed
 * comes after the others, where the table puts its column.
 */
function orderRowPropertiesForView(
  properties: DocumentProperty[],
  view: DatabaseRowView,
) {
  const ordered = orderDatabasePropertiesForView(properties, view);
  if (view.type !== "table") return ordered;
  const propertyById = new Map(
    ordered.map((property) => [property.definition.id, property]),
  );
  return databaseTableColumnIds(
    ordered.map((property) => property.definition.id),
    normalizeClientStringList(view.tableColumnOrderIds),
  ).flatMap((id) => {
    const property = propertyById.get(id);
    return property ? [property] : [];
  });
}

/**
 * Splits a row's Properties into those its view lists and those it hides, each
 * in the view's order. Without a view, they all list in the page's own order.
 * A Property's own visibility setting isn't decided here; it applies on top.
 */
export function databaseRowPropertyLayout(
  properties: DocumentProperty[],
  view: DatabaseRowView | null | undefined,
): { listed: DocumentProperty[]; hiddenInView: DocumentProperty[] } {
  if (!view) return { listed: properties, hiddenInView: [] };
  const hiddenIds = new Set(normalizeClientStringList(view.hiddenPropertyIds));
  const ordered = orderRowPropertiesForView(properties, view);
  return {
    listed: ordered.filter(
      (property) => !hiddenIds.has(property.definition.id),
    ),
    hiddenInView: ordered.filter((property) =>
      hiddenIds.has(property.definition.id),
    ),
  };
}

/** The row's Properties in the order its property list shows them. */
export function databaseRowPropertyOrder(
  properties: DocumentProperty[],
  view: DatabaseRowView | null | undefined,
) {
  const { listed, hiddenInView } = databaseRowPropertyLayout(properties, view);
  return [...listed, ...hiddenInView];
}
