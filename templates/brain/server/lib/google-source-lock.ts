import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { personalGoogleSourceFilter } from "./source-access.js";

type Source = typeof schema.brainSources.$inferSelect;

export async function withGoogleSourceLock<T>(
  sourceId: string,
  callback: (source: Source | undefined) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.brainSources)
      .where(
        and(
          eq(schema.brainSources.id, sourceId),
          accessFilter(schema.brainSources, schema.brainSourceShares),
          personalGoogleSourceFilter(),
        ),
      )
      .limit(1)
      .for("update");
    return callback(rows.find((source) => source.id === sourceId));
  });
}
