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
