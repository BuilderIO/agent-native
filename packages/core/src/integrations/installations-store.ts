/**
 * Durable metadata and encrypted credentials for managed messaging installs.
 *
 * The installation row deliberately contains only provider metadata and an
 * opaque `app_secrets` key. OAuth access and refresh tokens are serialized as
 * one bundle and encrypted by the framework secrets vault. List/read helpers
 * never expose the secret key or token values.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  getDbExec,
  intType,
  isPostgres,
  isUniqueViolation,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import type { SecretScope } from "../secrets/register.js";
import {
  deleteAppSecret,
  readAppSecret,
  writeAppSecret,
} from "../secrets/storage.js";

const TABLE = "integration_installations";
let _initPromise: Promise<void> | undefined;

export type IntegrationInstallationStatus =
  | "connected"
  | "disconnected"
  | "revoked"
  | "error";

export type IntegrationInstallationHealth =
  | "unknown"
  | "healthy"
  | "degraded"
  | "revoked";

export interface IntegrationTokenBundle {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
}

/** Safe-to-return installation metadata. No secret reference or token value. */
export interface IntegrationInstallation {
  id: string;
  platform: string;
  installationKey: string;
  teamId: string | null;
  teamName: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
  isEnterpriseInstall: boolean;
  apiAppId: string | null;
  botUserId: string | null;
  scopes: string[];
  installedByExternalUserId: string | null;
  ownerEmail: string;
  orgId: string | null;
  status: IntegrationInstallationStatus;
  health: IntegrationInstallationHealth;
  lastError: string | null;
  healthCheckedAt: number | null;
  lastHealthyAt: number | null;
  tokenExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  disconnectedAt: number | null;
}

interface RawInstallation extends IntegrationInstallation {
  tokenSecretKey: string;
  secretScope: SecretScope;
  secretScopeId: string;
}

export interface InstallationActor {
  userEmail: string;
  orgId?: string | null;
  /** Must come from a verified active organization membership. */
  isOrgAdmin?: boolean;
}

export interface UpsertIntegrationInstallationInput {
  platform: string;
  installationKey: string;
  teamId?: string | null;
  teamName?: string | null;
  enterpriseId?: string | null;
  enterpriseName?: string | null;
  isEnterpriseInstall?: boolean;
  apiAppId?: string | null;
  botUserId?: string | null;
  scopes?: readonly string[];
  installedByExternalUserId?: string | null;
  ownerEmail: string;
  orgId?: string | null;
  secretScope: SecretScope;
  secretScopeId: string;
  tokenBundle: IntegrationTokenBundle;
  status?: IntegrationInstallationStatus;
  health?: IntegrationInstallationHealth;
  lastError?: string | null;
  healthCheckedAt?: number | null;
  lastHealthyAt?: number | null;
  tokenExpiresAt?: number | null;
}

export interface IntegrationInstallationUpdate {
  teamName?: string | null;
  enterpriseName?: string | null;
  botUserId?: string | null;
  scopes?: readonly string[];
  status?: IntegrationInstallationStatus;
  health?: IntegrationInstallationHealth;
  lastError?: string | null;
  healthCheckedAt?: number | null;
  lastHealthyAt?: number | null;
  tokenExpiresAt?: number | null;
}

function createSql(): string {
  const integer = intType();
  return `CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    installation_key TEXT NOT NULL,
    team_id TEXT,
    team_name TEXT,
    enterprise_id TEXT,
    enterprise_name TEXT,
    is_enterprise_install ${integer} NOT NULL DEFAULT 0,
    api_app_id TEXT,
    bot_user_id TEXT,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    installed_by_external_user_id TEXT,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    token_secret_key TEXT NOT NULL,
    secret_scope TEXT NOT NULL,
    secret_scope_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected',
    health TEXT NOT NULL DEFAULT 'unknown',
    last_error TEXT,
    health_checked_at ${integer},
    last_healthy_at ${integer},
    token_expires_at ${integer},
    created_at ${integer} NOT NULL,
    updated_at ${integer} NOT NULL,
    disconnected_at ${integer}
  )`;
}

