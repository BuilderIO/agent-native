import { randomUUID } from "node:crypto";

import {
  listWorkspaceConnectionProviders,
  type WorkspaceConnectionCapability,
  type WorkspaceConnectionProvider,
  type WorkspaceConnectionTemplateUse,
} from "../connections/catalog.js";
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
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
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
  scope?: "user" | "org" | "workspace";
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
  lastUsedAt?: string | null;
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
  lastUsedAt?: string | null;
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

export interface ListWorkspaceConnectionsForAppOptions {
  appId: string;
  provider?: string;
  includeDisabled?: boolean;
}

export interface ResolveWorkspaceConnectionForAppOptions extends ListWorkspaceConnectionsForAppOptions {
  connectionId?: string;
  requireConnected?: boolean;
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

export type WorkspaceConnectionAppAccessMode =
  | "all-apps"
  | "allowed-app"
  | "explicit-grant"
  | "unavailable";

export interface WorkspaceConnectionAppAccess {
  appId: string;
  available: boolean;
  mode: WorkspaceConnectionAppAccessMode;
  reason: string;
  grantId: string | null;
}

export type WorkspaceConnectionGrantState =
  | "connected"
  | "granted"
  | "needs_grant"
  | "not_connected";

export type WorkspaceConnectionGrantAvailability =
  | "available"
  | "needs_grant"
  | "not_connected";

export type WorkspaceConnectionProviderReadinessStatus =
  | "ready"
  | "checking"
  | "needs_credentials"
  | "needs_attention"
  | "disabled"
  | "not_configured";

export interface WorkspaceConnectionPublicCredentialRef {
  key: string;
  scope?: string;
  provider?: string;
  label?: string;
  source: "connection" | "grant";
}

export interface WorkspaceConnectionExplicitGrantSummary {
  id: string;
  appId: string;
  scopes: string[];
  credentialRefs: WorkspaceConnectionPublicCredentialRef[];
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface WorkspaceConnectionForAppSummary {
  id: string;
  label: string;
  provider: string;
  accountId: string | null;
  accountLabel: string | null;
  status: WorkspaceConnectionStatus;
  grantedToApp: boolean;
  grantScope: "all-apps" | "selected-apps";
  appAccess: WorkspaceConnectionAppAccess;
  allowedApps: string[];
  credentialRefs: WorkspaceConnectionPublicCredentialRef[];
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  explicitGrant: WorkspaceConnectionExplicitGrantSummary | null;
}

export interface WorkspaceConnectionForApp extends SerializedWorkspaceConnection {
  appAccess: WorkspaceConnectionAppAccess;
  explicitGrant: SerializedWorkspaceConnectionGrant | null;
}

export interface ResolvedWorkspaceConnectionForApp {
  available: boolean;
  connection: WorkspaceConnectionForApp | null;
  appAccess: WorkspaceConnectionAppAccess | null;
  reason: string;
}

export interface WorkspaceConnectionProviderAppSummary {
  appId: string;
  provider: string;
  grantState: WorkspaceConnectionGrantState;
  grantAvailability: WorkspaceConnectionGrantAvailability;
  grantAvailabilityMessage: string;
  connectionCount: number;
  grantedConnectionCount: number;
  activeConnectionCount: number;
  ungrantedConnectionCount: number;
  unhealthyGrantedConnectionCount: number;
  explicitGrantCount: number;
  credentialRefCount: number;
  hasWorkspaceConnection: boolean;
  hasGrantedWorkspaceConnection: boolean;
  hasActiveWorkspaceConnection: boolean;
  lastUsedAt: string | null;
  statuses: WorkspaceConnectionStatus[];
  connections: WorkspaceConnectionForAppSummary[];
}

export interface WorkspaceConnectionProviderReadiness {
  status: WorkspaceConnectionProviderReadinessStatus;
  connectionCount: number;
  activeConnectionCount: number;
  readyConnectionCount: number;
  requiredCredentialKeys: string[];
  missingRequiredCredentialKeys: string[];
  appGrant: WorkspaceConnectionProviderAppSummary | null;
}

export interface WorkspaceConnectionProviderLike {
  id: string;
  label?: string;
  credentialKeys?: readonly {
    key: string;
    required?: boolean;
  }[];
}

export interface SummarizeWorkspaceConnectionProviderForAppOptions {
  providerId: string;
  appId: string;
  connections: SerializedWorkspaceConnection[];
  grants?: SerializedWorkspaceConnectionGrant[];
  includeConnections?: "all" | "granted";
}

export interface SummarizeWorkspaceConnectionProviderReadinessOptions {
  provider: WorkspaceConnectionProviderLike;
  connections: SerializedWorkspaceConnection[];
  grants?: SerializedWorkspaceConnectionGrant[];
  appId?: string;
  includeConnections?: "all" | "granted";
}

export interface ListWorkspaceConnectionProviderCatalogForAppOptions {
  appId: string;
  provider?: string;
  capability?: WorkspaceConnectionCapability;
  templateUse?: WorkspaceConnectionTemplateUse;
  includeDisabled?: boolean;
  includeConnections?: "all" | "granted";
}

export interface MarkWorkspaceConnectionUsedOptions {
  connectionId: string;
  appId?: string | null;
  usedAt?: Date | number | string | null;
}

export interface MarkWorkspaceConnectionUsedResult {
  connectionUpdated: boolean;
  grantUpdated: boolean;
  lastUsedAt: string;
}

export interface WorkspaceConnectionProviderCatalogForAppItem extends WorkspaceConnectionProvider {
  workspaceConnection: WorkspaceConnectionProviderAppSummary;
  readiness: WorkspaceConnectionProviderReadiness;
}

export interface WorkspaceConnectionProviderCatalogForApp {
  appId: string;
  providers: WorkspaceConnectionProviderCatalogForAppItem[];
  connections: SerializedWorkspaceConnection[];
  grants: SerializedWorkspaceConnectionGrant[];
  counts: {
    providers: number;
    connections: number;
    grants: number;
    readyProviders: number;
  };
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
  await ensureColumn(client, table, "last_used_at", intType());
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
  await ensureColumn(client, table, "last_used_at", intType());
}

export async function ensureWorkspaceConnectionsTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const table = workspaceConnectionsTable();
      const grantsTable = workspaceConnectionGrantsTable();

