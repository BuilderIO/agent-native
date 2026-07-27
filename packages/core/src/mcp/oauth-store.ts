/**
 * SQL-backed storage for standard remote MCP OAuth.
 *
 * Additive framework tables only. We store OAuth client registrations,
 * short-lived authorization codes, and hashed refresh tokens. Access tokens
 * are signed JWTs and are never persisted.
 */

import { randomBytes, randomUUID, createHash } from "node:crypto";

import {
  getDbExec,
  isConnectionError,
  intType,
  isPostgres,
} from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

export const MCP_OAUTH_CODE_TTL_MS = 10 * 60_000;

/**
 * Parse a duration string like "30d", "1h", "7d" into seconds.
 * Returns `null` when the input is not a valid recognised pattern.
 */
function parseDurationSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (match[2].toLowerCase()) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
  }
  return null;
}

const DEFAULT_ACCESS_TOKEN_TTL = "30d";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 30 * 86400;

function resolveAccessTokenTtl(): { str: string; seconds: number } {
  const env = process.env.MCP_OAUTH_ACCESS_TOKEN_TTL?.trim();
  if (env) {
    const secs = parseDurationSeconds(env);
    if (secs !== null) return { str: env, seconds: secs };
    // Garbage value — fall back to default rather than silently breaking.
    console.warn(
      `[mcp-oauth] Invalid MCP_OAUTH_ACCESS_TOKEN_TTL="${env}", using default "${DEFAULT_ACCESS_TOKEN_TTL}"`,
    );
  }
  return {
    str: DEFAULT_ACCESS_TOKEN_TTL,
    seconds: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  };
}

const _accessTokenTtl = resolveAccessTokenTtl();

/**
 * Access-token TTL as a jose-compatible duration string.
 * Defaults to "30d"; override with MCP_OAUTH_ACCESS_TOKEN_TTL env var.
 */
export const MCP_OAUTH_ACCESS_TOKEN_TTL: string = _accessTokenTtl.str;

/**
 * Access-token TTL in seconds (derived from the same env var).
 * Used to populate the OAuth `expires_in` response field.
 */
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: number =
  _accessTokenTtl.seconds;

export const MCP_OAUTH_REFRESH_TOKEN_TTL_MS = 365 * 24 * 60 * 60_000;
export const MCP_OAUTH_REGISTER_MAX = 60;
export const MCP_OAUTH_REGISTER_WINDOW_MS = 60_000;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createClientsSql = `
        CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
          client_id TEXT PRIMARY KEY,
          client_name TEXT,
          redirect_uris TEXT NOT NULL,
          grant_types TEXT,
          response_types TEXT,
          token_endpoint_auth_method TEXT,
          created_at ${intType()}
        )
      `;
      const createCodesSql = `
        CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
          code TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
          code_challenge_method TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          org_domain TEXT,
          scope TEXT NOT NULL,
          resource TEXT NOT NULL,
          created_at ${intType()},
          expires_at ${intType()},
          consumed_at ${intType()}
        )
      `;
      const createRefreshTokensSql = `
        CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
          id TEXT PRIMARY KEY,
          token_hash TEXT UNIQUE NOT NULL,
          client_id TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          org_domain TEXT,
          scope TEXT NOT NULL,
          resource TEXT NOT NULL,
          created_at ${intType()},
          expires_at ${intType()},
          last_used_at ${intType()},
          revoked_at ${intType()},
          replaced_by_hash TEXT
        )
      `;

      if (isPostgres()) {
        // PG-guard: probe information_schema first (no lock) and only issue
        // DDL when the table is actually missing, wrapped in a
        // transaction-scoped lock_timeout so a contended lock fails fast.
        await ensureTableExists("mcp_oauth_clients", createClientsSql);
        await ensureTableExists("mcp_oauth_codes", createCodesSql);
        await ensureTableExists(
          "mcp_oauth_refresh_tokens",
          createRefreshTokensSql,
        );
        return;
      }

      // SQLite (local dev): no ACCESS EXCLUSIVE lock problem — keep existing
      // create-then-execute behaviour.
      await client.execute(createClientsSql);
      await client.execute(createCodesSql);
      await client.execute(createRefreshTokensSql);
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export interface OAuthClientRow {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  createdAt: number | null;
}

