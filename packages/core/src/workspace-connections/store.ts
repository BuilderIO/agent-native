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

export interface WorkspaceConnectionGrant {
  id: string;
  connectionId: string;
  provider: string;
  appId: string;
  scopes: string[];
  config: Record<string, unknown>;
  credentialRefs: WorkspaceConnectionCredentialRef[];
  grantedByEmail: string;
  ownerEmail: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SerializedWorkspaceConnectionGrant = WorkspaceConnectionGrant;

export interface ListWorkspaceConnectionsOptions {
  provider?: string;
  appId?: string;
  includeDisabled?: boolean;
}

export interface ListWorkspaceConnectionGrantsOptions {
  connectionId?: string;
  appId?: string;
  provider?: string;
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

export interface UpsertWorkspaceConnectionGrantInput {
  id?: string;
  connectionId: string;
  appId: string;
  provider?: string;
  scopes?: string[];
  config?: Record<string, unknown>;
  credentialRefs?: WorkspaceConnectionCredentialRef[];
}

let _initPromise: Promise<void> | undefined;

function workspaceConnectionsTable(): string {
  return isPostgres()
    ? "public.workspace_connections"
    : "workspace_connections";
}

function workspaceConnectionGrantsTable(): string {
  return isPostgres()
    ? "public.workspace_connection_grants"
    : "workspace_connection_grants";
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
  table: string,
  name: string,
  definition: string,
): Promise<void> {
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

async function ensureWorkspaceConnectionColumns(
  client: DbExec,
  table: string,
): Promise<void> {
  await ensureColumn(client, table, "provider", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, table, "label", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, table, "account_id", "TEXT");
  await ensureColumn(client, table, "account_label", "TEXT");
  await ensureColumn(
    client,
    table,
    "status",
    "TEXT NOT NULL DEFAULT 'connected'",
  );
  await ensureColumn(
    client,
    table,
    "scopes_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  await ensureColumn(
    client,
    table,
    "config_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  await ensureColumn(
    client,
    table,
    "allowed_apps_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  await ensureColumn(
    client,
    table,
    "credential_refs_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  await ensureColumn(client, table, "owner_email", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, table, "org_id", "TEXT");
  await ensureColumn(
    client,
    table,
    "created_at",
    `${intType()} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    client,
    table,
    "updated_at",
    `${intType()} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(client, table, "last_checked_at", intType());
  await ensureColumn(client, table, "last_error", "TEXT");
}

async function ensureWorkspaceConnectionGrantColumns(
  client: DbExec,
  table: string,
): Promise<void> {
  await ensureColumn(
    client,
    table,
    "connection_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  await ensureColumn(client, table, "provider", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, table, "app_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(
    client,
    table,
    "scopes_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  await ensureColumn(
    client,
    table,
    "config_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  await ensureColumn(
    client,
    table,
    "credential_refs_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  await ensureColumn(
    client,
    table,
    "granted_by_email",
    "TEXT NOT NULL DEFAULT ''",
  );
  await ensureColumn(client, table, "owner_email", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(client, table, "org_id", "TEXT");
  await ensureColumn(
    client,
    table,
    "created_at",
    `${intType()} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    client,
    table,
    "updated_at",
    `${intType()} NOT NULL DEFAULT 0`,
  );
}

export async function ensureWorkspaceConnectionsTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const table = workspaceConnectionsTable();
      const grantsTable = workspaceConnectionGrantsTable();
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

      await ensureWorkspaceConnectionColumns(client, table);

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
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS ${grantsTable} (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL DEFAULT '',
            provider TEXT NOT NULL DEFAULT '',
            app_id TEXT NOT NULL DEFAULT '',
            scopes_json TEXT NOT NULL DEFAULT '[]',
            config_json TEXT NOT NULL DEFAULT '{}',
            credential_refs_json TEXT NOT NULL DEFAULT '[]',
            granted_by_email TEXT NOT NULL DEFAULT '',
            owner_email TEXT NOT NULL DEFAULT '',
            org_id TEXT,
            created_at ${intType()} NOT NULL DEFAULT 0,
            updated_at ${intType()} NOT NULL DEFAULT 0
          )
        `),
      );

      await ensureWorkspaceConnectionGrantColumns(client, grantsTable);

      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connection_grants_connection_app ON ${grantsTable} (connection_id, app_id)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_workspace_connection_grants_scope_app ON ${grantsTable} (org_id, owner_email, app_id)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_workspace_connection_grants_updated_at ON ${grantsTable} (updated_at)`,
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

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
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

function parseGrantRow(row: Record<string, unknown>): WorkspaceConnectionGrant {
  return serializeWorkspaceConnectionGrant({
    id: String(row.id),
    connectionId: String(row.connection_id ?? ""),
    provider: String(row.provider ?? ""),
    appId: String(row.app_id ?? ""),
    scopes: normalizeStringArray(safeJsonParse<unknown>(row.scopes_json, [])),
    config: normalizeObject(safeJsonParse<unknown>(row.config_json, {})),
    credentialRefs: normalizeCredentialRefs(
      safeJsonParse<unknown>(row.credential_refs_json, []),
    ),
    grantedByEmail: String(row.granted_by_email ?? ""),
    ownerEmail: String(row.owner_email ?? ""),
    orgId: row.org_id == null ? null : String(row.org_id),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
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

export function serializeWorkspaceConnectionGrant(
  grant: WorkspaceConnectionGrant,
): SerializedWorkspaceConnectionGrant {
  return {
    ...grant,
    scopes: normalizeStringArray(grant.scopes),
    config: sanitizeConfig(grant.config),
    credentialRefs: normalizeCredentialRefs(grant.credentialRefs),
  };
}

async function getGrantedConnectionIdsForApp(
  client: DbExec,
  scope: ReturnType<typeof requireWorkspaceConnectionScope>,
  appId: string,
): Promise<Set<string>> {
  const table = workspaceConnectionGrantsTable();
  const where = scopedWhere(scope);
  const { rows } = await client.execute({
    sql: `SELECT connection_id FROM ${table} WHERE app_id = ? AND ${where.sql}`,
    args: [appId, ...where.args],
  });
  return new Set(
    rows
      .map((row) =>
        String((row as Record<string, unknown>).connection_id ?? ""),
      )
      .filter(Boolean),
  );
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
  const appId = options.appId?.trim();

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

  const connections = rows.map((row) =>
    parseRow(row as Record<string, unknown>),
  );
  if (!appId) return connections;

  const grantedConnectionIds = await getGrantedConnectionIdsForApp(
    client,
    scope,
    appId,
  );
  return connections.filter(
    (connection) =>
      connection.allowedApps.length === 0 ||
      connection.allowedApps.includes(appId) ||
      grantedConnectionIds.has(connection.id),
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

export async function listWorkspaceConnectionGrants(
  options: ListWorkspaceConnectionGrantsOptions = {},
): Promise<SerializedWorkspaceConnectionGrant[]> {
  await ensureWorkspaceConnectionsTable();
  const client = getDbExec();
  const table = workspaceConnectionGrantsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const clauses = [where.sql];
  const args: unknown[] = [...where.args];
  const connectionId = options.connectionId?.trim();
  const appId = options.appId?.trim();
  const provider = options.provider?.trim();

  if (connectionId) {
    clauses.push("connection_id = ?");
    args.push(connectionId);
  }
  if (appId) {
    clauses.push("app_id = ?");
    args.push(appId);
  }
  if (provider) {
    clauses.push("provider = ?");
    args.push(provider);
  }

  const { rows } = await client.execute({
    sql: `SELECT * FROM ${table} WHERE ${clauses.join(
      " AND ",
    )} ORDER BY updated_at DESC`,
    args,
  });

  return rows.map((row) => parseGrantRow(row as Record<string, unknown>));
}

export async function getWorkspaceConnectionGrant(
  connectionId: string,
  appId: string,
): Promise<SerializedWorkspaceConnectionGrant | null> {
  await ensureWorkspaceConnectionsTable();
  const normalizedConnectionId = normalizeRequiredString(
    connectionId,
    "getWorkspaceConnectionGrant connectionId",
  );
  const normalizedAppId = normalizeRequiredString(
    appId,
    "getWorkspaceConnectionGrant appId",
  );
  const client = getDbExec();
  const table = workspaceConnectionGrantsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${table} WHERE connection_id = ? AND app_id = ? AND ${where.sql} LIMIT 1`,
    args: [normalizedConnectionId, normalizedAppId, ...where.args],
  });
  if (rows.length === 0) return null;
  return parseGrantRow(rows[0] as Record<string, unknown>);
}

export async function upsertWorkspaceConnectionGrant(
  input: UpsertWorkspaceConnectionGrantInput,
): Promise<SerializedWorkspaceConnectionGrant> {
  await ensureWorkspaceConnectionsTable();
  const connectionId = normalizeRequiredString(
    input.connectionId,
    "upsertWorkspaceConnectionGrant connectionId",
  );
  const appId = normalizeRequiredString(
    input.appId,
    "upsertWorkspaceConnectionGrant appId",
  );

  const connection = await getWorkspaceConnection(connectionId);
  if (!connection) {
    throw new Error(
      `Workspace connection "${connectionId}" was not found in the current request scope.`,
    );
  }

  const client = getDbExec();
  const table = workspaceConnectionGrantsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const id = input.id?.trim() || randomUUID();
  const now = Date.now();
  const provider = input.provider?.trim() || connection.provider;
  const scopes = normalizeStringArray(input.scopes);
  const config = sanitizeConfig(input.config);
  const credentialRefs = normalizeCredentialRefs(input.credentialRefs);

  const update = await client.execute({
    sql: `UPDATE ${table}
      SET provider = ?, scopes_json = ?, config_json = ?,
        credential_refs_json = ?, granted_by_email = ?, updated_at = ?
      WHERE connection_id = ? AND app_id = ? AND ${where.sql}`,
    args: [
      provider,
      JSON.stringify(scopes),
      JSON.stringify(config),
      JSON.stringify(credentialRefs),
      scope.ownerEmail,
      now,
      connectionId,
      appId,
      ...where.args,
    ],
  });

  if (update.rowsAffected === 0) {
    try {
      await client.execute({
        sql: `INSERT INTO ${table}
          (id, connection_id, provider, app_id, scopes_json, config_json,
            credential_refs_json, granted_by_email, owner_email, org_id,
            created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          connectionId,
          provider,
          appId,
          JSON.stringify(scopes),
          JSON.stringify(config),
          JSON.stringify(credentialRefs),
          scope.ownerEmail,
          scope.ownerEmail,
          scope.orgId,
          now,
          now,
        ],
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `Workspace connection grant for "${connectionId}" and "${appId}" already exists outside the current request scope.`,
        );
      }
      throw err;
    }
  }

  const grant = await getWorkspaceConnectionGrant(connectionId, appId);
  if (!grant) {
    throw new Error(
      `Workspace connection grant for "${connectionId}" and "${appId}" was not found after upsert.`,
    );
  }
  return grant;
}

export async function revokeWorkspaceConnectionGrant(
  connectionId: string,
  appId: string,
): Promise<boolean> {
  await ensureWorkspaceConnectionsTable();
  const normalizedConnectionId = normalizeRequiredString(
    connectionId,
    "revokeWorkspaceConnectionGrant connectionId",
  );
  const normalizedAppId = normalizeRequiredString(
    appId,
    "revokeWorkspaceConnectionGrant appId",
  );
  const client = getDbExec();
  const table = workspaceConnectionGrantsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE connection_id = ? AND app_id = ? AND ${where.sql}`,
    args: [normalizedConnectionId, normalizedAppId, ...where.args],
  });
  return result.rowsAffected > 0;
}

export async function deleteWorkspaceConnection(id: string): Promise<boolean> {
  await ensureWorkspaceConnectionsTable();
  const client = getDbExec();
  const table = workspaceConnectionsTable();
  const grantsTable = workspaceConnectionGrantsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE id = ? AND ${where.sql}`,
    args: [id, ...where.args],
  });
  if (result.rowsAffected > 0) {
    await client.execute({
      sql: `DELETE FROM ${grantsTable} WHERE connection_id = ? AND ${where.sql}`,
      args: [id, ...where.args],
    });
  }
  return result.rowsAffected > 0;
}