      const createConnectionsSql = `
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
            last_used_at ${intType()},
            last_checked_at ${intType()},
            last_error TEXT
          )
        `;
      const createGrantsSql = `
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
            updated_at ${intType()} NOT NULL DEFAULT 0,
            last_used_at ${intType()}
          )
        `;

      if (isPostgres()) {
        // PG-guard: probe information_schema / pg_indexes first (no lock) and
        // only issue DDL when the table/column/index is actually missing,
        // wrapped in a transaction-scoped lock_timeout so a contended lock
        // fails fast. Uses unqualified table names for the probe (the helpers
        // always search the `public` schema).

        // --- workspace_connections ---
        await ensureTableExists("workspace_connections", createConnectionsSql);
        await ensureColumnExists(
          "workspace_connections",
          "provider",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "label",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "account_id",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS account_id TEXT`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "account_label",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS account_label TEXT`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "status",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected'`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "scopes_json",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS scopes_json TEXT NOT NULL DEFAULT '[]'`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "config_json",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS config_json TEXT NOT NULL DEFAULT '{}'`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "allowed_apps_json",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS allowed_apps_json TEXT NOT NULL DEFAULT '[]'`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "credential_refs_json",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS credential_refs_json TEXT NOT NULL DEFAULT '[]'`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "owner_email",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "org_id",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS org_id TEXT`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "created_at",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS created_at ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "updated_at",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS updated_at ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "last_checked_at",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS last_checked_at ${intType()}`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "last_used_at",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS last_used_at ${intType()}`,
        );
        await ensureColumnExists(
          "workspace_connections",
          "last_error",
          `ALTER TABLE workspace_connections ADD COLUMN IF NOT EXISTS last_error TEXT`,
        );
        await ensureIndexExists(
          "idx_workspace_connections_scope_provider",
          `CREATE INDEX IF NOT EXISTS idx_workspace_connections_scope_provider ON ${table} (org_id, owner_email, provider)`,
        );
        await ensureIndexExists(
          "idx_workspace_connections_updated_at",
          `CREATE INDEX IF NOT EXISTS idx_workspace_connections_updated_at ON ${table} (updated_at)`,
        );

        // --- workspace_connection_grants ---
        await ensureTableExists("workspace_connection_grants", createGrantsSql);
        await ensureColumnExists(
          "workspace_connection_grants",
          "connection_id",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS connection_id TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "provider",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "app_id",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "scopes_json",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS scopes_json TEXT NOT NULL DEFAULT '[]'`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "config_json",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS config_json TEXT NOT NULL DEFAULT '{}'`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "credential_refs_json",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS credential_refs_json TEXT NOT NULL DEFAULT '[]'`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "granted_by_email",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS granted_by_email TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "owner_email",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT ''`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "org_id",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS org_id TEXT`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "created_at",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS created_at ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "updated_at",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS updated_at ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "workspace_connection_grants",
          "last_used_at",
          `ALTER TABLE workspace_connection_grants ADD COLUMN IF NOT EXISTS last_used_at ${intType()}`,
        );
        await ensureIndexExists(
          "idx_workspace_connection_grants_connection_app",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connection_grants_connection_app ON ${grantsTable} (connection_id, app_id)`,
        );
        await ensureIndexExists(
          "idx_workspace_connection_grants_scope_app",
          `CREATE INDEX IF NOT EXISTS idx_workspace_connection_grants_scope_app ON ${grantsTable} (org_id, owner_email, app_id)`,
        );
        await ensureIndexExists(
          "idx_workspace_connection_grants_updated_at",
          `CREATE INDEX IF NOT EXISTS idx_workspace_connection_grants_updated_at ON ${grantsTable} (updated_at)`,
        );
        return;
      }

