import type { DbExec } from "@agent-native/core/db";
import { eq, sql, type SQL } from "drizzle-orm";

import { schema } from "../db/index.js";
import { drizzleOverExec } from "./exec-db.js";

/**
 * Why a page can't take its body writes through its live copy yet: a writer
 * that reaches it still writes the SQL body directly. On a switched page that
 * writer refuses with `LIVE_BODY_WRITER_UNSUPPORTED` for good, so switching
 * the page would stop the writer rather than route it.
 *
 * Some writers reach every page and refuse too: `update-document --content`
 * from outside the editor, and the property and block writers of a primary
 * Blocks field, since every page is a row of its space's Files collection,
 * which has one. They only change a body's text, which `edit-document` does
 * through the live copy, so they block no page. `migrate-historical-icon-urls`
 * defers a page it refuses.
 */
export type LiveBodySwitchBlocker =
  /** The folder sync, conflict accept, import, and the file's own editor, which runs without collab. */
  | "local_file"
  /** `share-local-file-document`, which rewrites a shared copy's body. */
  | "local_file_copy"
  /** GitHub and Builder syncs, and any source Content doesn't own. */
  | "source_owned"
  /** Notion pull, push and link. */
  | "notion"
  /** Row migration and a source's body hydration, which reach rows of a collection people made. */
  | "database_row";

export const LIVE_BODY_SWITCH_BLOCKERS: readonly LiveBodySwitchBlocker[] = [
  "local_file",
  "local_file_copy",
  "source_owned",
  "notion",
  "database_row",
];

// Built on call, not at import: tests mock the schema without these tables.
// A source mode is allowed only when Content owns the body, so a source added
// later is ineligible until its writers are routed.
function blockerConditions(): Record<LiveBodySwitchBlocker, SQL> {
  const page = schema.documents;
  const links = schema.documentSyncLinks;
  const memberships = schema.contentDatabaseItems;
  const collections = schema.contentDatabases;
  return {
    local_file: sql`${page.sourceMode} IS NOT DISTINCT FROM 'local-files'`,
    local_file_copy: sql`${page.sourceKind} IS NOT DISTINCT FROM 'local-file-copy'`,
    source_owned: sql`${page.sourceMode} IS NOT NULL AND ${page.sourceMode} NOT IN ('database', 'local-files')`,
    notion: sql`EXISTS (SELECT 1 FROM ${links} WHERE ${links.documentId} = ${page.id})`,
    // A membership whose collection is missing counts: only a system
    // collection is known to be out of those writers' reach.
    database_row: sql`EXISTS (SELECT 1 FROM ${memberships} LEFT JOIN ${collections} ON ${collections.id} = ${memberships.databaseId} WHERE ${memberships.documentId} = ${page.id} AND ${collections.systemRole} IS NULL)`,
  };
}

/** True for a `documents` row with no blocker, for a query's `where`. */
export function liveBodySwitchEligibleSql(): SQL {
  const conditions = Object.values(blockerConditions()).map(
    (condition) => sql`(${condition})`,
  );
  return sql`NOT (${sql.join(conditions, sql` OR `)})`;
}

/**
 * The blockers of page `documentId`, read on `exec`; empty when the page can
 * be switched, undefined when it doesn't exist. Inside a live-copy commit,
 * pass the commit's `tx`.
 */
export async function liveBodySwitchBlockers(
  exec: DbExec,
  documentId: string,
): Promise<LiveBodySwitchBlocker[] | undefined> {
  const conditions = blockerConditions();
  // guard:allow-unscoped — callers check access to the page first, and this reads only which writers reach it.
  const [row] = await drizzleOverExec(exec)
    .select(
      Object.fromEntries(
        LIVE_BODY_SWITCH_BLOCKERS.map((blocker) => [
          blocker,
          sql<number>`CASE WHEN ${conditions[blocker]} THEN 1 ELSE 0 END`.as(
            blocker,
          ),
        ]),
      ),
    )
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  if (!row) return undefined;
  return LIVE_BODY_SWITCH_BLOCKERS.filter((blocker) => {
    const value = Number(row[blocker]);
    if (value !== 0 && value !== 1) {
      throw new Error(
        `Page ${documentId}'s ${blocker} check answered ${String(row[blocker])}.`,
      );
    }
    return value === 1;
  });
}
