import type { Document } from "@shared/api";

type SidebarDocumentAccess = Pick<
  Document,
  "accessRole" | "canEdit" | "canManage"
>;

export function documentSidebarActionAvailability(
  document: SidebarDocumentAccess,
  {
    favoriteAvailable,
    manageAvailable = true,
  }: {
    favoriteAvailable: boolean;
    manageAvailable?: boolean;
  },
) {
  const canEdit = document.canEdit !== false;
  const canManage =
    document.canManage === true ||
    document.accessRole === "owner" ||
    document.accessRole === "admin";
  const canFavorite = favoriteAvailable;

  return {
    canEdit,
    canManage,
    canFavorite,
    hasMenuActions: canFavorite || (canManage && manageAvailable),
  };
}

/**
 * The page to open when the open page is going to Trash with `deletedId`.
 * Home would reopen the last page visited, which is the one being deleted.
 * The caller knows the open page's path, root first, and the cached
 * top-level Files rows. Neither the deleted page's parent nor a top-level row
 * can sit inside the deleted subtree, so either survives the delete. Null
 * means neither is known, and the caller waits for the server.
 */
export function remainingPageAfterDelete(
  deletedId: string,
  {
    activePath,
    filesRootDocumentIds,
    pendingTrashIds = new Set(),
  }: {
    activePath: readonly {
      id: string;
      parentId: string | null;
      canView?: boolean;
    }[];
    filesRootDocumentIds: readonly string[];
    pendingTrashIds?: ReadonlySet<string>;
  },
): string | null {
  const parentId = activePath.find((entry) => entry.id === deletedId)?.parentId;
  const parent = activePath.find((entry) => entry.id === parentId);
  if (parent && parent.canView !== false && !pendingTrashIds.has(parent.id)) {
    return parent.id;
  }
  return (
    filesRootDocumentIds.find(
      (documentId) =>
        documentId !== deletedId && !pendingTrashIds.has(documentId),
    ) ?? null
  );
}

/**
 * Whether a failed delete should go back to the page it left: only while the
 * person is still on the page the delete opened. Someone who has moved on
 * since gets the failure toast where they are. The pathname may carry the
 * app's base path, so only its end is compared.
 */
export function stillOnPageOpenedForDelete(
  currentPathname: string,
  remainingPageId: string | null,
): boolean {
  return (
    remainingPageId !== null &&
    currentPathname.endsWith(`/page/${remainingPageId}`)
  );
}

/**
 * Where to go once the server confirms a delete. The server's path matters
 * only when the sidebar didn't leave the deleted page itself; when it already
 * opened a remaining page, following the server would bounce through Home.
 */
export function navigationAfterConfirmedDelete(
  navigationPath: string | null | undefined,
  { leftDeletedPage }: { leftDeletedPage: boolean },
): string | null {
  return leftDeletedPage ? null : (navigationPath ?? null);
}
