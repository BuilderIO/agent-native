import type { ContentDatabaseView } from "./api.js";

export const DATABASE_TABLE_GUTTER_WIDTH = 56;
const DATABASE_TABLE_MIN_SCROLLABLE_WIDTH = 120;

export type DatabaseFrozenColumnGeometry = {
  widths: Readonly<Record<string, number>>;
  viewportWidth: number | undefined;
  gutterWidth?: number;
};

type TableColumnPresentation = Pick<
  ContentDatabaseView,
  | "id"
  | "tableColumnOrderIds"
  | "wrapCells"
  | "columnWrapOverrides"
  | "frozenThroughColumnId"
>;

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

export function withSavedTableColumnPresentation<
  T extends Pick<ContentDatabaseView, "id"> & Partial<TableColumnPresentation>,
>(view: T, savedViews: readonly TableColumnPresentation[]) {
  const saved = savedViews.find((candidate) => candidate.id === view.id);
  const next = {
    ...view,
    tableColumnOrderIds:
      view.tableColumnOrderIds ?? saved?.tableColumnOrderIds ?? [],
    columnWrapOverrides:
      view.columnWrapOverrides ?? saved?.columnWrapOverrides ?? {},
  };

  if (view.frozenThroughColumnId !== undefined) return next;
  if (saved?.frozenThroughColumnId === undefined) return next;
  return {
    ...next,
    frozenThroughColumnId: saved.frozenThroughColumnId,
  };
}

export function databaseColumnWraps(
  view: Pick<ContentDatabaseView, "wrapCells" | "columnWrapOverrides">,
  columnId: string,
) {
  return view.columnWrapOverrides?.[columnId] ?? view.wrapCells === true;
}

export function withDatabaseColumnWrap(
  view: ContentDatabaseView,
  columnId: string,
  wrap: boolean,
): ContentDatabaseView {
  const overrides = { ...view.columnWrapOverrides };
  if (wrap === (view.wrapCells === true)) delete overrides[columnId];
  else overrides[columnId] = wrap;
  return { ...view, columnWrapOverrides: overrides };
}

export function withDatabaseWrapDefault(
  view: ContentDatabaseView,
  wrapCells: boolean,
): ContentDatabaseView {
  return { ...view, wrapCells, columnWrapOverrides: {} };
}

export function withoutDatabaseColumnPresentation(
  view: ContentDatabaseView,
  columnId: string,
): ContentDatabaseView {
  const columnWrapOverrides = { ...view.columnWrapOverrides };
  delete columnWrapOverrides[columnId];
  return {
    ...view,
    columnWrapOverrides,
    frozenThroughColumnId:
      view.frozenThroughColumnId === columnId
        ? null
        : view.frozenThroughColumnId,
  };
}

export function databaseFrozenColumnIds(
  view: Pick<ContentDatabaseView, "frozenThroughColumnId">,
  visibleColumnIds: readonly string[],
  geometry?: DatabaseFrozenColumnGeometry,
) {
  const endpointIndex =
    view.frozenThroughColumnId === undefined
      ? visibleColumnIds.length > 0
        ? 0
        : -1
      : view.frozenThroughColumnId === null
        ? -1
        : visibleColumnIds.indexOf(view.frozenThroughColumnId);
  if (endpointIndex < 0) return [];

  const intended = visibleColumnIds.slice(0, endpointIndex + 1);
  if (!geometry || geometry.viewportWidth === undefined) return intended;

  const maxFrozenDataWidth = Math.max(
    0,
    geometry.viewportWidth -
      (geometry.gutterWidth ?? DATABASE_TABLE_GUTTER_WIDTH) -
      DATABASE_TABLE_MIN_SCROLLABLE_WIDTH,
  );
  let frozenDataWidth = 0;
  const effective: string[] = [];
  for (const columnId of intended) {
    const width = geometry.widths[columnId];
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(`Missing valid table width for column ${columnId}`);
    }
    if (frozenDataWidth + width > maxFrozenDataWidth) break;
    frozenDataWidth += width;
    effective.push(columnId);
  }
  return effective;
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
