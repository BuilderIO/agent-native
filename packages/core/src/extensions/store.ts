import { randomUUID } from "node:crypto";

import { and, eq, gte, isNull } from "drizzle-orm";

import { appStatePut } from "../application-state/store.js";
import { getDbExec, isPostgres, retryOnDdlRace } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import {
  ensureTableExists,
  ensureColumnExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";
import { recordChange } from "../server/poll.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
  ForbiddenError,
} from "../sharing/access.js";
import { registerShareableResource } from "../sharing/registry.js";
import {
  EXTENSION_CHANGE_MARKER_KEY,
  extensionChangeMarkerSession,
  extensionChangeMarkerValue,
  type ExtensionChangeTarget,
} from "./change-marker.js";
import {
  applyExtensionContentUpdate,
  type ExtensionContentEdit,
  type ExtensionLegacyPatch,
} from "./content-patch.js";
import {
  extensions,
  extensionHides,
  extensionShares,
  extensionHistory,
  EXTENSIONS_CREATE_SQL,
  EXTENSIONS_CREATE_SQL_PG,
  EXTENSION_SHARES_CREATE_SQL,
  EXTENSION_SHARES_CREATE_SQL_PG,
  EXTENSION_DATA_CREATE_SQL,
  EXTENSION_DATA_CREATE_SQL_PG,
  EXTENSION_DATA_ITEM_INDEX_SQL,
  EXTENSION_DATA_ITEM_INDEX_SQL_PG,
  EXTENSION_DATA_DROP_OLD_INDEX_SQL,
  EXTENSION_DATA_DROP_OLD_INDEX_SQL_PG,
  EXTENSIONS_OWNER_INDEX_SQL,
  EXTENSIONS_ORG_INDEX_SQL,
  EXTENSIONS_UPDATED_INDEX_SQL,
  EXTENSIONS_HIDDEN_AT_COLUMN_SQL,
  EXTENSIONS_HIDDEN_BY_COLUMN_SQL,
  EXTENSIONS_HIDDEN_AT_INDEX_SQL,
  EXTENSION_SHARES_RESOURCE_INDEX_SQL,
  EXTENSION_HIDES_CREATE_SQL,
  EXTENSION_HIDES_CREATE_SQL_PG,
  EXTENSION_HIDES_UNIQUE_INDEX_SQL,
  EXTENSION_HIDES_OWNER_INDEX_SQL,
  EXTENSION_HISTORY_CREATE_SQL,
  EXTENSION_HISTORY_CREATE_SQL_PG,
  EXTENSION_HISTORY_VERSION_INDEX_SQL,
  EXTENSION_HISTORY_CREATED_INDEX_SQL,
  EXTENSION_CONSENTS_CREATE_SQL,
  EXTENSION_CONSENTS_CREATE_SQL_PG,
  EXTENSION_CONSENTS_VIEWER_INDEX_SQL,
} from "./schema.js";

const getDb = createGetDb({
  extensions,
  extensionShares,
  extensionHides,
  extensionHistory,
});

let _initPromise: Promise<void> | undefined;

