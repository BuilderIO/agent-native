import type {
  ContentDatabaseNavigationSort,
  ContentDatabasePersonalViewOverrides,
  ContentSidebarViewOrder,
} from "@shared/api";

export const FILES_NAVIGATION_PAGE_SIZE = 20;

/** The Files tree order a person chose, as the paged navigation query reads it. */
export function filesNavigationOrder(
  overrides: ContentDatabasePersonalViewOverrides | null | undefined,
): { activeViewId: string; order: ContentSidebarViewOrder } {
  const activeViewId = overrides?.activeViewId ?? "default";
  return {
    activeViewId,
    order: overrides?.views.find((view) => view.id === activeViewId)
      ?.sidebarOrder ?? { mode: "custom", itemIds: [] },
  };
}

// Every reader of one Files branch must build the same params so the sidebar
// tree and breadcrumb menus share one cached request per page.
export function filesNavigationPageParams(args: {
  databaseId: string;
  parentId: string | null;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
  cursor?: string;
}) {
  return {
    databaseId: args.databaseId,
    limit: FILES_NAVIGATION_PAGE_SIZE,
    navigation: {
      parentId: args.parentId,
      sort: args.sort,
      viewId: args.viewId,
      cursor: args.cursor,
    },
  };
}
