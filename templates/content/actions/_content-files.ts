import { createHash } from "node:crypto";

import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";
import {
  organizationContentSpaceId,
  personalContentSpaceId,
} from "./_content-spaces.js";

type Db = any;

export type ContentFilesReconciliation = {
  assignedSpaces: number;
  insertedMemberships: number;
  removedMemberships: number;
  documents: number;
};

export function contentFilesItemId(databaseId: string, documentId: string) {
  return `content_database_item_${createHash("sha256")
    .update(`${databaseId}:${documentId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

async function remapItemReferences(db: Db, replacements: Map<string, string>) {
  if (!replacements.size) return;
  const duplicateIds = [...replacements.keys()];
  const remap = (column: any) => {
    let expression = sql`CASE ${column}`;
    for (const [duplicateId, canonicalId] of replacements)
      expression = sql`${expression} WHEN ${duplicateId} THEN ${canonicalId}`;
    return sql`${expression} ELSE ${column} END`;
  };
  for (const table of [
    schema.contentSpaceCatalogItems,
    schema.contentDatabaseBodyHydrationQueue,
    schema.contentDatabaseSourceRows,
    schema.contentDatabaseSourceChangeSets,
  ]) {
    await db
      .update(table)
      .set({ databaseItemId: remap(table.databaseItemId) })
      .where(inArray(table.databaseItemId, duplicateIds));
  }
}

async function reconcileDocuments(args: {
  db: Db;
  documents: Array<typeof schema.documents.$inferSelect>;
  filesDatabases: Array<typeof schema.contentDatabases.$inferSelect>;
  now: string;
}) {
  const filesBySpace = new Map(
    args.filesDatabases.map((database) => [database.spaceId, database]),
  );
  const filesDatabaseIds = args.filesDatabases.map((database) => database.id);
  const filesBackingDocumentIds = new Set(
    args.filesDatabases.map((database) => database.documentId),
  );
  const existingItems = filesDatabaseIds.length
    ? await args.db
        .select()
        .from(schema.contentDatabaseItems)
        .where(
          inArray(schema.contentDatabaseItems.databaseId, filesDatabaseIds),
        )
    : [];
  const itemsByDocument = new Map<
    string,
    Array<typeof schema.contentDatabaseItems.$inferSelect>
  >();
  const nextPosition = new Map<string, number>();
  for (const item of existingItems) {
    const documentItems = itemsByDocument.get(item.documentId) ?? [];
    documentItems.push(item);
    itemsByDocument.set(item.documentId, documentItems);
    nextPosition.set(
      item.databaseId,
      Math.max(nextPosition.get(item.databaseId) ?? 0, item.position + 1),
    );
  }

  const deleteIds = new Set<string>();
  const replacements = new Map<string, string>();
  const inserts: Array<typeof schema.contentDatabaseItems.$inferInsert> = [];
  for (const document of args.documents) {
    const existing = itemsByDocument.get(document.id) ?? [];
    if (filesBackingDocumentIds.has(document.id)) {
      for (const item of existing) deleteIds.add(item.id);
      continue;
    }
    const canonicalDatabase = filesBySpace.get(document.spaceId);
    if (!canonicalDatabase) {
      throw new Error(
        `Content space for document "${document.id}" has no Files database`,
      );
    }
    const canonicalItems = existing
      .filter((item) => item.databaseId === canonicalDatabase.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    const canonicalItemId =
      canonicalItems[0]?.id ??
      contentFilesItemId(canonicalDatabase.id, document.id);
    for (const item of existing) {
      if (item.databaseId !== canonicalDatabase.id) {
        deleteIds.add(item.id);
        replacements.set(item.id, canonicalItemId);
      }
    }
    for (const duplicate of canonicalItems.slice(1)) {
      deleteIds.add(duplicate.id);
      replacements.set(duplicate.id, canonicalItemId);
    }
    if (canonicalItems.length === 0) {
      const position = nextPosition.get(canonicalDatabase.id) ?? 0;
      nextPosition.set(canonicalDatabase.id, position + 1);
      inserts.push({
        id: contentFilesItemId(canonicalDatabase.id, document.id),
        ownerEmail: document.ownerEmail,
        orgId: document.orgId,
        databaseId: canonicalDatabase.id,
        documentId: document.id,
        position,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
  }
  await remapItemReferences(args.db, replacements);
  if (deleteIds.size) {
    await args.db
      .delete(schema.contentDatabaseItems)
      .where(inArray(schema.contentDatabaseItems.id, [...deleteIds]));
  }
  if (inserts.length) {
    await args.db
      .insert(schema.contentDatabaseItems)
      .values(inserts)
      .onConflictDoNothing();
  }
  return { inserted: inserts.length, removed: deleteIds.size };
}

export async function ensureDocumentFilesMembership(
  db: Db,
  documentId: string,
  now = new Date().toISOString(),
  accessContext?: { userEmail?: string; orgId?: string },
) {
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        accessFilter(schema.documents, schema.documentShares, accessContext),
      ),
    );
  if (!document) throw new Error(`Document "${documentId}" not found`);
  if (!document.spaceId)
    throw new Error(`Document "${documentId}" does not have a Content space`);
  const filesDatabases = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.systemRole, "files"),
        eq(schema.contentDatabases.spaceId, document.spaceId),
      ),
    );
  return reconcileDocuments({ db, documents: [document], filesDatabases, now });
}

export async function ensureDocumentsFilesMembership(
  db: Db,
  documentIds: string[],
  now = new Date().toISOString(),
  ownerEmail?: string,
) {
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return { inserted: 0, removed: 0 };
  const documents = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, ids),
        ownerEmail
          ? or(
              eq(schema.documents.ownerEmail, ownerEmail),
              accessFilter(schema.documents, schema.documentShares),
            )
          : accessFilter(schema.documents, schema.documentShares),
      ),
    );
  if (documents.length !== ids.length) {
    const found = new Set(documents.map((document: any) => document.id));
    const missing = ids.filter((id) => !found.has(id));
    throw new Error(`Documents not found: ${missing.join(", ")}`);
  }
  for (const document of documents) {
    if (!document.spaceId) {
      throw new Error(
        `Document "${document.id}" does not have a Content space`,
      );
    }
  }
  const spaceIds: string[] = Array.from(
    new Set<string>(documents.map((document: any) => String(document.spaceId))),
  );
  const filesDatabases = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.systemRole, "files"),
        or(
          ...spaceIds.map((spaceId) =>
            eq(schema.contentDatabases.spaceId, spaceId),
          ),
        ),
      ),
    );
  return reconcileDocuments({ db, documents, filesDatabases, now });
}

