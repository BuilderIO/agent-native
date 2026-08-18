import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import { normalizeContentSpaceEmail } from "./_content-space-access.js";
import {
  personalContentSpaceId,
  systemIdsForContentSpace,
} from "./_content-spaces.js";

type Db = any;

export function favoritesSystemIds(userEmail: string) {
  return systemIdsForContentSpace(
    personalContentSpaceId(normalizeContentSpaceEmail(userEmail)),
    "favorites",
  );
}

export async function favoriteDocumentIds(
  db: Db,
  userEmail: string,
  documentIds: string[],
) {
  if (documentIds.length === 0) return new Set<string>();
  const favoritesDatabaseId = favoritesSystemIds(userEmail).databaseId;
  const rows = await db
    .select({ documentId: schema.contentDatabaseItems.documentId })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, favoritesDatabaseId),
        inArray(schema.contentDatabaseItems.documentId, documentIds),
      ),
    );
  return new Set(rows.map((row: { documentId: string }) => row.documentId));
}

export async function setFavoriteMembership(args: {
  db: Db;
  userEmail: string;
  documentId: string;
  favorite: boolean;
  now: string;
}) {
  const email = normalizeContentSpaceEmail(args.userEmail);
  const favoritesDatabaseId = favoritesSystemIds(email).databaseId;
  const [existing] = await args.db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, favoritesDatabaseId),
        eq(schema.contentDatabaseItems.documentId, args.documentId),
      ),
    );

  if (!args.favorite) {
    if (existing) {
      await args.db
        .delete(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.id, existing.id));
    }
    return false;
  }
  if (existing) return true;

  const [position] = await args.db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, favoritesDatabaseId));
  const id = `content_database_item_${createHash("sha256")
    .update(`${favoritesDatabaseId}:${args.documentId}`)
    .digest("hex")
    .slice(0, 32)}`;
  await args.db
    .insert(schema.contentDatabaseItems)
    .values({
      id,
      ownerEmail: email,
      orgId: null,
      databaseId: favoritesDatabaseId,
      documentId: args.documentId,
      position: Number(position?.max ?? -1) + 1,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing();
  return true;
}