export async function ensureExtensionsTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const pg = isPostgres();
      if (pg) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("tools", EXTENSIONS_CREATE_SQL_PG);
        await migrateMisnamedExtensionsTable(client, pg); // data migration, not DDL — unchanged
        await ensureTableExists("tool_shares", EXTENSION_SHARES_CREATE_SQL_PG);
        await ensureTableExists("tool_data", EXTENSION_DATA_CREATE_SQL_PG);
        await ensureExtensionDataItemId(client, pg); // ADD COLUMN — guarded inside
        await ensureExtensionDataScope(client, pg); // ADD COLUMN — guarded inside
        // DROP INDEX (for old index) — safe DDL, runs via client.execute; keep on both paths
        await client.execute(EXTENSION_DATA_DROP_OLD_INDEX_SQL_PG);
        await ensureIndexExists(
          "tool_data_scoped_item_idx",
          EXTENSION_DATA_ITEM_INDEX_SQL_PG,
        );
        await ensureIndexExists("tools_owner_idx", EXTENSIONS_OWNER_INDEX_SQL);
        await ensureIndexExists("tools_org_idx", EXTENSIONS_ORG_INDEX_SQL);
        await ensureIndexExists(
          "tools_updated_at_idx",
          EXTENSIONS_UPDATED_INDEX_SQL,
        );
        await ensureExtensionsGlobalHideColumns(client, pg); // ADD COLUMN — guarded inside
        await ensureIndexExists(
          "tools_hidden_at_idx",
          EXTENSIONS_HIDDEN_AT_INDEX_SQL,
        );
        await ensureIndexExists(
          "tool_shares_resource_idx",
          EXTENSION_SHARES_RESOURCE_INDEX_SQL,
        );
        await ensureTableExists(
          "tool_hidden_extensions",
          EXTENSION_HIDES_CREATE_SQL_PG,
        );
        await ensureIndexExists(
          "tool_hidden_extensions_user_tool_idx",
          EXTENSION_HIDES_UNIQUE_INDEX_SQL,
        );
        await ensureIndexExists(
          "tool_hidden_extensions_owner_idx",
          EXTENSION_HIDES_OWNER_INDEX_SQL,
        );
        await ensureTableExists(
          "tool_history",
          EXTENSION_HISTORY_CREATE_SQL_PG,
        );
        await ensureIndexExists(
          "tool_history_tool_version_idx",
          EXTENSION_HISTORY_VERSION_INDEX_SQL,
        );
        await ensureIndexExists(
          "tool_history_tool_created_idx",
          EXTENSION_HISTORY_CREATED_INDEX_SQL,
        );
        await ensureTableExists(
          "tool_consents",
          EXTENSION_CONSENTS_CREATE_SQL_PG,
        );
        await ensureIndexExists(
          "tool_consents_viewer_idx",
          EXTENSION_CONSENTS_VIEWER_INDEX_SQL,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await retryOnDdlRace(() =>
        client.execute(pg ? EXTENSIONS_CREATE_SQL_PG : EXTENSIONS_CREATE_SQL),
      );
      await migrateMisnamedExtensionsTable(client, pg);
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_SHARES_CREATE_SQL_PG : EXTENSION_SHARES_CREATE_SQL,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_DATA_CREATE_SQL_PG : EXTENSION_DATA_CREATE_SQL,
        ),
      );
      await ensureExtensionDataItemId(client, pg);
      await ensureExtensionDataScope(client, pg);
      await client.execute(
        pg
          ? EXTENSION_DATA_DROP_OLD_INDEX_SQL_PG
          : EXTENSION_DATA_DROP_OLD_INDEX_SQL,
      );
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_DATA_ITEM_INDEX_SQL_PG : EXTENSION_DATA_ITEM_INDEX_SQL,
        ),
      );
      await retryOnDdlRace(() => client.execute(EXTENSIONS_OWNER_INDEX_SQL));
      await retryOnDdlRace(() => client.execute(EXTENSIONS_ORG_INDEX_SQL));
      await retryOnDdlRace(() => client.execute(EXTENSIONS_UPDATED_INDEX_SQL));
      await ensureExtensionsGlobalHideColumns(client, pg);
      await retryOnDdlRace(() =>
        client.execute(EXTENSIONS_HIDDEN_AT_INDEX_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_SHARES_RESOURCE_INDEX_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_HIDES_CREATE_SQL_PG : EXTENSION_HIDES_CREATE_SQL,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_HIDES_UNIQUE_INDEX_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_HIDES_OWNER_INDEX_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_HISTORY_CREATE_SQL_PG : EXTENSION_HISTORY_CREATE_SQL,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_HISTORY_VERSION_INDEX_SQL),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_HISTORY_CREATED_INDEX_SQL),
      );
      // tool_consents was introduced for an audit-C1 per-viewer consent
      // gate that we removed once we settled on intra-org trust as the
      // baseline. The table is kept (additive — never drop) so deploys
      // that already created it stay healthy; the runtime consent code
      // is gone. Idempotent CREATE IF NOT EXISTS for fresh schemas.
      await retryOnDdlRace(() =>
        client.execute(
          pg ? EXTENSION_CONSENTS_CREATE_SQL_PG : EXTENSION_CONSENTS_CREATE_SQL,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(EXTENSION_CONSENTS_VIEWER_INDEX_SQL),
      );
    })();
  }

  try {
    await _initPromise;
  } catch (err) {
    _initPromise = undefined;
    throw err;
  }
}

async function migrateMisnamedExtensionsTable(
  client: ReturnType<typeof getDbExec>,
  pg: boolean,
): Promise<void> {
  const sql = pg
    ? `INSERT INTO tools (id, name, description, content, icon, created_at, updated_at, owner_email, org_id, visibility)
       SELECT id, name, description, content, icon, created_at, updated_at, owner_email, org_id, visibility
       FROM extensions
       ON CONFLICT (id) DO NOTHING`
    : `INSERT OR IGNORE INTO tools (id, name, description, content, icon, created_at, updated_at, owner_email, org_id, visibility)
       SELECT id, name, description, content, icon, created_at, updated_at, owner_email, org_id, visibility
       FROM extensions`;

  try {
    await client.execute(sql);
  } catch (err: any) {
    const message = String(err?.message ?? err).toLowerCase();
    if (
      message.includes("no such table: extensions") ||
      message.includes('relation "extensions" does not exist') ||
      message.includes("relation extensions does not exist")
    ) {
      return;
    }
    throw err;
  }
}

