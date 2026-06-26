/**
 * Framework-table store for the "connect external agents" feature.
 *
 * Two additive, dialect-agnostic tables back the browser **Connect** page and
 * the OAuth-style **device-code flow** a CLI drives:
 *
 *   - `mcp_connect_tokens`  — one row per minted MCP token. We never store the
 *     token value (it's a signed JWT); only its `jti` so revocation is a
 *     SQL lookup. Revoking sets `revoked_at`; the row is never deleted.
 *   - `mcp_device_codes`    — short-lived (10 min) device/user code pairs for
 *     the OAuth 2.0 device-authorization-style CLI flow. Single-use
 *     (`consumed_at`), rate-limited at creation.
 *
 * Mirrors `application-state/store.ts`: lazy `ensureTable()`, `getDbExec()`,
 * `isConnectionError()` swallow so a transient Neon WS drop never 500s.
 * `CREATE TABLE IF NOT EXISTS` only — strictly additive, never DROP / ALTER
 * (shared prod DB rule).
 */

import { randomBytes, randomUUID } from "node:crypto";

import {
  getDbExec,
  isConnectionError,
  intType,
  isPostgres,
} from "../db/client.js";
import { ensureTableExists, ensureColumnExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

/**
 * Scope claim that marks a connect-minted token (vs. an ordinary A2A
 * delegation JWT). Only tokens carrying this scope go through the revoke
 * lookup in `verifyAuth` — defined here so both `connect-route.ts` and
 * `build-server.ts` import it from the leaf store without a cycle.
 */
export const MCP_CONNECT_SCOPE = "mcp-connect";

/**
 * Client id used when connect/device flows have to mint a standard MCP OAuth
 * access token instead of an A2A JWT (for deployments without A2A_SECRET).
 */
export const MCP_CONNECT_OAUTH_CLIENT_ID = "agent-native-connect";

/** Device codes are valid for 10 minutes. */
export const DEVICE_CODE_TTL_MS = 10 * 60_000;

/** Default minted-token lifetime. Configurable per-request 1–365 days. */
export const DEFAULT_TOKEN_TTL_DAYS = 365;
export const MIN_TOKEN_TTL_DAYS = 1;
export const MAX_TOKEN_TTL_DAYS = 365;

/**
 * Rate limit for `device/start`: at most this many device codes may be created
 * within `DEVICE_START_WINDOW_MS`. Unauthenticated endpoint — keep it tight so
 * a hostile client can't flood the table or brute-force user codes.
 */
export const DEVICE_START_MAX = 20;
export const DEVICE_START_WINDOW_MS = 60_000;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      // Additive only. Never DROP / ALTER — this DB is shared across every
      // deploy context (preview/branch/prod) for hosted templates.
      const createTokensSql = `
        CREATE TABLE IF NOT EXISTS mcp_connect_tokens (
          id TEXT PRIMARY KEY,
          jti TEXT UNIQUE NOT NULL,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          label TEXT,
          kind TEXT NOT NULL DEFAULT 'personal',
          service_name TEXT,
          created_by TEXT,
          created_at ${intType()},
          last_used_at ${intType()},
          revoked_at ${intType()}
        )
      `;
      const createDeviceCodesSql = `
        CREATE TABLE IF NOT EXISTS mcp_device_codes (
          device_code TEXT PRIMARY KEY,
          user_code TEXT NOT NULL,
          owner_email TEXT,
          org_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          token_jti TEXT,
          created_at ${intType()},
          expires_at ${intType()},
          consumed_at ${intType()}
        )
      `;

      if (isPostgres()) {
        // PG-guard: probe information_schema first (no lock) and only issue
        // DDL when the table/column is actually missing, wrapped in a
        // transaction-scoped lock_timeout so a contended lock fails fast.
        await ensureTableExists("mcp_connect_tokens", createTokensSql);
        // Additive columns for org service tokens — added after initial
        // deployment; ensureColumnExists probes before ALTERing.
        await ensureColumnExists(
          "mcp_connect_tokens",
          "kind",
          `ALTER TABLE mcp_connect_tokens ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'personal'`,
        );
        await ensureColumnExists(
          "mcp_connect_tokens",
          "service_name",
          `ALTER TABLE mcp_connect_tokens ADD COLUMN IF NOT EXISTS service_name TEXT`,
        );
        await ensureColumnExists(
          "mcp_connect_tokens",
          "created_by",
          `ALTER TABLE mcp_connect_tokens ADD COLUMN IF NOT EXISTS created_by TEXT`,
        );
        await ensureTableExists("mcp_device_codes", createDeviceCodesSql);
        return;
      }

      // SQLite (local dev): no ACCESS EXCLUSIVE lock problem — keep existing
      // create-then-additive-alter behaviour.
      await client.execute(createTokensSql);
      // Additive columns for org service tokens (deployments that created the
      // table before these columns existed; fresh DBs get them via the CREATE
      // TABLE above). kind='personal' (default) preserves the original
      // per-user token; kind='service' marks tokens minted for an org service
      // principal (e.g. CI) rather than a person. service_name is the
      // human-readable service label (e.g. "ci"); created_by records the
      // human who minted it, for audit.
      for (const [withIfNotExists, plain] of [
        [
          `ALTER TABLE mcp_connect_tokens ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'personal'`,
          `ALTER TABLE mcp_connect_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal'`,
        ],
        [
          `ALTER TABLE mcp_connect_tokens ADD COLUMN IF NOT EXISTS service_name TEXT`,
          `ALTER TABLE mcp_connect_tokens ADD COLUMN service_name TEXT`,
        ],
        [
          `ALTER TABLE mcp_connect_tokens ADD COLUMN IF NOT EXISTS created_by TEXT`,
          `ALTER TABLE mcp_connect_tokens ADD COLUMN created_by TEXT`,
        ],
      ]) {
        try {
          await client.execute(withIfNotExists);
        } catch {
          // SQLite doesn't support "ADD COLUMN IF NOT EXISTS" — retry the
          // plain form and swallow "duplicate column" when it already exists.
          try {
            await client.execute(plain);
          } catch {
            // Column already exists (or was created by CREATE TABLE above).
          }
        }
      }
      await client.execute(createDeviceCodesSql);
    })().catch((err) => {
      // Don't cache a rejected init. A transient DB blip should let the next
      // connect/mint/revoke call retry rather than wedging the process.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

// ---------------------------------------------------------------------------
// Minted-token records
// ---------------------------------------------------------------------------

export interface MintedTokenRow {
  id: string;
  jti: string;
  ownerEmail: string;
  orgId: string | null;
  label: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  /** `'personal'` (default) or `'service'` for org service tokens. */
  kind: "personal" | "service";
  /** Human-readable service principal name, e.g. `"ci"`. Only set when `kind === 'service'`. */
  serviceName: string | null;
  /** Email of the human who minted a service token. Only set when `kind === 'service'`. */
  createdBy: string | null;
}

/**
 * Synthetic identity for an org service token: `svc-<name>@service.<orgId>`.
 * It is email-shaped so the entire existing identity plumbing (JWT `sub`,
 * `runWithRequestContext({ userEmail })`, ownable-row `owner_email` columns,
 * display surfaces that render an email) works unchanged, while remaining
 * clearly distinguishable from a human account. Ownable rows created under
 * this identity carry the org's `orgId`, so org members can see them.
 */
export function serviceIdentityEmail(
  serviceName: string,
  orgId: string,
): string {
  return `svc-${normalizeServiceName(serviceName)}@service.${orgId}`;
}

/** True when an email is a synthetic org-service-token identity. */
export function isServiceIdentityEmail(email: string | undefined): boolean {
  return !!email && /^svc-[a-z0-9-]+@service\./.test(email);
}

/**
 * Normalize a user-supplied service name to a DNS-label-ish slug so the
 * synthetic identity stays a valid email local part: lowercase, `a-z0-9-`,
 * max 48 chars. Throws on names that normalize to nothing.
 */
export function normalizeServiceName(raw: string): string {
  const slug = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!slug) {
    throw new Error("Service name must contain at least one letter or number.");
  }
  return slug;
}

/**
 * Persist a record of a minted token. The token value itself (a signed JWT)
 * is NEVER stored — only its `jti`, so revocation is a cheap SQL lookup.
 */
export async function recordMintedToken(params: {
  jti: string;
  ownerEmail: string;
  orgId?: string | null;
  label?: string | null;
  /** Defaults to `'personal'`. Pass `'service'` for org service tokens. */
  kind?: "personal" | "service";
  /** Service principal name — required semantics when kind === 'service'. */
  serviceName?: string | null;
  /** The human who minted a service token (audit trail). */
  createdBy?: string | null;
}): Promise<string> {
  await ensureTable();
  const client = getDbExec();
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO mcp_connect_tokens (id, jti, owner_email, org_id, label, kind, service_name, created_by, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      params.jti,
      params.ownerEmail,
      params.orgId ?? null,
      params.label ?? null,
      params.kind ?? "personal",
      params.serviceName ?? null,
      params.createdBy ?? null,
      Date.now(),
      null,
      null,
    ],
  });
  return id;
}

