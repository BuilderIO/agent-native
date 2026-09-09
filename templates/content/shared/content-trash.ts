export interface ContentTrashItem {
  documentId: string;
  databaseId: string | null;
  legacyRestoreDatabaseId?: string | null;
  title: string;
  kind: "page" | "database";
  trashedAt: string;
  trashedBy: string | null;
  trashOrigin: string | null;
  trashRootId: string | null;
  parentId: string | null;
  parentTitle: string | null;
  spaceId: string | null;
  spaceName: string | null;
  canRestore: boolean;
  canPermanentlyDelete: boolean;
}

export interface ListContentTrashResponse {
  items: ContentTrashItem[];
  nextCursor: string | null;
}