      // SQLite (local dev): no ACCESS EXCLUSIVE lock problem — keep existing
      // retryOnDdlRace + ensureColumn behaviour.
      await retryOnDdlRace(() => client.execute(createConnectionsSql));
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
      await retryOnDdlRace(() => client.execute(createGrantsSql));
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
    lastUsedAt: iso(row.last_used_at),
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
    lastUsedAt: iso(row.last_used_at),
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

export function getWorkspaceConnectionAppAccess(
  connection: Pick<
    SerializedWorkspaceConnection,
    "id" | "allowedApps" | "label"
  >,
  appId: string,
  grants: Pick<
    SerializedWorkspaceConnectionGrant,
    "id" | "connectionId" | "appId"
  >[] = [],
): WorkspaceConnectionAppAccess {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId) {
    return {
      appId: normalizedAppId,
      available: false,
      mode: "unavailable",
      reason: "No app id was provided.",
      grantId: null,
    };
  }

  if (connection.allowedApps.length === 0) {
    return {
      appId: normalizedAppId,
      available: true,
      mode: "all-apps",
      reason: "Connection is available to every app in the workspace.",
      grantId: null,
    };
  }

  if (connection.allowedApps.includes(normalizedAppId)) {
    return {
      appId: normalizedAppId,
      available: true,
      mode: "allowed-app",
      reason: `Connection is directly allowed for ${normalizedAppId}.`,
      grantId: null,
    };
  }

  const explicitGrant = grants.find(
    (grant) =>
      grant.connectionId === connection.id && grant.appId === normalizedAppId,
  );
  if (explicitGrant) {
    return {
      appId: normalizedAppId,
      available: true,
      mode: "explicit-grant",
      reason: `Connection has an explicit grant for ${normalizedAppId}.`,
      grantId: explicitGrant.id,
    };
  }