export async function reconcileContentFilesMemberships(
  db: Db,
  userEmail: string,
): Promise<ContentFilesReconciliation> {
  const email = normalizeContentSpaceEmail(userEmail);
  const memberships = await listContentOrganizationMemberships(email);
  const personalSpaceId = personalContentSpaceId(email);
  const orgSpaces = new Map<
    string,
    { spaceId: string; canReconcilePrivateDocuments: boolean }
  >();
  for (const membership of memberships) {
    const spaceId = organizationContentSpaceId(membership.orgId);
    await resolveContentSpaceAccess(spaceId);
    orgSpaces.set(membership.orgId, {
      spaceId,
      canReconcilePrivateDocuments:
        membership.role === "owner" || membership.role === "admin",
    });
  }
  const accessibleSpaceIds = [
    personalSpaceId,
    ...[...orgSpaces.values()].map(({ spaceId }) => spaceId),
  ];
  const now = new Date().toISOString();
  const result: ContentFilesReconciliation = {
    assignedSpaces: 0,
    insertedMemberships: 0,
    removedMemberships: 0,
    documents: 0,
  };

  await db.transaction(async (tx: Db) => {
    const personalLegacyDocuments = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, email),
          isNull(schema.documents.orgId),
          isNull(schema.documents.spaceId),
        ),
      );
    if (personalLegacyDocuments.length) {
      await tx
        .update(schema.documents)
        .set({ spaceId: personalSpaceId, updatedAt: now })
        .where(
          inArray(
            schema.documents.id,
            personalLegacyDocuments.map((row: any) => row.id),
          ),
        );
      result.assignedSpaces += personalLegacyDocuments.length;
    }
    for (const [orgId, orgSpace] of orgSpaces) {
      const legacyDocuments = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.orgId, orgId),
            isNull(schema.documents.spaceId),
            orgSpace.canReconcilePrivateDocuments
              ? undefined
              : or(
                  eq(schema.documents.ownerEmail, email),
                  eq(schema.documents.visibility, "org"),
                  eq(schema.documents.visibility, "public"),
                ),
          ),
        );
      if (!legacyDocuments.length) continue;
      await tx
        .update(schema.documents)
        .set({ spaceId: orgSpace.spaceId, updatedAt: now })
        .where(
          inArray(
            schema.documents.id,
            legacyDocuments.map((row: any) => row.id),
          ),
        );
      result.assignedSpaces += legacyDocuments.length;
    }

    const accessibleDocuments = await tx
      .select()
      .from(schema.documents)
      .where(inArray(schema.documents.spaceId, accessibleSpaceIds));
    const orgSpaceById = new Map(
      [...orgSpaces.values()].map((space) => [space.spaceId, space]),
    );
    const documents = accessibleDocuments.filter((document: any) => {
      if (document.spaceId === personalSpaceId) {
        return normalizeContentSpaceEmail(document.ownerEmail) === email;
      }
      const orgSpace = orgSpaceById.get(document.spaceId);
      return (
        orgSpace?.canReconcilePrivateDocuments === true ||
        normalizeContentSpaceEmail(document.ownerEmail) === email ||
        document.visibility === "org" ||
        document.visibility === "public"
      );
    });
    const filesDatabases = await tx
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.systemRole, "files"),
          inArray(schema.contentDatabases.spaceId, accessibleSpaceIds),
        ),
      );
    const membershipResult = await reconcileDocuments({
      db: tx,
      documents,
      filesDatabases,
      now,
    });
    result.documents = documents.length;
    result.insertedMemberships = membershipResult.inserted;
    result.removedMemberships = membershipResult.removed;
  });
  return result;
}
