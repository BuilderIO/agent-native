import { ActionContractError } from "@agent-native/core";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import {
  evaluateFeatureFlagRules,
  getFeatureFlagRulesStrict,
} from "@agent-native/core/feature-flags";
import { eq, sql } from "drizzle-orm";

import {
  LIVE_BODY_SHADOW_FLAG,
  LIVE_BODY_WRITER_FLAG,
} from "../../shared/feature-flags.js";
import { getDb, schema } from "../db/index.js";

// Decision D2 of the stored-form rebuild: a page's body is written through its
// live copy only when the page is switched, its live copy holds the page's
// current body revision, and both flags are on for the page's owner.
//
// A page linked to a local file stays on the legacy path even when switched.
// Its editor saves the body through SQL, never over collab, and the writers
// that follow its file have no live-copy route.
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
  | "local_file"
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
  | "sourceMode"
  | "bodyRevision"
  | "collabBodyRevision"
  | "liveCopyVersion"
  | "ownerEmail"
  | "orgId"
>;

export const liveBodyWriterPageColumns = {
  id: schema.documents.id,
  liveBodySwitchedAt: schema.documents.liveBodySwitchedAt,
  sourceMode: schema.documents.sourceMode,
  bodyRevision: schema.documents.bodyRevision,
  collabBodyRevision: schema.documents.collabBodyRevision,
  liveCopyVersion: schema.documents.liveCopyVersion,
  ownerEmail: schema.documents.ownerEmail,
  orgId: schema.documents.orgId,
};

/**
 * Decides the write path for a page row the caller read under its row lock;
 * pass that transaction so the flags and the stored live copy's version are
 * read in it rather than from the request's settings snapshot. A caller
 * without the lock uses `liveBodyWriterGate`. Unreadable or malformed flag
 * state throws: reading it as "off" would send a switched page's writes down
 * the legacy path.
 */
export async function liveBodyWriterGateForRow(
  row: LiveBodyWriterPageRow | null | undefined,
  options: { transaction?: DbExec } = {},
): Promise<LiveBodyWriterGate> {
  return gateForMarkers(
    row,
    async (documentId) => {
      const { rows } = await (options.transaction ?? getDbExec()).execute({
        sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
        args: [documentId],
      });
      return (rows[0] as { version?: unknown } | undefined)?.version;
    },
    (page) => liveBodyWriterFlagsOn(page, options),
  );
}

/**
 * `liveBodyWriterGateForRow` for rows locked together, in their order. The
 * live copies' versions are read in one statement and the flags once per
 * owner and organization, so a bulk writer doesn't hold its locks across
 * reads for every page.
 */
export async function liveBodyWriterGatesForRows(
  rows: readonly LiveBodyWriterPageRow[],
  options: { transaction?: DbExec } = {},
): Promise<LiveBodyWriterGate[]> {
  const exec = options.transaction ?? getDbExec();
  const switched = rows.filter((row) => row.liveBodySwitchedAt);
  const versions = new Map<string, unknown>();
  if (switched.length > 0) {
    const { rows: docs } = await exec.execute({
      sql: `SELECT doc_id, version FROM _collab_docs WHERE doc_id IN (${switched.map(() => "?").join(", ")})`,
      args: switched.map((row) => row.id),
    });
    for (const doc of docs as Array<{ doc_id: unknown; version: unknown }>) {
      versions.set(String(doc.doc_id), doc.version);
    }
  }
  const flagsByScope = new Map<string, Promise<boolean>>();
  const flagsOn = (
    page: Pick<LiveBodyWriterPageRow, "ownerEmail" | "orgId">,
  ) => {
    const scope = JSON.stringify([page.ownerEmail, page.orgId]);
    let on = flagsByScope.get(scope);
    if (!on) {
      on = liveBodyWriterFlagsOn(page, { transaction: exec });
      flagsByScope.set(scope, on);
    }
    return on;
  };
  const gates: LiveBodyWriterGate[] = [];
  for (const row of rows) {
    gates.push(
      await gateForMarkers(row, async () => versions.get(row.id), flagsOn),
    );
  }
  return gates;
}

/** The refusal of a legacy body write to a page that switched in flight. */
export function liveBodyWritePathChanged(documentId: string) {
  return new ActionContractError(
    `Page ${documentId} started taking writes through its live copy while this write was in flight. Read it again and retry.`,
    {
      errorCode: "LIVE_BODY_WRITE_PATH_CHANGED",
      statusCode: 409,
      details: { documentId, reason: "live_copy" },
    },
  );
}

/**
 * Refuses a legacy body write to a page that now writes its body through its
 * live copy. Call it in the write's transaction, on the page row read under
 * its lock: a page can switch after the writer chose the legacy path, and a
 * SQL write then would never reach the live copy or the tabs open on it.
 */
export async function assertLegacyBodyWritePath(
  row: LiveBodyWriterPageRow,
  options: { transaction?: DbExec } = {},
): Promise<void> {
  if ((await liveBodyWriterGateForRow(row, options)).writePath === "legacy")
    return;
  throw liveBodyWritePathChanged(row.id);
}

/**
 * Refuses to link a page switched to its live copy to a local file. The link
 * would take the page off its live copy unannounced, since the gate keeps a
 * linked page on the legacy path; switching it back first is the way through.
 * Pass the link's transaction to read the page under its row lock.
 */