  return {
    appId: normalizedAppId,
    available: false,
    mode: "unavailable",
    reason: `Grant ${normalizedAppId} access before this connection can be reused by the app.`,
    grantId: null,
  };
}

export function workspaceConnectionIsAvailableToApp(
  connection: Pick<
    SerializedWorkspaceConnection,
    "id" | "allowedApps" | "label"
  >,
  appId: string,
  grants: Pick<
    SerializedWorkspaceConnectionGrant,
    "id" | "connectionId" | "appId"
  >[] = [],
): boolean {
  return getWorkspaceConnectionAppAccess(connection, appId, grants).available;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const latest = values.reduce<number | null>((current, value) => {
    const parsed = value ? Date.parse(value) : NaN;
    if (!Number.isFinite(parsed)) return current;
    return current == null || parsed > current ? parsed : current;
  }, null);
  return latest == null ? null : new Date(latest).toISOString();
}

function publicCredentialRefs(
  refs: WorkspaceConnectionCredentialRef[],
  source: WorkspaceConnectionPublicCredentialRef["source"],
): WorkspaceConnectionPublicCredentialRef[] {
  return refs.map((ref) => ({
    key: ref.key,
    scope: ref.scope,
    provider: ref.provider,
    label: ref.label,
    source,
  }));
}

function grantsForConnection(
  connectionId: string,
  grants: SerializedWorkspaceConnectionGrant[],
  appId?: string,
): SerializedWorkspaceConnectionGrant[] {
  return grants.filter(
    (grant) =>
      grant.connectionId === connectionId && (!appId || grant.appId === appId),
  );
}

function explicitGrantForConnection(
  connectionId: string,
  grants: SerializedWorkspaceConnectionGrant[],
  appId?: string,
): SerializedWorkspaceConnectionGrant | undefined {
  return grantsForConnection(connectionId, grants, appId)[0];
}

function connectionForApp(
  connection: SerializedWorkspaceConnection,
  appId: string,
  grants: SerializedWorkspaceConnectionGrant[],
): WorkspaceConnectionForApp {
  const normalizedAppId = appId.trim();
  const appAccess = getWorkspaceConnectionAppAccess(
    connection,
    normalizedAppId,
    grants,
  );
  return {
    ...connection,
    appAccess,
    explicitGrant:
      explicitGrantForConnection(connection.id, grants, normalizedAppId) ??
      null,
  };
}

function serializeConnectionForApp(
  connection: SerializedWorkspaceConnection,
  appId: string,
  grants: SerializedWorkspaceConnectionGrant[],
): WorkspaceConnectionForAppSummary {
  const explicitGrant = explicitGrantForConnection(
    connection.id,
    grants,
    appId,
  );
  const appAccess = getWorkspaceConnectionAppAccess(connection, appId, grants);
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    accountId: connection.accountId,
    accountLabel: connection.accountLabel,
    status: connection.status,
    grantedToApp: appAccess.available,
    grantScope:
      connection.allowedApps.length === 0 ? "all-apps" : "selected-apps",
    appAccess,
    allowedApps: connection.allowedApps,
    credentialRefs: publicCredentialRefs(
      connection.credentialRefs,
      "connection",
    ),
    lastUsedAt: latestIso([connection.lastUsedAt, explicitGrant?.lastUsedAt]),
    lastCheckedAt: connection.lastCheckedAt,
    lastError: connection.lastError,
    explicitGrant: explicitGrant
      ? {
          id: explicitGrant.id,
          appId: explicitGrant.appId,
          scopes: explicitGrant.scopes,
          credentialRefs: publicCredentialRefs(
            explicitGrant.credentialRefs,
            "grant",
          ),
          updatedAt: explicitGrant.updatedAt,
          lastUsedAt: explicitGrant.lastUsedAt ?? null,
        }
      : null,
  };
}

function grantAvailabilityMessage(
  grantState: WorkspaceConnectionGrantState,
  providerId: string,
  appId: string,
): string {
  switch (grantState) {
    case "connected":
      return `${appId} has an active ${providerId} workspace connection.`;
    case "granted":
      return `${appId} has ${providerId} access, but the granted connection is not connected yet.`;
    case "needs_grant":
      return `A ${providerId} workspace connection exists; grant ${appId} access to reuse it.`;
    case "not_connected":
    default:
      return `No shared ${providerId} workspace connection is available yet.`;
  }
}

