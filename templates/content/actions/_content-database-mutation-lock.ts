import { eq, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { withPositionLock } from "./_position-utils.js";

export function withContentDatabaseMutationLock<T>(
  databaseId: string,
  run: () => Promise<T>,
) {
  return withPositionLock(`contentDatabaseMutation:${databaseId}`, run);
}

export async function lockContentDatabaseMutation(
  tx: ReturnType<typeof getDb>,
  databaseId: string,
) {
  const locked = await tx
    .update(schema.contentDatabases)
    .set({ updatedAt: sql`${schema.contentDatabases.updatedAt}` })
    .where(eq(schema.contentDatabases.id, databaseId))
    .returning({ id: schema.contentDatabases.id });
  if (locked.length !== 1) throw new Error("Database not found.");
}

export async function touchContentDatabase(
  tx: ReturnType<typeof getDb>,
  databaseId: string,
  now = new Date().toISOString(),
) {
  const touched = await tx
    .update(schema.contentDatabases)
    .set({ updatedAt: now })
    .where(eq(schema.contentDatabases.id, databaseId))
    .returning({ id: schema.contentDatabases.id });
  if (touched.length !== 1) throw new Error("Database not found.");
}
