import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";
import {
  deleteLocalFileDocument,
  isLocalDocumentId,
  isContentLocalFileMode,
} from "./_local-file-documents.js";

const DELETE_BATCH_SIZE = 90;

async function selectDocumentChildren(
  db: ReturnType<typeof getDb>,
  parentIds: string[],
  ownerEmail: string,
) {
  const rows: Array<{ id: string }> = [];
  for (const batch of chunks(parentIds, DELETE_BATCH_SIZE)) {
    rows.push(
      ...(await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.parentId, batch),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )),
    );
  }
  return rows;
}

async function selectOwnedDatabaseIds(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  ownerEmail: string,
) {
  const rows: Array<{ id: string }> = [];
  for (const batch of chunks(documentIds, DELETE_BATCH_SIZE)) {
    rows.push(
      ...(await db
        .select({ id: schema.contentDatabases.id })
        .from(schema.contentDatabases)
        .where(
          and(
            inArray(schema.contentDatabases.documentId, batch),
            eq(schema.contentDatabases.ownerEmail, ownerEmail),
          ),
        )),
    );
  }
  return rows;
}

async function selectDatabaseItemDocuments(
  db: ReturnType<typeof getDb>,
  databaseIds: string[],
  ownerEmail: string,
) {
  const rows: Array<{ documentId: string }> = [];
  for (const batch of chunks(databaseIds, DELETE_BATCH_SIZE)) {
    rows.push(
      ...(await db
        .select({ documentId: schema.contentDatabaseItems.documentId })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            inArray(schema.contentDatabaseItems.databaseId, batch),
            eq(schema.contentDatabaseItems.ownerEmail, ownerEmail),
          ),
        )),
    );
  }
  if (rows.length === 0) return rows;

  const ownedRows: Array<{ id: string }> = [];
  for (const batch of chunks(
    rows.map((row) => row.documentId),
    DELETE_BATCH_SIZE,
  )) {
    ownedRows.push(
      ...(await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, batch),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )),
    );
  }

  return ownedRows.map((row) => ({ documentId: row.id }));
}