/**
 * Returns true when the given `jti` corresponds to a token that has been
 * revoked. Fails OPEN on a store/DB error: a transient Neon WS drop must not
 * lock every connected agent out. Signature verification is unaffected — this
 * is only the post-verify revoke check (see `verifyAuth` in build-server.ts).
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT revoked_at FROM mcp_connect_tokens WHERE jti = ?`,
      args: [jti],
    });
    if (rows.length === 0) return false;
    const revokedAt = rows[0].revoked_at ?? rows[0].revokedAt;
    return revokedAt != null;
  } catch (err) {
    // Fail open: a DB blip must not turn every minted token into a 401.
    // (Signature checks already passed; this only gates explicit revokes.)
    if (isConnectionError(err)) return false;
    return false;
  }
}

function mapTokenRow(r: any): MintedTokenRow {
  return {
    id: r.id as string,
    jti: r.jti as string,
    ownerEmail: (r.owner_email ?? r.ownerEmail) as string,
    orgId: (r.org_id ?? r.orgId ?? null) as string | null,
    label: (r.label ?? null) as string | null,
    createdAt: numOrNull(r.created_at ?? r.createdAt),
    lastUsedAt: numOrNull(r.last_used_at ?? r.lastUsedAt),
    revokedAt: numOrNull(r.revoked_at ?? r.revokedAt),
    kind: r.kind === "service" ? "service" : "personal",
    serviceName: (r.service_name ?? r.serviceName ?? null) as string | null,
    createdBy: (r.created_by ?? r.createdBy ?? null) as string | null,
  };
}

export async function listTokens(
  ownerEmail: string,
): Promise<MintedTokenRow[]> {
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT id, jti, owner_email, org_id, label, kind, service_name, created_by, created_at, last_used_at, revoked_at FROM mcp_connect_tokens WHERE owner_email = ? ORDER BY created_at DESC`,
      args: [ownerEmail],
    });
    return rows.map(mapTokenRow);
  } catch (err) {
    if (isConnectionError(err)) return [];
    throw err;
  }
}

/**
 * List the org's service tokens (kind = 'service'), newest first. Scoped by
 * `org_id` — callers must already have established the caller is a member of
 * `orgId` (the actions in `mcp/actions/` gate on org role).
 */