export interface OAuthCodeRow {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  ownerEmail: string;
  orgId: string | null;
  orgDomain: string | null;
  scope: string;
  resource: string;
  createdAt: number | null;
  expiresAt: number | null;
  consumedAt: number | null;
}

export interface OAuthRefreshTokenRow {
  id: string;
  tokenHash: string;
  clientId: string;
  ownerEmail: string;
  orgId: string | null;
  orgDomain: string | null;
  scope: string;
  resource: string;
  createdAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  replacedByHash: string | null;
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function parseJsonStringArray(
  value: unknown,
  fallback: string[] = [],
): string[] {
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : fallback;
  } catch {
    return fallback;
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapClientRow(row: any): OAuthClientRow {
  return {
    clientId: row.client_id ?? row.clientId,
    clientName: row.client_name ?? row.clientName ?? null,
    redirectUris: parseJsonStringArray(row.redirect_uris ?? row.redirectUris),
    grantTypes: parseJsonStringArray(row.grant_types ?? row.grantTypes, [
      "authorization_code",
      "refresh_token",
    ]),
    responseTypes: parseJsonStringArray(
      row.response_types ?? row.responseTypes,
      ["code"],
    ),
    tokenEndpointAuthMethod:
      row.token_endpoint_auth_method ?? row.tokenEndpointAuthMethod ?? "none",
    createdAt: numOrNull(row.created_at ?? row.createdAt),
  };
}

function mapCodeRow(row: any): OAuthCodeRow {
  return {
    code: row.code,
    clientId: row.client_id ?? row.clientId,
    redirectUri: row.redirect_uri ?? row.redirectUri,
    codeChallenge: row.code_challenge ?? row.codeChallenge,
    codeChallengeMethod: row.code_challenge_method ?? row.codeChallengeMethod,
    ownerEmail: row.owner_email ?? row.ownerEmail,
    orgId: row.org_id ?? row.orgId ?? null,
    orgDomain: row.org_domain ?? row.orgDomain ?? null,
    scope: row.scope,
    resource: row.resource,
    createdAt: numOrNull(row.created_at ?? row.createdAt),
    expiresAt: numOrNull(row.expires_at ?? row.expiresAt),
    consumedAt: numOrNull(row.consumed_at ?? row.consumedAt),
  };
}

function mapRefreshRow(row: any): OAuthRefreshTokenRow {
  return {
    id: row.id,
    tokenHash: row.token_hash ?? row.tokenHash,
    clientId: row.client_id ?? row.clientId,
    ownerEmail: row.owner_email ?? row.ownerEmail,
    orgId: row.org_id ?? row.orgId ?? null,
    orgDomain: row.org_domain ?? row.orgDomain ?? null,
    scope: row.scope,
    resource: row.resource,
    createdAt: numOrNull(row.created_at ?? row.createdAt),
    expiresAt: numOrNull(row.expires_at ?? row.expiresAt),
    lastUsedAt: numOrNull(row.last_used_at ?? row.lastUsedAt),
    revokedAt: numOrNull(row.revoked_at ?? row.revokedAt),
    replacedByHash: row.replaced_by_hash ?? row.replacedByHash ?? null,
  };
}

export async function registerOAuthClient(params: {
  clientName?: string | null;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  tokenEndpointAuthMethod?: string;
}): Promise<OAuthClientRow> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  try {
    const { rows } = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM mcp_oauth_clients WHERE created_at > ?`,
      args: [now - MCP_OAUTH_REGISTER_WINDOW_MS],
    });
    const n = Number(rows[0]?.n ?? rows[0]?.["COUNT(*)"] ?? 0);
    if (Number.isFinite(n) && n >= MCP_OAUTH_REGISTER_MAX) {
      throw new Error("RATE_LIMITED");
    }
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED") throw err;
    // Registration stays possible through transient count-read failures; the
    // exact redirect URI allowlist remains the primary safety gate.
  }
  const clientId = `agent-native-oauth-client-${randomUUID()}`;
  const grantTypes = params.grantTypes?.length
    ? params.grantTypes
    : ["authorization_code", "refresh_token"];
  const responseTypes = params.responseTypes?.length
    ? params.responseTypes
    : ["code"];
  const tokenEndpointAuthMethod = params.tokenEndpointAuthMethod || "none";
  await client.execute({
    sql: `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      clientId,
      params.clientName ?? null,
      JSON.stringify(params.redirectUris),
      JSON.stringify(grantTypes),
      JSON.stringify(responseTypes),
      tokenEndpointAuthMethod,
      now,
    ],
  });
  return {
    clientId,
    clientName: params.clientName ?? null,
    redirectUris: params.redirectUris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod,
    createdAt: now,
  };
}

