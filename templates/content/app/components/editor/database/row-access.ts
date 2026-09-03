import type { ContentDatabaseItem, ContentDatabaseSource } from "@shared/api";

export function databaseItemIsSourceBacked(
  item: ContentDatabaseItem,
  sources: ContentDatabaseSource[],
) {
  const membershipHydration = item.document.databaseMembership?.bodyHydration;
  const hydration = item.bodyHydration ?? membershipHydration;
  return (
    item.sourceRecord !== undefined ||
    item.document.databaseMembership?.sourceId != null ||
    hydration?.version != null ||
    (hydration !== undefined && hydration.status !== "hydrated") ||
    sources.some((source) =>
      source.rows.some((row) => row.databaseItemId === item.id),
    )
  );
}

export function databaseItemHasViewerAccess(item: ContentDatabaseItem) {
  return item.document.canView === true;
}

export function databaseItemCanDuplicate(
  item: ContentDatabaseItem,
  isWorkspaceCatalog: boolean,
) {
  return !isWorkspaceCatalog && databaseItemHasViewerAccess(item);
}

export function databaseItemCanRemoveFromDatabase(args: {
  item: ContentDatabaseItem;
  databaseCanManage: boolean;
  databaseSystemRole: string | null | undefined;
  isWorkspaceCatalog: boolean;
  sources: ContentDatabaseSource[];
}) {
  return (
    args.databaseCanManage &&
    args.databaseSystemRole === null &&
    databaseItemHasViewerAccess(args.item) &&
    !args.isWorkspaceCatalog &&
    !databaseItemIsSourceBacked(args.item, args.sources)
  );
}
