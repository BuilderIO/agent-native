import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { setActionChangeFastPath } from "../action-change-fast-path.js";
import {
  actionChangeDedupeKey,
  ACTION_CHANGE_MARKER_KEY,
  parseActionChangeMarker,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import {
  type DbExec,
  getDbExec,
  isProductionServerlessFunctionRuntime,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { appMigratesAtRelease } from "../db/migration-policy.js";
import { retainRequestDbPoolScope } from "../db/request-pool-context.js";
import { defineStore } from "../db/store-registry.js";
import {
  EXTENSION_CHANGE_MARKER_KEY,
  parseExtensionChangeMarker,
  type ExtensionChangeTarget,
} from "../extensions/change-marker.js";
import {
  registerRecurringSweepHandler,
  type RecurringSweepContext,
} from "../jobs/sweep-hooks.js";
import { recordUnreadableSyncEvent } from "../observability/metrics.js";
import { REALTIME_REGISTRATION_SETTING_KEY } from "../realtime-registration-key.js";
import { getSettingsEmitter } from "../settings/store.js";
import { getHttpRequestTelemetryId } from "./http-response-telemetry.js";
import {
  pruneSyncEvents,
  SYNC_EVENTS_PRUNE_STATE_TABLE,
  type SyncEventsPruneOptions,
  type SyncEventsPruneResult,
} from "./sync-events-prune.js";

export interface ChangeEvent {
  version: number;
  cursorId?: string;
  source: string;
  type: string;
  key?: string;
  owner?: string;
  orgId?: string;
  resourceType?: string;
  resourceId?: string;
  visibility?: "public";
  [k: string]: unknown;
}

type ChangeVisibilityTarget = Pick<
  ChangeEvent,
  "owner" | "orgId" | "resourceType" | "resourceId" | "visibility"
> &
  Partial<Pick<ChangeEvent, "source" | "key">>;

export interface TransactionalChange {
  persist(transaction: DbExec): Promise<ChangeEvent>;
  isPersisted(): boolean;
  publish(): ChangeEvent;
}

export class SyncEventReadError extends Error {
  readonly code = "SYNC_EVENT_READ_UNAVAILABLE";

  constructor() {
    super("A sync event could not be read; clients must refresh their data.");
    this.name = "SyncEventReadError";
  }
}

const MAX_BUFFER = 200;
const DURABLE_READ_LIMIT = 1000;
const DURABLE_PRUNE_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const DURABLE_PRUNE_WRITE_BUDGET_MS = 3_000;
const DURABLE_PRUNE_SWEEP_BUDGET_MS = 20_000;
export const SYNC_EVENTS_PRUNE_SWEEP_ID = "sync-events-prune";
export const SYNC_EVENTS_PRUNE_STATE_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${SYNC_EVENTS_PRUNE_STATE_TABLE} (
    id INT PRIMARY KEY,
    cursor_version BIGINT NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at BIGINT,
    last_run_at BIGINT,
    last_checked_at BIGINT,
    last_success_at BIGINT,
    last_deleted BIGINT NOT NULL DEFAULT 0,
    total_deleted BIGINT NOT NULL DEFAULT 0,
    backlog BOOLEAN NOT NULL DEFAULT FALSE,
    consecutive_failures INT NOT NULL DEFAULT 0,
    last_error TEXT,
    last_error_at BIGINT
  )
`;
const ACTION_MARKER_REPLAY_WINDOW_MS = 60_000;
const LEGACY_DB_CHECK_INTERVAL_MS = 1000;
export const DURABLE_LEGACY_DB_CHECK_INTERVAL_MS = 30_000;
export const POLL_CHANGE_EVENT = "poll-change";

const ACCESS_CACHE_TTL_MS = 30_000;
const ACCESS_CACHE_DENY_TTL_MS = 5_000;
const ACCESS_CACHE_MAX = 5_000;
const ACCESS_PRIME_LIMIT = 250;
const ACCESS_RETRY_LIMIT = 8;
const ACCESS_CHECKS_AT_ONCE = 8;
const ACCESS_IN_FLIGHT_MAX = 1_000;
const ACCESS_SINGLE_CHECK_ROOM = 250;
const ACCESS_CHECK_TIMEOUT_MS = 30_000;
const ACCESS_CHECK_TIMEOUTS_MAX = 2;
const ACCESS_CHECK_WAIT_MS = 1_000;
const SCREEN_REFRESH_KEY = "__screen_refresh__";
const SCREEN_REFRESH_QUERY_LIMIT = 256;

const SEED_SYNC_VERSION_SQL = `
  INSERT INTO sync_version (id, v)
  SELECT 1, GREATEST(
    COALESCE((SELECT MAX(version) FROM sync_events), 0),
    (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
  )
  ON CONFLICT (id) DO NOTHING
`;
const ALLOCATING_INSERT_SQL = `
  WITH alloc AS (
    UPDATE sync_version
       SET v = GREATEST(v + 1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT, (?)::BIGINT)
     WHERE id = 1
     RETURNING v
  )
  INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
  SELECT ?, alloc.v, jsonb_set((?)::jsonb, '{version}', to_jsonb(alloc.v))::text, ?, ?, ?, ?, ?, ?, ?, ?
    FROM alloc
  ON CONFLICT (id) DO UPDATE SET id = excluded.id
  RETURNING version
`;

function timestampValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDurableEventRow(row: {
  id?: unknown;
  version?: unknown;
  event_json?: unknown;
  owner?: unknown;
  org_id?: unknown;
  resource_type?: unknown;
  resource_id?: unknown;
}): { rawVersion: number; rowId: string; event: ChangeEvent | null } {
  const rawVersion = timestampValue(row.version);
  const rowId = typeof row.id === "string" ? row.id : "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row.event_json));
  } catch {
    return { rawVersion, rowId, event: null };
  }
  if (!parsed || typeof parsed !== "object") {
    return { rawVersion, rowId, event: null };
  }
  const parsedRecord = parsed as Record<string, unknown>;
  if (
    typeof parsedRecord.source !== "string" ||
    typeof parsedRecord.type !== "string"
  ) {
    return { rawVersion, rowId, event: null };
  }
  const parsedEvent = parsed as ChangeEvent;
  const {
    owner: _eventOwner,
    orgId: _eventOrgId,
    resourceType: _eventResourceType,
    resourceId: _eventResourceId,
    ...safeEvent
  } = parsedEvent;
  const event: ChangeEvent = {
    ...safeEvent,
    version: rawVersion || parsedEvent.version,
    ...(typeof row.owner === "string"
      ? { owner: row.owner }
      : row.owner === undefined && typeof parsedEvent.owner === "string"
        ? { owner: parsedEvent.owner }
        : {}),
    ...(typeof row.org_id === "string"
      ? { orgId: row.org_id }
      : row.org_id === undefined && typeof parsedEvent.orgId === "string"
        ? { orgId: parsedEvent.orgId }
        : {}),
    ...(typeof row.resource_type === "string"
      ? { resourceType: row.resource_type }
      : row.resource_type === undefined &&
          typeof parsedEvent.resourceType === "string"
        ? { resourceType: parsedEvent.resourceType }
        : {}),
    ...(typeof row.resource_id === "string"
      ? { resourceId: row.resource_id }
      : row.resource_id === undefined &&
          typeof parsedEvent.resourceId === "string"
        ? { resourceId: parsedEvent.resourceId }
        : {}),
    ...(rowId || typeof parsedEvent.cursorId === "string"
      ? { cursorId: rowId || parsedEvent.cursorId }
      : {}),
  };
  return { rawVersion, rowId, event };
}

function sqlWatermarkValue(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

type SyncCursor = { version: number; id: string };

function compareSyncCursors(a: SyncCursor, b: SyncCursor): number {
  if (a.version !== b.version) return a.version - b.version;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function cursorForEvent(event: ChangeEvent): SyncCursor {
  return { version: event.version, id: event.cursorId ?? "" };
}

function encodeSyncCursor(cursor: SyncCursor): string {
  return `${cursor.version}.${cursor.id}`;
}

function decodeSyncCursor(value: unknown): SyncCursor | undefined {
  if (typeof value !== "string") return undefined;
  const separator = value.indexOf(".");
  if (separator < 1) return undefined;
  const version = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(version) || version < 0) return undefined;
  return { version, id };
}

function isEventAfterCursor(event: ChangeEvent, cursor: SyncCursor): boolean {
  return compareSyncCursors(cursorForEvent(event), cursor) > 0;
}

function withoutSettingsKey<T extends { source: string; key?: string }>(
  event: T,
): T {
  return event.source === "settings" && event.key !== "*"
    ? ({ ...event, key: "*" } as T)
    : event;
}

export function sanitizeChangeEvent<T extends { source: string; key?: string }>(
  event: T,
): T {
  return withoutSettingsKey(event);
}

function syncEventsDisabled(): boolean {
  return (
    process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE === "1" ||
    (process.env.VITEST === "true" &&
      process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS !== "1")
  );
}

async function ensureSyncEventsSchema(
  client: DbExec,
  dbAssignedVersions: boolean,
): Promise<void> {
  const createSql = `
        CREATE TABLE IF NOT EXISTS sync_events (
          id TEXT PRIMARY KEY,
          version BIGINT NOT NULL,
          event_json TEXT NOT NULL,
          source TEXT NOT NULL,
          type TEXT NOT NULL,
          event_key TEXT,
          owner TEXT,
          org_id TEXT,
          resource_type TEXT,
          resource_id TEXT,
          created_at BIGINT NOT NULL
        )
      `;

  const guardOptions = { injectedClient: client };
  await ensureTableExists("sync_events", createSql, guardOptions);
  // `version` is the only index the read and the prune can use: the read
  // ORs owner/org/resource_type, so (owner, version) and (org_id, version)
  // were never scanned and only multiplied the write cost of every event.
  await ensureIndexExists(
    "sync_events_version_idx",
    "CREATE INDEX IF NOT EXISTS sync_events_version_idx ON sync_events (version)",
    guardOptions,
  );
  if (dbAssignedVersions) {
    await ensureTableExists(
      "sync_version",
      "CREATE TABLE IF NOT EXISTS sync_version (id INT PRIMARY KEY, v BIGINT NOT NULL)",
      guardOptions,
    );
  }
}

async function seedSyncVersion(
  client: DbExec,
  dbAssignedVersions: boolean,
): Promise<void> {
  if (dbAssignedVersions) await client.execute(SEED_SYNC_VERSION_SQL);
}

async function ensureSyncEventsPruneState(client: DbExec): Promise<void> {
  await ensureTableExists(
    SYNC_EVENTS_PRUNE_STATE_TABLE,
    SYNC_EVENTS_PRUNE_STATE_CREATE_SQL,
    { injectedClient: client },
  );
}

async function readMaxUpdatedAtRaw(
  db: {
    execute: (
      query: string | { sql: string; args?: unknown[] },
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  table: "application_state" | "settings" | "tools",
  excludeKey?: string,
): Promise<unknown> {
  try {
    const result = await db.execute(
      excludeKey
        ? {
            sql: `SELECT MAX(updated_at) as max_ts FROM ${table} WHERE key != ?`,
            args: [excludeKey],
          }
        : `SELECT MAX(updated_at) as max_ts FROM ${table}`,
    );
    return result.rows[0]?.max_ts;
  } catch {
    // Optional framework tables may not exist in every app yet.
    return undefined;
  }
}

async function readMaxUpdatedAt(
  db: {
    execute: (
      query: string | { sql: string; args?: unknown[] },
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  table: "application_state" | "settings" | "tools",
  excludeKey?: string,
): Promise<number> {
  return timestampValue(await readMaxUpdatedAtRaw(db, table, excludeKey));
}

async function readSettingsMaxUpdatedAt(db: {
  execute: (
    query: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number> {
  return readMaxUpdatedAt(db, "settings", REALTIME_REGISTRATION_SETTING_KEY);
}

async function readExtensionMarkerMaxUpdatedAt(db: {
  execute: (
    query: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number> {
  try {
    const result = await db.execute({
      sql: "SELECT MAX(updated_at) as max_ts FROM application_state WHERE key = ?",
      args: [EXTENSION_CHANGE_MARKER_KEY],
    });
    return timestampValue(result.rows[0]?.max_ts);
  } catch {
    return 0;
  }
}

async function readActionMarkerMaxUpdatedAt(db: {
  execute: (
    query: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number> {
  try {
    const result = await db.execute({
      sql: "SELECT MAX(updated_at) as max_ts FROM application_state WHERE key = ?",
      args: [ACTION_CHANGE_MARKER_KEY],
    });
    return timestampValue(result.rows[0]?.max_ts);
  } catch {
    return 0;
  }
}

function accessCacheKey(
  userEmail: string,
  orgId: string | undefined,
  resourceType: string,
  resourceId: string,
): string {
  return `${userEmail}|${orgId ?? ""}|${resourceType}|${resourceId}`;
}

function accessResourceKey(resourceType: string, resourceId: string): string {
  return `${resourceType}|${resourceId}`;
}

function extensionTargetKey(target: ExtensionChangeTarget): string | null {
  if (target.owner) return `owner:${target.owner}`;
  if (target.orgId) return `org:${target.orgId}`;
  return null;
}

function addExtensionTarget(
  targets: Map<string, ExtensionChangeTarget>,
  target: ExtensionChangeTarget,
): void {
  const key = extensionTargetKey(target);
  if (key) targets.set(key, target);
}

function extensionTargetsForRow(
  row: Record<string, unknown>,
  shareRows: Array<Record<string, unknown>>,
): ExtensionChangeTarget[] {
  const targets = new Map<string, ExtensionChangeTarget>();
  const owner = typeof row.owner_email === "string" ? row.owner_email : "";
  const orgId = typeof row.org_id === "string" ? row.org_id : "";
  const visibility =
    typeof row.visibility === "string" ? row.visibility : "private";

  if (owner) addExtensionTarget(targets, { owner });
  if (visibility === "org" && orgId) addExtensionTarget(targets, { orgId });

  for (const share of shareRows) {
    const principalType =
      typeof share.principal_type === "string" ? share.principal_type : "";
    const principalId =
      typeof share.principal_id === "string" ? share.principal_id : "";
    if (principalType === "user" && principalId) {
      addExtensionTarget(targets, { owner: principalId });
    } else if (principalType === "org" && principalId) {
      addExtensionTarget(targets, { orgId: principalId });
    } else if (principalType === "group" && orgId) {
      addExtensionTarget(targets, { orgId });
    }
  }

  return Array.from(targets.values());
}

async function readExtensionTargetsForRows(
  db: {
    execute: (
      query: string | { sql: string; args?: unknown[] },
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  rows: Array<Record<string, unknown>>,
): Promise<ExtensionChangeTarget[][]> {
  const ids = rows
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);
  const sharesByResourceId = new Map<string, Array<Record<string, unknown>>>();

  if (ids.length > 0) {
    try {
      const placeholders = ids.map(() => "?").join(", ");
      const shareResult = await db.execute({
        sql: `SELECT resource_id, principal_type, principal_id FROM tool_shares WHERE resource_id IN (${placeholders})`,
        args: ids,
      });
      for (const share of shareResult.rows) {
        const resourceId =
          typeof share.resource_id === "string" ? share.resource_id : "";
        if (!resourceId) continue;
        const bucket = sharesByResourceId.get(resourceId) ?? [];
        bucket.push(share);
        sharesByResourceId.set(resourceId, bucket);
      }
    } catch {
      // Sharing tables are optional during early app initialization.
    }
  }

  return rows.map((row) =>
    extensionTargetsForRow(
      row,
      sharesByResourceId.get(typeof row.id === "string" ? row.id : "") ?? [],
    ),
  );
}

export type ChangeVisibility =
  | "visible"
  | "hidden"
  | "foreign"
  | "pending"
  | "unreadable";

type AccessDecision = boolean | "foreign" | "unreadable";
function logUnreadable(
  resourceType: unknown,
  resourceId: unknown,
  cause: string,
  error?: unknown,
): void {
  const record =
    error && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown })
      : undefined;
  const safe = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
      ? value
      : undefined;
  console.error("[agent-native] sync event unreadable", {
    resourceType:
      typeof resourceType === "string" && !resourceType.includes("@")
        ? resourceType
        : null,
    resourceId:
      typeof resourceId === "string" && !resourceId.includes("@")
        ? resourceId
        : null,
    cause,
    ...(cause === "threw"
      ? {
          errorName: safe(record?.name) ?? "Unknown",
          ...(safe(record?.code) ? { errorCode: safe(record?.code) } : {}),
        }
      : {}),
  });
}

class SyncEventsTableUnavailableError extends Error {
  constructor() {
    super("Durable sync events are unavailable until their table exists.");
    this.name = "SyncEventsTableUnavailableError";
  }
}

function isMissingRelationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { code?: unknown }).code === "42P01";
}

function isInvalidJsonCastError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  return (
    record.code === "22P02" ||
    (typeof record.message === "string" &&
      record.message.startsWith("invalid input syntax for type json"))
  );
}

export type ChangeReadResult = {
  version: number;
  events: ChangeEvent[];
  cursor?: string;
  cursorLimited?: boolean;
  /** Set when the read stopped at an event whose access check is unresolved. */
  accessPending?: boolean;
  unreadable?: Array<{ type: "access-unavailable" | "unknown-scope" }>;
};

type UnreadableCause = "threw" | "timeout" | "missing-event";
type UnreadableAt = {
  cursor: SyncCursor;
  type: "access-unavailable" | "unknown-scope";
  cause: UnreadableCause;
};
function unreadableSignals(
  entries: UnreadableAt[],
): Pick<ChangeReadResult, "unreadable"> {
  const types = [...new Set(entries.map((entry) => entry.type))];
  return types.length ? { unreadable: types.map((type) => ({ type })) } : {};
}
function recordUnreadableEntries(entries: readonly UnreadableAt[]): void {
  for (const entry of entries) {
    recordUnreadableSyncEvent(entry.cause);
  }
}

type AccessRead = {
  checking: Set<string>;
  blockedOn: Set<Promise<void>>;
  unreadableCursors: UnreadableAt[];
};

export type AccessResolver = (
  resourceType: string,
  resourceId: string,
  ctx: { userEmail: string; orgId: string | undefined },
) => Promise<unknown>;

const defaultResolveAccess: AccessResolver = async (
  resourceType,
  resourceId,
  ctx,
) => {
  const { getShareableResource } = await import("../sharing/registry.js");
  if (!getShareableResource(resourceType)) return "foreign";
  const { resolveAccess } = await import("../sharing/access.js");
  return resolveAccess(resourceType, resourceId, ctx);
};

/**
 * Answers which of `resourceIds` the user may see. A resolver may also report
 * answers through `answered` as they arrive, so a read can pass those
 * resources before the slowest of the rest is checked. One that checks its
 * resources in turns reports each turn's resources through `starting` before
 * it checks them, so a missed deadline counts only against resources whose
 * checks started, and stops when `starting` returns false: none of its
 * answers count any more. One that never calls `starting` has started them
 * all.
 */
export type ManyAccessResolver = (
  resourceType: string,
  resourceIds: string[],
  ctx: { userEmail: string; orgId: string | undefined },
  answered?: (resourceId: string, allowed: boolean) => void,
  starting?: (resourceIds: readonly string[]) => boolean | void,
) => Promise<ReadonlySet<string> | "foreign">;

const defaultResolveAccessMany: ManyAccessResolver = async (
  resourceType,
  resourceIds,
  ctx,
  answered,
  starting,
) => {
  const { getShareableResource } = await import("../sharing/registry.js");
  const { hasHostAccessResolver, resolveAccessMany } =
    await import("../sharing/access.js");
  if (
    !getShareableResource(resourceType) &&
    !hasHostAccessResolver(resourceType)
  )
    return "foreign";
  const accessCtx = {
    userEmail: ctx.userEmail,
    ...(ctx.orgId === undefined ? {} : { orgId: ctx.orgId }),
  };
  if (!hasHostAccessResolver(resourceType)) {
    const access = await resolveAccessMany(
      resourceType,
      resourceIds,
      accessCtx,
      {
        skipResourceBody: true,
      },
    );
    return new Set(access.keys());
  }
  return checkEachResource(
    resourceIds,
    async (resourceId) =>
      (await resolveAccessMany(resourceType, [resourceId], accessCtx)).has(
        resourceId,
      ),
    answered,
    starting,
  );
};

function resolveOneWith(resolveAccessMany: ManyAccessResolver): AccessResolver {
  return async (resourceType, resourceId, ctx) => {
    const result = await resolveAccessMany(resourceType, [resourceId], ctx);
    return result === "foreign"
      ? "foreign"
      : result.has(resourceId)
        ? true
        : null;
  };
}

function resolveEachWith(resolveAccess: AccessResolver): ManyAccessResolver {
  return (resourceType, resourceIds, ctx, answered, starting) =>
    checkEachResource(
      resourceIds,
      async (resourceId) =>
        (await resolveAccess(resourceType, resourceId, ctx)) != null,
      answered,
      starting,
    );
}

async function checkEachResource(
  resourceIds: string[],
  check: (resourceId: string) => Promise<boolean>,
  answered: ((resourceId: string, allowed: boolean) => void) | undefined,
  starting: ((resourceIds: readonly string[]) => boolean | void) | undefined,
): Promise<ReadonlySet<string>> {
  const visible = new Set<string>();
  const failures: unknown[] = [];
  for (
    let start = 0;
    start < resourceIds.length;
    start += ACCESS_CHECKS_AT_ONCE
  ) {
    const group = resourceIds.slice(start, start + ACCESS_CHECKS_AT_ONCE);
    if (starting?.(group) === false) break;
    await Promise.all(
      group.map(async (resourceId) => {
        try {
          const allowed = await check(resourceId);
          if (allowed) visible.add(resourceId);
          answered?.(resourceId, allowed);
        } catch (error) {
          failures.push(error);
        }
      }),
    );
    if (failures.length > 0) break;
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} access checks failed`, {
      cause: failures[0],
    });
  }
  return visible;
}