async function ensureExtensionDataItemId(
  client: ReturnType<typeof getDbExec>,
  pg: boolean,
): Promise<void> {
  if (pg) {
    await ensureColumnExists(
      "tool_data",
      "item_id",
      `ALTER TABLE tool_data ADD COLUMN IF NOT EXISTS item_id TEXT`,
    );
    return;
  }

  // Keep this additive: legacy rows with item_id=id are still read correctly
  // through COALESCE(item_id, id), so SQLite never needs a table rebuild here.
  try {
    await client.execute(`ALTER TABLE tool_data ADD COLUMN item_id TEXT`);
  } catch (err: any) {
    if (
      !String(err?.message ?? err)
        .toLowerCase()
        .includes("duplicate")
    ) {
      throw err;
    }
  }
}

async function ensureExtensionDataScope(
  client: ReturnType<typeof getDbExec>,
  pg: boolean,
): Promise<void> {
  const addCol = (name: string, def: string) => {
    if (pg) {
      return ensureColumnExists(
        "tool_data",
        name,
        `ALTER TABLE tool_data ADD COLUMN IF NOT EXISTS ${name} ${def}`,
      );
    }
    return client
      .execute(`ALTER TABLE tool_data ADD COLUMN ${name} ${def}`)
      .catch((err: any) => {
        if (
          !String(err?.message ?? err)
            .toLowerCase()
            .includes("duplicate")
        )
          throw err;
      });
  };
  await addCol("scope", "TEXT NOT NULL DEFAULT 'user'");
  await addCol("org_id", "TEXT");
  await addCol("scope_key", "TEXT NOT NULL DEFAULT 'local@localhost'");
  // One-time backfill migration: replaces the dev-mode DEFAULT scope_key
  // with each row's real owner_email. Not a per-request fallback.
  await client.execute(
    // guard:allow-localhost-fallback — one-time backfill migration replacing dev-mode default scope_key with the row's real owner_email
    `UPDATE tool_data SET scope_key = owner_email WHERE scope_key = 'local@localhost' AND owner_email != 'local@localhost'`,
  );
}

async function ensureExtensionsGlobalHideColumns(
  client: ReturnType<typeof getDbExec>,
  pg: boolean,
): Promise<void> {
  // Global (admin) hide columns on the `tools` row, distinct from the
  // per-user `tool_hidden_extensions` table. Additive — keep this idempotent
  // for both dialects. Postgres supports `ADD COLUMN IF NOT EXISTS`; SQLite
  // does not, so we drop the clause and swallow the duplicate-column error.
  const addCol = (pgSql: string, name: string, def: string) => {
    if (pg) {
      return ensureColumnExists("tools", name, pgSql);
    }
    return client
      .execute(`ALTER TABLE tools ADD COLUMN ${name} ${def}`)
      .catch((err: any) => {
        if (
          !String(err?.message ?? err)
            .toLowerCase()
            .includes("duplicate")
        )
          throw err;
      });
  };
  await addCol(EXTENSIONS_HIDDEN_AT_COLUMN_SQL, "hidden_at", "TEXT");
  await addCol(EXTENSIONS_HIDDEN_BY_COLUMN_SQL, "hidden_by", "TEXT");
}

export function registerExtensionsShareable() {
  registerShareableResource({
    type: "extension",
    resourceTable: extensions,
    sharesTable: extensionShares,
    displayName: "Extension",
    titleColumn: "name",
    getDb: () => getDb(),
    // Extension HTML executes inside an iframe and calls actions / SQL / the
    // secrets-injecting proxy as the *viewer*. A public extension would let a
    // random authenticated user run code with the viewer's credentials — and
    // a malicious shared extension could re-share itself wider. Lock both:
    // no public visibility, and individual user shares must already be (or
    // be invited to) the org.
    allowPublic: false,
    requireOrgMemberForUserShares: true,
  });
}

