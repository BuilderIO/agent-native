import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nextDocumentUpdatedAt } from "./document-updated-at.js";

// The caller holds the document lock in this transaction before locking its collection.
export async function nextDocumentMetadataUpdatedAt(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  ownerEmail: string;
  currentUpdatedAt: string;
}): Promise<string> {
  const [database] = await args.db
    .select({ updatedAt: schema.contentDatabases.updatedAt })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, args.documentId),
        eq(schema.contentDatabases.ownerEmail, args.ownerEmail),
      ),
    )
    .limit(1)
    .for("update");
  const updatedAt = nextDocumentUpdatedAt(args.currentUpdatedAt);
  return database
    ? nextDocumentUpdatedAt(database.updatedAt, Date.parse(updatedAt))
    : updatedAt;
}