export async function listOrgServiceTokens(
  orgId: string,
): Promise<MintedTokenRow[]> {
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT id, jti, owner_email, org_id, label, kind, service_name, created_by, created_at, last_used_at, revoked_at FROM mcp_connect_tokens WHERE org_id = ? AND kind = 'service' ORDER BY created_at DESC`,
      args: [orgId],
    });
    return rows.map(mapTokenRow);
  } catch (err) {
    if (isConnectionError(err)) return [];
    throw err;
  }
}

/**
 * Revoke an org service token by id, scoped to `orgId` AND `kind = 'service'`
 * so a caller can never revoke another org's token (or someone's personal
 * token) through this path. Uses the same `revoked_at` gate `isJtiRevoked`
 * checks, so revocation takes effect on the next request like personal
 * tokens. Idempotent; returns true when a row actually transitioned.
 */
export async function revokeOrgServiceToken(
  orgId: string,
  id: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE mcp_connect_tokens SET revoked_at = ? WHERE id = ? AND org_id = ? AND kind = 'service' AND revoked_at IS NULL`,
    args: [Date.now(), id, orgId],
  });
  return result.rowsAffected > 0;
}

/**
 * Revoke a token, but ONLY if it is owned by `ownerEmail` (the caller). The
 * `owner_email = ?` predicate is the access scope — a caller can never revoke
 * another user's token. Idempotent: re-revoking keeps the first timestamp.
 * Returns true when a row was actually transitioned to revoked.
 */
