import { fail } from "@agent-native/core/action";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, schema } from "../server/db/index.js";
import { contentTrashPredicates } from "./_content-trash-query.js";

const SETTLED_PURGE_OUTCOMES = new Set(["deleted", "conflicted"]);

export async function assertContentTrashPurgeReadAccess(
  planId: string,
  orgId: string | null,
) {
  const items = await getDb()
    .select({
      documentId: schema.contentTrashPurgePlanItems.documentId,
      outcome: schema.contentTrashPurgePlanItems.outcome,
    })
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, planId));
  const documentIds = items
    .filter(({ outcome }) => !SETTLED_PURGE_OUTCOMES.has(outcome))
    .map(({ documentId }) => documentId);
  const ctx = orgId ? { ...currentAccess(), orgId } : currentAccess();
  const document = schema.documents;
  const database = alias(schema.contentDatabases, "purge_read_database");
  const host = alias(schema.documents, "purge_read_host");
  const canonicalDatabaseId = sql<string>`(select min(${schema.contentDatabases.id}) from ${schema.contentDatabases} where ${schema.contentDatabases.documentId} = ${document.id})`;
  const { authority, deletedAt } = contentTrashPredicates(
    document,
    database,
    accessFilter(document, schema.documentShares, ctx, "admin"),
    accessFilter(document, schema.documentShares, ctx),
    accessFilter(host, schema.documentShares, ctx, "editor"),
  );
  const authorized = documentIds.length
    ? await getDb()
        .select({ id: document.id })
        .from(document)
        .leftJoin(database, eq(database.id, canonicalDatabaseId))
        .leftJoin(host, eq(host.id, database.ownerDocumentId))
        .where(
          and(
            inArray(document.id, documentIds),
            isNotNull(deletedAt),
            authority,
          ),
        )
    : [];
  if (authorized.length !== documentIds.length) {
    fail("Trash purge record not found", {
      errorCode: "not_found",
      statusCode: 404,
    });
  }
}
