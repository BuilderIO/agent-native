import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  PrivateVaultMigrationError,
  hashPrivateVaultMigrationSource,
  type PrivateVaultMigrationScope,
  type PrivateVaultMigrationSource,
  type PrivateVaultMigrationSourceDocument,
} from "./private-vault-migration.js";

type DocumentRow = typeof schema.documents.$inferSelect;

function sourceFromRow(row: DocumentRow): PrivateVaultMigrationSourceDocument {
  return {
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    content: row.content,
    description: row.description,
    icon: row.icon,
    position: row.position,
    isFavorite: row.isFavorite === 1,
    hideFromSearch: row.hideFromSearch === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sourceScope(scope: PrivateVaultMigrationScope) {
  return and(
    eq(schema.documents.ownerEmail, scope.ownerEmail),
    eq(schema.documents.orgId, scope.orgId),
    eq(schema.documents.visibility, "private"),
  );
}

async function hasUnsupportedRows(
  scope: PrivateVaultMigrationScope,
  sourceDocumentIds: readonly string[],
  requireClosedSubtree = true,
): Promise<boolean> {
  const db = getDb();
  const one = { id: schema.documents.id };
  const checks = await Promise.all([
    db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.ownerEmail, scope.ownerEmail),
          inArray(schema.documentVersions.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentMedia.id })
      .from(schema.documentMedia)
      .where(
        and(
          eq(schema.documentMedia.ownerEmail, scope.ownerEmail),
          eq(schema.documentMedia.orgId, scope.orgId),
          inArray(schema.documentMedia.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentPreviewDrafts.id })
      .from(schema.documentPreviewDrafts)
      .where(
        and(
          eq(schema.documentPreviewDrafts.ownerEmail, scope.ownerEmail),
          eq(schema.documentPreviewDrafts.orgId, scope.orgId),
          inArray(schema.documentPreviewDrafts.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentComments.id })
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.ownerEmail, scope.ownerEmail),
          inArray(schema.documentComments.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentSyncLinks.documentId })
      .from(schema.documentSyncLinks)
      .where(
        and(
          eq(schema.documentSyncLinks.ownerEmail, scope.ownerEmail),
          inArray(schema.documentSyncLinks.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.builderDocSidecars.id })
      .from(schema.builderDocSidecars)
      .where(
        and(
          eq(schema.builderDocSidecars.ownerEmail, scope.ownerEmail),
          eq(schema.builderDocSidecars.orgId, scope.orgId),
          inArray(schema.builderDocSidecars.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.ownerEmail, scope.ownerEmail),
          eq(schema.contentDatabases.orgId, scope.orgId),
          or(
            inArray(schema.contentDatabases.documentId, sourceDocumentIds),
            inArray(schema.contentDatabases.ownerDocumentId, sourceDocumentIds),
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.ownerEmail, scope.ownerEmail),
          eq(schema.contentDatabaseItems.orgId, scope.orgId),
          inArray(schema.contentDatabaseItems.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
      .from(schema.contentDatabaseBodyHydrationQueue)
      .where(
        and(
          eq(
            schema.contentDatabaseBodyHydrationQueue.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentDatabaseBodyHydrationQueue.orgId, scope.orgId),
          inArray(
            schema.contentDatabaseBodyHydrationQueue.documentId,
            sourceDocumentIds,
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.contentDatabaseSourceRows.id })
      .from(schema.contentDatabaseSourceRows)
      .where(
        and(
          eq(schema.contentDatabaseSourceRows.ownerEmail, scope.ownerEmail),
          inArray(
            schema.contentDatabaseSourceRows.documentId,
            sourceDocumentIds,
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.contentDatabaseSourceChangeSets.id })
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(
            schema.contentDatabaseSourceChangeSets.ownerEmail,
            scope.ownerEmail,
          ),
          inArray(
            schema.contentDatabaseSourceChangeSets.documentId,
            sourceDocumentIds,
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentPropertyValues.id })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.ownerEmail, scope.ownerEmail),
          inArray(schema.documentPropertyValues.documentId, sourceDocumentIds),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentBlockFieldContents.id })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(schema.documentBlockFieldContents.ownerEmail, scope.ownerEmail),
          inArray(
            schema.documentBlockFieldContents.documentId,
            sourceDocumentIds,
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.documentShares.id })
      .from(schema.documentShares)
      .where(inArray(schema.documentShares.resourceId, sourceDocumentIds))
      .limit(1),
    db
      .select(one)
      .from(schema.documents)
      .where(
        and(
          sourceScope(scope),
          inArray(schema.documents.parentId, sourceDocumentIds),
        ),
      ),
  ]);
  const selected = new Set(sourceDocumentIds);
  const unselectedChild = checks[14].some((row) => !selected.has(row.id));
  return (
    checks.slice(0, 14).some((rows) => rows.length > 0) ||
    (requireClosedSubtree && unselectedChild)
  );
}

async function readFrozenSources(
  scope: PrivateVaultMigrationScope,
  sourceDocumentIds: readonly string[],
  allowAllMissing = false,
) {
  const rows = await getDb()
    .select()
    .from(schema.documents)
    .where(
      and(sourceScope(scope), inArray(schema.documents.id, sourceDocumentIds)),
    );
  if (allowAllMissing && rows.length === 0) return [];
  if (
    rows.length !== sourceDocumentIds.length ||
    rows.some(
      (row) =>
        row.sourceMode !== null ||
        row.sourceKind !== null ||
        row.sourcePath !== null ||
        row.sourceRootPath !== null,
    ) ||
    (await hasUnsupportedRows(scope, sourceDocumentIds))
  )
    throw new PrivateVaultMigrationError();
  return rows.map(sourceFromRow);
}

export const sqlPrivateVaultMigrationSource: PrivateVaultMigrationSource = {
  async listCandidateIds(scope) {
    const rows = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          sourceScope(scope),
          isNull(schema.documents.sourceMode),
          isNull(schema.documents.sourceKind),
          isNull(schema.documents.sourcePath),
          isNull(schema.documents.sourceRootPath),
        ),
      );
    return rows
      .map((row) => row.id)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  },

  freeze: readFrozenSources,

  async read(scope, sourceDocumentId) {
    const [row] = await getDb()
      .select()
      .from(schema.documents)
      .where(and(sourceScope(scope), eq(schema.documents.id, sourceDocumentId)))
      .limit(1);
    if (
      !row ||
      row.sourceMode !== null ||
      row.sourceKind !== null ||
      row.sourcePath !== null ||
      row.sourceRootPath !== null ||
      (await hasUnsupportedRows(scope, [sourceDocumentId], false))
    )
      return null;
    return sourceFromRow(row);
  },

  async cleanup(scope, sources) {
    const sourceDocumentIds = [
      ...new Set(sources.map((item) => item.sourceDocumentId)),
    ];
    if (sourceDocumentIds.length !== sources.length)
      throw new PrivateVaultMigrationError();
    const frozen = await readFrozenSources(scope, sourceDocumentIds, true);
    const expected = new Map(
      sources.map((source) => [source.sourceDocumentId, source.sourceDigest]),
    );
    if (
      (frozen.length !== 0 && frozen.length !== sources.length) ||
      frozen.some(
        (source) =>
          hashPrivateVaultMigrationSource(source) !== expected.get(source.id),
      )
    )
      throw new PrivateVaultMigrationError();
    // A retry after the delete committed but before the ledger transition is
    // complete. Treat only the all-gone case as idempotent; partial absence is
    // ambiguous and remains fail-closed.
    if (frozen.length === 0) return;
    await getDb().transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.documents)
        .where(
          and(
            eq(schema.documents.ownerEmail, scope.ownerEmail),
            eq(schema.documents.orgId, scope.orgId),
            eq(schema.documents.visibility, "private"),
            inArray(schema.documents.id, sourceDocumentIds),
          ),
        )
        .returning({ id: schema.documents.id });
      if (deleted.length !== sourceDocumentIds.length)
        throw new PrivateVaultMigrationError();
    });
  },
};
