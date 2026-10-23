import { ActionContractError } from "@agent-native/core";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nextDocumentUpdatedAt } from "./document-updated-at.js";

interface DocumentMetadataScope {
  db: ReturnType<typeof getDb>;
  documentId: string;
  ownerEmail: string;
}

function selectDocumentMetadataDatabases(args: DocumentMetadataScope) {
  return args.db
    .select({
      id: schema.contentDatabases.id,
      updatedAt: schema.contentDatabases.updatedAt,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      and(
        eq(schema.documents.id, args.documentId),
        eq(schema.documents.ownerEmail, args.ownerEmail),
      ),
    )
    .orderBy(asc(schema.contentDatabases.id))
    .limit(2);
}

function metadataScopeChanged(): never {
  throw new ActionContractError(
    "The document's backing collection changed. Read the document again and retry.",
    { errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED", statusCode: 409 },
  );
}

// Lifecycle mutations acquire collection locks before document locks.
export async function lockDocumentMetadataDatabase(
  args: DocumentMetadataScope,
) {
  const databases = await selectDocumentMetadataDatabases(args).for("update", {
    of: schema.contentDatabases,
  });
  if (databases.length > 1) metadataScopeChanged();
  return databases[0]?.id ?? null;
}

/**
 * Locks the collection the page backs and the inline collections it owns, in
 * one id-ordered pass. A body save that drops an inline block soft-deletes its
 * collection after writing the page, and Trash of the page locks that
 * collection before the page.
 */
export async function lockDocumentBodyDatabases(args: DocumentMetadataScope) {
  const databases = await args.db
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      or(
        and(
          eq(schema.documents.id, args.documentId),
          eq(schema.documents.ownerEmail, args.ownerEmail),
        ),
        and(
          eq(schema.contentDatabases.ownerDocumentId, args.documentId),
          eq(schema.contentDatabases.ownerEmail, args.ownerEmail),
          isNull(schema.contentDatabases.deletedAt),
        ),
      ),
    )
    .orderBy(sql`${schema.contentDatabases.id} COLLATE "C"`)
    .for("update", { of: schema.contentDatabases });
  const backing = databases.filter(
    (database) => database.documentId === args.documentId,
  );
  if (backing.length > 1) metadataScopeChanged();
  return {
    databaseId: backing[0]?.id ?? null,
    lockedDatabaseIds: new Set(databases.map((database) => database.id)),
  };
}

export async function assertDocumentMetadataDatabaseScope(
  args: DocumentMetadataScope & {
    lockedDatabaseId: string | null;
  },
) {
  const databases = await selectDocumentMetadataDatabases(args);
  const database = databases[0];
  if (
    databases.length > 1 ||
    (database?.id ?? null) !== args.lockedDatabaseId
  ) {
    metadataScopeChanged();
  }
  return database;
}

export async function nextDocumentMetadataUpdatedAt(
  args: DocumentMetadataScope & {
    currentUpdatedAt: string;
    lockedDatabaseId: string | null;
  },
): Promise<string> {
  const database = await assertDocumentMetadataDatabaseScope(args);
  const updatedAt = nextDocumentUpdatedAt(args.currentUpdatedAt);
  return database
    ? nextDocumentUpdatedAt(database.updatedAt, Date.parse(updatedAt))
    : updatedAt;
}
