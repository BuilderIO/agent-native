import {
  ActionContractError,
  defineAction,
  fail,
} from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";
import { deleteBlocksFieldIdentity } from "./_blocks-field-identity.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
} from "./_content-database-mutation-lock.js";
import { assertNotWorkspaceCatalogDocuments } from "./_content-space-catalog-guards.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { renumberDatabaseRows } from "./_database-row-batch.js";
import { lockDocumentsForLifecycle } from "./_document-lifecycle.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import { collectDocumentTrashScope } from "./_document-trash-scope.js";
import {
  assertTrashScopeToken,
  collectTrashRecoveryScope,
} from "./_trash-recovery-scope.js";
import {
  collectTrashDestinationAncestors,
  resolveTrashRestoreDestination,
} from "./_trash-restore-destination.js";

const DELETE_BATCH_SIZE = 90;

export class PermanentDeleteScopeChangedError extends Error {
  constructor() {
    super("Document deletion scope changed; retry deletion.");
  }
}

type PermanentDeleteScope = {
  documentIds: string[];
  ownedDatabaseIds: string[];
};

function hasSameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

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

async function selectDatabaseItemDocumentTrashState(
  db: ReturnType<typeof getDb>,
  databaseIds: string[],
  ownerEmail: string,
) {
  const itemDocuments = await selectDatabaseItemDocuments(
    db,
    databaseIds,
    ownerEmail,
  );
  const rows: Array<{
    id: string;
    trashedAt: string | null;
  }> = [];
  for (const batch of chunks(
    itemDocuments.map((item) => item.documentId),
    DELETE_BATCH_SIZE,
  )) {
    rows.push(
      ...(await db
        .select({
          id: schema.documents.id,
          trashedAt: schema.documents.trashedAt,
        })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, batch),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )),
    );
  }
  return rows;
}

async function selectMembershipsForDocuments(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
) {
  const rows: Array<{ id: string; databaseId: string }> = [];
  for (const batch of chunks(documentIds, DELETE_BATCH_SIZE)) {
    rows.push(
      ...(await db
        .select({
          id: schema.contentDatabaseItems.id,
          databaseId: schema.contentDatabaseItems.databaseId,
        })
        .from(schema.contentDatabaseItems)
        .where(inArray(schema.contentDatabaseItems.documentId, batch))),
    );
  }
  return rows;
}