function resourceNeedingAccessCheck(
  event: Pick<
    ChangeEvent,
    "owner" | "orgId" | "resourceType" | "resourceId" | "visibility"
  >,
  normalizedUserEmail: string,
): { resourceType: string; resourceId: string } | undefined {
  if (!event.resourceType || !event.resourceId) return undefined;
  if (
    typeof event.owner === "string" &&
    event.owner.trim().toLowerCase() === normalizedUserEmail
  ) {
    return undefined;
  }
  if (event.visibility === "public") return undefined;
  return { resourceType: event.resourceType, resourceId: event.resourceId };
}

export interface AppSyncStateOptions {
  getDb?: () => DbExec;
  /**
   * Checks one resource. Defaults to the sharing layer's check, or, when only
   * `resolveAccessMany` is given, to a batch of one through it.
   */
  resolveAccess?: AccessResolver;
  /**
   * Checks many resources of one type in one go. Defaults to the sharing
   * layer's batch check, or, when only `resolveAccess` is given, to one
   * `resolveAccess` call per resource. Given with `resolveAccess`, it must
   * make the same decisions: a read asks one or the other about a resource,
   * depending on how it reaches it.
   */
  resolveAccessMany?: ManyAccessResolver;
  deterministicEventIds?: boolean;
  dbAssignedVersions?: boolean;
  accessAllowTtlMs?: number;
}