export interface ExtensionRow {
  id: string;
  name: string;
  description: string;
  content: string;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  hiddenAt: string | null;
  hiddenBy: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

export type ExtensionHistoryOperation =
  | "create"
  | "baseline"
  | "metadata-update"
  | "content-update"
  | "restore";

export interface ExtensionHistoryEntry {
  id: string;
  extensionId: string;
  version: number;
  operation: ExtensionHistoryOperation | string;
  summary: string;
  name: string;
  description: string;
  content?: string;
  icon: string | null;
  actorEmail: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  persisted: boolean;
  contentLength: number;
}

export interface ExtensionHistoryDiffLine {
  type: "equal" | "insert" | "delete";
  text: string;
}

export interface ExtensionHistoryDetail {
  entry: ExtensionHistoryEntry;
  previous: ExtensionHistoryEntry | null;
  diff: ExtensionHistoryDiffLine[];
  stats: {
    addedLines: number;
    deletedLines: number;
    changed: boolean;
  };
}

interface RawExtensionHistoryRow {
  id: string;
  tool_id?: string;
  extensionId?: string;
  version: number | string;
  operation: string;
  summary?: string | null;
  name: string;
  description?: string | null;
  content?: string | null;
  icon?: string | null;
  actor_email?: string | null;
  actorEmail?: string | null;
  owner_email?: string | null;
  ownerEmail?: string | null;
  org_id?: string | null;
  orgId?: string | null;
  visibility?: string | null;
  created_at?: string;
  createdAt?: string;
}

function targetKey(target: ExtensionChangeTarget): string | null {
  if (target.owner) return `owner:${target.owner}`;
  if (target.orgId) return `org:${target.orgId}`;
  return null;
}

function addExtensionChangeTarget(
  targets: Map<string, ExtensionChangeTarget>,
  target: ExtensionChangeTarget,
): void {
  const key = targetKey(target);
  if (key) targets.set(key, target);
}

async function extensionChangeTargetsForRow(
  row: ExtensionRow,
): Promise<ExtensionChangeTarget[]> {
  const targets = new Map<string, ExtensionChangeTarget>();
  addExtensionChangeTarget(targets, { owner: row.ownerEmail });
  if (row.visibility === "org" && row.orgId) {
    addExtensionChangeTarget(targets, { orgId: row.orgId });
  }

  const db = getDb();
  const shares = (await db
    .select({
      principalType: extensionShares.principalType,
      principalId: extensionShares.principalId,
    })
    .from(extensionShares)
    .where(eq(extensionShares.resourceId, row.id))) as Array<{
    principalType: "user" | "org";
    principalId: string;
  }>;

  for (const share of shares) {
    if (share.principalType === "user") {
      addExtensionChangeTarget(targets, { owner: share.principalId });
    } else if (share.principalType === "org") {
      addExtensionChangeTarget(targets, { orgId: share.principalId });
    }
  }

  return Array.from(targets.values());
}

async function extensionChangeTargetsForId(
  id: string,
): Promise<ExtensionChangeTarget[]> {
  const db = getDb();
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  const row = rows[0] as ExtensionRow | undefined;
  return row ? extensionChangeTargetsForRow(row) : [];
}

export async function getExtensionChangeTargets(
  id: string,
): Promise<ExtensionChangeTarget[]> {
  await ensureExtensionsTables();
  return extensionChangeTargetsForId(id);
}

function dedupeExtensionChangeTargets(
  targets: ExtensionChangeTarget[],
): ExtensionChangeTarget[] {
  const unique = new Map<string, ExtensionChangeTarget>();
  for (const target of targets) {
    const key = targetKey(target);
    if (key) unique.set(key, target);
  }
  return Array.from(unique.values());
}

async function notifyExtensionChanged(
  targets: ExtensionChangeTarget[],
): Promise<void> {
  const uniqueTargets = dedupeExtensionChangeTargets(targets);
  if (uniqueTargets.length === 0) return;

  for (const target of uniqueTargets) {
    recordChange({
      source: "extensions",
      type: "change",
      key: "*",
      ...(target.owner ? { owner: target.owner } : {}),
      ...(target.orgId ? { orgId: target.orgId } : {}),
    });
  }

  await Promise.all(
    uniqueTargets.map(async (target) => {
      const sessionId = extensionChangeMarkerSession(target);
      if (!sessionId) return;
      await appStatePut(
        sessionId,
        EXTENSION_CHANGE_MARKER_KEY,
        extensionChangeMarkerValue(target),
      );
    }),
  );
}

export async function notifyExtensionChangeForResource(
  id: string,
  beforeTargets: ExtensionChangeTarget[] = [],
): Promise<void> {
  await ensureExtensionsTables();
  await notifyExtensionChanged([
    ...beforeTargets,
    ...(await extensionChangeTargetsForId(id)),
  ]);
}

function extensionHistoryEntryFromRaw(
  row: RawExtensionHistoryRow,
  includeContent: boolean,
): ExtensionHistoryEntry {
  const content = row.content ?? "";
  const visibility = normalizeVisibility(row.visibility);
  return {
    id: row.id,
    extensionId: String(row.tool_id ?? row.extensionId ?? ""),
    version: Number(row.version) || 1,
    operation: row.operation,
    summary: row.summary ?? "",
    name: row.name,
    description: row.description ?? "",
    ...(includeContent ? { content } : {}),
    icon: row.icon ?? null,
    actorEmail: row.actor_email ?? row.actorEmail ?? null,
    ownerEmail: row.owner_email ?? row.ownerEmail ?? "",
    orgId: row.org_id ?? row.orgId ?? null,
    visibility,
    createdAt: row.created_at ?? row.createdAt ?? new Date(0).toISOString(),
    persisted: true,
    contentLength: content.length,
  };
}

function extensionHistoryEntryFromExtension(
  row: ExtensionRow,
  includeContent: boolean,
): ExtensionHistoryEntry {
  return {
    id: `current:${row.id}`,
    extensionId: row.id,
    version: 1,
    operation: "baseline",
    summary: "Current version",
    name: row.name,
    description: row.description,
    ...(includeContent ? { content: row.content } : {}),
    icon: row.icon,
    actorEmail: null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    visibility: row.visibility,
    createdAt: row.updatedAt,
    persisted: false,
    contentLength: row.content.length,
  };
}

function normalizeVisibility(value: unknown): "private" | "org" | "public" {
  return value === "org" || value === "public" ? value : "private";
}

function currentActorEmail(): string | null {
  return getRequestUserEmail() ?? null;
}

function clampHistoryLimit(value: unknown): number {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(1, Math.floor(limit)), 100);
}

