import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { documentDiscoveryFilter } from "../server/lib/documents.js";

export const DOCUMENT_DISCOVERY_MAX_LIMIT = 200;
export const DOCUMENT_DISCOVERY_DEFAULT_LIMIT = 50;

export type DocumentDiscoveryType = "page" | "database";

export interface DocumentDiscoveryFilters {
  userEmail: string | null | undefined;
  authorizedOrgIds: string[];
  exactTitle?: string;
  parentId?: string | null;
  spaceId?: string;
  documentType?: DocumentDiscoveryType;
  additional?: SQL;
}

export function documentDiscoveryWhere({
  userEmail,
  authorizedOrgIds,
  exactTitle,
  parentId,
  spaceId,
  documentType,
  additional,
}: DocumentDiscoveryFilters) {
  const db = getDb();
  const accessContexts = [
    { userEmail: userEmail ?? undefined },
    ...authorizedOrgIds.map((orgId) => ({
      userEmail: userEmail ?? undefined,
      orgId,
    })),
  ];
  const activeDatabaseDocument = db
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, schema.documents.id),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  const deletedDatabaseDocument = db
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, schema.documents.id),
        isNotNull(schema.contentDatabases.deletedAt),
      ),
    );
  const deletedDatabaseMembership = db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, schema.documents.id),
        isNotNull(schema.contentDatabases.deletedAt),
      ),
    );

  return and(
    or(
      ...accessContexts.map((context) =>
        accessFilter(schema.documents, schema.documentShares, context),
      ),
    ),
    isNull(schema.documents.trashedAt),
    documentDiscoveryFilter({
      userEmail,
      orgIds: authorizedOrgIds,
    }),
    notExists(deletedDatabaseDocument),
    notExists(deletedDatabaseMembership),
    exactTitle === undefined
      ? undefined
      : eq(schema.documents.title, exactTitle),
    parentId === undefined
      ? undefined
      : parentId === null
        ? isNull(schema.documents.parentId)
        : eq(schema.documents.parentId, parentId),
    spaceId === undefined ? undefined : eq(schema.documents.spaceId, spaceId),
    documentType === "database"
      ? exists(activeDatabaseDocument)
      : documentType === "page"
        ? notExists(activeDatabaseDocument)
        : undefined,
    additional,
  );
}

export function documentDiscoveryPagination(args: {
  offset: number;
  limit: number;
  totalItems: number;
  returnedItems: number;
}) {
  const nextOffset = args.offset + args.returnedItems;
  const hasMore = nextOffset < args.totalItems;
  return {
    offset: args.offset,
    limit: args.limit,
    totalItems: args.totalItems,
    returnedItems: args.returnedItems,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
}
