import { ActionContractError } from "@agent-native/core";
import { and, asc, eq } from "drizzle-orm";

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
