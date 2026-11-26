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

export type ContentTrashWhereCondition =
  | {
      field: "spaceId" | "parentId" | "createdBy" | "updatedBy" | "deletedBy";
      operator?: "is" | "isNot";
      values: string[];
    }
  | {
      field: "kind";
      operator?: "is" | "isNot";
      values: Array<"page" | "database">;
    }
  | { field: "deletedAt"; from?: string; to?: string };

export interface ContentTrashWhere {
  mode: "and" | "or";
  items: Array<
    | ContentTrashWhereCondition
    | { mode: "and" | "or"; conditions: ContentTrashWhereCondition[] }
  >;
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

export interface ContentTrashPurgeSpace {
  spaceId: string;
  name: string;
  canPurge: boolean;
}

export interface ListContentTrashPurgeSpacesResponse {
  spaces: ContentTrashPurgeSpace[];
}

export interface ContentTrashFilterOptionsResponse {
  people: Array<{ email: string; name: string | null }>;
  locations: Array<{ id: string; title: string }>;
}
