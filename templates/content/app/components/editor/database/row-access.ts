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

// Without edit access the menu holds only Open page, Copy link and Comment,
// which all need a page the reader can open. Rows in a source's attach preview
// aren't pages yet, and a collection can list rows whose pages it doesn't share.
// An MCP App widget's session is scoped to the widget's own resource, so it
// gives readers no menu, as its page toolbar gives no page menu.
export function databaseItemHasRowMenu(
  item: ContentDatabaseItem,
  canEditDatabase: boolean,
  inWidget: boolean,
) {
  return canEditDatabase || (!inWidget && databaseItemHasViewerAccess(item));
}

export function databaseItemCanDuplicate(
  item: ContentDatabaseItem,
  isWorkspaceCatalog: boolean,
) {
  return (
    !isWorkspaceCatalog &&
    databaseItemHasViewerAccess(item) &&
    // A copy would be a row with no file behind it in a GitHub collection.
    item.document.source?.mode !== "github"
  );
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