export async function revokeToken(
  ownerEmail: string,
  id: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE mcp_connect_tokens SET revoked_at = ? WHERE id = ? AND owner_email = ? AND revoked_at IS NULL`,
    args: [Date.now(), id, ownerEmail],
  });
  return result.rowsAffected > 0;
}

/**
 * Best-effort: stamp `last_used_at` for a token. Swallows all errors — this is
 * pure telemetry and must never affect the auth path.
 */
export async function touchTokenUsed(jti: string): Promise<void> {
  try {
    await ensureTable();
    const client = getDbExec();
    await client.execute({
      sql: `UPDATE mcp_connect_tokens SET last_used_at = ? WHERE jti = ?`,
      args: [Date.now(), jti],
    });
  } catch {
    // last_used_at is informational only — never throw from the hot path.
  }
}

// ---------------------------------------------------------------------------
// Device-code flow (OAuth 2.0 device-authorization style)
// ---------------------------------------------------------------------------

export interface DeviceCodeRow {
  deviceCode: string;
  userCode: string;
  ownerEmail: string | null;
  orgId: string | null;
  status: "pending" | "approved" | "minting" | "consumed" | "expired";
  tokenJti: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  consumedAt: number | null;
}

const USER_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // Crockford-ish base32, no 0/1/O/I

/** Crypto-random short human-typable code, formatted `XXXX-XXXX`. */
function generateUserCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
    if (i === 3) out += "-";
  }
  return out;
}

function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Create a new device+user code pair. Rate-limited: at most
 * `DEVICE_START_MAX` codes within `DEVICE_START_WINDOW_MS`. The window count
 * is a coarse global cap (this endpoint is unauthenticated) — enough to stop
 * table flooding / user-code brute force without per-IP plumbing.
 *
 * Throws `RATE_LIMITED` when the cap is exceeded so the route can map it to a
 * 429.
 */
export async function createDeviceCode(): Promise<DeviceCodeRow> {
  await ensureTable();
  const client = getDbExec();

  const now = Date.now();
  try {
    const { rows } = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM mcp_device_codes WHERE created_at > ?`,
      args: [now - DEVICE_START_WINDOW_MS],
    });
    const n = Number(rows[0]?.n ?? rows[0]?.["COUNT(*)"] ?? 0);
    if (Number.isFinite(n) && n >= DEVICE_START_MAX) {
      throw new Error("RATE_LIMITED");
    }
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED") throw err;
    // A read failure here should not block legitimate device starts — the
    // single-use + short-TTL design is the primary protection. Continue.
  }

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = now + DEVICE_CODE_TTL_MS;
  await client.execute({
    sql: `INSERT INTO mcp_device_codes (device_code, user_code, owner_email, org_id, status, token_jti, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      deviceCode,
      userCode,
      null,
      null,
      "pending",
      null,
      now,
      expiresAt,
      null,
    ],
  });
  return {
    deviceCode,
    userCode,
    ownerEmail: null,
    orgId: null,
    status: "pending",
    tokenJti: null,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  };
}

function mapDeviceRow(r: any): DeviceCodeRow {
  return {
    deviceCode: (r.device_code ?? r.deviceCode) as string,
    userCode: (r.user_code ?? r.userCode) as string,
    ownerEmail: (r.owner_email ?? r.ownerEmail ?? null) as string | null,
    orgId: (r.org_id ?? r.orgId ?? null) as string | null,
    status: (r.status ?? "pending") as DeviceCodeRow["status"],
    tokenJti: (r.token_jti ?? r.tokenJti ?? null) as string | null,
    createdAt: numOrNull(r.created_at ?? r.createdAt),
    expiresAt: numOrNull(r.expires_at ?? r.expiresAt),
    consumedAt: numOrNull(r.consumed_at ?? r.consumedAt),
  };
}

export async function getDeviceCode(
  deviceCode: string,
): Promise<DeviceCodeRow | null> {
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM mcp_device_codes WHERE device_code = ?`,
      args: [deviceCode],
    });
    if (rows.length === 0) return null;
    return mapDeviceRow(rows[0]);
  } catch (err) {
    if (isConnectionError(err)) return null;
    throw err;
  }
}