async function selectMembershipIdsForDatabases(
  db: ReturnType<typeof getDb>,
  databaseIds: string[],
) {
  const rows: Array<{ id: string }> = [];
  for (const batch of chunks(databaseIds, DELETE_BATCH_SIZE)) {
    rows.push(
      ...(await db
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(inArray(schema.contentDatabaseItems.databaseId, batch))),
    );
  }
  return rows.map((row) => row.id);
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

async function lockPermanentDeleteScope(
  db: ReturnType<typeof getDb>,
  collectScope: () => Promise<PermanentDeleteScope>,
) {
  const initialScope = await collectScope();
  const initialMemberships = await selectMembershipsForDocuments(
    db,
    initialScope.documentIds,
  );
  const lockedDatabaseIds = [
    ...new Set([
      ...initialScope.ownedDatabaseIds,
      ...initialMemberships.map((membership) => membership.databaseId),
    ]),
  ].sort();
  for (const databaseId of lockedDatabaseIds) {
    await lockContentDatabaseMutation(db, databaseId);
  }

  const reloadedScope = await collectScope();
  const reloadedMemberships = await selectMembershipsForDocuments(
    db,
    reloadedScope.documentIds,
  );
  const lockedDatabaseIdSet = new Set(lockedDatabaseIds);
  const uncoveredDatabaseId = [
    ...reloadedScope.ownedDatabaseIds,
    ...reloadedMemberships.map((membership) => membership.databaseId),
  ].find((databaseId) => !lockedDatabaseIdSet.has(databaseId));
  if (uncoveredDatabaseId) {
    throw new PermanentDeleteScopeChangedError();
  }

  const membershipIds = await selectMembershipIdsForDatabases(
    db,
    lockedDatabaseIds,
  );
  await lockDatabaseMemberships(db, membershipIds);

  const lockedScope = await collectScope();
  const lockedMemberships = await selectMembershipsForDocuments(
    db,
    lockedScope.documentIds,
  );
  const lockedMembershipIds = await selectMembershipIdsForDatabases(
    db,
    lockedDatabaseIds,
  );
  if (
    !hasSameIds(reloadedScope.documentIds, lockedScope.documentIds) ||
    !hasSameIds(reloadedScope.ownedDatabaseIds, lockedScope.ownedDatabaseIds) ||
    !hasSameIds(membershipIds, lockedMembershipIds) ||
    [
      ...lockedScope.ownedDatabaseIds,
      ...lockedMemberships.map((membership) => membership.databaseId),
    ].some((databaseId) => !lockedDatabaseIdSet.has(databaseId))
  ) {
    throw new PermanentDeleteScopeChangedError();
  }
  return lockedScope;
}

export async function lockDatabasesForTrash(
  db: ReturnType<typeof getDb>,
  id: string,
  ownerEmail: string,
) {
  const subtree = await collectDocumentTrashScope(db, id, ownerEmail);
  const memberships = await selectMembershipsForDocuments(
    db,
    subtree.documentIds,
  );
  const databaseIds = [
    ...new Set([
      ...memberships.map((membership) => membership.databaseId),
      ...subtree.ownedDatabaseIds,
    ]),
  ].sort();
  for (const databaseId of databaseIds) {
    await lockContentDatabaseMutation(db, databaseId);
  }
  return new Set(databaseIds);
}

export async function trashDocumentSubtree(
  db: ReturnType<typeof getDb>,
  id: string,
  ownerEmail: string,
  trashedAt = new Date().toISOString(),
  lockedDatabaseIds?: ReadonlySet<string>,
  origin?: string,
): Promise<string[]> {
  lockedDatabaseIds ??= await lockDatabasesForTrash(db, id, ownerEmail);
  const { documentIds, ownedDatabaseIds } = await collectDocumentTrashScope(
    db,
    id,
    ownerEmail,
  );
  if (lockedDatabaseIds) {
    const memberships = await selectMembershipsForDocuments(db, documentIds);
    const unlockedDatabaseId = [
      ...new Set([
        ...ownedDatabaseIds,
        ...memberships.map((membership) => membership.databaseId),
      ]),
    ].find((databaseId) => !lockedDatabaseIds.has(databaseId));
    if (unlockedDatabaseId) {
      throw new Error("Document subtree changed; retry deletion.");
    }
  }
  const scopeMemberships = await selectMembershipsForDocuments(db, documentIds);
  await lockDatabaseMemberships(
    db,
    scopeMemberships.map((membership) => membership.id),
  );
  await lockDocumentsForLifecycle(db, documentIds);
  const lockedScope = await collectDocumentTrashScope(db, id, ownerEmail);
  if (
    !hasSameIds(documentIds, lockedScope.documentIds) ||
    !hasSameIds(ownedDatabaseIds, lockedScope.ownedDatabaseIds)
  ) {
    throw new ActionContractError(
      "The page hierarchy changed. Retry moving it to Trash.",
      { errorCode: "DOCUMENT_TRASH_SCOPE_CHANGED" },
    );
  }
  await assertNotWorkspaceCatalogDocuments(db, documentIds, "deleted");

  const independentlyTrashedDatabaseDocumentIds = new Set<string>();
  for (const batch of chunks(documentIds, DELETE_BATCH_SIZE)) {
    for (const database of await db
      .select({ documentId: schema.contentDatabases.documentId })
      .from(schema.contentDatabases)
      .where(
        and(
          inArray(schema.contentDatabases.documentId, batch),
          eq(schema.contentDatabases.ownerEmail, ownerEmail),
          isNotNull(schema.contentDatabases.deletedAt),
        ),
      )) {
      independentlyTrashedDatabaseDocumentIds.add(database.documentId);
    }
  }

  const activeDocumentIds: string[] = [];
  for (const batch of chunks(documentIds, DELETE_BATCH_SIZE)) {
    activeDocumentIds.push(
      ...(
        await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(
              inArray(schema.documents.id, batch),
              eq(schema.documents.ownerEmail, ownerEmail),
              isNull(schema.documents.trashedAt),
            ),
          )
      )
        .map((document) => document.id)
        .filter(
          (documentId) =>
            !independentlyTrashedDatabaseDocumentIds.has(documentId),
        ),
    );
  }

  await assertDocumentMutationAccess(db, activeDocumentIds, "admin");
  const activeMemberships = await selectMembershipsForDocuments(
    db,
    activeDocumentIds,
  );
  const transitioningOwnedDatabases: Array<{ id: string }> = [];
  for (const batch of chunks(activeDocumentIds, DELETE_BATCH_SIZE)) {
    transitioningOwnedDatabases.push(
      ...(await db
        .select({ id: schema.contentDatabases.id })
        .from(schema.contentDatabases)
        .where(
          and(
            inArray(schema.contentDatabases.documentId, batch),
            eq(schema.contentDatabases.ownerEmail, ownerEmail),
            isNull(schema.contentDatabases.deletedAt),
          ),
        )),
    );
  }
  const transitioningOwnedDatabaseIds = new Set(
    transitioningOwnedDatabases.map((database) => database.id),
  );
  const externalDatabaseIds = [
    ...new Set(
      activeMemberships
        .map((membership) => membership.databaseId)
        .filter((databaseId) => !transitioningOwnedDatabaseIds.has(databaseId)),
    ),
  ].sort();
  for (const databaseId of externalDatabaseIds) {
    await touchContentDatabase(db, databaseId, trashedAt);
  }

  for (const batch of chunks(activeDocumentIds, DELETE_BATCH_SIZE)) {
    await db
      .update(schema.documents)
      .set({
        trashedAt,
        trashRootId: id,
        updatedAt: trashedAt,
        trashedBy: getRequestUserEmail() ?? null,
        trashOrigin: origin ?? null,
        trashParentId: sql`${schema.documents.parentId}`,
      })
      .where(
        and(
          inArray(schema.documents.id, batch),
          eq(schema.documents.ownerEmail, ownerEmail),
          isNull(schema.documents.trashedAt),
        ),
      );
    await db
      .update(schema.contentDatabases)
      .set({ deletedAt: trashedAt, updatedAt: trashedAt })
      .where(
        and(
          inArray(schema.contentDatabases.documentId, batch),
          eq(schema.contentDatabases.ownerEmail, ownerEmail),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
  }

  return activeDocumentIds;
}

export async function restoreDocumentSubtree(
  db: ReturnType<typeof getDb>,
  rootId: string,
  ownerEmail: string,
  options: { destinationParentId?: string | null; scopeToken?: string } = {},
): Promise<string[]> {
  const [existing] = await db
    .select({ trashedAt: schema.documents.trashedAt })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, rootId),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    )
    .limit(1);
  if (!existing?.trashedAt) return [];
  const initial = await collectTrashRecoveryScope(db, rootId, "restore");
  assertTrashScopeToken(initial.token, options.scopeToken);
  const initialMemberships = await selectMembershipsForDocuments(
    db,
    initial.documentIds,
  );
  const databaseLocks = [
    ...new Set([
      ...initial.ownedDatabaseIds,
      ...initialMemberships.map((item) => item.databaseId),
    ]),
  ].sort();
  for (const databaseId of databaseLocks)
    await lockContentDatabaseMutation(db, databaseId);
  const membershipIds = await selectMembershipIdsForDatabases(
    db,
    databaseLocks,
  );
  await lockDatabaseMemberships(db, membershipIds);
  const destinationId =
    options.destinationParentId === undefined
      ? initial.root.parentId
      : options.destinationParentId;
  const destinationAncestors = await collectTrashDestinationAncestors(
    db,
    destinationId,
    initial.documentIds,
  );
  await lockDocumentsForLifecycle(db, [
    ...initial.documentIds,
    ...initial.hostDocumentIds,
    ...destinationAncestors,
  ]);
  await assertDocumentMutationAccess(db, initial.adminDocumentIds, "admin");
  await assertDocumentMutationAccess(db, initial.viewerDocumentIds, "viewer");
  await assertDocumentMutationAccess(db, initial.hostDocumentIds, "editor");
  const scope = await collectTrashRecoveryScope(db, rootId, "restore");
  assertTrashScopeToken(scope.token, initial.token);
  if (
    !hasSameIds(
      destinationAncestors,
      await collectTrashDestinationAncestors(
        db,
        destinationId,
        scope.documentIds,
      ),
    )
  ) {
    fail("The destination hierarchy changed. Review it again.", {
      errorCode: "TRASH_SCOPE_CONFLICT",
      statusCode: 409,
    });
  }
  const memberships = await selectMembershipsForDocuments(
    db,
    scope.documentIds,
  );
  if (
    memberships.some((item) => !databaseLocks.includes(item.databaseId)) ||
    !hasSameIds(
      membershipIds,
      await selectMembershipIdsForDatabases(db, databaseLocks),
    )
  ) {
    fail("The Trash selection changed. Review it again.", {
      errorCode: "TRASH_SCOPE_CONFLICT",
      statusCode: 409,
    });
  }
  const parentId = await resolveTrashRestoreDestination(
    db,
    scope,
    options.destinationParentId,
  );
  if (scope.requiresOriginalDestination && parentId !== scope.root.parentId) {
    fail("Restoring this inline Database requires its original location.", {
      errorCode: "TRASH_DESTINATION_ACCESS_DENIED",
      statusCode: 403,
    });
  }
  if (parentId)
    await assertDocumentMutationAccess(
      db,
      [parentId],
      options.destinationParentId === undefined ? "viewer" : "editor",
    );
  const documentIds = scope.documentIds;
  const now = new Date().toISOString();
  if (parentId !== scope.root.parentId) {
    await db
      .update(schema.documents)
      .set({ parentId })
      .where(eq(schema.documents.id, rootId));
    await db
      .update(schema.contentDatabases)
      .set({ ownerDocumentId: null, ownerBlockId: null })
      .where(eq(schema.contentDatabases.documentId, rootId));
  }
  for (const batch of chunks(documentIds, DELETE_BATCH_SIZE)) {
    await db
      .update(schema.documents)
      .set({ trashedAt: null, trashRootId: null, updatedAt: now })
      .where(
        and(
          inArray(schema.documents.id, batch),
          eq(schema.documents.ownerEmail, ownerEmail),
          eq(schema.documents.trashRootId, scope.root.trashRootId!),
        ),
      );
    await db
      .update(schema.contentDatabases)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          inArray(schema.contentDatabases.documentId, batch),
          eq(schema.contentDatabases.ownerEmail, ownerEmail),
        ),
      );
  }
  const databaseIds = [
    ...new Set(
      (
        await db
          .select({ databaseId: schema.contentDatabaseItems.databaseId })
          .from(schema.contentDatabaseItems)
          .where(inArray(schema.contentDatabaseItems.documentId, documentIds))
      ).map((item) => item.databaseId),
    ),
  ];
  for (const databaseId of databaseIds) {
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      )
      .limit(1);
    if (database) await renumberDatabaseRows(db, database, now);
  }

  return documentIds;
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
  return db.transaction((tx) =>
    deleteDocumentRootsRecursive(
      tx as unknown as ReturnType<typeof getDb>,
      [id],
      ownerEmail,
    ),
  );
}