const INDEXES = [
  [
    "idx_integration_installations_key",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_installations_key ON ${TABLE}(platform, installation_key)`,
  ],
  [
    "idx_integration_installations_team",
    `CREATE INDEX IF NOT EXISTS idx_integration_installations_team ON ${TABLE}(platform, team_id, status)`,
  ],
  [
    "idx_integration_installations_owner",
    `CREATE INDEX IF NOT EXISTS idx_integration_installations_owner ON ${TABLE}(owner_email, updated_at)`,
  ],
  [
    "idx_integration_installations_org",
    `CREATE INDEX IF NOT EXISTS idx_integration_installations_org ON ${TABLE}(org_id, updated_at)`,
  ],
] as const;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const ddl = createSql();
      if (isPostgres()) {
        await ensureTableExists(TABLE, ddl);
        for (const [name, sql] of INDEXES) {
          await ensureIndexExists(name, sql);
        }
        return;
      }
      await retryOnDdlRace(() => client.execute(ddl));
      for (const [, sql] of INDEXES) {
        await retryOnDdlRace(() => client.execute(sql));
      }
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > 512) throw new Error(`${name} is too long`);
  return normalized;
}

function normalizePlatform(value: string): string {
  return required(value, "platform").toLowerCase();
}

function normalizeEmail(value: string): string {
  return required(value, "ownerEmail").toLowerCase();
}

function normalizeScopes(scopes: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (scopes ?? [])
        .map((scope) => scope.trim())
        .filter(Boolean)
        .sort(),
    ),
  );
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function rowToRaw(row: Record<string, unknown>): RawInstallation {
  return {
    id: String(row.id),
    platform: String(row.platform),
    installationKey: String(row.installation_key),
    teamId: (row.team_id as string | null) ?? null,
    teamName: (row.team_name as string | null) ?? null,
    enterpriseId: (row.enterprise_id as string | null) ?? null,
    enterpriseName: (row.enterprise_name as string | null) ?? null,
    isEnterpriseInstall: toBoolean(row.is_enterprise_install),
    apiAppId: (row.api_app_id as string | null) ?? null,
    botUserId: (row.bot_user_id as string | null) ?? null,
    scopes: parseScopes(row.scopes_json),
    installedByExternalUserId:
      (row.installed_by_external_user_id as string | null) ?? null,
    ownerEmail: String(row.owner_email),
    orgId: (row.org_id as string | null) ?? null,
    tokenSecretKey: String(row.token_secret_key),
    secretScope: row.secret_scope as SecretScope,
    secretScopeId: String(row.secret_scope_id),
    status: row.status as IntegrationInstallationStatus,
    health: row.health as IntegrationInstallationHealth,
    lastError: (row.last_error as string | null) ?? null,
    healthCheckedAt: nullableNumber(row.health_checked_at),
    lastHealthyAt: nullableNumber(row.last_healthy_at),
    tokenExpiresAt: nullableNumber(row.token_expires_at),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    disconnectedAt: nullableNumber(row.disconnected_at),
  };
}

function toSafeInstallation(row: RawInstallation): IntegrationInstallation {
  const {
    tokenSecretKey: _tokenSecretKey,
    secretScope: _scope,
    secretScopeId: _scopeId,
    ...safe
  } = row;
  return safe;
}

function tokenSecretKey(platform: string, installationKey: string): string {
  const digest = createHash("sha256")
    .update(`${platform}\0${installationKey}`)
    .digest("hex")
    .slice(0, 32);
  return `integration:${platform}:${digest}:oauth-token-bundle`;
}

function sameOwner(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameScope(
  row: Pick<RawInstallation, "ownerEmail" | "orgId">,
  ownerEmail: string,
  orgId: string | null,
): boolean {
  if (row.orgId || orgId) return !!row.orgId && row.orgId === orgId;
  return sameOwner(row.ownerEmail, ownerEmail);
}

function canMutate(row: RawInstallation, actor: InstallationActor): boolean {
  if (row.orgId) {
    return actor.orgId === row.orgId && actor.isOrgAdmin === true;
  }
  return sameOwner(row.ownerEmail, actor.userEmail);
}

async function selectRawById(id: string): Promise<RawInstallation | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? rowToRaw(rows[0] as Record<string, unknown>) : null;
}

async function selectRawByKey(
  platform: string,
  installationKey: string,
): Promise<RawInstallation | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE platform = ? AND installation_key = ? LIMIT 1`,
    args: [
      normalizePlatform(platform),
      required(installationKey, "installationKey"),
    ],
  });
  return rows[0] ? rowToRaw(rows[0] as Record<string, unknown>) : null;
}

