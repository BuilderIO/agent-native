import type { ContentDatabaseView } from "./api.js";

export function withSavedTableColumnOrder<
  T extends Pick<ContentDatabaseView, "id" | "tableColumnOrderIds">,
>(
  view: T,
  savedViews: readonly Pick<
    ContentDatabaseView,
    "id" | "tableColumnOrderIds"
  >[],
) {
  return {
    ...view,
    tableColumnOrderIds:
      view.tableColumnOrderIds ??
      savedViews.find((saved) => saved.id === view.id)?.tableColumnOrderIds ??
      [],
  };
}

export function databaseTableColumnIds(
  propertyIds: readonly string[],
  order: readonly string[] = [],
): string[] {
  const available = new Set(["name", ...propertyIds]);
  const ordered = [...new Set(order)].filter((id) => available.has(id));
  return [...ordered, ...[...available].filter((id) => !ordered.includes(id))];
}

export function reorderDatabaseTableColumn(
  view: ContentDatabaseView,
  propertyIds: readonly string[],
  visiblePropertyIds: readonly string[],
  sourceId: string,
  targetId: string,
  side: "before" | "after",
): ContentDatabaseView {
  const visible = new Set(["name", ...visiblePropertyIds]);
  if (
    sourceId === targetId ||
    !visible.has(sourceId) ||
    !visible.has(targetId)
  ) {
    return view;
  }
  const order = databaseTableColumnIds(propertyIds, view.tableColumnOrderIds);
  const next = order.filter((id) => id !== sourceId);
  next.splice(next.indexOf(targetId) + (side === "after" ? 1 : 0), 0, sourceId);
  return {
    ...view,
    tableColumnOrderIds: next,
    propertyOrderIds: next.filter((id) => id !== "name"),
  };
}
