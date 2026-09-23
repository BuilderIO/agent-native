import { fail } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, schema } from "../server/db/index.js";
import { contentTrashPredicates } from "./_content-trash-query.js";

export async function assertContentTrashPurgeReadAccess(planId: string) {
  const items = await getDb()
    .select({
      documentId: schema.contentTrashPurgePlanItems.documentId,
    })
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, planId));
  const documentIds = items.map(({ documentId }) => documentId);
  const document = alias(schema.documents, "purge_read_document");
  const database = alias(schema.contentDatabases, "purge_read_database");
  const host = alias(schema.documents, "purge_read_host");
  const canonicalDatabaseId = sql<string>`(select min(${schema.contentDatabases.id}) from ${schema.contentDatabases} where ${schema.contentDatabases.documentId} = ${document.id})`;
  const { authority, deletedAt } = contentTrashPredicates(
    document,
    database,
    accessFilter(document, schema.documentShares, undefined, "admin"),
    accessFilter(document, schema.documentShares),
    accessFilter(host, schema.documentShares, undefined, "editor"),
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
