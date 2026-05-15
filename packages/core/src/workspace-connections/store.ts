import { randomUUID } from "node:crypto";
import {
  getDbExec,
  intType,
  isPostgres,
  isUniqueViolation,
  retryOnDdlRace,
  safeJsonParse,
  type DbExec,
} from "../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";

export type WorkspaceConnectionStatus =
  | "connected"
  | "checking"
  | "needs_reauth"
  | "error"
  | "disabled";

export interface WorkspaceConnectionCredentialRef {
  key: string;
  scope?: "user" | "org";
  provider?: string;
  label?: string;
  [key: string]: unknown;
}

export interface WorkspaceConnection {
  id: string;
  provider: string;
  label: string;
  accountId: string | null;
  accountLabel: string | null;
  status: WorkspaceConnectionStatus;
  scopes: string[];
  config: Record<string, unknown>;
  allowedApps: string[];
  credentialRefs: WorkspaceConnectionCredentialRef[];
  ownerEmail: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export type SerializedWorkspaceConnection = WorkspaceConnection;

export interface ListWorkspaceConnectionsOptions {
  provider?: string;
  appId?: string;
  includeDisabled?: boolean;
}

export interface UpsertWorkspaceConnectionInput {
  id?: string;
  provider: string;
  label?: string;
  accountId?: string | null;
  accountLabel?: string | null;
  status?: WorkspaceConnectionStatus;
  scopes?: string[];
  config?: Record<string, unknown>;
  allowedApps?: string[];
  credentialRefs?: WorkspaceConnectionCredentialRef[];
  lastCheckedAt?: Date | number | string | null;
  lastError?: string | null;
}

let _initPromise: Promise<void> | undefined;

function workspaceConnectionsTable(): string {
  return isPostgres()
    ? "public.workspace_connections"
    : "workspace_connections";
}

function isDuplicateColumnError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? "");
  const message = String((err as { message?: unknown })?.message ?? err)
    .toLowerCase()
    .trim();
  return (
    code === "42701" ||
    message.includes("duplicate column") ||
    message.includes("already exists")
  );
}

