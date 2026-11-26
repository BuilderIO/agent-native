import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { firstRow, getAccessibleSource, manualSourceWhere } from "./brain.js";

export async function importReplacesCapture(
  externalIds: readonly string[],
  target: { sourceId?: string; sourceTitle?: string },
): Promise<boolean> {
  const ids = Array.from(new Set(externalIds.filter(Boolean)));
  if (!ids.length) return false;
  const db = getDb();
  let sourceId = target.sourceId;
  if (sourceId) {
    await getAccessibleSource(sourceId, "editor");
  } else {
    sourceId = firstRow(
      await db
        .select({ id: schema.brainSources.id })
        .from(schema.brainSources)
        .where(manualSourceWhere(target.sourceTitle ?? "Manual imports"))
        .limit(1),
    )?.id;
    if (!sourceId) return false;
  }
  const replaced = firstRow(
    await db
      .select({ id: schema.brainRawCaptures.id })
      .from(schema.brainRawCaptures)
      .where(
        and(
          eq(schema.brainRawCaptures.sourceId, sourceId),
          inArray(schema.brainRawCaptures.externalId, ids),
        ),
      )
      .limit(1),
  );
  return replaced !== undefined;
}