export async function getOAuthClient(
  clientId: string,
): Promise<OAuthClientRow | null> {
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM mcp_oauth_clients WHERE client_id = ?`,
      args: [clientId],
    });
    return rows.length ? mapClientRow(rows[0]) : null;
  } catch (err) {
    if (isConnectionError(err)) return null;
    throw err;
  }
}

export async function createOAuthCode(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  ownerEmail: string;
  orgId?: string | null;
  orgDomain?: string | null;
  scope: string;
  resource: string;
}): Promise<OAuthCodeRow> {
  await ensureTable();
  const client = getDbExec();
  const code = generateOpaqueToken();
  const now = Date.now();
  const expiresAt = now + MCP_OAUTH_CODE_TTL_MS;
  await client.execute({
    sql: `INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, owner_email, org_id, org_domain, scope, resource, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      code,
      params.clientId,
      params.redirectUri,
      params.codeChallenge,
      params.codeChallengeMethod,
      params.ownerEmail,
      params.orgId ?? null,
      params.orgDomain ?? null,
      params.scope,
      params.resource,
      now,
      expiresAt,
      null,
    ],
  });
  return {
    code,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    ownerEmail: params.ownerEmail,
    orgId: params.orgId ?? null,
    orgDomain: params.orgDomain ?? null,
    scope: params.scope,
    resource: params.resource,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  };
}

export async function getOAuthCode(code: string): Promise<OAuthCodeRow | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM mcp_oauth_codes WHERE code = ?`,
    args: [code],
  });
  if (rows.length === 0) return null;
  const row = mapCodeRow(rows[0]);
  if (row.consumedAt != null || (row.expiresAt ?? 0) < Date.now()) {
    return null;
  }
  return row;
}

export async function consumeOAuthCode(
  code: string,
): Promise<OAuthCodeRow | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM mcp_oauth_codes WHERE code = ?`,
    args: [code],
  });
  if (rows.length === 0) return null;
  const row = mapCodeRow(rows[0]);
  if (row.consumedAt != null || (row.expiresAt ?? 0) < Date.now()) {
    return null;
  }
  const result = await client.execute({
    sql: `UPDATE mcp_oauth_codes SET consumed_at = ? WHERE code = ? AND consumed_at IS NULL`,
    args: [Date.now(), code],
  });
  return result.rowsAffected > 0 ? row : null;
}

