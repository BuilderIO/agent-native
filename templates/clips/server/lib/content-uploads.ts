import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/**
 * True for a recording uploaded from an Agent-Native Content page. Those list
 * under From Content rather than Library; a Clip linked into a page doesn't.
 */
export function uploadedFromContent() {
  const bindings = schema.recordingContentBindings;
  return sql`EXISTS (SELECT 1 FROM ${bindings} WHERE ${bindings.recordingId} = ${schema.recordings.id} AND ${bindings.origin} = 'upload')`;
}

/**
 * The Content page each upload came from, by recording id. Clips keeps no
 * page titles, so a page is named by its link alone.
 */
export async function contentPageUrls(
  recordingIds: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!recordingIds.length) return urls;
  const bindings = schema.recordingContentBindings;
  const pages = await getDb()
    .select({
      recordingId: bindings.recordingId,
      contentApp: bindings.contentApp,
      documentId: bindings.documentId,
    })
    .from(bindings)
    .where(
      and(
        inArray(bindings.recordingId, recordingIds),
        eq(bindings.origin, "upload"),
      ),
    )
    .orderBy(asc(bindings.createdAt));
  for (const page of pages) {
    if (urls.has(page.recordingId)) continue;
    urls.set(
      page.recordingId,
      `${page.contentApp}/page/${encodeURIComponent(page.documentId)}`,
    );
  }
  return urls;
}