export class AppSyncState {
  private readonly getDb: () => DbExec;
  private readonly resolveAccessFn: AccessResolver;
  private readonly resolveAccessManyFn: ManyAccessResolver;
  private readonly deterministicEventIds: boolean;
  private readonly dbAssignedVersions: boolean;
  private recordChain: Promise<void> = Promise.resolve();
  private dbVersionFallbacks = 0;
  private warnedListenerThrow = false;

  private version = 0;
  private latestCursor: SyncCursor = { version: 0, id: "" };
  private readonly buffer: ChangeEvent[] = [];
  private readonly pollEmitter = new EventEmitter();
  private syncEventsInitPromise: Promise<boolean> | undefined;
  private syncEventsInitFailures = 0;
  private lastDurablePrune = Date.now();
  private pruneInFlight: Promise<SyncEventsPruneResult> | undefined;
  private durableWriteFailures = 0;
  private allocatorReseedFailures = 0;

  private versionSeeded = false;

  private lastDbCheck = 0;
  private checkPromise: Promise<void> | null = null;
  private lastAppStateTs = 0;
  private lastSettingsTs = 0;
  private lastExtensionsTs = 0;
  private lastExtensionsUpdatedAt: string | number | undefined;
  private lastExtensionMarkerTs = 0;
  private lastActionMarkerTs = 0;
  private replayActionMarkerOnce = false;

  private lastScreenRefreshTs = 0;
  private lastScreenRefreshSessionId = "";
  private screenRefreshInitialized = false;
  private screenRefreshHasMore = false;
  private localEmittersWired = false;

  private readonly accessCache = new Map<
    string,
    {
      allowed: AccessDecision;
      checkedAt: number;
      unreadableCause?: "threw" | "timeout";
    }
  >();
  private readonly accessInFlight = new Map<string, Promise<void>>();
  private readonly accessTimeouts = new Map<string, number>();
  private accessChecksRunning = 0;
  private accessGeneration = 0;
  private readonly accessInvalidationEpoch = new Map<string, number>();
  private readonly accessAllowTtlMs: number;

  constructor(options: AppSyncStateOptions = {}) {
    this.getDb = options.getDb ?? getDbExec;
    this.resolveAccessFn =
      options.resolveAccess ??
      (options.resolveAccessMany
        ? resolveOneWith(options.resolveAccessMany)
        : defaultResolveAccess);
    this.resolveAccessManyFn =
      options.resolveAccessMany ??
      (options.resolveAccess
        ? resolveEachWith(options.resolveAccess)
        : defaultResolveAccessMany);
    this.deterministicEventIds = options.deterministicEventIds ?? false;
    this.dbAssignedVersions = options.dbAssignedVersions ?? false;
    this.accessAllowTtlMs = options.accessAllowTtlMs ?? ACCESS_CACHE_TTL_MS;
    this.pollEmitter.setMaxListeners(0);
  }

  private accessCacheTtl(allowed: AccessDecision): number {
    return allowed === true ? this.accessAllowTtlMs : ACCESS_CACHE_DENY_TTL_MS;
  }