export async function createOAuthRefreshToken(params: {
  refreshToken: string;
  clientId: string;
  ownerEmail: string;
  orgId?: string | null;
  orgDomain?: string | null;
  scope: string;
  resource: string;
}): Promise<OAuthRefreshTokenRow> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const row: OAuthRefreshTokenRow = {
    id: randomUUID(),
    tokenHash: hashOAuthToken(params.refreshToken),
    clientId: params.clientId,
    ownerEmail: params.ownerEmail,
    orgId: params.orgId ?? null,
    orgDomain: params.orgDomain ?? null,
    scope: params.scope,
    resource: params.resource,
    createdAt: now,
    expiresAt: now + MCP_OAUTH_REFRESH_TOKEN_TTL_MS,
    lastUsedAt: null,
    revokedAt: null,
    replacedByHash: null,
  };
  await client.execute({
    sql: `INSERT INTO mcp_oauth_refresh_tokens (id, token_hash, client_id, owner_email, org_id, org_domain, scope, resource, created_at, expires_at, last_used_at, revoked_at, replaced_by_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.tokenHash,
      row.clientId,
      row.ownerEmail,
      row.orgId,
      row.orgDomain,
      row.scope,
      row.resource,
      row.createdAt,
      row.expiresAt,
      row.lastUsedAt,
      row.revokedAt,
      row.replacedByHash,
    ],
  });
  return row;
}

export async function rotateOAuthRefreshToken(params: {
  oldRefreshToken: string;
  newRefreshToken: string;
}): Promise<OAuthRefreshTokenRow | null> {
  await ensureTable();
  const client = getDbExec();
  const oldHash = hashOAuthToken(params.oldRefreshToken);
  const newHash = hashOAuthToken(params.newRefreshToken);
  const { rows } = await client.execute({
    sql: `SELECT * FROM mcp_oauth_refresh_tokens WHERE token_hash = ?`,
    args: [oldHash],
  });
  if (rows.length === 0) return null;
  const old = mapRefreshRow(rows[0]);
  if (old.revokedAt != null || (old.expiresAt ?? 0) < Date.now()) return null;

  const now = Date.now();
  const update = await client.execute({
    sql: `UPDATE mcp_oauth_refresh_tokens SET revoked_at = ?, last_used_at = ?, replaced_by_hash = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    args: [now, now, newHash, oldHash],
  });
  if (update.rowsAffected === 0) return null;

  const next: OAuthRefreshTokenRow = {
    ...old,
    id: randomUUID(),
    tokenHash: newHash,
    createdAt: now,
    expiresAt: now + MCP_OAUTH_REFRESH_TOKEN_TTL_MS,
    lastUsedAt: null,
    revokedAt: null,
    replacedByHash: null,
  };
  await client.execute({
    sql: `INSERT INTO mcp_oauth_refresh_tokens (id, token_hash, client_id, owner_email, org_id, org_domain, scope, resource, created_at, expires_at, last_used_at, revoked_at, replaced_by_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      next.id,
      next.tokenHash,
      next.clientId,
      next.ownerEmail,
      next.orgId,
      next.orgDomain,
      next.scope,
      next.resource,
      next.createdAt,
      next.expiresAt,
      next.lastUsedAt,
      next.revokedAt,
      next.replacedByHash,
    ],
  });
  return next;
}

export async function getOAuthRefreshToken(
  refreshToken: string,
): Promise<OAuthRefreshTokenRow | null> {
  await ensureTable();
  const client = getDbExec();
  const tokenHash = hashOAuthToken(refreshToken);
  const { rows } = await client.execute({
    sql: `SELECT * FROM mcp_oauth_refresh_tokens WHERE token_hash = ?`,
    args: [tokenHash],
  });
  if (rows.length === 0) return null;
  const row = mapRefreshRow(rows[0]);
  if (row.revokedAt != null || (row.expiresAt ?? 0) < Date.now()) {
    return null;
  }
  return row;
}

/**
 * Slide the refresh-token's expiry window on each successful use so that active
 * users never hit the TTL. Records `last_used_at` and extends `expires_at` to
 * `now + MCP_OAUTH_REFRESH_TOKEN_TTL_MS`.
 */
export async function touchOAuthRefreshToken(
  refreshToken: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const tokenHash = hashOAuthToken(refreshToken);
  const now = Date.now();
  await client.execute({
    sql: `UPDATE mcp_oauth_refresh_tokens SET last_used_at = ?, expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    args: [now, now + MCP_OAUTH_REFRESH_TOKEN_TTL_MS, tokenHash],
  });
}
