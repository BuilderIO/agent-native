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
 * Where to go once the server confirms a delete. The server's path matters
 * only when the open page went with a parent the sidebar hadn't loaded; when
 * the sidebar already left the deleted page for a remaining one, following
 * the server would bounce through Home.
 */
export function navigationAfterConfirmedDelete(
  navigationPath: string | null | undefined,
  { leftDeletedPage }: { leftDeletedPage: boolean },
): string | null {
  return leftDeletedPage ? null : (navigationPath ?? null);
}
