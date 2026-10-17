export interface ContentTrashItem {
  documentId: string;
  databaseId: string | null;
  legacyRestoreDatabaseId: string | null;
  title: string;
  kind: "page" | "database";
  createdBy?: string | null;
  createdByState: "known" | "unresolved";
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByState: "known" | "unresolved";
  updatedByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  trashedAt: string;
  trashedBy: string | null;
  trashedByState: "known" | "unresolved";
  trashedByName?: string | null;
  trashOrigin: string | null;
  trashRootId: string | null;
  parentId: string | null;
  parentTitle: string | null;
  spaceId: string | null;
  spaceName: string | null;
  canRestore: boolean;
  canPermanentlyDelete: boolean;
  hasAccessibleTrashedChildren: boolean;
}

export interface ListContentTrashResponse {
  items: ContentTrashItem[];
  nextCursor: string | null;
}

export type ContentTrashPurgeStatus =
  | "queued"
  | "running"
  | "retryable"
  | "succeeded"
  | "partially_completed"
  | "conflicted"
  | "failed";

export interface ContentTrashPurgePreviewItem {
  documentId: string;
  title: string;
  eligible: boolean;
  blocker: string | null;
  survivorEffect: string | null;
}

export interface ContentTrashPurgePlanItem extends ContentTrashPurgePreviewItem {
  unitId: string;
  outcome: string;
  outcomeDetail: string | null;
}

export interface ContentTrashPurgePlanResponse {
  planId: string;
  scopeToken: string;
  state: "ready";
  eligibleCount: number;
  blockedCount: number;
  affectedPreview: ContentTrashPurgePreviewItem[];
  filtersIgnored: boolean;
}