export async function assertLocalFileLinkable(
  documentId: string,
  options: { transaction?: ContentDb } = {},
): Promise<void> {
  // guard:allow-unscoped — the linking writer checked access to the page, and this reads only its switch and source mode.
  const query = (options.transaction ?? getDb())
    .select({
      liveBodySwitchedAt: schema.documents.liveBodySwitchedAt,
      sourceMode: schema.documents.sourceMode,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  const [page] = await (options.transaction ? query.for("update") : query);
  if (!page?.liveBodySwitchedAt || page.sourceMode === "local-files") return;
  throw new ActionContractError(
    `Page ${documentId} is switched to its live copy, so it can't be linked to a local file. Switch it back with set-live-body-switch (switched: false), then retry.`,
    {
      errorCode: "LOCAL_FILE_LINK_SWITCHED_PAGE",
      statusCode: 409,
      details: { documentId },
    },
  );
}

/** True for `assertLocalFileLinkable`'s refusal. */
export function isLocalFileLinkRefused(
  error: unknown,
): error is ActionContractError {
  return (
    error instanceof ActionContractError &&
    error.errorCode === "LOCAL_FILE_LINK_SWITCHED_PAGE"
  );
}

async function gateForMarkers(
  row: LiveBodyWriterPageRow | null | undefined,
  readCollabVersion: (documentId: string) => Promise<unknown>,
  flagsOn: (
    page: Pick<LiveBodyWriterPageRow, "ownerEmail" | "orgId">,
  ) => Promise<boolean>,
): Promise<LiveBodyWriterGate> {
  if (!row) return { writePath: "legacy", reason: "no_page" };
  if (!row.liveBodySwitchedAt)
    return { writePath: "legacy", reason: "not_switched" };
  if (row.sourceMode === "local-files")
    return { writePath: "legacy", reason: "local_file" };
  if (row.collabBodyRevision !== row.bodyRevision)
    return { writePath: "legacy", reason: "live_copy_behind" };
  // The stored version, not the one an edit was built on: a peer's commit
  // moves both markers, and core's fence retries the overtaken edit.
  const collabVersion = parseCollabVersion(
    row.id,
    await readCollabVersion(row.id),
  );
  if (collabVersion === null || row.liveCopyVersion !== collabVersion)
    return { writePath: "legacy", reason: "stored_body_behind" };
  return (await flagsOn(row))
    ? { writePath: "live_copy" }
    : { writePath: "legacy", reason: "flag_off" };
}

// Core's version for the page's collab doc; null when it has none.
function parseCollabVersion(documentId: string, version: unknown) {
  if (version === undefined || version === null) return null;
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
  const [writer, shadow] = await Promise.all(
    [LIVE_BODY_WRITER_FLAG, LIVE_BODY_SHADOW_FLAG].map((flag) =>
      flagOnForPage(flag.key, row, options.transaction),
    ),
  );
  return writer && shadow;
}

async function flagOnForPage(
  key: string,
  row: Pick<LiveBodyWriterPageRow, "ownerEmail" | "orgId">,
  transaction: DbExec | undefined,
): Promise<boolean> {
  const scope = { userEmail: row.ownerEmail, orgId: row.orgId };
  const rules = await getFeatureFlagRulesStrict(key, { ...scope, transaction });
  if (evaluateFeatureFlagRules(key, rules, scope)) return true;
  if (row.orgId) return false;
  // `enable-for-current-user` stores an enablement in the org its manager had
  // active, but a personal page has no org, so look for the owner's own
  // listing in each of their orgs. Only that listing counts: an org's rollout
  // covers the org's pages, not its members' personal ones.
  const owner = row.ownerEmail.trim().toLowerCase();
  for (const orgId of await ownerOrgIds(owner, transaction)) {
    const orgRules = await getFeatureFlagRulesStrict(key, {
      orgId,
      transaction,
    });
    if (orgRules.mode !== "off" && orgRules.emails.includes(owner)) return true;
  }
  return false;
}

// Read here rather than through core's membership cache, which answers for the
// request's caller and turns an unreadable table into "no orgs".
async function ownerOrgIds(
  owner: string,
  transaction: DbExec | undefined,
): Promise<string[]> {
  const exec = transaction ?? getDbExec();
  const relation = await exec.execute({
    sql: "SELECT to_regclass('org_members') AS relation",
    args: [],
  });
  // A deployment without organizations has no memberships.
  if (!relation.rows[0]?.relation) return [];
  const { rows } = await exec.execute({
    sql: `SELECT org_id FROM org_members
          WHERE LOWER(email) = ? AND federation_removal_pending_at IS NULL
          ORDER BY org_id`,
    args: [owner],
  });
  return rows.map((row) => String((row as { org_id: unknown }).org_id));
}

type ContentDb = Pick<ReturnType<typeof getDb>, "select">;

/** The write path for a page, read without its row lock. */
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
  // Most pages stop here, before `_collab_docs`, which a deployment creates
  // with its first collab doc.
  if (!row) return { writePath: "legacy", reason: "no_page" };
  if (!row.liveBodySwitchedAt)
    return { writePath: "legacy", reason: "not_switched" };
  // A live-copy commit moves the page's markers and its collab doc's version
  // together, so read them in one statement: two reads could straddle a
  // commit and see the page behind its own live copy.
  // guard:allow-unscoped — callers check access to the page first, and the gate returns only its write path.
  const [markers] = await db
    .select({
      ...liveBodyWriterPageColumns,
      collabVersion: sql<unknown>`(SELECT collab.version FROM _collab_docs AS collab WHERE collab.doc_id = documents.id)`,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, docId))
    .limit(1);
  return gateForMarkers(
    markers,
    async () => markers?.collabVersion,
    (page) => liveBodyWriterFlagsOn(page),
  );
}

/** True when `docId`'s body must be written through its live copy. */
export async function isLiveBodyWriterPage(
  docId: string,
  options: { db?: ContentDb } = {},
): Promise<boolean> {
  return (await liveBodyWriterGate(docId, options)).writePath === "live_copy";
}
