import { ActionContractError } from "@agent-native/core";
import { inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";

type Db = ReturnType<typeof getDb>;

export async function collectDocumentTrashScope(
  db: Db,
  rootId: string,
  ownerEmail: string,
) {
  const documentIds = new Set([rootId]);
  const ownedDatabaseIds = new Set<string>();
  let frontier = [rootId];
  while (frontier.length > 0) {
    const next = new Set<string>();
    for (const batch of chunks(frontier, 90)) {
      const databases = await db
        .select({
          id: schema.contentDatabases.id,
          documentId: schema.contentDatabases.documentId,
        })
        .from(schema.contentDatabases)
        .where(inArray(schema.contentDatabases.documentId, batch));
      const databaseParents = new Set(
        databases.map((database) => database.documentId),
      );
      for (const database of databases) ownedDatabaseIds.add(database.id);
      const children = await db
        .select({
          id: schema.documents.id,
          parentId: schema.documents.parentId,
          ownerEmail: schema.documents.ownerEmail,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.parentId, batch));
      for (const child of children) {
        if (databaseParents.has(child.parentId!)) {
          // Legacy row creation stored collection membership as parentage, with
          // no durable marker distinguishing it from a later deliberate move.
          throw new ActionContractError(
            "Database child ownership must be resolved before moving this page to Trash.",
            {
              errorCode: "DATABASE_CHILD_OWNERSHIP_AMBIGUOUS",
            },
          );
        }
        if (child.ownerEmail !== ownerEmail) {
          throw new ActionContractError(
            "The page hierarchy has a different owner and cannot be moved to Trash together.",
            {
              errorCode: "DOCUMENT_TRASH_SCOPE_OWNER_CONFLICT",
            },
          );
        }
        if (!documentIds.has(child.id)) {
          documentIds.add(child.id);
          next.add(child.id);
        }
      }
    }
    frontier = [...next];
  }
  return {
    documentIds: [...documentIds],
    ownedDatabaseIds: [...ownedDatabaseIds],
  };
}
