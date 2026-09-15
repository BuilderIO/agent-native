import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
} from "./_content-database-mutation-lock.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import { assertNotWorkspaceCatalogDocuments } from "./_content-space-catalog-guards.js";
import {
  databaseItemsPositionScope,
  documentsPositionScope,
  nextAppendPosition,
  withPositionLock,
} from "./_position-utils.js";
import { nanoid } from "./_property-utils.js";

export interface AdoptDocumentIntoDatabaseInput {
  databaseId?: string;
  databaseDocumentId?: string;
  documentId: string;
}

export interface AdoptDocumentIntoDatabaseResult {
  databaseId: string;
  databaseDocumentId: string;
  documentId: string;
  itemId: string;
  position: number;
  previousParentId: string | null;
  alreadyMember: boolean;
}

type Db = ReturnType<typeof getDb>;

async function resolveDatabase(input: AdoptDocumentIntoDatabaseInput) {
  if (!input.databaseId && !input.databaseDocumentId) {
    throw new Error("Either databaseId or databaseDocumentId is required.");
  }
  const [database] = await getDb()
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        input.databaseId
          ? eq(schema.contentDatabases.id, input.databaseId)
          : undefined,
        input.databaseDocumentId
          ? eq(schema.contentDatabases.documentId, input.databaseDocumentId)
          : undefined,
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (!database) throw new Error("Content collection not found.");
  return database;
}

async function assertNotAncestorOfDatabase(
  db: Db,
  ownerEmail: string,
  documentId: string,
  databaseDocumentId: string,
) {
  const seen = new Set<string>();
  let currentId: string | null = databaseDocumentId;
  while (currentId && !seen.has(currentId)) {
    if (currentId === documentId) {
      throw new Error(
        "A page cannot be added to a collection nested inside itself.",
      );
    }
    seen.add(currentId);
    const [parent] = await db
      .select({ parentId: schema.documents.parentId })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, currentId),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );
    currentId = parent?.parentId ?? null;
  }
}

/**
 * Claim the page's row for the rest of the transaction. Mirrors
 * `lockDatabaseMemberships`: a no-op write is the row lock, and a row count of
 * zero means the page went away under us.
 */
async function lockDocumentRow(tx: Db, documentId: string, ownerEmail: string) {
  const locked = await tx
    .update(schema.documents)
    .set({ updatedAt: sql`${schema.documents.updatedAt}` })
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    )
    .returning({ id: schema.documents.id });
  if (locked.length !== 1) throw new Error("Page not found.");
}

/**
 * Naming the blocking collection is what lets the caller go and fix it, but the
 * caller was only authorized against the target collection and the page. A page
 * shared on its own can sit in a collection its editor cannot read, so the title
 * is only included when the caller could have read it anyway.
 */
async function describeBlockingCollection(blocking: {
  databaseId: string;
  documentId: string;
  title: string;
}) {
  const access = await resolveAccess("document", blocking.documentId);
  return access
    ? `The page is already a row of the collection "${blocking.title}" (${blocking.databaseId}). Remove it from that collection first with remove-database-items.`
    : "The page is already a row of another collection you cannot read. Ask its owner to remove the page from that collection first.";
}

/**
 * Move an existing page into a collection so it becomes a real row: the page is
 * reparented under the collection's backing page AND gains its
 * `content_database_items` membership. Writing only one of the two leaves a
 * page that looks filed but never appears in the collection, which is the
 * half-associated state this helper exists to make impossible.
 */
