import { MAX_PUBLIC_FOLLOWERS } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import { getDb, schema } from "../db/index.js";

/** Parent ids per query, well under every driver's parameter limit. */
const PARENT_GROUP = 90;

/**
 * The sub-pages that go public with a page and leave public with it, as in
 * Notion: every page under it, at any depth, that has the same owner. A
 * sub-page someone else owns, and everything under it, keeps its own
 * setting. One in the trash or in a deleted database doesn't go public, but
 * does leave public, so restoring it can't bring back a public page under a
 * private one.
 *
 * Returns the public ones when `isPublic` is true and the rest when it is
 * false, walking through both, since a private sub-page can hold public
 * ones. Stops one past `MAX_PUBLIC_FOLLOWERS`, so a change that would carry
 * more is refused rather than half done.
 */
export async function publicSubPageIds(
  page: { id: string; ownerEmail: string },
  options: { isPublic: boolean },
): Promise<string[]> {
  const db = getDb();
  const ids: string[] = [];
  const seen = new Set([page.id]);
  let frontier = [page.id];
  while (frontier.length > 0 && ids.length <= MAX_PUBLIC_FOLLOWERS) {
    const next: string[] = [];
    for (let index = 0; index < frontier.length; index += PARENT_GROUP) {
      const children = await db
        .select({
          id: schema.documents.id,
          visibility: schema.documents.visibility,
        })
        .from(schema.documents)
        .where(
          and(
            inArray(
              schema.documents.parentId,
              frontier.slice(index, index + PARENT_GROUP),
            ),
            eq(schema.documents.ownerEmail, page.ownerEmail),
            ...(options.isPublic
              ? []
              : [
                  isNull(schema.documents.trashedAt),
                  ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
                ]),
          ),
        );
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        next.push(child.id);
        if ((child.visibility === "public") === options.isPublic) {
          ids.push(child.id);
        }
      }
    }
    frontier = next;
  }
  return ids.slice(0, MAX_PUBLIC_FOLLOWERS + 1);
}