  private durableEventId(event: ChangeEvent, dedupeKey?: string): string {
    if (this.deterministicEventIds && dedupeKey !== undefined) {
      const identity = [
        event.source,
        event.type,
        event.key ?? "",
        event.owner ?? "",
        event.orgId ?? "",
        event.resourceType ?? "",
        event.resourceId ?? "",
        dedupeKey,
      ].join("\u0000");
      return createHash("sha256").update(identity).digest("hex").slice(0, 32);
    }
    return `${event.version}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getVersion(): number {
    return this.version;
  }

  async getPollBaseline(
    useDurableEvents: boolean,
  ): Promise<{ version: number; cursor: string }> {
    let cursor: SyncCursor = { version: this.version, id: "" };
    if (compareSyncCursors(this.latestCursor, cursor) > 0) {
      cursor = this.latestCursor;
    }

    if (useDurableEvents && !syncEventsDisabled()) {
      try {
        const result = await this.getDb().execute(
          "SELECT version, id FROM sync_events WHERE version = (SELECT MAX(version) FROM sync_events) ORDER BY id DESC LIMIT 1",
        );
        const row = result.rows[0];
        if (row) {
          const version = Number(row.version);
          if (
            !Number.isSafeInteger(version) ||
            version < 0 ||
            typeof row.id !== "string"
          ) {
            throw new Error("Durable sync event cursor is invalid");
          }
          const durableCursor = { version, id: row.id };
          if (compareSyncCursors(durableCursor, cursor) > 0) {
            cursor = durableCursor;
          }
        }
      } catch (error) {
        if (isMissingRelationError(error)) {
          throw new SyncEventsTableUnavailableError();
        }
        throw error;
      }
    }

    return {
      version: Math.max(this.version, cursor.version),
      cursor: encodeSyncCursor(cursor),
    };
  }

  getPollEmitter(): EventEmitter {
    return this.pollEmitter;
  }

  wireLocalEmitters(): void {
    if (this.localEmittersWired) return;
    this.localEmittersWired = true;
    getAppStateEmitter().on("app-state", (event) => {
      if (
        event.key === EXTENSION_CHANGE_MARKER_KEY ||
        event.key === ACTION_CHANGE_MARKER_KEY
      ) {
        return;
      }
      this.recordChange(event);
    });
    getSettingsEmitter().on("settings", (event) => {
      if (event.key === REALTIME_REGISTRATION_SETTING_KEY) return;
      this.recordChange(event);
    });
  }

  async ensureSyncEventsTable(): Promise<boolean> {
    if (syncEventsDisabled()) return false;
    if (!this.syncEventsInitPromise) {
      this.syncEventsInitPromise = (async () => {
        const isDefault = this === _defaultState;
        const client = isDefault ? undefined : this.getDb();
        if (client) {
          await ensureSyncEventsSchema(client, this.dbAssignedVersions);
          await seedSyncVersion(client, this.dbAssignedVersions);
        } else {
          await syncEventsStore.ready();
        }
        // Retention bookkeeping must never stop event writes: without this
        // table the prune fails on its own, loudly, and events keep flowing.
        try {
          if (client) await ensureSyncEventsPruneState(client);
          else await syncEventsPruneStateStore.ready();
        } catch (error) {
          console.error(
            `[agent-native] sync_events_prune_state_unavailable: could not ensure ${SYNC_EVENTS_PRUNE_STATE_TABLE}; sync events still persist, retention prune will fail until it exists:`,
            error instanceof Error ? error.message : String(error),
          );
        }
        this.syncEventsInitFailures = 0;
        return true;
      })().catch((error: unknown) => {
        this.syncEventsInitPromise = undefined;
        this.syncEventsInitFailures++;
        if (this.syncEventsInitFailures === 1) {
          console.error(
            "[agent-native] sync_events_unavailable: could not ensure sync_events; durable real-time events are not written until it recovers:",
            error instanceof Error ? error.message : String(error),
          );
        }
        return false;
      });
    }
    return this.syncEventsInitPromise;
  }

  /** Single-flight per process; cross-instance exclusion is the state-row lease. */
  pruneDurableEvents(
    client: DbExec,
    options?: SyncEventsPruneOptions,
  ): Promise<SyncEventsPruneResult> {
    if (this.pruneInFlight) return this.pruneInFlight;
    const run = pruneSyncEvents(client, options).finally(() => {
      if (this.pruneInFlight === run) this.pruneInFlight = undefined;
    });
    this.pruneInFlight = run;
    return run;
  }

  private prunePiggyback(client: DbExec): void {
    const now = Date.now();
    if (now - this.lastDurablePrune < DURABLE_PRUNE_WRITE_INTERVAL_MS) return;
    this.lastDurablePrune = now;
    void retainRequestDbPoolScope(
      this.pruneDurableEvents(client, {
        budgetMs: DURABLE_PRUNE_WRITE_BUDGET_MS,
      }),
    ).catch((error) => {
      console.error("[agent-native] sync_events prune crashed:", error);
    });
  }

  /** Recurring-sweep driver: a failed prune must fail the tick, not pass as idle. */
  async pruneDurableEventsForSweep(
    context: RecurringSweepContext,
  ): Promise<SyncEventsPruneResult | null> {
    if (syncEventsDisabled()) return null;
    if (!(await this.ensureSyncEventsTable())) {
      throw new Error("sync_events is unavailable; retention prune skipped");
    }
    const result = await this.pruneDurableEvents(this.getDb(), {
      budgetMs: DURABLE_PRUNE_SWEEP_BUDGET_MS,
      deadlineAt: context.deadlineAt,
      signal: context.signal,
    });
    if (result.status === "failed") {
      throw new Error(
        `sync_events prune failed (${result.consecutiveFailures} consecutive): ${result.error}`,
      );
    }
    return result;
  }

  private reportDurableWriteFailure(
    error: unknown,
    event: Pick<ChangeEvent, "source" | "type" | "key">,
  ): void {
    this.durableWriteFailures++;
    if (this.durableWriteFailures === 1) {
      console.warn(
        `[agent-native] sync_events write failed for ${event.source}/${event.type}${event.key ? `/${event.key}` : ""}; durable replay is unavailable until the database recovers:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private reportAllocatorReseedFailure(error: unknown): void {
    this.allocatorReseedFailures++;
    if (this.allocatorReseedFailures === 1) {
      console.warn(
        "[agent-native] sync version allocator reseed failed; retrying allocation:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async persistSyncEvent(
    event: ChangeEvent,
    dedupeKey?: string,
    presetId?: string,
  ): Promise<void> {
    if (!(await this.ensureSyncEventsTable())) return;
    const safeEvent = withoutSettingsKey(event);
    const client = this.getDb();
    await client.execute({
      sql: `INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      args: [
        presetId ?? this.durableEventId(event, dedupeKey),
        event.version,
        JSON.stringify(safeEvent),
        safeEvent.source,
        safeEvent.type,
        safeEvent.key ?? null,
        safeEvent.owner ?? null,
        safeEvent.orgId ?? null,
        safeEvent.resourceType ?? null,
        safeEvent.resourceId ?? null,
        Date.now(),
      ],
    });
    this.durableWriteFailures = 0;
    this.prunePiggyback(client);
  }

  private async persistWithDbAssignedVersion(
    event: { source: string; type: string; key?: string; [k: string]: unknown },
    id: string,
  ): Promise<number | null> {
    if (!(await this.ensureSyncEventsTable())) return null;
    const client = this.getDb();
    const args = [
      this.version + 1,
      id,
      JSON.stringify(event).split("\\u0000").join(""),
      event.source,
      event.type,
      event.key ?? null,
      (event.owner as string | undefined) ?? null,
      (event.orgId as string | undefined) ?? null,
      (event.resourceType as string | undefined) ?? null,
      (event.resourceId as string | undefined) ?? null,
      Date.now(),
    ];
    let result = await client.execute({ sql: ALLOCATING_INSERT_SQL, args });
    if (result.rows.length === 0) {
      try {
        await client.execute(SEED_SYNC_VERSION_SQL);
        this.allocatorReseedFailures = 0;
      } catch (error) {
        this.reportAllocatorReseedFailure(error);
      }
      result = await client.execute({ sql: ALLOCATING_INSERT_SQL, args });
    }
    if (result.rows.length > 0) this.allocatorReseedFailures = 0;
    const version = timestampValue(result.rows[0]?.version);
    this.prunePiggyback(client);
    return version > 0 ? version : null;
  }

  private async recoverCommittedVersion(id: string): Promise<number | null> {
    try {
      const result = await this.getDb().execute({
        sql: "SELECT version FROM sync_events WHERE id = ?",
        args: [id],
      });
      const version = timestampValue(result.rows[0]?.version);
      return version > 0 ? version : null;
    } catch {
      return null;
    }
  }

  private async alignVersionAllocator(floor: number): Promise<void> {
    if (floor <= 0) return;
    try {
      if (!(await this.ensureSyncEventsTable())) return;
      await this.getDb().execute({
        sql: "UPDATE sync_version SET v = GREATEST(v, (?)::BIGINT) WHERE id = 1",
        args: [floor],
      });
    } catch {
      // Soft guarantee under DB failure, matching the clock fallback.
    }
  }

  async readMaxSyncEventVersion(): Promise<number> {
    if (!(await this.ensureSyncEventsTable())) return 0;
    try {
      const result = await this.getDb().execute(
        "SELECT MAX(version) as max_version FROM sync_events",
      );
      return timestampValue(result.rows[0]?.max_version);
    } catch {
      return 0;
    }
  }

  async readMinSyncEventVersion(): Promise<number> {
    if (!(await this.ensureSyncEventsTable())) return 0;
    try {
      const result = await this.getDb().execute(
        "SELECT MIN(version) as min_version FROM sync_events",
      );
      return timestampValue(result.rows[0]?.min_version);
    } catch {
      return 0;
    }
  }

  invalidateCollabAccessCache(resourceType: string, resourceId: string): void {
    const resourceKey = accessResourceKey(resourceType, resourceId);
    this.accessInvalidationEpoch.set(
      resourceKey,
      (this.accessInvalidationEpoch.get(resourceKey) ?? 0) + 1,
    );
    const suffix = `|${resourceKey}`;
    for (const key of Array.from(this.accessCache.keys())) {
      if (key.endsWith(suffix)) this.accessCache.delete(key);
    }
    for (const key of Array.from(this.accessInFlight.keys())) {
      if (key.endsWith(suffix)) this.accessInFlight.delete(key);
    }
    for (const key of Array.from(this.accessTimeouts.keys())) {
      if (key.endsWith(suffix)) this.accessTimeouts.delete(key);
    }
  }

  private setAccessCache(
    key: string,
    allowed: AccessDecision,
    now: number,
    unreadableCause?: "threw" | "timeout",
  ): void {
    this.accessTimeouts.delete(key);
    this.accessCache.delete(key);
    this.accessCache.set(key, {
      allowed,
      checkedAt: now,
      ...(allowed === "unreadable"
        ? { unreadableCause: unreadableCause ?? "threw" }
        : {}),
    });
    if (this.accessCache.size > ACCESS_CACHE_MAX) {
      const overflow = this.accessCache.size - ACCESS_CACHE_MAX;
      let removed = 0;
      for (const oldestKey of this.accessCache.keys()) {
        this.accessCache.delete(oldestKey);
        if (++removed >= overflow) break;
      }
    }
  }

  private unreadableCauseForEvent(
    event: ChangeVisibilityTarget,
    userEmail: string,
    orgId: string | undefined,
  ): "threw" | "timeout" {
    if (event.resourceType && event.resourceId) {
      const key = accessCacheKey(
        userEmail.trim().toLowerCase(),
        orgId,
        event.resourceType,
        event.resourceId,
      );
      return this.accessCache.get(key)?.unreadableCause ?? "threw";
    }
    return "threw";
  }

  private scheduleAccessCheck(
    key: string,
    resourceType: string,
    resourceId: string,
    userEmail: string,
    orgId: string | undefined,
  ): void {
    if (this.accessInFlight.has(key)) return;
    if (
      this.accessChecksRunning >=
      ACCESS_IN_FLIGHT_MAX + ACCESS_SINGLE_CHECK_ROOM
    ) {
      return;
    }
    const resourceKey = accessResourceKey(resourceType, resourceId);
    const epoch = this.accessInvalidationEpoch.get(resourceKey) ?? 0;
    const work = retainRequestDbPoolScope(
      Promise.resolve().then(async () => {
        let allowed: AccessDecision;
        let unreadableCause: "threw" | "timeout" | undefined;
        try {
          const result = await this.resolveAccessFn(resourceType, resourceId, {
            userEmail,
            orgId,
          });
          allowed = result === "foreign" ? "foreign" : result != null;
        } catch (error) {
          logUnreadable(resourceType, resourceId, "threw", error);
          allowed = "unreadable";
          unreadableCause = "threw";
        }
        if ((this.accessInvalidationEpoch.get(resourceKey) ?? 0) !== epoch) {
          return;
        }
        if (this.accessInFlight.get(key) !== check) return;
        this.setAccessCache(key, allowed, Date.now(), unreadableCause);
      }),
    );
    this.countRunningAccessWork(1, work);
    const check = this.trackAccessCheck([key], work);
  }

  private countRunningAccessWork(count: number, work: Promise<void>): void {
    const generation = this.accessGeneration;
    this.accessChecksRunning += count;
    const ended = () => {
      if (this.accessGeneration === generation) {
        this.accessChecksRunning -= count;
      }
    };
    void work.then(ended, ended);
  }

  private endAccessCheck(key: string, check: Promise<void> | undefined): void {
    if (this.accessInFlight.get(key) === check) this.accessInFlight.delete(key);
  }

  private primeAccessChecks(
    events: Iterable<ChangeEvent | null>,
    userEmail: string,
    orgId: string | undefined,
    checking: AccessRead["checking"] = new Set(),
  ): void {
    const normalizedUserEmail = userEmail.trim().toLowerCase();
    const now = Date.now();
    const keysByType = new Map<string, Map<string, string>>();
    const room = ACCESS_IN_FLIGHT_MAX - this.accessChecksRunning;
    let started = 0;
    for (const event of events) {
      if (checking.size >= ACCESS_PRIME_LIMIT) break;
      if (!event) continue;
      const resource = resourceNeedingAccessCheck(event, normalizedUserEmail);
      if (!resource) continue;
      const key = accessCacheKey(
        normalizedUserEmail,
        orgId,
        resource.resourceType,
        resource.resourceId,
      );
      if (checking.has(key)) continue;
      if (this.accessInFlight.has(key)) {
        checking.add(key);
        continue;
      }
      const cached = this.accessCache.get(key);
      if (
        cached &&
        now - cached.checkedAt < this.accessCacheTtl(cached.allowed)
      )
        continue;
      if (started >= room) break;
      started++;
      checking.add(key);
      let keys = keysByType.get(resource.resourceType);
      if (!keys) {
        keys = new Map();
        keysByType.set(resource.resourceType, keys);
      }
      keys.set(resource.resourceId, key);
    }
    for (const [resourceType, keys] of keysByType) {
      this.scheduleAccessChecks(resourceType, keys, normalizedUserEmail, orgId);
    }
  }

  private scheduleAccessChecks(
    resourceType: string,
    keys: ReadonlyMap<string, string>,
    userEmail: string,
    orgId: string | undefined,
  ): void {
    const resolveMany = this.resolveAccessManyFn;
    const epochs = new Map(
      [...keys.keys()].map((resourceId) => [
        resourceId,
        this.accessInvalidationEpoch.get(
          accessResourceKey(resourceType, resourceId),
        ) ?? 0,
      ]),
    );
    const cacheUnlessInvalidated = (
      resourceId: string,
      allowed: AccessDecision,
      unreadableCause?: "threw" | "timeout",
    ) => {
      const key = keys.get(resourceId);
      const epoch =
        this.accessInvalidationEpoch.get(
          accessResourceKey(resourceType, resourceId),
        ) ?? 0;
      if (!key || epoch !== epochs.get(resourceId)) return;
      if (this.accessInFlight.get(key) !== check) return;
      this.setAccessCache(key, allowed, Date.now(), unreadableCause);
      this.endAccessCheck(key, check);
    };
    const ids = [...keys.keys()];
    const answeredIds = new Set<string>();
    const answer = (resourceId: string, allowed: boolean) => {
      answeredIds.add(resourceId);
      cacheUnlessInvalidated(resourceId, allowed);
    };
    let startedKeys: Set<string> | undefined;
    const starting = (resourceIds: readonly string[]): boolean => {
      startedKeys ??= new Set();
      for (const resourceId of resourceIds) {
        const key = keys.get(resourceId);
        if (key) startedKeys.add(key);
      }
      for (const key of keys.values()) {
        if (this.accessInFlight.get(key) === check) return true;
      }
      return false;
    };
    const run = async () => {
      try {
        const visible = await resolveMany(
          resourceType,
          ids,
          { userEmail, orgId },
          answer,
          starting,
        );
        for (const id of ids) {
          if (!answeredIds.has(id)) {
            if (visible === "foreign") cacheUnlessInvalidated(id, "foreign");
            else answer(id, visible.has(id));
          }
        }
      } catch {
        const retried = ids
          .filter((id) => !answeredIds.has(id))
          .slice(0, ACCESS_RETRY_LIMIT);
        if (!starting(retried)) return;
        await Promise.all(
          retried.map(async (id) => {
            let allowed: AccessDecision;
            let unreadableCause: "threw" | "timeout" | undefined;
            try {
              const result = await resolveMany(resourceType, [id], {
                userEmail,
                orgId,
              });
              allowed = result === "foreign" ? "foreign" : result.has(id);
            } catch (error) {
              logUnreadable(resourceType, id, "threw", error);
              allowed = "unreadable";
              unreadableCause = "threw";
            }
            cacheUnlessInvalidated(id, allowed, unreadableCause);
          }),
        );
      }
    };
    const work = retainRequestDbPoolScope(Promise.resolve().then(run));
    this.countRunningAccessWork(keys.size, work);
    const check = this.trackAccessCheck(
      [...keys.values()],
      work,
      (key) => !startedKeys || startedKeys.has(key),
    );
  }

  private trackAccessCheck(
    keys: string[],
    work: Promise<void>,
    started: (key: string) => boolean = () => true,
  ): Promise<void> {
    const check: Promise<void> = Promise.resolve().then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        timedOut = await Promise.race([
          work.then(() => false),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(true), ACCESS_CHECK_TIMEOUT_MS);
            (timer as { unref?: () => void }).unref?.();
          }),
        ]);
      } finally {
        clearTimeout(timer);
        for (const key of keys) {
          if (
            timedOut &&
            this.accessInFlight.get(key) === check &&
            started(key)
          ) {
            this.noteAccessTimeout(key);
          }
          this.endAccessCheck(key, check);
        }
      }
    });
    for (const key of keys) this.accessInFlight.set(key, check);
    return check;
  }

  private noteAccessTimeout(key: string): void {
    const missed = (this.accessTimeouts.get(key) ?? 0) + 1;
    this.accessTimeouts.delete(key);
    if (missed >= ACCESS_CHECK_TIMEOUTS_MAX) {
      const [, , resourceType, ...resourceId] = key.split("|");
      logUnreadable(resourceType, resourceId.join("|"), "timeout");
      this.setAccessCache(key, "unreadable", Date.now(), "timeout");
      return;
    }
    this.accessTimeouts.set(key, missed);
    if (this.accessTimeouts.size > ACCESS_CACHE_MAX) {
      const oldestKey = this.accessTimeouts.keys().next().value;
      if (oldestKey !== undefined) this.accessTimeouts.delete(oldestKey);
    }
  }

  __resetAccessCacheForTests(): void {
    this.accessCache.clear();
    this.accessInFlight.clear();
    this.accessTimeouts.clear();
    this.accessChecksRunning = 0;
    this.accessGeneration++;
    this.accessInvalidationEpoch.clear();
  }

  /**
   * Decide whether a poll/SSE change event should be delivered to a user.
   *
   * SYNC-CACHE VARIANT — WHY THIS IS SYNCHRONOUS:
   * This function is called on hot, synchronous paths: the SSE emitter callback
   * `push(change)` in poll-events.ts (fires per event) and the
   * `getChangesSinceForUser` loop in this file. Making it async would be
   * invasive. Instead, for the access-aware branch we consult an in-memory
   * cache and, on a miss, fire a NON-BLOCKING background access check and
   * return `false` for the current event. Callers that must not lose the event
   * use `getChangeVisibilityForUser` and wait for the pending check (the SSE
   * handler and `getCombinedChangesSinceForUser` do); this boolean form alone
   * would drop the first event for a fresh (user, resource) pair, and a live
   * stream does not poll to recover it.
   *
   * Security: a cache MISS returns `false`, so we NEVER deliver to a user before
   * their access has been affirmatively confirmed by the resolver — the same
   * authority that gates the HTTP routes. Resolver errors remain distinct from
   * permission denials so callers can request a refresh without advancing.
   * Organization membership alone does not grant access to a resource-scoped event.
   */
  canSeeChangeForUser(
    event: ChangeVisibilityTarget,
    userEmail: string,
    orgId: string | undefined,
  ): boolean {
    return (
      this.getChangeVisibilityForUser(event, userEmail, orgId) === "visible"
    );
  }

  private async waitForAccessChecks(
    checks: Iterable<Promise<void>>,
    timeoutMs: number,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(checks),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * Like `getChangeVisibilityForUser`, but a "pending" verdict waits (bounded)
   * for this event's own access check and answers again, so a caller that
   * cannot poll later does not lose the event. Still "pending" after the wait
   * means the check did not finish.
   */
  async resolveChangeVisibilityForUser(
    event: ChangeVisibilityTarget,
    userEmail: string,
    orgId: string | undefined,
    timeoutMs: number,
  ): Promise<ChangeVisibility> {
    const visibility = this.getChangeVisibilityForUser(event, userEmail, orgId);
    if (visibility !== "pending") return visibility;
    const check = this.runningAccessCheck(event, userEmail, orgId);
    if (check) await this.waitForAccessChecks([check], timeoutMs);
    return this.getChangeVisibilityForUser(event, userEmail, orgId);
  }

  private runningAccessCheck(
    event: Pick<ChangeEvent, "resourceType" | "resourceId">,
    userEmail: string,
    orgId: string | undefined,
  ): Promise<void> | undefined {
    if (!event.resourceType || !event.resourceId) return undefined;
    return this.accessInFlight.get(
      accessCacheKey(
        userEmail.trim().toLowerCase(),
        orgId,
        event.resourceType,
        event.resourceId,
      ),
    );
  }

  getChangeVisibilityForUser(
    event: ChangeVisibilityTarget,
    userEmail: string,
    orgId: string | undefined,
  ): ChangeVisibility {
    const normalizedUserEmail = userEmail.trim().toLowerCase();
    // Older settings notifications have no owner metadata. Their reserved user
    // key must remain private when replayed from either memory or durable sync.
    if (event.source === "settings" && event.key?.startsWith("u:")) {
      const owner = /^u:([^:]+):/.exec(event.key)?.[1];
      return owner?.trim().toLowerCase() === normalizedUserEmail
        ? "visible"
        : "hidden";
    }
    if (event.visibility === "public") return "visible";
    if (!event.owner && !event.orgId && !event.resourceType) return "hidden";
    if (
      typeof event.owner === "string" &&
      event.owner.trim().toLowerCase() === normalizedUserEmail
    ) {
      return "visible";
    }
    if (event.resourceType && event.resourceId) {
      const key = accessCacheKey(
        normalizedUserEmail,
        orgId,
        event.resourceType,
        event.resourceId,
      );
      const cached = this.accessCache.get(key);
      const now = Date.now();
      if (
        cached &&
        now - cached.checkedAt < this.accessCacheTtl(cached.allowed)
      ) {
        return cached.allowed === "unreadable" || cached.allowed === "foreign"
          ? cached.allowed
          : cached.allowed
            ? "visible"
            : "hidden";
      }
      this.scheduleAccessCheck(
        key,
        event.resourceType,
        event.resourceId,
        normalizedUserEmail,
        orgId,
      );
      return "pending";
    }

    if (event.orgId && orgId && event.orgId === orgId) return "visible";

    return "hidden";
  }

  recordChange(
    event: {
      source: string;
      type: string;
      key?: string;
      [k: string]: unknown;
    },
    opts?: { dedupeKey?: string },
  ): void {
    const safeEvent = sanitizeChangeEvent(event);
    if (this.dbAssignedVersions && !syncEventsDisabled()) {
      this.recordChain = retainRequestDbPoolScope(
        this.recordChain
          .then(() => this.recordWithDbVersion(safeEvent, opts?.dedupeKey))
          .catch((error) => {
            this.reportDurableWriteFailure(error, safeEvent);
          }),
      );
      return;
    }
    this.version = Math.max(this.version + 1, Date.now());
    const provisional: ChangeEvent = { ...safeEvent, version: this.version };
    const cursorId = this.durableEventId(provisional, opts?.dedupeKey);
    const entry: ChangeEvent = { ...provisional, cursorId };
    this.commitEntry(entry);
    void retainRequestDbPoolScope(
      this.persistSyncEvent(entry, opts?.dedupeKey, cursorId),
    ).catch((error) => {
      this.reportDurableWriteFailure(error, entry);
    });
  }

  async prepareTransactionalChange(event: {
    source: string;
    type: string;
    key?: string;
    [k: string]: unknown;
  }): Promise<TransactionalChange> {
    const safeEvent = sanitizeChangeEvent(event);
    if (!(await this.ensureSyncEventsTable())) {
      throw new Error(
        "Transactional change delivery requires durable sync events",
      );
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let persisted: ChangeEvent | null = null;
    return {
      persist: async (transaction) => {
        if (persisted) return persisted;
        let version: number;
        if (this.dbAssignedVersions) {
          const result = await transaction.execute({
            sql: ALLOCATING_INSERT_SQL,
            args: [
              this.version + 1,
              id,
              JSON.stringify({ ...safeEvent, cursorId: id })
                .split("\\u0000")
                .join(""),
              safeEvent.source,
              safeEvent.type,
              safeEvent.key ?? null,
              (safeEvent.owner as string | undefined) ?? null,
              (safeEvent.orgId as string | undefined) ?? null,
              (safeEvent.resourceType as string | undefined) ?? null,
              (safeEvent.resourceId as string | undefined) ?? null,
              Date.now(),
            ],
          });
          version = timestampValue(result.rows[0]?.version);
          if (version <= 0) {
            throw new Error("Durable sync version allocation failed");
          }
        } else {
          version = Math.max(this.version + 1, Date.now());
          const entry = { ...safeEvent, version, cursorId: id } as ChangeEvent;
          const result = await transaction.execute({
            sql: `INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
            args: [
              id,
              version,
              JSON.stringify(entry),
              entry.source,
              entry.type,
              entry.key ?? null,
              entry.owner ?? null,
              entry.orgId ?? null,
              entry.resourceType ?? null,
              entry.resourceId ?? null,
              Date.now(),
            ],
          });
          if (result.rowsAffected !== 1) {
            throw new Error("Durable sync event was not persisted");
          }
        }
        persisted = { ...safeEvent, version, cursorId: id } as ChangeEvent;
        return persisted;
      },
      isPersisted: () => persisted !== null,
      publish: () => {
        if (!persisted) {
          throw new Error(
            "Transactional change cannot publish before persistence commits",
          );
        }
        this.version = Math.max(this.version, persisted.version);
        this.commitEntryForChain(persisted);
        return persisted;
      },
    };
  }