async function historyVersionCount(extensionId: string): Promise<number> {
  const result = await getDbExec().execute({
    sql: `SELECT MAX(version) AS version FROM tool_history WHERE tool_id = ?`,
    args: [extensionId],
  });
  const value = (result.rows?.[0] as any)?.version;
  const version = Number(value ?? 0);
  return Number.isFinite(version) ? version : 0;
}

async function hasExtensionHistory(extensionId: string): Promise<boolean> {
  const result = await getDbExec().execute({
    sql: `SELECT id FROM tool_history WHERE tool_id = ? LIMIT 1`,
    args: [extensionId],
  });
  return (result.rows?.length ?? 0) > 0;
}

async function recordExtensionHistorySnapshot(
  row: ExtensionRow,
  operation: ExtensionHistoryOperation,
  summary: string,
): Promise<ExtensionHistoryEntry> {
  const version = (await historyVersionCount(row.id)) + 1;
  const now = new Date().toISOString();
  const historyId = randomUUID();
  await getDbExec().execute({
    sql: `INSERT INTO tool_history (
      id, tool_id, version, operation, summary, name, description, content,
      icon, actor_email, owner_email, org_id, visibility, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      historyId,
      row.id,
      version,
      operation,
      summary,
      row.name,
      row.description,
      row.content,
      row.icon,
      currentActorEmail(),
      row.ownerEmail,
      row.orgId,
      row.visibility,
      now,
    ],
  });

  return {
    id: historyId,
    extensionId: row.id,
    version,
    operation,
    summary,
    name: row.name,
    description: row.description,
    content: row.content,
    icon: row.icon,
    actorEmail: currentActorEmail(),
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    visibility: row.visibility,
    createdAt: now,
    persisted: true,
    contentLength: row.content.length,
  };
}

async function ensureExtensionHistoryBaseline(
  row: ExtensionRow,
): Promise<void> {
  if (await hasExtensionHistory(row.id)) return;
  await recordExtensionHistorySnapshot(
    row,
    "baseline",
    "Saved starting version",
  );
}

function summarizeMetadataChange(
  before: ExtensionRow,
  after: ExtensionRow,
): string {
  const changes: string[] = [];
  if (before.name !== after.name) {
    changes.push(`Renamed from "${before.name}" to "${after.name}"`);
  }
  if (before.description !== after.description) {
    changes.push("Updated description");
  }
  if (before.icon !== after.icon) {
    changes.push("Updated icon");
  }
  if (before.visibility !== after.visibility) {
    changes.push(`Changed visibility to ${after.visibility}`);
  }
  return changes.join("; ") || "Updated details";
}

function summarizeContentChange(
  beforeContent: string,
  afterContent: string,
): string {
  const stats = diffStats(createLineDiff(beforeContent, afterContent));
  if (!stats.changed) return "Saved content";
  return `Updated content (+${stats.addedLines} -${stats.deletedLines} lines)`;
}

function parseHistoryVersion(version: unknown): number | null {
  const parsed = Number(version);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

async function getPersistedHistoryEntry(
  extensionId: string,
  version: number,
  includeContent: boolean,
): Promise<ExtensionHistoryEntry | null> {
  const result = await getDbExec().execute({
    sql: `SELECT id, tool_id, version, operation, summary, name, description,
      content, icon, actor_email, owner_email, org_id, visibility, created_at
      FROM tool_history
      WHERE tool_id = ? AND version = ?
      LIMIT 1`,
    args: [extensionId, version],
  });
  const row = result.rows?.[0] as RawExtensionHistoryRow | undefined;
  return row ? extensionHistoryEntryFromRaw(row, includeContent) : null;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const parts = text.split("\n");
  return parts
    .map((line, index) => (index < parts.length - 1 ? `${line}\n` : line))
    .filter((line) => line.length > 0);
}

function createLineDiff(
  beforeText: string,
  afterText: string,
): ExtensionHistoryDiffLine[] {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  if (before.length === 0 && after.length === 0) return [];

  const cells = before.length * after.length;
  if (cells > 40_000) return createBoundaryDiff(before, after);

  const dp = Array.from({ length: before.length + 1 }, () =>
    Array(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        before[i] === after[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const diff: ExtensionHistoryDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      diff.push({ type: "equal", text: before[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "delete", text: before[i] });
      i += 1;
    } else {
      diff.push({ type: "insert", text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    diff.push({ type: "delete", text: before[i] });
    i += 1;
  }
  while (j < after.length) {
    diff.push({ type: "insert", text: after[j] });
    j += 1;
  }
  return diff;
}

function createBoundaryDiff(
  before: string[],
  after: string[],
): ExtensionHistoryDiffLine[] {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix + prefix < before.length &&
    suffix + prefix < after.length &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return [
    ...before
      .slice(0, prefix)
      .map((text) => ({ type: "equal" as const, text })),
    ...before
      .slice(prefix, before.length - suffix)
      .map((text) => ({ type: "delete" as const, text })),
    ...after
      .slice(prefix, after.length - suffix)
      .map((text) => ({ type: "insert" as const, text })),
    ...before
      .slice(before.length - suffix)
      .map((text) => ({ type: "equal" as const, text })),
  ];
}

function diffStats(diff: ExtensionHistoryDiffLine[]): {
  addedLines: number;
  deletedLines: number;
  changed: boolean;
} {
  const addedLines = diff.filter((line) => line.type === "insert").length;
  const deletedLines = diff.filter((line) => line.type === "delete").length;
  return {
    addedLines,
    deletedLines,
    changed: addedLines > 0 || deletedLines > 0,
  };
}

export interface ListExtensionsOptions {
  includeHidden?: boolean;
  /**
   * Include extensions an admin/owner has globally hidden via `hidden_at`.
   * Off by default so globally-hidden extensions disappear for everyone.
   */
  includeGloballyHidden?: boolean;
}

export async function listExtensions(
  options: ListExtensionsOptions = {},
): Promise<ExtensionRow[]> {
  await ensureExtensionsTables();
  const db = getDb();
  // Build the WHERE with a single `and()` — drizzle replaces (not ANDs)
  // on repeated `.where()` calls, so combine the access filter and the
  // global-hidden filter into one condition.
  const base = accessFilter(extensions, extensionShares);
  const where = options.includeGloballyHidden
    ? base
    : and(base, isNull(extensions.hiddenAt));
  const rows = (await db
    .select()
    .from(extensions)
    .where(where)) as ExtensionRow[];

  if (options.includeHidden) return rows;

  const hiddenIds = await getHiddenExtensionIdsForCurrentUser();
  if (hiddenIds.size === 0) return rows;
  return rows.filter((row) => !hiddenIds.has(row.id));
}

export async function getExtension(id: string): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  const access = await resolveAccess("extension", id);
  return (access?.resource as ExtensionRow | undefined) ?? null;
}

export interface ListExtensionHistoryOptions {
  limit?: number;
  includeContent?: boolean;
}

export async function listExtensionHistory(
  id: string,
  options: ListExtensionHistoryOptions = {},
): Promise<ExtensionHistoryEntry[]> {
  await ensureExtensionsTables();
  const extension = await getExtension(id);
  if (!extension) return [];

  const includeContent = options.includeContent === true;
  const limit = clampHistoryLimit(options.limit);
  const result = await getDbExec().execute({
    sql: `SELECT id, tool_id, version, operation, summary, name, description,
      content, icon, actor_email, owner_email, org_id, visibility, created_at
      FROM tool_history
      WHERE tool_id = ?
      ORDER BY version DESC
      LIMIT ?`,
    args: [id, limit],
  });

  const entries = (result.rows ?? []).map((row) =>
    extensionHistoryEntryFromRaw(row as RawExtensionHistoryRow, includeContent),
  );

  if (entries.length > 0) return entries;
  return [extensionHistoryEntryFromExtension(extension, includeContent)];
}

export async function getExtensionHistoryVersion(
  id: string,
  versionValue: number | string,
): Promise<ExtensionHistoryDetail | null> {
  await ensureExtensionsTables();
  const extension = await getExtension(id);
  if (!extension) return null;

  const version = parseHistoryVersion(versionValue);
  if (!version) return null;

  const persisted = await getPersistedHistoryEntry(id, version, true);
  const entry =
    persisted ??
    (!(await hasExtensionHistory(id)) && version === 1
      ? extensionHistoryEntryFromExtension(extension, true)
      : null);
  if (!entry) return null;

  const previous =
    version > 1 ? await getPersistedHistoryEntry(id, version - 1, true) : null;
  const previousContent = previous?.content ?? "";
  const currentContent = entry.content ?? "";
  const diff = createLineDiff(previousContent, currentContent);

  return {
    entry,
    previous,
    diff,
    stats: diffStats(diff),
  };
}

export async function restoreExtensionHistoryVersion(
  id: string,
  versionValue: number | string,
): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "editor");

  const version = parseHistoryVersion(versionValue);
  if (!version) return null;

  const existingRows = await getDb()
    .select()
    .from(extensions)
    .where(eq(extensions.id, id));
  const existing = existingRows[0] as ExtensionRow | undefined;
  if (!existing) return null;

  await ensureExtensionHistoryBaseline(existing);
  const target = await getPersistedHistoryEntry(id, version, true);
  if (!target) return null;

  const beforeTargets = await extensionChangeTargetsForId(id);
  await getDb()
    .update(extensions)
    .set({
      name: target.name,
      description: target.description,
      content: target.content ?? "",
      icon: target.icon,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(extensions.id, id));

  const rows = await getDb()
    .select()
    .from(extensions)
    .where(eq(extensions.id, id));
  const row = (rows[0] as ExtensionRow) ?? null;
  if (row) {
    await recordExtensionHistorySnapshot(
      row,
      "restore",
      `Restored version ${version}`,
    );
    await notifyExtensionChanged([
      ...beforeTargets,
      ...(await extensionChangeTargetsForRow(row)),
    ]);
  }
  return row;
}

export interface CreateExtensionData {
  name: string;
  description?: string;
  content?: string;
  icon?: string;
}

export async function createExtension(
  data: CreateExtensionData,
): Promise<ExtensionRow> {
  await ensureExtensionsTables();
  const db = getDb();
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: ExtensionRow = {
    id,
    name: data.name,
    description: data.description ?? "",
    content: data.content ?? "",
    icon: data.icon ?? null,
    createdAt: now,
    updatedAt: now,
    hiddenAt: null,
    hiddenBy: null,
    ownerEmail: userEmail,
    orgId: orgId ?? null,
    visibility: "private",
  };
  await db.insert(extensions).values(row);
  await recordExtensionHistorySnapshot(row, "create", "Created extension");
  await notifyExtensionChanged([{ owner: row.ownerEmail }]);
  return row;
}

/**
 * Returns an extension with the exact same name and content created by the
 * current user — in the current org/workspace scope — in the last 5 minutes,
 * or null if none exists. Used to make create-extension idempotent when a
 * connection drop causes the agent to retry the same tool call.
 *
 * Scoped by `orgId` the same way `createExtension` stamps it, so the same
 * `ownerEmail` working in two different orgs can create identically-named,
 * identical-content extensions without this lookup cross-matching and skipping
 * the second insert. Keyed on the FULL create inputs (name + content +
 * description + icon, normalized exactly as `createExtension` stores them), so
 * two creates that differ in any of them are treated as distinct — only a
 * byte-identical re-create (the connection-retry case) recovers the prior row,
 * and no intentional second create silently loses its metadata.
 */
export async function findRecentDuplicateExtension(data: {
  name: string;
  content: string;
  description?: string;
  icon?: string;
}): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  const db = getDb();
  const userEmail = getRequestUserEmail();
  if (!userEmail) return null;
  const orgId = getRequestOrgId() ?? null;
  const description = data.description ?? "";
  const icon = data.icon ?? null;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rows = await db
    .select()
    .from(extensions)
    .where(
      and(
        eq(extensions.ownerEmail, userEmail),
        orgId === null ? isNull(extensions.orgId) : eq(extensions.orgId, orgId),
        eq(extensions.name, data.name),
        eq(extensions.content, data.content),
        eq(extensions.description, description),
        icon === null ? isNull(extensions.icon) : eq(extensions.icon, icon),
        gte(extensions.createdAt, fiveMinutesAgo),
        isNull(extensions.hiddenAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdateExtensionData {
  name?: string;
  description?: string;
  icon?: string;
  /**
   * Extensions cannot be public — `set-resource-visibility` and this store
   * helper both reject `"public"`. The type lists it so the framework's
   * generic share UI compiles, not because it's allowed at runtime.
   */
  visibility?: "private" | "org" | "public";
}

export async function updateExtension(
  id: string,
  data: UpdateExtensionData,
): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "editor");
  if (data.visibility === "public") {
    // Defense in depth — `registerExtensionsShareable` sets
    // `allowPublic: false`, so `set-resource-visibility` already rejects
    // this. Block direct callers too (HTTP `PUT /extensions/:id`, internal
    // refactors) so the rule holds regardless of entry point.
    throw new ForbiddenError(
      "Extensions cannot be made public — share with specific people or your organization instead.",
    );
  }
  const db = getDb();
  const beforeTargets = await extensionChangeTargetsForId(id);
  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.icon !== undefined) updates.icon = data.icon;
  if (data.visibility !== undefined) updates.visibility = data.visibility;
  const existingRows = await db
    .select()
    .from(extensions)
    .where(eq(extensions.id, id));
  const existing = existingRows[0] as ExtensionRow | undefined;
  if (!existing) return null;
  await ensureExtensionHistoryBaseline(existing);
  await db.update(extensions).set(updates).where(eq(extensions.id, id));
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  const row = (rows[0] as ExtensionRow) ?? null;
  if (row) {
    await recordExtensionHistorySnapshot(
      row,
      "metadata-update",
      summarizeMetadataChange(existing, row),
    );
    await notifyExtensionChanged([
      ...beforeTargets,
      ...(await extensionChangeTargetsForRow(row)),
    ]);
  }
  return row;
}

export interface UpdateExtensionContentOpts {
  content?: string;
  patches?: ExtensionLegacyPatch[];
  edits?: ExtensionContentEdit[];
  format?: boolean;
}

export async function updateExtensionContent(
  id: string,
  opts: UpdateExtensionContentOpts,
): Promise<ExtensionRow | null> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "editor");
  const db = getDb();

  if (
    opts.content === undefined &&
    opts.patches === undefined &&
    opts.edits === undefined &&
    !opts.format
  ) {
    return null;
  }

  const existingRows = await db
    .select()
    .from(extensions)
    .where(eq(extensions.id, id));
  if (!existingRows[0]) return null;
  const existing = existingRows[0] as ExtensionRow;
  const existingContent = existing.content;
  await ensureExtensionHistoryBaseline(existing);
  const update = await applyExtensionContentUpdate(existingContent, opts);

  const beforeTargets = await extensionChangeTargetsForId(id);
  await db
    .update(extensions)
    .set({ content: update.content, updatedAt: new Date().toISOString() })
    .where(eq(extensions.id, id));
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  const row = (rows[0] as ExtensionRow) ?? null;
  if (row) {
    await recordExtensionHistorySnapshot(
      row,
      "content-update",
      summarizeContentChange(existingContent, row.content),
    );
    await notifyExtensionChanged([
      ...beforeTargets,
      ...(await extensionChangeTargetsForRow(row)),
    ]);
  }
  return row;
}

export async function deleteExtension(id: string): Promise<boolean> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "admin");
  const db = getDb();
  const rows = await db.select().from(extensions).where(eq(extensions.id, id));
  const row = rows[0] as ExtensionRow | undefined;
  if (!row) return false;
  const targets = await extensionChangeTargetsForRow(row);
  await db.delete(extensionShares).where(eq(extensionShares.resourceId, id));
  await db.delete(extensionHides).where(eq(extensionHides.extensionId, id));
  await getDbExec().execute({
    sql: `DELETE FROM tool_data WHERE tool_id = ?`,
    args: [id],
  });
  await getDbExec().execute({
    sql: `DELETE FROM tool_history WHERE tool_id = ?`,
    args: [id],
  });
  const { cascadeDeleteExtensionSlots } = await import("./slots/store.js");
  await cascadeDeleteExtensionSlots(id);
  await db.delete(extensions).where(eq(extensions.id, id));
  await notifyExtensionChanged(targets);
  return true;
}

export async function getHiddenExtensionIdsForCurrentUser(): Promise<
  Set<string>
> {
  await ensureExtensionsTables();
  const userEmail = getRequestUserEmail();
  if (!userEmail) return new Set();

  const db = getDb();
  const rows = await db
    .select({ extensionId: extensionHides.extensionId })
    .from(extensionHides)
    .where(eq(extensionHides.ownerEmail, userEmail));
  return new Set(rows.map((row) => row.extensionId));
}

export async function hideExtension(id: string): Promise<boolean> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "viewer");
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const now = new Date().toISOString();
  await getDbExec().execute({
    sql: `INSERT INTO tool_hidden_extensions (id, tool_id, owner_email, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (owner_email, tool_id) DO NOTHING`,
    args: [randomUUID(), id, userEmail, now],
  });
  await notifyExtensionChanged([{ owner: userEmail }]);
  return true;
}

export async function unhideExtension(id: string): Promise<boolean> {
  await ensureExtensionsTables();
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  await getDbExec().execute({
    sql: `DELETE FROM tool_hidden_extensions WHERE tool_id = ? AND owner_email = ?`,
    args: [id, userEmail],
  });
  await notifyExtensionChanged([{ owner: userEmail }]);
  return true;
}

/**
 * Globally hide an extension from EVERYONE's list by stamping `hidden_at` /
 * `hidden_by` on the `tools` row. Distinct from the per-user `hideExtension`
 * (`tool_hidden_extensions`) — this affects all viewers. Requires admin/owner
 * access. The extension is not deleted and stays accessible by id; pass
 * `includeGloballyHidden: true` to `listExtensions` to surface it again.
 */
export async function globalHideExtension(id: string): Promise<boolean> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "admin");
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const beforeTargets = await extensionChangeTargetsForId(id);
  const now = new Date().toISOString();
  await getDbExec().execute({
    sql: `UPDATE tools SET hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?`,
    args: [now, userEmail, now, id],
  });
  await notifyExtensionChanged([
    ...beforeTargets,
    ...(await extensionChangeTargetsForId(id)),
  ]);
  return true;
}

/**
 * Clear a global hide so the extension reappears in everyone's list. Requires
 * admin/owner access. Mirrors `globalHideExtension`.
 */
export async function globalUnhideExtension(id: string): Promise<boolean> {
  await ensureExtensionsTables();
  await assertAccess("extension", id, "admin");
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const beforeTargets = await extensionChangeTargetsForId(id);
  const now = new Date().toISOString();
  await getDbExec().execute({
    sql: `UPDATE tools SET hidden_at = NULL, hidden_by = NULL, updated_at = ? WHERE id = ?`,
    args: [now, id],
  });
  await notifyExtensionChanged([
    ...beforeTargets,
    ...(await extensionChangeTargetsForId(id)),
  ]);
  return true;
}