async function ensureColumn(
  client: DbExec,
  name: string,
  definition: string,
): Promise<void> {
  const table = workspaceConnectionsTable();
  try {
    await retryOnDdlRace(() =>
      client.execute(
        isPostgres()
          ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`
          : `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`,
      ),
    );
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}

export async function ensureWorkspaceConnectionsTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const table = workspaceConnectionsTable();
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL DEFAULT '',
            label TEXT NOT NULL DEFAULT '',
            account_id TEXT,
            account_label TEXT,
            status TEXT NOT NULL DEFAULT 'connected',
            scopes_json TEXT NOT NULL DEFAULT '[]',
            config_json TEXT NOT NULL DEFAULT '{}',
            allowed_apps_json TEXT NOT NULL DEFAULT '[]',
            credential_refs_json TEXT NOT NULL DEFAULT '[]',
            owner_email TEXT NOT NULL DEFAULT '',
            org_id TEXT,
            created_at ${intType()} NOT NULL DEFAULT 0,
            updated_at ${intType()} NOT NULL DEFAULT 0,
            last_checked_at ${intType()},
            last_error TEXT
          )
        `),
      );

      await ensureColumn(client, "provider", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(client, "label", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(client, "account_id", "TEXT");
      await ensureColumn(client, "account_label", "TEXT");
      await ensureColumn(client, "status", "TEXT NOT NULL DEFAULT 'connected'");
      await ensureColumn(client, "scopes_json", "TEXT NOT NULL DEFAULT '[]'");
      await ensureColumn(client, "config_json", "TEXT NOT NULL DEFAULT '{}'");
      await ensureColumn(
        client,
        "allowed_apps_json",
        "TEXT NOT NULL DEFAULT '[]'",
      );
      await ensureColumn(
        client,
        "credential_refs_json",
        "TEXT NOT NULL DEFAULT '[]'",
      );
      await ensureColumn(client, "owner_email", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(client, "org_id", "TEXT");
      await ensureColumn(
        client,
        "created_at",
        `${intType()} NOT NULL DEFAULT 0`,
      );
      await ensureColumn(
        client,
        "updated_at",
        `${intType()} NOT NULL DEFAULT 0`,
      );
      await ensureColumn(client, "last_checked_at", intType());
      await ensureColumn(client, "last_error", "TEXT");

      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_workspace_connections_scope_provider ON ${table} (org_id, owner_email, provider)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_workspace_connections_updated_at ON ${table} (updated_at)`,
        ),
      );
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function requireWorkspaceConnectionScope(): {
  ownerEmail: string;
  orgId: string | null;
} {
  const ownerEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!ownerEmail) {
    throw new Error("Workspace connections require an authenticated user.");
  }
  return {
    ownerEmail,
    orgId: getRequestOrgId()?.trim() || null,
  };
}

function scopedWhere(
  scope: ReturnType<typeof requireWorkspaceConnectionScope>,
): { sql: string; args: string[] } {
  if (scope.orgId) {
    return { sql: "org_id = ?", args: [scope.orgId] };
  }
  return {
    sql: "owner_email = ? AND org_id IS NULL",
    args: [scope.ownerEmail],
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeCredentialRefs(
  value: unknown,
): WorkspaceConnectionCredentialRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is WorkspaceConnectionCredentialRef =>
        !!entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as WorkspaceConnectionCredentialRef).key === "string",
    )
    .map((entry) => sanitizeCredentialRef(entry))
    .filter((entry) => entry.key.trim().length > 0);
}

function normalizeStatus(value: unknown): WorkspaceConnectionStatus {
  if (
    value === "checking" ||
    value === "needs_reauth" ||
    value === "error" ||
    value === "disabled"
  ) {
    return value;
  }
  return "connected";
}

function millis(
  value: Date | number | string | null | undefined,
): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(num).toISOString();
}

const SECRET_KEYS = new Set([
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
  "accesstoken",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sanitizeJson(value: unknown, allowCredentialRefKey = false): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJson(entry, allowCredentialRefKey));
  }
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (
      SECRET_KEYS.has(normalized) &&
      !(allowCredentialRefKey && normalized === "key")
    ) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizeJson(entry, allowCredentialRefKey);
  }
  return result;
}

function sanitizeConfig(
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return sanitizeJson(normalizeObject(config), false) as Record<
    string,
    unknown
  >;
}

function sanitizeCredentialRef(
  ref: WorkspaceConnectionCredentialRef,
): WorkspaceConnectionCredentialRef {
  const sanitized = sanitizeJson(ref, true) as WorkspaceConnectionCredentialRef;
  if (Object.prototype.hasOwnProperty.call(sanitized, "value")) {
    sanitized.value = "[redacted]";
  }
  return sanitized;
}

function parseRow(row: Record<string, unknown>): WorkspaceConnection {
  return serializeWorkspaceConnection({
    id: String(row.id),
    provider: String(row.provider ?? ""),
    label: String(row.label ?? ""),
    accountId: row.account_id == null ? null : String(row.account_id),
    accountLabel: row.account_label == null ? null : String(row.account_label),
    status: normalizeStatus(row.status),
    scopes: normalizeStringArray(safeJsonParse<unknown>(row.scopes_json, [])),
    config: normalizeObject(safeJsonParse<unknown>(row.config_json, {})),
    allowedApps: normalizeStringArray(
      safeJsonParse<unknown>(row.allowed_apps_json, []),
    ),
    credentialRefs: normalizeCredentialRefs(
      safeJsonParse<unknown>(row.credential_refs_json, []),
    ),
    ownerEmail: String(row.owner_email ?? ""),
    orgId: row.org_id == null ? null : String(row.org_id),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
    lastCheckedAt: iso(row.last_checked_at),
    lastError: row.last_error == null ? null : String(row.last_error),
  });
}

export function serializeWorkspaceConnection(
  connection: WorkspaceConnection,
): SerializedWorkspaceConnection {
  return {
    ...connection,
    scopes: normalizeStringArray(connection.scopes),
    config: sanitizeConfig(connection.config),
    allowedApps: normalizeStringArray(connection.allowedApps),
    credentialRefs: normalizeCredentialRefs(connection.credentialRefs),
  };
}

export async function listWorkspaceConnections(
  options: ListWorkspaceConnectionsOptions = {},
): Promise<SerializedWorkspaceConnection[]> {
  await ensureWorkspaceConnectionsTable();
  const client = getDbExec();
  const table = workspaceConnectionsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const clauses = [where.sql];
  const args: unknown[] = [...where.args];

  if (options.provider) {
    clauses.push("provider = ?");
    args.push(options.provider);
  }
  if (!options.includeDisabled) {
    clauses.push("status != ?");
    args.push("disabled");
  }

  const { rows } = await client.execute({
    sql: `SELECT * FROM ${table} WHERE ${clauses.join(
      " AND ",
    )} ORDER BY updated_at DESC`,
    args,
  });

  return rows
    .map((row) => parseRow(row as Record<string, unknown>))
    .filter(
      (connection) =>
        !options.appId ||
        connection.allowedApps.length === 0 ||
        connection.allowedApps.includes(options.appId),
    );
}

export async function getWorkspaceConnection(
  id: string,
): Promise<SerializedWorkspaceConnection | null> {
  await ensureWorkspaceConnectionsTable();
  const client = getDbExec();
  const table = workspaceConnectionsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${table} WHERE id = ? AND ${where.sql} LIMIT 1`,
    args: [id, ...where.args],
  });
  if (rows.length === 0) return null;
  return parseRow(rows[0] as Record<string, unknown>);
}

export async function upsertWorkspaceConnection(
  input: UpsertWorkspaceConnectionInput,
): Promise<SerializedWorkspaceConnection> {
  await ensureWorkspaceConnectionsTable();
  const provider = input.provider.trim();
  if (!provider) {
    throw new Error("upsertWorkspaceConnection requires a provider.");
  }

  const client = getDbExec();
  const table = workspaceConnectionsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const id = input.id?.trim() || randomUUID();
  const now = Date.now();
  const label = input.label?.trim() || input.accountLabel?.trim() || provider;
  const status = normalizeStatus(input.status);
  const scopes = normalizeStringArray(input.scopes);
  const config = sanitizeConfig(input.config);
  const allowedApps = normalizeStringArray(input.allowedApps);
  const credentialRefs = normalizeCredentialRefs(input.credentialRefs);
  const lastCheckedAt = millis(input.lastCheckedAt);
  const lastError = input.lastError ?? null;

  const update = await client.execute({
    sql: `UPDATE ${table}
      SET provider = ?, label = ?, account_id = ?, account_label = ?,
        status = ?, scopes_json = ?, config_json = ?, allowed_apps_json = ?,
        credential_refs_json = ?, updated_at = ?, last_checked_at = ?,
        last_error = ?
      WHERE id = ? AND ${where.sql}`,
    args: [
      provider,
      label,
      input.accountId ?? null,
      input.accountLabel ?? null,
      status,
      JSON.stringify(scopes),
      JSON.stringify(config),
      JSON.stringify(allowedApps),
      JSON.stringify(credentialRefs),
      now,
      lastCheckedAt,
      lastError,
      id,
      ...where.args,
    ],
  });

  if (update.rowsAffected === 0) {
    try {
      await client.execute({
        sql: `INSERT INTO ${table}
          (id, provider, label, account_id, account_label, status,
            scopes_json, config_json, allowed_apps_json, credential_refs_json,
            owner_email, org_id, created_at, updated_at, last_checked_at,
            last_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          provider,
          label,
          input.accountId ?? null,
          input.accountLabel ?? null,
          status,
          JSON.stringify(scopes),
          JSON.stringify(config),
          JSON.stringify(allowedApps),
          JSON.stringify(credentialRefs),
          scope.ownerEmail,
          scope.orgId,
          now,
          now,
          lastCheckedAt,
          lastError,
        ],
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `Workspace connection "${id}" already exists outside the current request scope.`,
        );
      }
      throw err;
    }
  }

  const connection = await getWorkspaceConnection(id);
  if (!connection) {
    throw new Error(`Workspace connection "${id}" was not found after upsert.`);
  }
  return connection;
}

export async function deleteWorkspaceConnection(id: string): Promise<boolean> {
  await ensureWorkspaceConnectionsTable();
  const client = getDbExec();
  const table = workspaceConnectionsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE id = ? AND ${where.sql}`,
    args: [id, ...where.args],
  });
  return result.rowsAffected > 0;
}