/**
 * Create or refresh a managed install. Re-installs may rotate tokens inside
 * the same owner/org scope, but cannot silently move an existing provider
 * installation into another Agent Native tenant.
 */
export async function upsertIntegrationInstallation(
  input: UpsertIntegrationInstallationInput,
): Promise<IntegrationInstallation> {
  await ensureTable();
  const platform = normalizePlatform(input.platform);
  const installationKey = required(input.installationKey, "installationKey");
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const orgId = input.orgId?.trim() || null;
  const secretScopeId = required(input.secretScopeId, "secretScopeId");
  const accessToken = input.tokenBundle.accessToken?.trim();
  if (!accessToken) throw new Error("tokenBundle.accessToken is required");

  const existing = await selectRawByKey(platform, installationKey);
  if (existing && !sameScope(existing, ownerEmail, orgId)) {
    throw new Error(
      "This provider installation is already connected to another owner or organization.",
    );
  }

  const secretKey =
    existing?.tokenSecretKey ?? tokenSecretKey(platform, installationKey);
  const persistTokenBundle = (key: string) =>
    writeAppSecret({
      key,
      value: JSON.stringify(input.tokenBundle),
      scope: input.secretScope,
      scopeId: secretScopeId,
      description: `${platform} OAuth token bundle for a managed installation`,
    });
  await persistTokenBundle(secretKey);

  const now = Date.now();
  let id = existing?.id ?? randomUUID();
  const scopesJson = JSON.stringify(normalizeScopes(input.scopes));
  const tokenExpiresAt =
    input.tokenExpiresAt ?? input.tokenBundle.expiresAt ?? null;

  const updateExisting = async (rowId: string, rowSecretKey: string) => {
    await getDbExec().execute({
      sql: `UPDATE ${TABLE} SET
        team_id = ?, team_name = ?, enterprise_id = ?, enterprise_name = ?,
        is_enterprise_install = ?, api_app_id = ?, bot_user_id = ?, scopes_json = ?,
        installed_by_external_user_id = ?, owner_email = ?, org_id = ?,
        token_secret_key = ?, secret_scope = ?, secret_scope_id = ?, status = ?,
        health = ?, last_error = ?, health_checked_at = ?, last_healthy_at = ?,
        token_expires_at = ?, updated_at = ?, disconnected_at = ?
        WHERE id = ?`,
      args: [
        input.teamId ?? null,
        input.teamName ?? null,
        input.enterpriseId ?? null,
        input.enterpriseName ?? null,
        input.isEnterpriseInstall ? 1 : 0,
        input.apiAppId ?? null,
        input.botUserId ?? null,
        scopesJson,
        input.installedByExternalUserId ?? null,
        ownerEmail,
        orgId,
        rowSecretKey,
        input.secretScope,
        secretScopeId,
        input.status ?? "connected",
        input.health ?? "unknown",
        input.lastError ?? null,
        input.healthCheckedAt ?? null,
        input.lastHealthyAt ?? null,
        tokenExpiresAt,
        now,
        null,
        rowId,
      ],
    });
  };

  if (existing) {
    await updateExisting(existing.id, existing.tokenSecretKey);
  } else {
    try {
      await getDbExec().execute({
        sql: `INSERT INTO ${TABLE} (
          id, platform, installation_key, team_id, team_name, enterprise_id,
          enterprise_name, is_enterprise_install, api_app_id, bot_user_id,
          scopes_json, installed_by_external_user_id, owner_email, org_id,
          token_secret_key, secret_scope, secret_scope_id, status, health,
          last_error, health_checked_at, last_healthy_at, token_expires_at,
          created_at, updated_at, disconnected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          platform,
          installationKey,
          input.teamId ?? null,
          input.teamName ?? null,
          input.enterpriseId ?? null,
          input.enterpriseName ?? null,
          input.isEnterpriseInstall ? 1 : 0,
          input.apiAppId ?? null,
          input.botUserId ?? null,
          scopesJson,
          input.installedByExternalUserId ?? null,
          ownerEmail,
          orgId,
          secretKey,
          input.secretScope,
          secretScopeId,
          input.status ?? "connected",
          input.health ?? "unknown",
          input.lastError ?? null,
          input.healthCheckedAt ?? null,
          input.lastHealthyAt ?? null,
          tokenExpiresAt,
          now,
          now,
          null,
        ],
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const raced = await selectRawByKey(platform, installationKey);
      if (!raced) throw error;
      if (!sameScope(raced, ownerEmail, orgId)) {
        throw new Error(
          "This provider installation is already connected to another owner or organization.",
        );
      }

      id = raced.id;
      if (raced.tokenSecretKey !== secretKey) {
        await persistTokenBundle(raced.tokenSecretKey);
      }
      await updateExisting(raced.id, raced.tokenSecretKey);
    }
  }

  const stored = await selectRawById(id);
  if (!stored) throw new Error("Managed installation was not persisted");
  return toSafeInstallation(stored);
}

/** List installations visible to the owner or active organization member. */
export async function listIntegrationInstallations(
  actor: InstallationActor,
  platform?: string,
): Promise<IntegrationInstallation[]> {
  await ensureTable();
  const ownerEmail = normalizeEmail(actor.userEmail);
  const args: unknown[] = [ownerEmail];
  let visibility = "owner_email = ?";
  if (actor.orgId) {
    visibility = `(owner_email = ? OR org_id = ?)`;
    args.push(actor.orgId);
  }
  let platformFilter = "";
  if (platform) {
    platformFilter = " AND platform = ?";
    args.push(normalizePlatform(platform));
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE ${visibility}${platformFilter} ORDER BY updated_at DESC`,
    args,
  });
  return rows.map((row) =>
    toSafeInstallation(rowToRaw(row as Record<string, unknown>)),
  );
}

/** Read one installation through owner/org visibility scoping. */
export async function getIntegrationInstallation(
  id: string,
  actor: InstallationActor,
): Promise<IntegrationInstallation | null> {
  const row = await selectRawById(id);
  if (!row) return null;
  if (
    !sameOwner(row.ownerEmail, actor.userEmail) &&
    (!row.orgId || row.orgId !== actor.orgId)
  ) {
    return null;
  }
  return toSafeInstallation(row);
}

/** Update non-secret installation metadata after an owner/admin access check. */
export async function updateIntegrationInstallation(
  id: string,
  actor: InstallationActor,
  patch: IntegrationInstallationUpdate,
): Promise<IntegrationInstallation | null> {
  const row = await selectRawById(id);
  if (!row) return null;
  if (!canMutate(row, actor)) {
    throw new Error("You do not have access to update this installation.");
  }
  const next = {
    teamName: patch.teamName === undefined ? row.teamName : patch.teamName,
    enterpriseName:
      patch.enterpriseName === undefined
        ? row.enterpriseName
        : patch.enterpriseName,
    botUserId: patch.botUserId === undefined ? row.botUserId : patch.botUserId,
    scopes:
      patch.scopes === undefined ? row.scopes : normalizeScopes(patch.scopes),
    status: patch.status ?? row.status,
    health: patch.health ?? row.health,
    lastError: patch.lastError === undefined ? row.lastError : patch.lastError,
    healthCheckedAt:
      patch.healthCheckedAt === undefined
        ? row.healthCheckedAt
        : patch.healthCheckedAt,
    lastHealthyAt:
      patch.lastHealthyAt === undefined
        ? row.lastHealthyAt
        : patch.lastHealthyAt,
    tokenExpiresAt:
      patch.tokenExpiresAt === undefined
        ? row.tokenExpiresAt
        : patch.tokenExpiresAt,
  };
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET team_name = ?, enterprise_name = ?, bot_user_id = ?,
      scopes_json = ?, status = ?, health = ?, last_error = ?, health_checked_at = ?,
      last_healthy_at = ?, token_expires_at = ?, updated_at = ? WHERE id = ?`,
    args: [
      next.teamName,
      next.enterpriseName,
      next.botUserId,
      JSON.stringify(next.scopes),
      next.status,
      next.health,
      next.lastError,
      next.healthCheckedAt,
      next.lastHealthyAt,
      next.tokenExpiresAt,
      Date.now(),
      id,
    ],
  });
  const updated = await selectRawById(id);
  return updated ? toSafeInstallation(updated) : null;
}

/** Delete the encrypted token bundle and retain disconnected audit metadata. */
export async function disconnectIntegrationInstallation(
  id: string,
  actor: InstallationActor,
): Promise<IntegrationInstallation | null> {
  const row = await selectRawById(id);
  if (!row) return null;
  if (!canMutate(row, actor)) {
    throw new Error("You do not have access to disconnect this installation.");
  }
  await deleteAppSecret({
    key: row.tokenSecretKey,
    scope: row.secretScope,
    scopeId: row.secretScopeId,
  });
  const now = Date.now();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET status = 'disconnected', health = 'unknown',
      last_error = NULL, token_expires_at = NULL, disconnected_at = ?, updated_at = ?
      WHERE id = ?`,
    args: [now, now, id],
  });
  const updated = await selectRawById(id);
  return updated ? toSafeInstallation(updated) : null;
}

