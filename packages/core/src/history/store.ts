import {
  getDbExec,
  intType,
  isPostgres,
  isUniqueViolation,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import type { Visibility } from "../sharing/schema.js";
import type {
  HistoryActorKind,
  ResourceHistoryScope,
  ResourceVersion,
} from "./types.js";

let historyTableInitPromise: Promise<void> | undefined;

const VERSION_INSERT_MAX_ATTEMPTS = 8;

export interface InsertResourceVersionInput {
  resourceType: string;
  resourceId: string;
  createdBy?: string | null;
  actorKind?: HistoryActorKind;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
  title?: string | null;
  summary?: string | null;
  snapshot: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface QueryResourceVersionsInput {
  resourceType: string;
  resourceId: string;
  scope: ResourceHistoryScope;
  bypassScope?: boolean;
  limit?: number;
  offset?: number;
}

export async function ensureResourceVersionsTable(): Promise<void> {
  if (!historyTableInitPromise) {
    historyTableInitPromise = (async () => {
      const client = getDbExec();
      const createSql = `CREATE TABLE IF NOT EXISTS agent_resource_versions (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      version_number ${intType()} NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      actor_kind TEXT NOT NULL DEFAULT 'human',
      owner_email TEXT,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      title TEXT,
      summary TEXT,
      snapshot_json TEXT NOT NULL,
      metadata_json TEXT
    )`;
      const indexes = [
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_resource_versions_resource_number
           ON agent_resource_versions (resource_type, resource_id, version_number)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_resource_versions_owner
           ON agent_resource_versions (owner_email, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_resource_versions_org
           ON agent_resource_versions (org_id, created_at)`,
      ];

      if (isPostgres()) {
        await ensureTableExists("agent_resource_versions", createSql);
        await ensureIndexExists(
          "idx_agent_resource_versions_resource_number",
          indexes[0],
        );
        await ensureIndexExists(
          "idx_agent_resource_versions_owner",
          indexes[1],
        );
        await ensureIndexExists("idx_agent_resource_versions_org", indexes[2]);
      } else {
        await client.execute(createSql);
        for (const indexSql of indexes) {
          await client.execute(indexSql);
        }
      }
    })();
  }

  await historyTableInitPromise;
}

export async function insertResourceVersion(
  input: InsertResourceVersionInput,
): Promise<ResourceVersion> {
  await ensureResourceVersionsTable();
  const client = getDbExec();
  const visibility =
    input.visibility === "org" || input.visibility === "public"
      ? input.visibility
      : "private";
  const actorKind = input.actorKind ?? "human";
  const createdBy = input.createdBy ?? null;
  const ownerEmail = input.ownerEmail ?? input.createdBy ?? null;
  const orgId = input.orgId ?? null;
  const title = input.title ?? null;
  const summary = input.summary ?? null;
  const metadata = input.metadata ?? null;
  const snapshotJson = JSON.stringify(input.snapshot);
  const metadataJson = stringifyOptionalJson(metadata);

  let lastError: unknown;
  for (let attempt = 0; attempt < VERSION_INSERT_MAX_ATTEMPTS; attempt++) {
    const maxRows = await client.execute({
      sql: `SELECT MAX(version_number) as max_version
       FROM agent_resource_versions
      WHERE resource_type = ? AND resource_id = ?`,
      args: [input.resourceType, input.resourceId],
    });
    const versionNumber =
      Number(
        (maxRows.rows?.[0] as Record<string, unknown> | undefined)
          ?.max_version ?? 0,
      ) + 1;
    const id = createVersionId();
    const createdAt = new Date().toISOString();
    const version: ResourceVersion = {
      id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      versionNumber,
      createdAt,
      createdBy,
      actorKind,
      ownerEmail,
      orgId,
      visibility,
      title,
      summary,
      snapshot: input.snapshot,
      metadata,
    };

    try {
      await client.execute({
        sql: `INSERT INTO agent_resource_versions (
      id,
      resource_type,
      resource_id,
      version_number,
      created_at,
      created_by,
      actor_kind,
      owner_email,
      org_id,
      visibility,
      title,
      summary,
      snapshot_json,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.id,
          version.resourceType,
          version.resourceId,
          version.versionNumber,
          version.createdAt,
          version.createdBy,
          version.actorKind,
          version.ownerEmail,
          version.orgId,
          version.visibility,
          version.title,
          version.summary,
          snapshotJson,
          metadataJson,
        ],
      });
      return version;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to allocate a unique resource version number");
}

export async function queryResourceVersions(
  input: QueryResourceVersionsInput,
): Promise<ResourceVersion[]> {
  await ensureResourceVersionsTable();
  const client = getDbExec();
  const { clause, params } = input.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedResourceClause(input.scope);
  const limit = clampLimit(input.limit);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const result = await client.execute({
    sql: `SELECT ${listColumns()}
       FROM agent_resource_versions
      WHERE resource_type = ? AND resource_id = ? AND ${clause}
      ORDER BY version_number DESC
      LIMIT ? OFFSET ?`,
    args: [input.resourceType, input.resourceId, ...params, limit, offset],
  });
  return (result.rows ?? []).map((row) => mapVersionRow(row, false));
}

export async function getResourceVersionById(
  id: string,
  scope: ResourceHistoryScope,
  options: { bypassScope?: boolean } = {},
): Promise<ResourceVersion | null> {
  await ensureResourceVersionsTable();
  const client = getDbExec();
  const { clause, params } = options.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedResourceClause(scope);
  const result = await client.execute({
    sql: `SELECT ${allColumns()}
       FROM agent_resource_versions
      WHERE id = ? AND ${clause}
      LIMIT 1`,
    args: [id, ...params],
  });
  const row = result.rows?.[0];
  return row ? mapVersionRow(row, true) : null;
}

export async function getResourceVersionByNumber(
  resourceType: string,
  resourceId: string,
  versionNumber: number,
  scope: ResourceHistoryScope,
  options: { bypassScope?: boolean } = {},
): Promise<ResourceVersion | null> {
  await ensureResourceVersionsTable();
  const client = getDbExec();
  const { clause, params } = options.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedResourceClause(scope);
  const result = await client.execute({
    sql: `SELECT ${allColumns()}
       FROM agent_resource_versions
      WHERE resource_type = ?
        AND resource_id = ?
        AND version_number = ?
        AND ${clause}
      LIMIT 1`,
    args: [resourceType, resourceId, versionNumber, ...params],
  });
  const row = result.rows?.[0];
  return row ? mapVersionRow(row, true) : null;
}

export function __resetHistoryInitForTests(): void {
  historyTableInitPromise = undefined;
}

function listColumns(): string {
  return [
    "id",
    "resource_type",
    "resource_id",
    "version_number",
    "created_at",
    "created_by",
    "actor_kind",
    "owner_email",
    "org_id",
    "visibility",
    "title",
    "summary",
    "metadata_json",
  ].join(", ");
}

function allColumns(): string {
  return `${listColumns()}, snapshot_json`;
}

function scopedResourceClause(scope: ResourceHistoryScope): {
  clause: string;
  params: unknown[];
} {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (scope.userEmail) {
    parts.push("owner_email = ?");
    params.push(scope.userEmail);
  }
  if (scope.orgId) {
    parts.push("(visibility = 'org' AND org_id = ?)");
    params.push(scope.orgId);
  }
  parts.push("visibility = 'public'");

  if (parts.length === 0) {
    return { clause: "visibility = 'public'", params: [] };
  }

  return { clause: `(${parts.join(" OR ")})`, params };
}

function mapVersionRow(
  row: Record<string, unknown>,
  includeSnapshot: boolean,
): ResourceVersion {
  const version: ResourceVersion = {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    versionNumber: Number(row.version_number),
    createdAt: String(row.created_at),
    createdBy: nullableString(row.created_by),
    actorKind: normalizeActorKind(row.actor_kind),
    ownerEmail: nullableString(row.owner_email),
    orgId: nullableString(row.org_id),
    visibility: normalizeVisibility(row.visibility),
    title: nullableString(row.title),
    summary: nullableString(row.summary),
    metadata: parseOptionalJson(row.metadata_json),
  };
  if (includeSnapshot) {
    version.snapshot = parseRequiredJson(row.snapshot_json);
  }
  return version;
}

function createVersionId(): string {
  return `ver_${globalThis.crypto.randomUUID()}`;
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(200, Math.max(1, Math.floor(value ?? 50)));
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizeVisibility(value: unknown): Visibility {
  return value === "org" || value === "public" ? value : "private";
}

function normalizeActorKind(value: unknown): HistoryActorKind {
  return value === "agent" || value === "system" ? value : "human";
}

function stringifyOptionalJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseOptionalJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = parseRequiredJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function parseRequiredJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value);
}
