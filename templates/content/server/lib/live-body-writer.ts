import { getDbExec, type DbExec } from "@agent-native/core/db";
import {
  evaluateFeatureFlagRules,
  getFeatureFlagRulesStrict,
} from "@agent-native/core/feature-flags";
import { eq } from "drizzle-orm";

import {
  LIVE_BODY_SHADOW_FLAG,
  LIVE_BODY_WRITER_FLAG,
} from "../../shared/feature-flags.js";
import { getDb, schema } from "../db/index.js";

// Decision D2 of the stored-form rebuild: a page's body is written through its
// live copy only when the page is switched, its live copy holds the page's
// current body revision, and both flags are on for the page's owner.
//
// The flags are evaluated for the page, not the caller. Two collaborators with
// different flags would otherwise write one body down two paths at once.
//
// Two markers make the kill switch safe, one per side. While the flags are
// off, a switched page takes legacy SQL writes its live copy never sees, and
// editor updates that commit to Yjs on main's path, where nothing derives the
// stored body. A legacy write bumps only `body_revision`, so
// `collab_body_revision` falls behind it; a Yjs commit bumps only
// `_collab_docs.version`, so `live_copy_version` falls behind that. Either
// keeps the page on the legacy path until it is converted again; deriving
// from a copy out of step with the stored body would overwrite one side.

export type LiveBodyWritePath = "live_copy" | "legacy";

export type LiveBodyLegacyReason =
  | "no_page"
  | "not_switched"
  | "live_copy_behind"
  | "stored_body_behind"
  | "flag_off";

export type LiveBodyWriterGate =
  | { writePath: "live_copy" }
  | { writePath: "legacy"; reason: LiveBodyLegacyReason };

export type LiveBodyWriterPageRow = Pick<
  typeof schema.documents.$inferSelect,
  | "id"
  | "liveBodySwitchedAt"
  | "bodyRevision"
  | "collabBodyRevision"
  | "liveCopyVersion"
  | "ownerEmail"
  | "orgId"
>;

export const liveBodyWriterPageColumns = {
  id: schema.documents.id,
  liveBodySwitchedAt: schema.documents.liveBodySwitchedAt,
  bodyRevision: schema.documents.bodyRevision,
  collabBodyRevision: schema.documents.collabBodyRevision,
  liveCopyVersion: schema.documents.liveCopyVersion,
  ownerEmail: schema.documents.ownerEmail,
  orgId: schema.documents.orgId,
};

/**
 * Decides the write path for a page row the caller already read, for example
 * under the row lock its write holds; pass that transaction so the flags are
 * read in it rather than from the request's settings snapshot. A caller that
 * knows the live copy's version, as a commit's persist does, passes it as
 * `collabVersion` (null for none); otherwise it is read. Unreadable or malformed flag state
 * throws: reading it as "off" would send a switched page's writes down the
 * legacy path.
 */
export async function liveBodyWriterGateForRow(
  row: LiveBodyWriterPageRow | null | undefined,
  options: { transaction?: DbExec; collabVersion?: number | null } = {},
): Promise<LiveBodyWriterGate> {
  if (!row) return { writePath: "legacy", reason: "no_page" };
  if (!row.liveBodySwitchedAt)
    return { writePath: "legacy", reason: "not_switched" };
  if (row.collabBodyRevision !== row.bodyRevision)
    return { writePath: "legacy", reason: "live_copy_behind" };
  const collabVersion =
    options.collabVersion === undefined
      ? await storedCollabVersion(row.id, options.transaction)
      : options.collabVersion;
  if (collabVersion === null || row.liveCopyVersion !== collabVersion)
    return { writePath: "legacy", reason: "stored_body_behind" };
  return (await liveBodyWriterFlagsOn(row, options))
    ? { writePath: "live_copy" }
    : { writePath: "legacy", reason: "flag_off" };
}

// Core's version for the page's collab doc; null when it has none.
async function storedCollabVersion(
  documentId: string,
  transaction: DbExec | undefined,
): Promise<number | null> {
  const { rows } = await (transaction ?? getDbExec()).execute({
    sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
    args: [documentId],
  });
  const version = (rows[0] as { version?: unknown } | undefined)?.version;
  if (version === undefined) return null;
  const parsed = Number(version);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `Page ${documentId}'s collab doc has an unreadable version (${String(version)}).`,
    );
  }
  return parsed;
}

/** Both flags, for the page's owner and org; throws like the gate. */
export async function liveBodyWriterFlagsOn(
  row: Pick<LiveBodyWriterPageRow, "ownerEmail" | "orgId">,
  options: { transaction?: DbExec } = {},
): Promise<boolean> {
  const scope = { userEmail: row.ownerEmail, orgId: row.orgId };
  const [writer, shadow] = await Promise.all(
    [LIVE_BODY_WRITER_FLAG, LIVE_BODY_SHADOW_FLAG].map(async (flag) =>
      evaluateFeatureFlagRules(
        flag.key,
        await getFeatureFlagRulesStrict(flag.key, {
          ...scope,
          transaction: options.transaction,
        }),
        scope,
      ),
    ),
  );
  return writer && shadow;
}

type ContentDb = Pick<ReturnType<typeof getDb>, "select">;

export async function liveBodyWriterGate(
  docId: string,
  options: { db?: ContentDb } = {},
): Promise<LiveBodyWriterGate> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select(liveBodyWriterPageColumns)
    .from(schema.documents)
    .where(eq(schema.documents.id, docId))
    .limit(1);
  return liveBodyWriterGateForRow(row);
}

/** True when `docId`'s body must be written through its live copy. */
export async function isLiveBodyWriterPage(
  docId: string,
  options: { db?: ContentDb } = {},
): Promise<boolean> {
  return (await liveBodyWriterGate(docId, options)).writePath === "live_copy";
}