  private commitEntry(entry: ChangeEvent): void {
    this.buffer.push(entry);
    const cursor = cursorForEvent(entry);
    if (compareSyncCursors(cursor, this.latestCursor) > 0) {
      this.latestCursor = cursor;
    }
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }
    this.pollEmitter.emit(POLL_CHANGE_EVENT, entry);
  }

  private async recordWithDbVersion(
    event: { source: string; type: string; key?: string; [k: string]: unknown },
    dedupeKey?: string,
  ): Promise<void> {
    const id =
      this.deterministicEventIds && dedupeKey !== undefined
        ? this.durableEventId(
            { ...event, version: 0 } as ChangeEvent,
            dedupeKey,
          )
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let version: number | null = null;
    try {
      version = await this.persistWithDbAssignedVersion(
        { ...event, cursorId: id },
        id,
      );
    } catch {
      version = null;
    }
    if (version == null) {
      version = await this.recoverCommittedVersion(id);
    }
    if (version == null) {
      this.dbVersionFallbacks++;
      if (this.dbVersionFallbacks === 1) {
        console.warn(
          "[agent-native] sync version allocation failed; falling back to clock-assigned versions",
        );
      }
      this.version = Math.max(this.version + 1, Date.now());
      const entry: ChangeEvent = {
        ...event,
        version: this.version,
        cursorId: id,
      };
      await this.alignVersionAllocator(this.version);
      this.commitEntryForChain(entry);
      await this.persistSyncEvent(entry, dedupeKey, id);
      return;
    }
    this.version = Math.max(this.version, version);
    this.commitEntryForChain({ ...event, version, cursorId: id });
  }

  private commitEntryForChain(entry: ChangeEvent): void {
    try {
      this.commitEntry(entry);
    } catch (err) {
      if (!this.warnedListenerThrow) {
        this.warnedListenerThrow = true;
        console.warn(
          "[agent-native] poll listener threw during deferred emit",
          err,
        );
      }
    }
  }

  private recordExtensionChanges(
    targets: ExtensionChangeTarget[],
    dedupeKey?: string,
  ): void {
    const uniqueTargets = new Map<string, ExtensionChangeTarget>();
    for (const target of targets) addExtensionTarget(uniqueTargets, target);
    for (const target of uniqueTargets.values()) {
      this.recordChange(
        {
          source: "extensions",
          type: "change",
          key: "*",
          ...(target.owner ? { owner: target.owner } : {}),
          ...(target.orgId ? { orgId: target.orgId } : {}),
        },
        dedupeKey !== undefined
          ? {
              dedupeKey: `${dedupeKey}|${target.owner ?? ""}|${target.orgId ?? ""}`,
            }
          : undefined,
      );
    }
  }

  private recordActionChanges(
    targets: ActionChangeTarget[],
    dedupeKey?: string,
  ): void {
    for (const target of targets) {
      this.recordChange(
        {
          source: "action",
          type: "change",
          key: target.actionName ?? "*",
          ...(target.owner ? { owner: target.owner } : {}),
          ...(target.orgId ? { orgId: target.orgId } : {}),
          ...(target.requestSource
            ? { requestSource: target.requestSource }
            : {}),
          ...(target.resourceType && target.resourceId
            ? {
                resourceType: target.resourceType,
                resourceId: target.resourceId,
              }
            : {}),
        },
        dedupeKey !== undefined
          ? {
              dedupeKey: actionChangeDedupeKey(target, dedupeKey),
            }
          : undefined,
      );
    }
  }

  getChangesSince(since: number): { version: number; events: ChangeEvent[] } {
    if (since >= this.version) {
      return { version: this.version, events: [] };
    }
    const events = this.buffer.filter((e) => e.version > since);
    return { version: this.version, events };
  }

  getChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    cursor?: SyncCursor,
    accessRead?: AccessRead,
  ): ChangeReadResult {
    const readCursor = cursor ?? { version: since, id: "" };
    if (
      (!cursor && since >= this.version) ||
      (cursor && compareSyncCursors(this.latestCursor, readCursor) <= 0)
    ) {
      return {
        version: this.version,
        events: [],
        ...(cursor ? { cursor: encodeSyncCursor(readCursor) } : {}),
      };
    }
    const events: ChangeEvent[] = [];
    const unreadable: UnreadableAt[] = [];
    let version = this.version;
    let lastCursor = readCursor;
    const unread = this.buffer.filter((event) =>
      cursor ? isEventAfterCursor(event, readCursor) : event.version > since,
    );
    this.primeAccessChecks(unread, userEmail, orgId, accessRead?.checking);
    for (const event of unread) {
      const visibility = this.getChangeVisibilityForUser(
        event,
        userEmail,
        orgId,
      );
      if (visibility === "unreadable") {
        const entry: UnreadableAt = {
          cursor: cursorForEvent(event),
          type: "access-unavailable",
          cause: this.unreadableCauseForEvent(event, userEmail, orgId),
        };
        unreadable.push(entry);
        accessRead?.unreadableCursors.push(entry);
        lastCursor = cursorForEvent(event);
        continue;
      }
      if (visibility === "visible") {
        events.push(withoutSettingsKey(event));
        lastCursor = cursorForEvent(event);
        continue;
      }
      if (visibility === "pending") {
        const check = this.runningAccessCheck(event, userEmail, orgId);
        if (check) accessRead?.blockedOn.add(check);
        version = Math.max(since, event.version - 1);
        if (!accessRead) recordUnreadableEntries(unreadable);
        return {
          version,
          events,
          ...unreadableSignals(unreadable),
          cursorLimited: true,
          accessPending: true,
          ...(cursor && lastCursor !== readCursor
            ? { cursor: encodeSyncCursor(lastCursor) }
            : {}),
        };
      }
      lastCursor = cursorForEvent(event);
    }
    if (!accessRead) recordUnreadableEntries(unreadable);
    return {
      version,
      events,
      ...unreadableSignals(unreadable),
      ...(cursor && compareSyncCursors(lastCursor, readCursor) > 0
        ? { cursor: encodeSyncCursor(lastCursor) }
        : {}),
    };
  }

  async getDurableChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    cursor?: SyncCursor,
    accessRead?: AccessRead,
  ): Promise<ChangeReadResult> {
    if (syncEventsDisabled()) {
      return { version: this.version, events: [] };
    }

    const readCursor = cursor ?? { version: since, id: "" };
    if (!cursor && readCursor.version <= 0 && readCursor.id === "") {
      try {
        const result = await this.getDb().execute(
          "SELECT MAX(version) as max_version FROM sync_events",
        );
        return {
          version: Math.max(
            this.version,
            timestampValue(result.rows[0]?.max_version),
          ),
          events: [],
        };
      } catch (error) {
        if (isMissingRelationError(error))
          throw new SyncEventsTableUnavailableError();
        throw error;
      }
    }

    try {
      const cursorArgs = [
        cursor?.version ?? since,
        cursor !== undefined,
        cursor?.version ?? since,
        cursor?.id ?? "",
      ];
      let result;
      try {
        result = await this.getDb().execute({
          sql: `SELECT id, version, event_json, owner, org_id, resource_type, resource_id FROM sync_events
              WHERE (version > ? OR (? = TRUE AND version = ? AND id > ?))
              AND (event_json::jsonb ->> 'visibility' = 'public' OR lower(btrim(owner)) = ? OR org_id = ? OR resource_type IS NOT NULL)
              ORDER BY version ASC, id ASC LIMIT ?`,
          args: [
            ...cursorArgs,
            userEmail.trim().toLowerCase(),
            orgId ?? null,
            DURABLE_READ_LIMIT + 1,
          ],
        });
      } catch (error) {
        if (!isInvalidJsonCastError(error)) throw error;
        logUnreadable(null, null, "invalid-json-cast");
        result = await this.getDb().execute({
          sql: `SELECT id, version, event_json, owner, org_id, resource_type, resource_id FROM sync_events
              WHERE (version > ? OR (? = TRUE AND version = ? AND id > ?))
              ORDER BY version ASC, id ASC LIMIT ?`,
          args: [...cursorArgs, DURABLE_READ_LIMIT + 1],
        });
      }
      const events: ChangeEvent[] = [];
      const unreadable: UnreadableAt[] = [];
      let version = Math.max(this.version, since);
      let lastDurableVersion = since;
      let lastCursor = readCursor;
      const rows = result.rows.slice(0, DURABLE_READ_LIMIT);
      const overflowVersion = timestampValue(
        result.rows[DURABLE_READ_LIMIT]?.version,
      );

      const parsedRows = rows.map(parseDurableEventRow);
      this.primeAccessChecks(
        parsedRows.map((row) => row.event),
        userEmail,
        orgId,
        accessRead?.checking,
      );

      for (const [
        index,
        { rawVersion, rowId, event },
      ] of parsedRows.entries()) {
        if (rawVersion > lastDurableVersion) lastDurableVersion = rawVersion;
        if (rawVersion > version) version = rawVersion;
        let rowCursor = rowId ? { version: rawVersion, id: rowId } : undefined;
        if (!event) {
          const row = rows[index];
          logUnreadable(row?.resource_type, row?.resource_id, "missing-event");
          const entry: UnreadableAt = {
            cursor: rowCursor ?? { version: rawVersion, id: "" },
            type: "unknown-scope",
            cause: "missing-event",
          };
          unreadable.push(entry);
          accessRead?.unreadableCursors.push(entry);
          if (rowCursor) lastCursor = rowCursor;
          continue;
        }
        if (!rowCursor && typeof event.cursorId === "string") {
          rowCursor = { version: event.version, id: event.cursorId };
        }

        const row = rows[index];
        const scoped =
          event.visibility === "public" ||
          (typeof row?.owner === "string" &&
            row.owner.trim().toLowerCase() ===
              userEmail.trim().toLowerCase()) ||
          (typeof row?.org_id === "string" && row.org_id === orgId) ||
          typeof row?.resource_type === "string" ||
          (row?.owner === undefined &&
            row?.org_id === undefined &&
            row?.resource_type === undefined);
        if (!scoped) {
          if (rowCursor) lastCursor = rowCursor;
          continue;
        }
        const visibility = this.getChangeVisibilityForUser(
          event,
          userEmail,
          orgId,
        );
        if (visibility === "unreadable") {
          const entry: UnreadableAt = {
            cursor: rowCursor ?? { version: rawVersion, id: "" },
            type: "access-unavailable",
            cause: this.unreadableCauseForEvent(event, userEmail, orgId),
          };
          unreadable.push(entry);
          accessRead?.unreadableCursors.push(entry);
          if (rowCursor) lastCursor = rowCursor;
          continue;
        }
        if (visibility === "visible") {
          events.push(withoutSettingsKey(event));
          if (rowCursor) lastCursor = rowCursor;
          continue;
        }
        if (visibility === "pending") {
          const check = this.runningAccessCheck(event, userEmail, orgId);
          if (check) accessRead?.blockedOn.add(check);
          if (!accessRead) recordUnreadableEntries(unreadable);
          return {
            version: Math.max(since, event.version - 1),
            events,
            ...unreadableSignals(unreadable),
            cursorLimited: true,
            accessPending: true,
            ...(cursor && compareSyncCursors(lastCursor, readCursor) > 0
              ? { cursor: encodeSyncCursor(lastCursor) }
              : {}),
          };
        }
        if (rowCursor) lastCursor = rowCursor;
      }

      if (rows.length >= DURABLE_READ_LIMIT) {
        if (cursor) {
          if (!accessRead) recordUnreadableEntries(unreadable);
          return {
            version: Math.max(since, lastDurableVersion),
            events,
            ...unreadableSignals(unreadable),
            cursor: encodeSyncCursor(lastCursor),
            cursorLimited: result.rows.length > DURABLE_READ_LIMIT,
          };
        }
        if (overflowVersion === lastDurableVersion) {
          const boundaryVersion = lastDurableVersion;
          const boundedUnreadable = unreadable.filter(
            (entry) => entry.cursor.version < boundaryVersion,
          );
          if (!accessRead) recordUnreadableEntries(boundedUnreadable);
          return {
            version: Math.max(since, boundaryVersion - 1),
            events: events.filter((event) => event.version < boundaryVersion),
            ...unreadableSignals(boundedUnreadable),
            cursorLimited: true,
          };
        }
        if (!accessRead) recordUnreadableEntries(unreadable);
        return {
          version: Math.max(since, lastDurableVersion),
          events,
          ...unreadableSignals(unreadable),
          cursorLimited: true,
        };
      }

      if (!accessRead) recordUnreadableEntries(unreadable);
      return {
        version,
        events,
        ...unreadableSignals(unreadable),
        ...(cursor && compareSyncCursors(lastCursor, readCursor) > 0
          ? { cursor: encodeSyncCursor(lastCursor) }
          : {}),
      };
    } catch (error) {
      if (isMissingRelationError(error))
        throw new SyncEventsTableUnavailableError();
      if (isInvalidJsonCastError(error)) {
        logUnreadable(null, null, "invalid-json-cast");
        throw new SyncEventReadError();
      }
      throw error;
    }
  }

  async getCombinedChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    useDurableEvents: boolean,
    cursor?: SyncCursor,
  ): Promise<ChangeReadResult> {
    const accessRead: AccessRead = {
      checking: new Set(),
      blockedOn: new Set(),
      unreadableCursors: [],
    };
    const first = await this.readCombinedChangesSinceForUser(
      since,
      userEmail,
      orgId,
      useDurableEvents,
      cursor,
      accessRead,
    );
    // Only an unresolved access check is worth waiting for; a row-limit
    // truncation (also `cursorLimited`) is not blocked on one.
    if (!first.accessPending) {
      recordUnreadableEntries(accessRead.unreadableCursors);
      const { accessPending: _pending, ...result } = first;
      return result;
    }
    // A read stopped at an event whose access check had not finished. The
    // check is already running, so waiting for it here (bounded) delivers the
    // event now instead of one poll interval later.
    if (accessRead.blockedOn.size > 0) {
      await this.waitForAccessChecks(
        accessRead.blockedOn,
        ACCESS_CHECK_WAIT_MS,
      );
    }
    accessRead.unreadableCursors = [];
    const { accessPending: _pending, ...result } =
      await this.readCombinedChangesSinceForUser(
        since,
        userEmail,
        orgId,
        useDurableEvents,
        cursor,
        accessRead,
      );
    recordUnreadableEntries(accessRead.unreadableCursors);
    return result;
  }

  private async readCombinedChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    useDurableEvents: boolean,
    cursor: SyncCursor | undefined,
    accessRead: AccessRead,
  ): Promise<ChangeReadResult> {
    const memoryRead: AccessRead = {
      checking: accessRead.checking,
      blockedOn: new Set(),
      unreadableCursors: [],
    };
    const durableRead: AccessRead = {
      checking: accessRead.checking,
      blockedOn: new Set(),
      unreadableCursors: [],
    };
    const blockOn = (read: AccessRead) => {
      for (const check of read.blockedOn) accessRead.blockedOn.add(check);
    };
    const memory = this.getChangesSinceForUser(
      since,
      userEmail,
      orgId,
      cursor,
      memoryRead,
    );
    if (!useDurableEvents) {
      blockOn(memoryRead);
      accessRead.unreadableCursors = memoryRead.unreadableCursors;
      return memory;
    }

    const durable = await this.getDurableChangesSinceForUser(
      since,
      userEmail,
      orgId,
      cursor,
      durableRead,
    );
    const unreadableByKey = new Map<string, UnreadableAt>();
    for (const entry of [
      ...durableRead.unreadableCursors,
      ...memoryRead.unreadableCursors,
    ]) {
      unreadableByKey.set(`${entry.cursor.version}\0${entry.cursor.id}`, entry);
    }
    const sources = [
      { result: memory, read: memoryRead },
      { result: durable, read: durableRead },
    ];
    const byIdentity = new Map<string, ChangeEvent>();
    for (const event of [...durable.events, ...memory.events]) {
      byIdentity.set(
        JSON.stringify([
          event.cursorId,
          event.version,
          event.source,
          event.type,
          event.key,
          event.owner,
          event.orgId,
          event.resourceType,
          event.resourceId,
        ]),
        event,
      );
    }
    const events = Array.from(byIdentity.values()).sort((a, b) =>
      compareSyncCursors(cursorForEvent(a), cursorForEvent(b)),
    );
    const deliveredCursors = new Set(
      events.map((event) => {
        const cursor = cursorForEvent(event);
        return `${cursor.version}\0${cursor.id}`;
      }),
    );
    const unreadable = Array.from(unreadableByKey.entries())
      .filter(([key]) => !deliveredCursors.has(key))
      .map(([, entry]) => entry);
    if (cursor) {
      const limitedCursors = [memory, durable]
        .filter((result) => result.cursorLimited)
        .map((result) => decodeSyncCursor(result.cursor) ?? cursor);
      if (limitedCursors.length > 0) {
        const boundary = limitedCursors.reduce((minimum, value) =>
          compareSyncCursors(value, minimum) < 0 ? value : minimum,
        );
        // A check pending beyond the boundary the other read stopped at is
        // filtered out of this response, so waiting on it delivers nothing.
        const pending = sources.filter(
          ({ result }) =>
            result.accessPending &&
            compareSyncCursors(
              decodeSyncCursor(result.cursor) ?? cursor,
              boundary,
            ) <= 0,
        );
        for (const { read } of pending) blockOn(read);
        const boundedUnreadable = unreadable.filter(
          (entry) => compareSyncCursors(entry.cursor, boundary) <= 0,
        );
        accessRead.unreadableCursors = boundedUnreadable;
        return {
          version: boundary.version,
          cursor: encodeSyncCursor(boundary),
          cursorLimited: true,
          ...unreadableSignals(boundedUnreadable),
          ...(pending.length > 0 ? { accessPending: true } : {}),
          events: events.filter(
            (event) => compareSyncCursors(cursorForEvent(event), boundary) <= 0,
          ),
        };
      }
      const responseCursor = [
        cursor,
        decodeSyncCursor(memory.cursor),
        decodeSyncCursor(durable.cursor),
        ...events.map(cursorForEvent),
      ]
        .filter((value): value is SyncCursor => !!value)
        .reduce(
          (maximum, value) =>
            compareSyncCursors(value, maximum) > 0 ? value : maximum,
          cursor,
        );
      accessRead.unreadableCursors = unreadable;
      return {
        version: Math.max(memory.version, durable.version, since),
        events,
        ...unreadableSignals(unreadable),
        ...(compareSyncCursors(responseCursor, cursor) > 0
          ? { cursor: encodeSyncCursor(responseCursor) }
          : {}),
      };
    }
    const limitedVersions = [memory, durable]
      .filter((result) => result.cursorLimited)
      .map((result) => result.version);
    const pending = sources.filter(
      ({ result }) =>
        result.accessPending && result.version <= Math.min(...limitedVersions),
    );
    for (const { read } of pending) blockOn(read);
    const boundedUnreadable = unreadable.filter(
      (entry) =>
        !limitedVersions.length ||
        entry.cursor.version <= Math.min(...limitedVersions),
    );
    accessRead.unreadableCursors = boundedUnreadable;
    return {
      version:
        limitedVersions.length > 0
          ? Math.min(...limitedVersions)
          : Math.max(memory.version, durable.version, since),
      events:
        limitedVersions.length > 0
          ? events.filter(
              (event) => event.version <= Math.min(...limitedVersions),
            )
          : events,
      ...unreadableSignals(boundedUnreadable),
      ...(limitedVersions.length > 0 ? { cursorLimited: true } : {}),
      ...(pending.length > 0 ? { accessPending: true } : {}),
    };
  }

  async seedVersionFromDb(): Promise<void> {
    if (this.versionSeeded) return;
    this.versionSeeded = true;

    try {
      const db = this.getDb();

      const [
        syncEventsTs,
        appTs,
        settingsTs,
        extensionsMaxUpdatedAt,
        extensionMarkerTs,
        actionMarkerTs,
        refreshResult,
      ] = await Promise.all([
        this.readMaxSyncEventVersion(),
        readMaxUpdatedAt(db, "application_state"),
        readSettingsMaxUpdatedAt(db),
        readMaxUpdatedAtRaw(db, "tools"),
        readExtensionMarkerMaxUpdatedAt(db),
        readActionMarkerMaxUpdatedAt(db),
        db
          .execute({
            sql: "SELECT session_id, updated_at FROM application_state WHERE key = ? ORDER BY updated_at DESC, session_id DESC LIMIT 1",
            args: [SCREEN_REFRESH_KEY],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);

      const extensionsTs = timestampValue(extensionsMaxUpdatedAt);
      let refreshTs = 0;
      for (const row of refreshResult.rows) {
        refreshTs = Math.max(refreshTs, timestampValue(row.updated_at));
      }

      const seedMax = Math.max(
        syncEventsTs,
        appTs,
        settingsTs,
        extensionsTs,
        extensionMarkerTs,
        actionMarkerTs,
      );
      if (this.dbAssignedVersions && !syncEventsDisabled()) {
        await this.alignVersionAllocator(seedMax);
      }
      this.version = Math.max(this.version, seedMax);

      this.lastAppStateTs = appTs;
      this.lastSettingsTs = settingsTs;
      this.lastExtensionsTs = extensionsTs;
      this.lastExtensionsUpdatedAt = sqlWatermarkValue(extensionsMaxUpdatedAt);
      this.lastExtensionMarkerTs = extensionMarkerTs;
      this.lastActionMarkerTs = Math.max(
        0,
        actionMarkerTs - ACTION_MARKER_REPLAY_WINDOW_MS,
      );
      this.replayActionMarkerOnce = actionMarkerTs > 0;
      this.lastScreenRefreshTs = refreshTs;
      this.lastScreenRefreshSessionId =
        typeof refreshResult.rows[0]?.session_id === "string"
          ? refreshResult.rows[0].session_id
          : "";
      this.screenRefreshHasMore = false;
      this.screenRefreshInitialized = true;
      this.lastDbCheck = actionMarkerTs > 0 ? 0 : Date.now();
    } catch {
      // Tables may not exist yet — ignore
    }
  }

  async checkExternalDbChanges(options: {
    durableEvents: boolean;
  }): Promise<void> {
    const now = Date.now();
    const interval = options.durableEvents
      ? DURABLE_LEGACY_DB_CHECK_INTERVAL_MS
      : LEGACY_DB_CHECK_INTERVAL_MS;
    if (now - this.lastDbCheck < interval) return;
    if (this.checkPromise) return this.checkPromise;
    this.lastDbCheck = now;
    this.checkPromise = this.doCheckExternalDbChanges()
      .then(() => {
        if (this.dbAssignedVersions && !syncEventsDisabled()) {
          return this.recordChain;
        }
      })
      .finally(() => {
        this.checkPromise = null;
      });
    return this.checkPromise;
  }

  private async doCheckExternalDbChanges(): Promise<void> {
    try {
      const db = this.getDb();

      const [
        appStateMaxTs,
        actionMarkerTs,
        settingsTs,
        extensionsMaxUpdatedAt,
      ] = await Promise.all([
        readMaxUpdatedAt(db, "application_state"),
        readActionMarkerMaxUpdatedAt(db),
        readSettingsMaxUpdatedAt(db),
        readMaxUpdatedAtRaw(db, "tools"),
      ]);

      const replayActionMarker = this.replayActionMarkerOnce;
      this.replayActionMarkerOnce = false;
      const appStateChanged =
        appStateMaxTs > this.lastAppStateTs || replayActionMarker;
      const screenRefreshNeedsCheck =
        appStateChanged || this.screenRefreshHasMore;

      const [appResult, refreshResult, extensionMarkerTs] =
        screenRefreshNeedsCheck
          ? await Promise.all([
              appStateChanged
                ? db.execute({
                    sql: "SELECT session_id, key, updated_at FROM application_state WHERE updated_at > ? ORDER BY updated_at ASC",
                    args: [this.lastAppStateTs],
                  })
                : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
              db.execute({
                sql: `SELECT session_id, updated_at, value FROM application_state
                    WHERE key = ?
                      AND (updated_at > ? OR (updated_at = ? AND session_id > ?))
                    ORDER BY updated_at ASC, session_id ASC
                    LIMIT ?`,
                args: [
                  SCREEN_REFRESH_KEY,
                  this.lastScreenRefreshTs,
                  this.lastScreenRefreshTs,
                  this.lastScreenRefreshSessionId,
                  SCREEN_REFRESH_QUERY_LIMIT,
                ],
              }),
              readExtensionMarkerMaxUpdatedAt(db),
            ])
          : ([
              { rows: [] as Record<string, unknown>[] },
              null,
              this.lastExtensionMarkerTs,
            ] as const);

      if (appResult.rows.length > 0) {
        const appTs = appResult.rows.reduce(
          (max, row) => Math.max(max, timestampValue(row.updated_at)),
          this.lastAppStateTs,
        );
        if (this.lastAppStateTs > 0) {
          for (const row of appResult.rows) {
            const key = typeof row.key === "string" ? row.key : "*";
            if (
              key === EXTENSION_CHANGE_MARKER_KEY ||
              key === ACTION_CHANGE_MARKER_KEY
            ) {
              continue;
            }
            const owner =
              typeof row.session_id === "string" ? row.session_id : undefined;
            this.recordChange(
              {
                source: "app-state",
                type: "change",
                key,
                ...(owner ? { owner } : {}),
              },
              { dedupeKey: `app-state|${timestampValue(row.updated_at)}` },
            );
          }
        }
        this.lastAppStateTs = appTs;
      }

      if (actionMarkerTs > this.lastActionMarkerTs) {
        const actionMarkerResult = await db.execute({
          sql: "SELECT session_id, value, updated_at FROM application_state WHERE key = ? AND updated_at > ? ORDER BY updated_at ASC",
          args: [ACTION_CHANGE_MARKER_KEY, this.lastActionMarkerTs],
        });
        const changedActionMarkers = actionMarkerResult.rows.filter(
          (row) => timestampValue(row.updated_at) > this.lastActionMarkerTs,
        );
        for (const row of changedActionMarkers) {
          const target = parseActionChangeMarker(row.session_id, row.value);
          if (!target) continue;
          this.recordActionChanges(
            [target],
            target.nonce
              ? `action|${target.nonce}`
              : `action|${timestampValue(row.updated_at)}`,
          );
        }
        this.lastActionMarkerTs = actionMarkerTs;
      }

      if (refreshResult) {
        if (!this.screenRefreshInitialized) {
          const lastRow = refreshResult.rows.at(-1);
          this.lastScreenRefreshTs = timestampValue(lastRow?.updated_at);
          this.lastScreenRefreshSessionId =
            typeof lastRow?.session_id === "string" ? lastRow.session_id : "";
          this.screenRefreshHasMore =
            refreshResult.rows.length >= SCREEN_REFRESH_QUERY_LIMIT;
          this.screenRefreshInitialized = true;
        } else {
          for (const row of refreshResult.rows) {
            const owner =
              typeof row.session_id === "string" ? row.session_id : undefined;
            if (!owner) continue;
            const rowTs = timestampValue(row.updated_at);
            let scope: string | undefined;
            try {
              const raw = row.value;
              if (typeof raw === "string") {
                const parsed = JSON.parse(raw);
                if (typeof parsed?.scope === "string") scope = parsed.scope;
              }
            } catch {}
            this.recordChange(
              {
                source: "screen-refresh",
                type: "change",
                key: SCREEN_REFRESH_KEY,
                owner,
                ...(scope ? { scope } : {}),
              },
              { dedupeKey: `screen-refresh|${rowTs}|${owner}` },
            );
            this.lastScreenRefreshTs = rowTs;
            this.lastScreenRefreshSessionId = owner;
          }
          this.screenRefreshHasMore =
            refreshResult.rows.length >= SCREEN_REFRESH_QUERY_LIMIT;
        }
      }

      if (extensionMarkerTs > this.lastExtensionMarkerTs) {
        const extensionMarkerResult = await db.execute({
          sql: "SELECT session_id, value, updated_at FROM application_state WHERE key = ? AND updated_at > ? ORDER BY updated_at ASC",
          args: [EXTENSION_CHANGE_MARKER_KEY, this.lastExtensionMarkerTs],
        });
        const changedExtensionMarkers = extensionMarkerResult.rows;
        if (this.lastExtensionMarkerTs > 0) {
          this.recordExtensionChanges(
            changedExtensionMarkers
              .map((row) =>
                parseExtensionChangeMarker(row.session_id, row.value),
              )
              .filter((target): target is ExtensionChangeTarget => !!target),
            `ext-marker|${extensionMarkerTs}`,
          );
        }
        this.lastExtensionMarkerTs = extensionMarkerTs;
      }

      if (settingsTs > this.lastSettingsTs) {
        if (this.lastSettingsTs > 0) {
          this.recordChange(
            {
              source: "settings",
              type: "change",
              key: "*",
              visibility: "public",
            },
            { dedupeKey: `settings|${settingsTs}` },
          );
        }
        this.lastSettingsTs = settingsTs;
      }

      const extensionsTs = timestampValue(extensionsMaxUpdatedAt);
      if (extensionsTs > this.lastExtensionsTs) {
        const since = this.lastExtensionsUpdatedAt;
        if (this.lastExtensionsTs > 0 && since !== undefined) {
          const extensionResult = await db.execute({
            sql: "SELECT id, owner_email, org_id, visibility, updated_at FROM tools WHERE updated_at > ? ORDER BY updated_at ASC",
            args: [since],
          });
          const changedExtensionRows = extensionResult.rows.filter(
            (row) => timestampValue(row.updated_at) > this.lastExtensionsTs,
          );
          const targetsByRow = await readExtensionTargetsForRows(
            db,
            changedExtensionRows,
          );
          targetsByRow.forEach((targets, i) => {
            this.recordExtensionChanges(
              targets,
              `ext-tools|${timestampValue(changedExtensionRows[i]?.updated_at)}`,
            );
          });
        }
        this.lastExtensionsTs = extensionsTs;
        this.lastExtensionsUpdatedAt = sqlWatermarkValue(
          extensionsMaxUpdatedAt,
        );
      }
    } catch {
      // Tables may not exist yet — ignore
    }
  }
}

let _defaultState: AppSyncState | undefined;

function hostedRealtimeTransportEnabled(): boolean {
  // config-ok: one of three copies that must agree byte-for-byte; the other
  // two are in `sentry-config.ts` and in generated worker source, and this
  // file cannot import either way without a cycle.
  return process.env.AGENT_NATIVE_REALTIME_TRANSPORT?.trim() === "hosted";
}

export const __hostedRealtimeTransportEnabledForTests =
  hostedRealtimeTransportEnabled;

export function getDefaultAppSyncState(): AppSyncState {
  if (!_defaultState) {
    _defaultState = new AppSyncState({
      dbAssignedVersions: hostedRealtimeTransportEnabled(),
      deterministicEventIds: true,
    });
  }
  return _defaultState;
}

export const syncEventsStore = defineStore({
  id: "sync_events",
  migrations: [
    {
      name: "baseline",
      // sync_version is created regardless of the transport flag: the release
      // step's environment may not match the functions'.
      run: (exec) => ensureSyncEventsSchema(exec, true),
    },
    {
      name: "seed-sync-version",
      kind: "data",
      run: (exec) => seedSyncVersion(exec, true),
    },
  ],
});

export const syncEventsPruneStateStore = defineStore({
  id: "sync_events_prune_state",
  migrations: [
    {
      name: "baseline",
      run: (exec) => ensureSyncEventsPruneState(exec),
    },
  ],
});

export function getVersion(): number {
  return getDefaultAppSyncState().getVersion();
}

export async function getCurrentPollBaseline(
  state: AppSyncState = getDefaultAppSyncState(),
): Promise<{ version: number; cursor: string }> {
  if (syncEventsDisabled()) {
    await state.seedVersionFromDb();
    await state.checkExternalDbChanges({ durableEvents: false });
    return state.getPollBaseline(false);
  }

  const releaseOwnedServerlessPoll =
    isProductionServerlessFunctionRuntime() && appMigratesAtRelease();
  try {
    if (!releaseOwnedServerlessPoll) {
      await state.seedVersionFromDb();
      await state.checkExternalDbChanges({ durableEvents: true });
    }
    return await state.getPollBaseline(true);
  } catch (error) {
    if (!(error instanceof SyncEventsTableUnavailableError)) throw error;
    if (releaseOwnedServerlessPoll) throw error;
    await state.seedVersionFromDb();
    await state.checkExternalDbChanges({ durableEvents: false });
    return state.getPollBaseline(false);
  }
}

export function getPollEmitter(): EventEmitter {
  return getDefaultAppSyncState().getPollEmitter();
}

export function invalidateCollabAccessCache(
  resourceType: string,
  resourceId: string,
): void {
  getDefaultAppSyncState().invalidateCollabAccessCache(
    resourceType,
    resourceId,
  );
}

export function __resetCollabAccessCacheForTests(): void {
  getDefaultAppSyncState().__resetAccessCacheForTests();
}

export function canSeeChangeForUser(
  event: ChangeVisibilityTarget,
  userEmail: string,
  orgId: string | undefined,
): boolean {
  return getDefaultAppSyncState().canSeeChangeForUser(event, userEmail, orgId);
}

export function recordChange(event: {
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}): void {
  getDefaultAppSyncState().recordChange(event);
}

export function prepareTransactionalChange(event: {
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}): Promise<TransactionalChange> {
  return getDefaultAppSyncState().prepareTransactionalChange(event);
}

setActionChangeFastPath((target) => {
  getDefaultAppSyncState().recordChange(
    {
      source: "action",
      type: "change",
      key: target.actionName,
      ...(target.owner ? { owner: target.owner } : {}),
      ...(target.orgId ? { orgId: target.orgId } : {}),
      ...(target.requestSource ? { requestSource: target.requestSource } : {}),
      ...(target.resourceType && target.resourceId
        ? { resourceType: target.resourceType, resourceId: target.resourceId }
        : {}),
    },
    target.nonce
      ? { dedupeKey: actionChangeDedupeKey(target, `action|${target.nonce}`) }
      : undefined,
  );
});

export function getChangesSince(since: number): {
  version: number;
  events: ChangeEvent[];
} {
  return getDefaultAppSyncState().getChangesSince(since);
}

export function getChangesSinceForUser(
  since: number,
  userEmail: string,
  orgId: string | undefined,
): ChangeReadResult {
  return getDefaultAppSyncState().getChangesSinceForUser(
    since,
    userEmail,
    orgId,
  );
}

export function registerSyncEventsPruneSweep(state: AppSyncState): () => void {
  return registerRecurringSweepHandler(SYNC_EVENTS_PRUNE_SWEEP_ID, (context) =>
    state.pruneDurableEventsForSweep(context).then(() => undefined),
  );
}

export function createPollHandler(
  state: AppSyncState = getDefaultAppSyncState(),
) {
  if (state === getDefaultAppSyncState()) {
    state.wireLocalEmitters();
    registerSyncEventsPruneSweep(state);
  }
  return defineEventHandler(async (event) => {
    try {
      const session = await import("./auth.js").then(({ getSession }) =>
        getSession(event),
      );
      if (!session?.email) {
        setResponseStatus(event, 401);
        return { error: "Unauthenticated" };
      }
      const query = getQuery(event);
      const cursor = decodeSyncCursor(query.cursor);
      const since =
        cursor?.version ?? (parseInt(String(query.since ?? "0"), 10) || 0);
      if (syncEventsDisabled()) {
        await state.seedVersionFromDb();
        await state.checkExternalDbChanges({ durableEvents: false });
        return await state.getCombinedChangesSinceForUser(
          since,
          session.email,
          session.orgId,
          false,
          cursor,
        );
      }

      const releaseOwnedServerlessPoll =
        isProductionServerlessFunctionRuntime() && appMigratesAtRelease();
      try {
        if (!releaseOwnedServerlessPoll) {
          await state.seedVersionFromDb();
          await state.checkExternalDbChanges({ durableEvents: true });
        }
        // ponytail: release-owned serverless polling trusts sync_events; route direct SQL writes through recordChange instead of restoring marker scans.
        return await state.getCombinedChangesSinceForUser(
          since,
          session.email,
          session.orgId,
          true,
          cursor,
        );
      } catch (error) {
        if (!(error instanceof SyncEventsTableUnavailableError)) throw error;
        if (releaseOwnedServerlessPoll) throw error;
        await state.seedVersionFromDb();
        await state.checkExternalDbChanges({ durableEvents: false });
        return await state.getCombinedChangesSinceForUser(
          since,
          session.email,
          session.orgId,
          false,
          cursor,
        );
      }
    } catch (error) {
      if (error instanceof SyncEventReadError) {
        console.error("[agent-native] sync event read unavailable", {
          requestId: getHttpRequestTelemetryId(event) ?? "unavailable",
        });
        setResponseStatus(event, 409);
        return { error: error.code };
      }
      console.error(
        `[agent-native] Poll handler failed (request_id=${getHttpRequestTelemetryId(event) ?? "unavailable"})`,
        error,
      );
      throw error;
    }
  });
}