export async function adoptDocumentIntoDatabase(
  input: AdoptDocumentIntoDatabaseInput,
): Promise<AdoptDocumentIntoDatabaseResult> {
  const db = getDb();
  const database = await resolveDatabase(input);
  const documentId = input.documentId;

  if (documentId === database.documentId) {
    throw new Error("A collection's own page cannot be added to itself.");
  }
  if (database.systemRole) {
    throw new Error(
      "System collections manage their own membership and cannot adopt pages.",
    );
  }

  const [attachedSource] = await db
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .limit(1);
  if (attachedSource) {
    throw new Error(
      "Source-backed collections cannot adopt pages; add the row in the source instead.",
    );
  }

  await assertAccess("document", database.documentId, "editor");
  const documentAccess = await assertAccess("document", documentId, "editor");
  const document =
    documentAccess.resource as typeof schema.documents.$inferSelect;

  if (document.trashedAt) {
    throw new Error("A trashed page cannot be added to a collection.");
  }
  if (document.ownerEmail !== database.ownerEmail) {
    throw new Error("The page and the collection must have the same owner.");
  }
  if (document.spaceId !== database.spaceId) {
    throw new Error(
      "The page and the collection must be in the same Content space.",
    );
  }

  const [databaseDocument] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, database.documentId));
  if (!databaseDocument) {
    throw new Error("Content collection page not found.");
  }
  if (
    databaseDocument.visibility !== document.visibility ||
    (databaseDocument.orgId ?? null) !== (document.orgId ?? null)
  ) {
    throw new Error(
      "The page and the collection must be in the same section; move the page first.",
    );
  }

  const [documentBackedDatabase] = await db
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .limit(1);
  if (documentBackedDatabase) {
    throw new Error(
      "A collection page cannot become a row of another collection.",
    );
  }

  await assertNotWorkspaceCatalogDocuments(
    db,
    [documentId],
    "added to a collection",
  );
  await assertNotAncestorOfDatabase(
    db,
    database.ownerEmail,
    documentId,
    database.documentId,
  );

  const now = new Date().toISOString();

  const written = await withPositionLock(
    documentsPositionScope(database.ownerEmail, database.documentId),
    () =>
      withPositionLock(databaseItemsPositionScope(database.id), () =>
        db.transaction(async (tx: Db) => {
          await lockContentDatabaseMutation(tx, database.id);
          // The collection lock alone only serializes adopts into the SAME
          // collection. The single-ordinary-collection invariant below is
          // about the page, so it needs the page's own row lock: without it
          // two adopts of one page into different collections each see no
          // other membership, both insert, and the page ends up a row of two
          // collections.
          await lockDocumentRow(tx, documentId, database.ownerEmail);

          // Membership and parent are re-read under those locks. Reading them
          // earlier lets two concurrent adopts of one page both see "not a
          // member", so the loser hits the unique (databaseId, documentId)
          // constraint instead of returning the receipt the winner already
          // made true.
          const [existingMembership] = await tx
            .select()
            .from(schema.contentDatabaseItems)
            .where(
              and(
                eq(schema.contentDatabaseItems.databaseId, database.id),
                eq(schema.contentDatabaseItems.documentId, documentId),
              ),
            );
          const [currentDocument] = await tx
            .select({ parentId: schema.documents.parentId })
            .from(schema.documents)
            .where(eq(schema.documents.id, documentId));
          if (
            existingMembership &&
            currentDocument?.parentId === database.documentId
          ) {
            return {
              itemId: existingMembership.id,
              itemPosition: existingMembership.position,
              alreadyMember: true,
            };
          }

          // A page is a row of at most one ordinary collection. Adopting it
          // into a second one without removing the first leaves the old
          // collection listing a row whose page now lives elsewhere, so this
          // refuses rather than half-moving it. System memberships (Files,
          // Pinned, Workspaces) are deliberately parallel and stay.
          const otherMemberships = await tx
            .select({
              databaseId: schema.contentDatabases.id,
              documentId: schema.contentDatabases.documentId,
              title: schema.contentDatabases.title,
            })
            .from(schema.contentDatabaseItems)
            .innerJoin(
              schema.contentDatabases,
              eq(
                schema.contentDatabases.id,
                schema.contentDatabaseItems.databaseId,
              ),
            )
            .where(
              and(
                eq(schema.contentDatabaseItems.documentId, documentId),
                ne(schema.contentDatabaseItems.databaseId, database.id),
                isNull(schema.contentDatabases.systemRole),
                isNull(schema.contentDatabases.deletedAt),
              ),
            )
            .limit(1);
          if (otherMemberships.length > 0) {
            throw new Error(
              await describeBlockingCollection(otherMemberships[0]),
            );
          }

          const itemId = existingMembership?.id ?? nanoid();

          const [maxDoc] = await tx
            .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.ownerEmail, database.ownerEmail),
                eq(schema.documents.parentId, database.documentId),
              ),
            );
          const [maxItem] = await tx
            .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
            .from(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.databaseId, database.id));

          const documentPosition = nextAppendPosition(maxDoc?.max);
          const itemPosition =
            existingMembership?.position ?? nextAppendPosition(maxItem?.max);

          const reparented = await tx
            .update(schema.documents)
            .set({
              parentId: database.documentId,
              position: documentPosition,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.documents.id, documentId),
                eq(schema.documents.ownerEmail, database.ownerEmail),
              ),
            )
            .returning({ id: schema.documents.id });
          if (reparented.length !== 1) {
            throw new Error("The page could not be moved into the collection.");
          }

          if (!existingMembership) {
            await tx.insert(schema.contentDatabaseItems).values({
              id: itemId,
              ownerEmail: database.ownerEmail,
              orgId: database.orgId,
              databaseId: database.id,
              documentId,
              position: itemPosition,
              createdAt: now,
              updatedAt: now,
            });
          }

          const shares = await tx
            .select()
            .from(schema.documentShares)
            .where(eq(schema.documentShares.resourceId, database.documentId));
          const existingShares = await tx
            .select()
            .from(schema.documentShares)
            .where(eq(schema.documentShares.resourceId, documentId));
          const existingShareKeys = new Set(
            existingShares.map(
              (share) => `${share.principalType}:${share.principalId}`,
            ),
          );
          const missingShares = shares.filter(
            (share) =>
              !existingShareKeys.has(
                `${share.principalType}:${share.principalId}`,
              ),
          );
          if (missingShares.length > 0) {
            await tx.insert(schema.documentShares).values(
              missingShares.map((share) => ({
                id: nanoid(),
                resourceId: documentId,
                principalType: share.principalType,
                principalId: share.principalId,
                role: share.role,
                createdBy: database.ownerEmail,
                createdAt: now,
              })),
            );
          }

          await ensureDocumentFilesMembership(tx, documentId, now);
          await touchContentDatabase(tx, database.id, now);

          return { itemId, itemPosition, alreadyMember: false };
        }),
      ),
  );

  // Read the membership back outside the transaction. A caller that reports
  // "added to the collection" must never do so from the write's own optimism:
  // the page is only a row once BOTH halves are durable.
  const [persistedItem] = await db
    .select()
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, database.id),
        eq(schema.contentDatabaseItems.documentId, documentId),
      ),
    );
  const [persistedDocument] = await db
    .select({ parentId: schema.documents.parentId })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!persistedItem || persistedDocument?.parentId !== database.documentId) {
    throw new Error(
      `The page was not added to the collection: membership row ${
        persistedItem ? "exists" : "missing"
      }, page parent ${persistedDocument?.parentId ?? "missing"}.`,
    );
  }

  return {
    databaseId: database.id,
    databaseDocumentId: database.documentId,
    documentId,
    itemId: persistedItem.id,
    position: written.itemPosition,
    previousParentId: document.parentId ?? null,
    alreadyMember: written.alreadyMember,
  };
}