export function summarizeWorkspaceConnectionProviderForApp({
  providerId,
  appId,
  connections,
  grants = [],
  includeConnections = "granted",
}: SummarizeWorkspaceConnectionProviderForAppOptions): WorkspaceConnectionProviderAppSummary {
  const normalizedProviderId = providerId.trim();
  const normalizedAppId = appId.trim();
  const allConnections = connections.filter(
    (connection) => connection.provider === normalizedProviderId,
  );
  const grantedConnections = allConnections.filter(
    (connection) =>
      getWorkspaceConnectionAppAccess(connection, normalizedAppId, grants)
        .available,
  );
  const connectedConnections = grantedConnections.filter(
    (connection) => connection.status === "connected",
  );
  const ungrantedConnectionCount =
    allConnections.length - grantedConnections.length;
  const unhealthyGrantedConnectionCount =
    grantedConnections.length - connectedConnections.length;
  const grantState: WorkspaceConnectionGrantState = connectedConnections.length
    ? "connected"
    : grantedConnections.length
      ? "granted"
      : allConnections.length
        ? "needs_grant"
        : "not_connected";
  const explicitGrantCount = allConnections.reduce(
    (count, connection) =>
      explicitGrantForConnection(connection.id, grants, normalizedAppId)
        ? count + 1
        : count,
    0,
  );
  const credentialRefCount = allConnections.reduce((count, connection) => {
    const explicitGrant = explicitGrantForConnection(
      connection.id,
      grants,
      normalizedAppId,
    );
    return (
      count +
      connection.credentialRefs.length +
      (explicitGrant?.credentialRefs.length ?? 0)
    );
  }, 0);
  const visibleConnections =
    includeConnections === "all" ? allConnections : grantedConnections;
  const lastUsedAt = latestIso(
    grantedConnections.flatMap((connection) => [
      connection.lastUsedAt,
      explicitGrantForConnection(connection.id, grants, normalizedAppId)
        ?.lastUsedAt,
    ]),
  );

  return {
    appId: normalizedAppId,
    provider: normalizedProviderId,
    grantState,
    grantAvailability:
      grantState === "connected" || grantState === "granted"
        ? "available"
        : grantState,
    grantAvailabilityMessage: grantAvailabilityMessage(
      grantState,
      normalizedProviderId,
      normalizedAppId,
    ),
    connectionCount: allConnections.length,
    grantedConnectionCount: grantedConnections.length,
    activeConnectionCount: connectedConnections.length,
    ungrantedConnectionCount,
    unhealthyGrantedConnectionCount,
    explicitGrantCount,
    credentialRefCount,
    hasWorkspaceConnection: allConnections.length > 0,
    hasGrantedWorkspaceConnection: grantedConnections.length > 0,
    hasActiveWorkspaceConnection: connectedConnections.length > 0,
    lastUsedAt,
    statuses: uniqueStrings(
      allConnections.map((connection) => connection.status),
    ) as WorkspaceConnectionStatus[],
    connections: visibleConnections.map((connection) =>
      serializeConnectionForApp(connection, normalizedAppId, grants),
    ),
  };
}

function requiredCredentialKeys(provider: WorkspaceConnectionProviderLike) {
  return uniqueStrings(
    (provider.credentialKeys ?? [])
      .filter((credential) => credential.required ?? false)
      .map((credential) => credential.key),
  );
}

function missingRequiredCredentialKeys(
  provider: WorkspaceConnectionProviderLike,
  connection: SerializedWorkspaceConnection,
  grants: SerializedWorkspaceConnectionGrant[] = [],
): string[] {
  const available = new Set(
    [
      ...connection.credentialRefs,
      ...grants.flatMap((grant) => grant.credentialRefs),
    ]
      .map((ref) => ref.key.trim())
      .filter(Boolean),
  );
  return requiredCredentialKeys(provider).filter((key) => !available.has(key));
}