export async function deleteDocumentRootsRecursive(
  db: ReturnType<typeof getDb>,
  rootIds: string[],
  ownerEmail: string,
): Promise<string[]> {
  const collectScope = async () => {
    const documentIds = new Set<string>();
    const ownedDatabaseIds = new Set<string>();
    for (const rootId of rootIds) {
      const scope = await collectDocumentSubtreeForDelete(
        db,
        rootId,
        ownerEmail,
      );
      for (const documentId of scope.documentIds) documentIds.add(documentId);
      for (const databaseId of scope.ownedDatabaseIds) {
        ownedDatabaseIds.add(databaseId);
      }
    }
    return {
      documentIds: [...documentIds],
      ownedDatabaseIds: [...ownedDatabaseIds],
    };
  };
  const { documentIds, ownedDatabaseIds } = await lockPermanentDeleteScope(
    db,
    collectScope,
  );
  return deleteCollectedDocuments(
    db,
    documentIds,
    ownedDatabaseIds,
    ownerEmail,
  );
}

async function deleteCollectedDocuments(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  ownedDatabaseIds: string[],
  ownerEmail: string,
): Promise<string[]> {
  await assertNotWorkspaceCatalogDocuments(db, documentIds, "deleted");

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
    await deleteBlocksFieldIdentity({ db, propertyIds: propertyIdBatch });
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

  await deleteWhereIn(ownedDatabaseIds, async (databaseIdBatch) => {
    await db
      .delete(schema.contentDatabaseItemKeyClaims)
      .where(
        inArray(
          schema.contentDatabaseItemKeyClaims.databaseId,
          databaseIdBatch,
        ),
      );
  });

  await deleteWhereIn(documentIds, async (documentIdBatch) => {
    await db
      .delete(schema.contentDatabaseItemKeyClaims)
      .where(
        inArray(
          schema.contentDatabaseItemKeyClaims.documentId,
          documentIdBatch,
        ),
      );
  });

  await deleteWhereIn(documentIds, async (documentIdBatch) => {
    await deleteBlocksFieldIdentity({ db, documentIds: documentIdBatch });
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
    // Receipts deliberately have no database foreign key. Removing them after
    // the database row closes the race with a migration that already holds the
    // row lock and commits its receipt before this deletion can continue.
    await db
      .delete(schema.contentDatabaseMigrationReceipts)
      .where(
        inArray(
          schema.contentDatabaseMigrationReceipts.databaseId,
          databaseIdBatch,
        ),
      );
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

export async function deleteTrashedDocumentSubtree(
  db: ReturnType<typeof getDb>,
  id: string,
  ownerEmail: string,
  scopeToken?: string,
): Promise<string[]> {
  const collectScope = async () => {
    const scope = await collectTrashRecoveryScope(db, id);
    assertTrashScopeToken(scope.token, scopeToken);
    const documentIds = scope.documentIds;
    const ownedDatabaseIds = await selectOwnedDatabaseIds(
      db,
      documentIds,
      ownerEmail,
    ).then((rows) => rows.map((database) => database.id));
    const documentIdSet = new Set(documentIds);
    const activeOutsideScope = (
      await selectDatabaseItemDocumentTrashState(
        db,
        ownedDatabaseIds,
        ownerEmail,
      )
    ).find(
      (document) => !documentIdSet.has(document.id) && !document.trashedAt,
    );
    if (activeOutsideScope) {
      throw new Error(
        "Database contains an active row outside this Trash item",
      );
    }
    return { documentIds, ownedDatabaseIds, root: scope.root };
  };

  const initial = await collectScope();
  const collectSurvivors = async (selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const children = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        ownerEmail: schema.documents.ownerEmail,
        spaceId: schema.documents.spaceId,
        orgId: schema.documents.orgId,
        sourceMode: schema.documents.sourceMode,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.parentId, selectedIds));
    return children
      .filter((child) => !selected.has(child.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  };
  const initialSurvivors = await collectSurvivors(initial.documentIds);
  const { documentIds, ownedDatabaseIds } = await lockPermanentDeleteScope(
    db,
    collectScope,
  );

  await lockDocumentsForLifecycle(db, [
    ...documentIds,
    ...initialSurvivors.map((child) => child.id),
  ]);
  await assertDocumentMutationAccess(db, documentIds, "admin");
  const finalScope = await collectScope();
  if (
    !hasSameIds(finalScope.documentIds, documentIds) ||
    !hasSameIds(finalScope.ownedDatabaseIds, ownedDatabaseIds)
  ) {
    fail("The Trash selection changed. Review it again.", {
      errorCode: "TRASH_SCOPE_CONFLICT",
      statusCode: 409,
    });
  }
  const survivors = await collectSurvivors(documentIds);
  if (JSON.stringify(survivors) !== JSON.stringify(initialSurvivors)) {
    fail("Pages outside the Trash selection changed. Review it again.", {
      errorCode: "TRASH_SCOPE_CONFLICT",
      statusCode: 409,
    });
  }
  if (
    survivors.some(
      (child) =>
        child.ownerEmail !== ownerEmail ||
        child.spaceId !== finalScope.root.spaceId ||
        child.orgId !== finalScope.root.orgId,
    )
  ) {
    fail("A surviving child crosses an ownership or space boundary.", {
      errorCode: "TRASH_SCOPE_CONFLICT",
      statusCode: 409,
    });
  }
  if (survivors.length > 0) {
    const survivorIds = survivors.map((child) => child.id);
    await assertDocumentMutationAccess(db, survivorIds, "editor");
    await assertNotWorkspaceCatalogDocuments(db, survivorIds, "moved");
    const survivorDatabases = await db
      .select({
        ownerDocumentId: schema.contentDatabases.ownerDocumentId,
        ownerBlockId: schema.contentDatabases.ownerBlockId,
      })
      .from(schema.contentDatabases)
      .where(inArray(schema.contentDatabases.documentId, survivorIds));
    if (
      survivors.some((child) => child.sourceMode === "local-files") ||
      survivorDatabases.some(
        (database) =>
          database.ownerDocumentId !== null || database.ownerBlockId !== null,
      )
    ) {
      fail(
        "A source-backed or inline database child must be relocated before permanent deletion.",
        {
          errorCode: "TRASH_SURVIVOR_DESTINATION_CONFLICT",
          statusCode: 409,
        },
      );
    }
    await db
      .update(schema.documents)
      .set({ parentId: null, updatedAt: new Date().toISOString() })
      .where(inArray(schema.documents.id, survivorIds));
  }

  return deleteCollectedDocuments(
    db,
    documentIds,
    ownedDatabaseIds,
    ownerEmail,
  );
}

export async function accessibleAffectedDatabaseIds(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
) {
  if (documentIds.length === 0) return [];
  const candidates = new Set<string>();
  for (const batch of chunks(documentIds, DELETE_BATCH_SIZE)) {
    for (const membership of await selectMembershipsForDocuments(db, batch))
      candidates.add(membership.databaseId);
    for (const database of await db
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(inArray(schema.contentDatabases.documentId, batch)))
      candidates.add(database.id);
  }
  const visibleIds: string[] = [];
  for (const batch of chunks([...candidates], DELETE_BATCH_SIZE)) {
    const rows = await db
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabases.documentId),
      )
      .where(
        and(
          inArray(schema.contentDatabases.id, batch),
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            "viewer",
            { includePublic: true },
          ),
        ),
      );
    visibleIds.push(...rows.map((row) => row.id));
  }
  return visibleIds;
}