async function getDeviceCodeByUserCode(
  userCode: string,
): Promise<DeviceCodeRow | null> {
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT * FROM mcp_device_codes WHERE user_code = ?`,
      args: [userCode],
    });
    if (rows.length === 0) return null;
    return mapDeviceRow(rows[0]);
  } catch (err) {
    if (isConnectionError(err)) return null;
    throw err;
  }
}

/**
 * Bind the logged-in user (email + org) to a pending device code, identified
 * by its human-typable `user_code`. Only transitions a non-expired, still
 * `pending` row. Returns the bound row, or a string error code:
 *   - `not_found`  — no such user_code
 *   - `expired`    — past its TTL
 *   - `already`    — already approved/consumed (not re-bindable)
 */
export async function approveDeviceCode(
  userCode: string,
  ownerEmail: string,
  orgId: string | null,
): Promise<DeviceCodeRow | "not_found" | "expired" | "already"> {
  await ensureTable();
  const client = getDbExec();
  const row = await getDeviceCodeByUserCode(userCode);
  if (!row) return "not_found";
  if ((row.expiresAt ?? 0) < Date.now()) return "expired";
  if (row.status !== "pending") return "already";

  const result = await client.execute({
    sql: `UPDATE mcp_device_codes SET status = 'approved', owner_email = ?, org_id = ? WHERE user_code = ? AND status = 'pending'`,
    args: [ownerEmail, orgId, userCode],
  });
  if (result.rowsAffected === 0) {
    // Lost a race with another approve — re-read to report the real state.
    const fresh = await getDeviceCodeByUserCode(userCode);
    return fresh && fresh.status !== "pending" ? "already" : "not_found";
  }
  return {
    ...row,
    status: "approved",
    ownerEmail,
    orgId,
  };
}

/**
 * Atomically transition an approved device code to consumed and stamp the
 * minted token's jti. Single-use: only succeeds when the row is currently
 * `approved` (not already consumed). Returns the pre-consume row on success,
 * or null when it could not be consumed (already consumed / not approved /
 * gone). The caller mints the token only after this returns a row.
 */
export async function consumeDeviceCode(
  deviceCode: string,
  tokenJti: string,
): Promise<DeviceCodeRow | null> {
  await ensureTable();
  const client = getDbExec();
  const row = await getDeviceCode(deviceCode);
  if (!row) return null;
  if (row.status !== "approved") return null;
  const result = await client.execute({
    sql: `UPDATE mcp_device_codes SET status = 'consumed', token_jti = ?, consumed_at = ? WHERE device_code = ? AND status = 'approved'`,
    args: [tokenJti, Date.now(), deviceCode],
  });
  if (result.rowsAffected === 0) return null; // lost the single-use race
  return row;
}

/**
 * Claim an approved device code for token minting without making it terminal.
 * If signing or token recording fails, callers release this back to approved
 * so the CLI can retry the poll instead of being stuck at "consumed".
 */
export async function claimDeviceCodeForMint(
  deviceCode: string,
  tokenJti: string,
): Promise<DeviceCodeRow | null> {
  await ensureTable();
  const client = getDbExec();
  const row = await getDeviceCode(deviceCode);
  if (!row || row.status !== "approved") return null;
  const result = await client.execute({
    sql: `UPDATE mcp_device_codes SET status = 'minting', token_jti = ?, consumed_at = ? WHERE device_code = ? AND status = 'approved'`,
    args: [tokenJti, Date.now(), deviceCode],
  });
  if (result.rowsAffected === 0) return null;
  return row;
}

export async function finishDeviceCodeMint(
  deviceCode: string,
  tokenJti: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE mcp_device_codes SET status = 'consumed' WHERE device_code = ? AND status = 'minting' AND token_jti = ?`,
    args: [deviceCode, tokenJti],
  });
  return result.rowsAffected > 0;
}

export async function releaseDeviceCodeMint(
  deviceCode: string,
  tokenJti: string,
): Promise<void> {
  try {
    await ensureTable();
    const client = getDbExec();
    await client.execute({
      sql: `UPDATE mcp_device_codes SET status = 'approved', token_jti = NULL, consumed_at = NULL WHERE device_code = ? AND status = 'minting' AND token_jti = ?`,
      args: [deviceCode, tokenJti],
    });
  } catch {
    // The next poll will keep returning pending for a minting row until a
    // later cleanup/retry path can observe or repair it. Do not throw here.
  }
}

/**
 * Best-effort: flip an expired, still-pending/approved row to `expired` so
 * the poll endpoint can report a clean terminal state. Swallows errors.
 */
export async function expireDeviceCode(deviceCode: string): Promise<void> {
  try {
    await ensureTable();
    const client = getDbExec();
    await client.execute({
      sql: `UPDATE mcp_device_codes SET status = 'expired' WHERE device_code = ? AND status IN ('pending','approved')`,
      args: [deviceCode],
    });
  } catch {
    // The poll handler already treats past-TTL rows as expired regardless of
    // whether this housekeeping write lands.
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