export function summarizeWorkspaceConnectionProviderReadiness({
  provider,
  connections,
  grants = [],
  appId,
  includeConnections,
}: SummarizeWorkspaceConnectionProviderReadinessOptions): WorkspaceConnectionProviderReadiness {
  const providerConnections = connections.filter(
    (connection) => connection.provider === provider.id,
  );
  const activeConnections = providerConnections.filter(
    (connection) => connection.status !== "disabled",
  );
  const attentionConnections = activeConnections.filter(
    (connection) =>
      connection.status === "error" ||
      connection.status === "needs_reauth" ||
      Boolean(connection.lastError),
  );
  const missingKeys = uniqueStrings(
    activeConnections.flatMap((connection) =>
      missingRequiredCredentialKeys(
        provider,
        connection,
        grantsForConnection(connection.id, grants, appId),
      ),
    ),
  );
  const readyConnections = activeConnections.filter(
    (connection) =>
      connection.status === "connected" &&
      missingRequiredCredentialKeys(
        provider,
        connection,
        grantsForConnection(connection.id, grants, appId),
      ).length === 0,
  );
  const checkingConnections = activeConnections.filter(
    (connection) => connection.status === "checking",
  );

  let status: WorkspaceConnectionProviderReadinessStatus = "not_configured";
  if (readyConnections.length > 0) {
    status = "ready";
  } else if (attentionConnections.length > 0) {
    status = "needs_attention";
  } else if (missingKeys.length > 0) {
    status = "needs_credentials";
  } else if (checkingConnections.length > 0) {
    status = "checking";
  } else if (providerConnections.length > 0) {
    status = "disabled";
  }

  return {
    status,
    connectionCount: providerConnections.length,
    activeConnectionCount: activeConnections.length,
    readyConnectionCount: readyConnections.length,
    requiredCredentialKeys: requiredCredentialKeys(provider),
    missingRequiredCredentialKeys: missingKeys,
    appGrant: appId
      ? summarizeWorkspaceConnectionProviderForApp({
          providerId: provider.id,
          appId,
          connections,
          grants,
          includeConnections,
        })
      : null,
  };
}

export async function listWorkspaceConnectionProviderCatalogForApp({
  appId,
  provider,
  capability,
  templateUse,
  includeDisabled = true,
  includeConnections = "all",
}: ListWorkspaceConnectionProviderCatalogForAppOptions): Promise<WorkspaceConnectionProviderCatalogForApp> {
  const [connections, grants] = await Promise.all([
    listWorkspaceConnections({ provider, includeDisabled }),
    listWorkspaceConnectionGrants({ provider, appId }),
  ]);
  const providers = listWorkspaceConnectionProviders({
    capability,
    templateUse,
  })
    .filter((item) => !provider || item.id === provider)
    .map((item) => {
      const workspaceConnection = summarizeWorkspaceConnectionProviderForApp({
        providerId: item.id,
        appId,
        connections,
        grants,
        includeConnections,
      });
      const readiness = summarizeWorkspaceConnectionProviderReadiness({
        provider: item,
        connections,
        grants,
        appId,
        includeConnections,
      });
      return {
        ...item,
        workspaceConnection,
        readiness,
      };
    });

  return {
    appId,
    providers,
    connections,
    grants,
    counts: {
      providers: providers.length,
      connections: connections.length,
      grants: grants.length,
      readyProviders: providers.filter(
        (item) => item.readiness.status === "ready",
      ).length,
    },
  };
}

export async function listWorkspaceConnectionsForApp({
  appId,
  provider,
  includeDisabled = false,
}: ListWorkspaceConnectionsForAppOptions): Promise<
  WorkspaceConnectionForApp[]
> {
  const normalizedAppId = normalizeRequiredString(
    appId,
    "listWorkspaceConnectionsForApp appId",
  );
  const [connections, grants] = await Promise.all([
    listWorkspaceConnections({ provider, includeDisabled }),
    listWorkspaceConnectionGrants({ provider, appId: normalizedAppId }),
  ]);

  return connections
    .map((connection) => connectionForApp(connection, normalizedAppId, grants))
    .filter((connection) => connection.appAccess.available);
}