/**
 * Resolve credentials for a verified provider webhook/runtime path.
 *
 * This is intentionally separate from every user-facing list/read helper.
 * Callers must first authenticate the provider webhook (or run inside a
 * trusted OAuth callback) and must never log or return the result.
 */
export async function resolveIntegrationTokenBundle(
  platform: string,
  installationKey: string,
): Promise<IntegrationTokenBundle | null> {
  const row = await selectRawByKey(platform, installationKey);
  if (!row || row.status !== "connected" || row.health === "revoked")
    return null;
  const secret = await readAppSecret({
    key: row.tokenSecretKey,
    scope: row.secretScope,
    scopeId: row.secretScopeId,
  });
  if (!secret) return null;
  try {
    const parsed = JSON.parse(secret.value) as Partial<IntegrationTokenBundle>;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken)
      return null;
    return parsed as IntegrationTokenBundle;
  } catch {
    return null;
  }
}

/** Safe metadata lookup for a verified provider event. */
export async function getActiveIntegrationInstallationByKey(
  platform: string,
  installationKey: string,
): Promise<IntegrationInstallation | null> {
  const row = await selectRawByKey(platform, installationKey);
  if (!row || row.status !== "connected") return null;
  return toSafeInstallation(row);
}

/** Resolve a connected installation by workspace or enterprise tenant id. */
export async function getActiveIntegrationInstallationForTenant(
  platform: string,
  tenantId: string,
): Promise<IntegrationInstallation | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE}
      WHERE platform = ? AND (team_id = ? OR enterprise_id = ?)
        AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1`,
    args: [
      normalizePlatform(platform),
      required(tenantId, "tenantId"),
      required(tenantId, "tenantId"),
    ],
  });
  return rows[0]
    ? toSafeInstallation(rowToRaw(rows[0] as Record<string, unknown>))
    : null;
}
