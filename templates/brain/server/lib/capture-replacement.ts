import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { manualSourceWhere } from "./brain.js";

export async function importReplacesCapture(
  externalIds: readonly string[],
  target: { sourceId?: string; sourceTitle?: string },
): Promise<boolean> {
  const ids = Array.from(new Set(externalIds.filter(Boolean)));
  if (!ids.length) return false;
  const rows = await getDb()
    .select({ id: schema.brainRawCaptures.id })
    .from(schema.brainRawCaptures)
    .innerJoin(
      schema.brainSources,
      eq(schema.brainSources.id, schema.brainRawCaptures.sourceId),
    )
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        inArray(schema.brainRawCaptures.externalId, ids),
        target.sourceId
          ? eq(schema.brainRawCaptures.sourceId, target.sourceId)
          : manualSourceWhere(target.sourceTitle ?? "Manual imports"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