export async function resolveWorkspaceConnectionForApp({
  appId,
  provider,
  includeDisabled = false,
  connectionId,
  requireConnected = false,
}: ResolveWorkspaceConnectionForAppOptions): Promise<ResolvedWorkspaceConnectionForApp> {
  const normalizedAppId = normalizeRequiredString(
    appId,
    "resolveWorkspaceConnectionForApp appId",
  );
  const normalizedConnectionId = connectionId?.trim();
  const requestedConnections = await listWorkspaceConnections({
    provider,
    includeDisabled: includeDisabled || Boolean(normalizedConnectionId),
  });
  const candidateConnections = normalizedConnectionId
    ? requestedConnections.filter(
        (connection) => connection.id === normalizedConnectionId,
      )
    : requestedConnections;
  const grants = await listWorkspaceConnectionGrants({
    provider,
    appId: normalizedAppId,
    connectionId: normalizedConnectionId,
  });

  if (normalizedConnectionId && candidateConnections.length === 0) {
    return {
      available: false,
      connection: null,
      appAccess: null,
      reason: `Workspace connection "${normalizedConnectionId}" was not found in the current request scope.`,
    };
  }

  for (const connection of candidateConnections) {
    const connectionWithAccess = connectionForApp(
      connection,
      normalizedAppId,
      grants,
    );

    if (!connectionWithAccess.appAccess.available) {
      if (normalizedConnectionId) {
        return {
          available: false,
          connection: connectionWithAccess,
          appAccess: connectionWithAccess.appAccess,
          reason: connectionWithAccess.appAccess.reason,
        };
      }
      continue;
    }

    if (!includeDisabled && connection.status === "disabled") {
      if (normalizedConnectionId) {
        return {
          available: false,
          connection: connectionWithAccess,
          appAccess: connectionWithAccess.appAccess,
          reason: `Workspace connection "${connection.id}" is disabled.`,
        };
      }
      continue;
    }

    if (requireConnected && connection.status !== "connected") {
      if (normalizedConnectionId) {
        return {
          available: false,
          connection: connectionWithAccess,
          appAccess: connectionWithAccess.appAccess,
          reason: `Workspace connection "${connection.id}" is ${connection.status}; a connected workspace connection is required.`,
        };
      }
      continue;
    }

    return {
      available: true,
      connection: connectionWithAccess,
      appAccess: connectionWithAccess.appAccess,
      reason: connectionWithAccess.appAccess.reason,
    };
  }

  return {
    available: false,
    connection: null,
    appAccess: null,
    reason: provider
      ? `No available ${provider} workspace connection was found for ${normalizedAppId}.`
      : `No available workspace connection was found for ${normalizedAppId}.`,
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

export async function markWorkspaceConnectionUsed({
  connectionId,
  appId,
  usedAt,
}: MarkWorkspaceConnectionUsedOptions): Promise<MarkWorkspaceConnectionUsedResult> {
  await ensureWorkspaceConnectionsTable();
  const normalizedConnectionId = normalizeRequiredString(
    connectionId,
    "markWorkspaceConnectionUsed connectionId",
  );
  const normalizedAppId = appId?.trim();
  const usedAtMillis = millis(usedAt) ?? Date.now();
  const client = getDbExec();
  const connectionsTable = workspaceConnectionsTable();
  const grantsTable = workspaceConnectionGrantsTable();
  const scope = requireWorkspaceConnectionScope();
  const where = scopedWhere(scope);

  const connectionUpdate = await client.execute({
    sql: `UPDATE ${connectionsTable} SET last_used_at = ? WHERE id = ? AND ${where.sql}`,
    args: [usedAtMillis, normalizedConnectionId, ...where.args],
  });

  let grantUpdated = false;
  if (normalizedAppId) {
    const grantUpdate = await client.execute({
      sql: `UPDATE ${grantsTable} SET last_used_at = ? WHERE connection_id = ? AND app_id = ? AND ${where.sql}`,
      args: [
        usedAtMillis,
        normalizedConnectionId,
        normalizedAppId,
        ...where.args,
      ],
    });
    grantUpdated = grantUpdate.rowsAffected > 0;
  }

  return {
    connectionUpdated: connectionUpdate.rowsAffected > 0,
    grantUpdated,
    lastUsedAt: new Date(usedAtMillis).toISOString(),
  };
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