export default defineAction({
  description:
    "Move a canonical page and its true child pages to Trash everywhere, preserving database memberships and references. Unpin with update-document isFavorite:false; remove memberships with remove-database-items. Use trash-documents for selected pages and permanently-delete-document only for irreversible removal from Trash.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    databaseDocumentId: z
      .string()
      .optional()
      .describe("Database page the deletion was initiated from"),
  }),
  run: async (args, ctx) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    const db = getDb();
    if (args.databaseDocumentId) {
      const [contextDatabase] = await db
        .select()
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.documentId, args.databaseDocumentId),
            eq(schema.contentDatabases.systemRole, "favorites"),
          ),
        );
      if (contextDatabase) {
        throw new ActionContractError(
          "Use update-document with isFavorite:false to unpin, or omit databaseDocumentId to move the page to Trash.",
          { errorCode: "DOCUMENT_DELETE_INTENT_REQUIRED" },
        );
      }
    }

    const access = await assertAccess("document", id, "admin");
    const existing = access.resource;
    const [systemDatabase] = await db
      .select({ systemRole: schema.contentDatabases.systemRole })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, id));
    if (systemDatabase?.systemRole) {
      throw new Error("System Content database documents cannot be deleted");
    }
    return db.transaction(async (tx) => {
      const transactionDb = tx as unknown as ReturnType<typeof getDb>;
      const lockedDatabaseIds = await lockDatabasesForTrash(
        transactionDb,
        id,
        existing.ownerEmail as string,
      );
      const deleted = await trashDocumentSubtree(
        transactionDb,
        id,
        existing.ownerEmail as string,
        undefined,
        lockedDatabaseIds,
        ctx?.caller,
      );
      return {
        success: true,
        deleted: deleted.length,
        affectedDocumentIds: deleted,
        affectedDatabaseIds: await accessibleAffectedDatabaseIds(
          transactionDb,
          deleted,
        ),
      };
    });
  },
});