async function collectDocumentSubtreeForDelete(
  db: ReturnType<typeof getDb>,
  rootId: string,
  ownerEmail: string,
) {
  const documentIds = new Set([rootId]);
  const ownedDatabaseIds = new Set<string>();
  let frontier = [rootId];

  while (frontier.length > 0) {
    const next = new Set<string>();

    for (const child of await selectDocumentChildren(
      db,
      frontier,
      ownerEmail,
    )) {
      if (!documentIds.has(child.id)) {
        documentIds.add(child.id);
        next.add(child.id);
      }
    }

    const ownedDatabases = await selectOwnedDatabaseIds(
      db,
      frontier,
      ownerEmail,
    );
    const newDatabaseIds = ownedDatabases
      .map((database) => database.id)
      .filter((databaseId) => {
        if (ownedDatabaseIds.has(databaseId)) return false;
        ownedDatabaseIds.add(databaseId);
        return true;
      });

    if (newDatabaseIds.length > 0) {
      const itemDocuments = await selectDatabaseItemDocuments(
        db,
        newDatabaseIds,
        ownerEmail,
      );
      for (const item of itemDocuments) {
        if (!documentIds.has(item.documentId)) {
          documentIds.add(item.documentId);
          next.add(item.documentId);
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

async function deleteWhereIn<T>(
  items: T[],
  run: (batch: T[]) => Promise<unknown>,
) {
  for (const batch of chunks(items, DELETE_BATCH_SIZE)) {
    if (batch.length > 0) await run(batch);
  }
}

export async function deleteDocumentRecursive(
  db: ReturnType<typeof getDb>,
  id: string,
  ownerEmail: string,
): Promise<string[]> {
  const { documentIds, ownedDatabaseIds } =
    await collectDocumentSubtreeForDelete(db, id, ownerEmail);

  const propertyDefinitionIds: string[] = [];
  await deleteWhereIn(ownedDatabaseIds, async (databaseIdBatch) => {
    propertyDefinitionIds.push(
      ...(
        await db
          .select({ id: schema.documentPropertyDefinitions.id })
          .from(schema.documentPropertyDefinitions)
          .where(
            inArray(
              schema.documentPropertyDefinitions.databaseId,
              databaseIdBatch,
            ),
          )
      ).map((definition) => definition.id),
    );
  });

  const sourceIds: string[] = [];
  await deleteWhereIn(ownedDatabaseIds, async (databaseIdBatch) => {
    sourceIds.push(
      ...(
        await db
          .select({ id: schema.contentDatabaseSources.id })
          .from(schema.contentDatabaseSources)
          .where(
            inArray(schema.contentDatabaseSources.databaseId, databaseIdBatch),
          )
      ).map((source) => source.id),
    );
  });

  // Delete database membership/schema, sync links, versions, shares, then documents.
  await deleteWhereIn(sourceIds, async (sourceIdBatch) => {
    await db
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(
        inArray(
          schema.contentDatabaseBodyHydrationQueue.sourceId,
          sourceIdBatch,
        ),
      );
    await db
      .delete(schema.contentDatabaseSourceExecutions)
      .where(
        inArray(schema.contentDatabaseSourceExecutions.sourceId, sourceIdBatch),
      );
    await db
      .delete(schema.contentDatabaseSourceChangeReviews)
      .where(
        inArray(
          schema.contentDatabaseSourceChangeReviews.sourceId,
          sourceIdBatch,
        ),
      );
    await db
      .delete(schema.contentDatabaseSourceChangeSets)
      .where(
        inArray(schema.contentDatabaseSourceChangeSets.sourceId, sourceIdBatch),
      );
    await db
      .delete(schema.contentDatabaseSourceRows)
      .where(inArray(schema.contentDatabaseSourceRows.sourceId, sourceIdBatch));
    await db
      .delete(schema.contentDatabaseSourceFields)
      .where(
        inArray(schema.contentDatabaseSourceFields.sourceId, sourceIdBatch),
      );
  });

  await deleteWhereIn(propertyDefinitionIds, async (propertyIdBatch) => {
    await db
      .delete(schema.documentPropertyValues)
      .where(
        inArray(schema.documentPropertyValues.propertyId, propertyIdBatch),
      );
    await db
      .delete(schema.documentBlockFieldContents)
      .where(
        inArray(schema.documentBlockFieldContents.propertyId, propertyIdBatch),
      );
  });

  await deleteWhereIn(documentIds, async (documentIdBatch) => {
    await db
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(
        inArray(
          schema.contentDatabaseBodyHydrationQueue.documentId,
          documentIdBatch,
        ),
      );
    await db
      .delete(schema.documentPropertyValues)
      .where(
        and(
          inArray(schema.documentPropertyValues.documentId, documentIdBatch),
          eq(schema.documentPropertyValues.ownerEmail, ownerEmail),
        ),
      );
    await db
      .delete(schema.documentBlockFieldContents)
      .where(
        inArray(schema.documentBlockFieldContents.documentId, documentIdBatch),
      );
    await db
      .delete(schema.contentDatabaseItems)
      .where(inArray(schema.contentDatabaseItems.documentId, documentIdBatch));
  });

  await deleteWhereIn(ownedDatabaseIds, async (databaseIdBatch) => {
    await db
      .delete(schema.contentDatabaseItems)
      .where(inArray(schema.contentDatabaseItems.databaseId, databaseIdBatch));
    await db
      .delete(schema.contentDatabaseSources)
      .where(
        inArray(schema.contentDatabaseSources.databaseId, databaseIdBatch),
      );
    await db
      .delete(schema.documentPropertyDefinitions)
      .where(
        inArray(schema.documentPropertyDefinitions.databaseId, databaseIdBatch),
      );
    await db
      .delete(schema.contentDatabases)
      .where(inArray(schema.contentDatabases.id, databaseIdBatch));
  });

  await deleteWhereIn(documentIds, async (documentIdBatch) => {
    await db
      .delete(schema.documentSyncLinks)
      .where(
        and(
          inArray(schema.documentSyncLinks.documentId, documentIdBatch),
          eq(schema.documentSyncLinks.ownerEmail, ownerEmail),
        ),
      );
    await db
      .delete(schema.documentVersions)
      .where(
        and(
          inArray(schema.documentVersions.documentId, documentIdBatch),
          eq(schema.documentVersions.ownerEmail, ownerEmail),
        ),
      );
    await db
      .delete(schema.builderDocSidecars)
      .where(
        and(
          inArray(schema.builderDocSidecars.documentId, documentIdBatch),
          eq(schema.builderDocSidecars.ownerEmail, ownerEmail),
        ),
      );
    await db
      .delete(schema.documentComments)
      .where(
        and(
          inArray(schema.documentComments.documentId, documentIdBatch),
          eq(schema.documentComments.ownerEmail, ownerEmail),
        ),
      );
    await db
      .delete(schema.documentShares)
      .where(inArray(schema.documentShares.resourceId, documentIdBatch));
  });

  await deleteWhereIn(documentIds, async (documentIdBatch) => {
    await db
      .delete(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, documentIdBatch),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );
  });

  return documentIds;
}

export default defineAction({
  description: "Delete a document and all its children recursively.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
  }),
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    if ((await isContentLocalFileMode()) && isLocalDocumentId(id)) {
      const result = await deleteLocalFileDocument(id);
      await writeAppState("refresh-signal", { ts: Date.now() });
      return result;
    }

    const access = await assertAccess("document", id, "admin");
    const existing = access.resource;

    const db = getDb();
    const deleted = await deleteDocumentRecursive(
      db,
      id,
      existing.ownerEmail as string,
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { success: true, deleted: deleted.length };
  },
});
