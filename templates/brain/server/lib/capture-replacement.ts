import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { findManualSource, firstRow, getAccessibleSource } from "./brain.js";

export async function importReplacesCapture(
  externalIds: readonly string[],
  target: { sourceId?: string | undefined; sourceTitle?: string | undefined },
): Promise<boolean> {
  const ids = Array.from(new Set(externalIds.filter(Boolean)));
  if (!ids.length) return false;
  let sourceId = target.sourceId;
  if (sourceId) {
    await getAccessibleSource(sourceId, "editor");
  } else {
    sourceId = (await findManualSource(target.sourceTitle))?.id;
    if (!sourceId) return false;
  }
  const replaced = firstRow(
    await getDb()
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
