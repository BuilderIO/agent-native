/**
 * Framework-table store for the cross-app SSO ("Sign in with Agent-Native")
 * CLIENT side. Backs two pieces of the federated login round-trip:
 *
 *   - `identity_sso_state` — short-lived (10 min), single-use, crypto-random
 *     CSRF `state` values. Minted at `/_agent-native/identity/login`,
 *     consumed exactly once at `/_agent-native/identity/callback`. Carries an
 *     optional same-origin `return` path so the user lands back where they
 *     started after federated sign-in.
 *   - `identity_sso_jti` — replayed-token guard. The hub-issued identity JWT
 *     carries a random `jti`; the first callback that verifies a given `jti`
 *     records it here, and any later callback that presents the same `jti`
 *     is rejected. Best-effort: a DB blip never widens the trust boundary
 *     (signature + exp + scope + single-use state are still enforced), it
 *     only relaxes the extra replay gate.
 *
 * Mirrors `mcp/connect-store.ts`: lazy `ensureTable()`, `getDbExec()`,
 * dialect-agnostic SQL via `intType()`, `isConnectionError()` swallow so a
 * transient Neon WS drop never 500s. `CREATE TABLE IF NOT EXISTS` only —
 * strictly additive, never DROP / ALTER (shared prod DB rule).
 *
 * Node-only (crypto), bundled alongside the other framework auth modules.
 */

import { randomBytes } from "node:crypto";

import {
  getDbExec,
  isConnectionError,
  intType,
  isPostgres,
} from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

// ---------------------------------------------------------------------------
// Feature switch — the SINGLE source of truth for whether the federated-SSO
// client is active. Lives here (a leaf module with no dependency on auth.ts)
// so BOTH the auth guard and the route handler import the identical
// validator and can never drift. Pure env read, no I/O — safe on the guard
// hot path.
// ---------------------------------------------------------------------------

/**
 * Read + normalise `AGENT_NATIVE_IDENTITY_HUB_URL`. Returns `undefined`
 * (feature OFF) unless it is set to a syntactically valid http(s) URL. A
 * malformed value is treated as OFF rather than throwing, so a typo can
 * never brick an app's login — it just behaves as if SSO were unconfigured.
 */
export function getIdentityHubUrl(): string | undefined {
  const raw = process.env.AGENT_NATIVE_IDENTITY_HUB_URL?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Whether the federated-SSO client is active. When false, NOTHING in the
 * SSO module has any effect: the route 404s, the guard bypass is inert, the
 * login button is not rendered. This is the single switch the
 * env-unset-no-op invariant is asserted against.
 */
export function isIdentitySsoEnabled(): boolean {
  return !!getIdentityHubUrl();
}

/**
 * The conditional "Sign in with Agent-Native" entry injected into the login
 * page — ONLY when the feature is enabled. Returns an empty string when
 * disabled so the login HTML is byte-for-byte identical to today's output
 * with the env unset (asserted by the env-unset-no-op regression test). Pure
 * string builder, no I/O — safe to call during HTML render. Lives in this
 * leaf module so `onboarding-html.ts` can import it without creating an
 * `auth.ts` ↔ `identity-sso.ts` import cycle.
 */
export function identitySsoLoginButtonHtml(): string {
  if (!isIdentitySsoEnabled()) return "";
  return (
    `\n  <a class="btn-identity-sso" id="identity-sso-btn" ` +
    `href="/_agent-native/identity/login" ` +
    `style="display:flex;align-items:center;justify-content:center;gap:0.5rem;` +
    `width:100%;padding:0.7rem 1rem;margin-bottom:0.75rem;border-radius:8px;` +
    `border:1px solid rgba(255,255,255,0.18);background:transparent;` +
    `color:inherit;font:inherit;font-weight:600;text-decoration:none;` +
    `cursor:pointer">Sign in with Agent-Native</a>\n`
  );
}

/** CSRF state values are valid for 10 minutes. */
export const SSO_STATE_TTL_MS = 10 * 60_000;

/**
 * Rate limit for `identity/login`: at most this many state rows may be
 * created within `SSO_LOGIN_WINDOW_MS`. The endpoint is reachable without a
 * session (it's the entry point), so keep a coarse global cap to stop table
 * flooding without per-IP plumbing.
 */
export const SSO_LOGIN_MAX = 60;
export const SSO_LOGIN_WINDOW_MS = 60_000;

// Build the CREATE SQL lazily (not at module scope) so intType() runs at
// RUNTIME, not import time — a module-scope call breaks any consumer whose
// db/client mock doesn't stub intType (e.g. db-admin specs).
function buildIdentitySsoStateCreateSql(): string {
  return `
        CREATE TABLE IF NOT EXISTS identity_sso_state (
          state TEXT PRIMARY KEY,
          return_path TEXT,
          created_at ${intType()},
          expires_at ${intType()},
          consumed_at ${intType()}
        )
      `;
}
function buildIdentitySsoJtiCreateSql(): string {
  return `
        CREATE TABLE IF NOT EXISTS identity_sso_jti (
          jti TEXT PRIMARY KEY,
          seen_at ${intType()}
        )
      `;
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const identitySsoStateCreateSql = buildIdentitySsoStateCreateSql();
      const identitySsoJtiCreateSql = buildIdentitySsoJtiCreateSql();
      // Additive only. Never DROP / ALTER — this DB is shared across every
      // deploy context (preview/branch/prod) for hosted templates.
      if (isPostgres()) {
        // PG guard: probe → guarded DDL → re-probe; skips lock on already-migrated path
        await ensureTableExists(
          "identity_sso_state",
          identitySsoStateCreateSql,
        );
        await ensureTableExists("identity_sso_jti", identitySsoJtiCreateSql);
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(identitySsoStateCreateSql);
      await client.execute(identitySsoJtiCreateSql);
    })().catch((err) => {
      // Don't cache a rejection — let the next caller retry a fresh init.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// CSRF state
// ---------------------------------------------------------------------------

/**
 * Mint a fresh crypto-random `state` value, persist it with an optional
 * same-origin return path, and return it. Rate-limited at creation: at most
 * `SSO_LOGIN_MAX` rows within `SSO_LOGIN_WINDOW_MS`. Throws `RATE_LIMITED`
 * when the cap is exceeded so the route can map it to a 429.
 */
export async function createSsoState(
  returnPath: string | null,
): Promise<string> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  try {
    const { rows } = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM identity_sso_state WHERE created_at > ?`,
      args: [now - SSO_LOGIN_WINDOW_MS],
    });
    const n = Number(rows[0]?.n ?? rows[0]?.["COUNT(*)"] ?? 0);
    if (Number.isFinite(n) && n >= SSO_LOGIN_MAX) {
      throw new Error("RATE_LIMITED");
    }
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED") throw err;
    // A read failure must not block legitimate logins — single-use +
    // short-TTL state is the primary protection. Continue.
  }

  const state = randomBytes(32).toString("base64url");
  const expiresAt = now + SSO_STATE_TTL_MS;
  await client.execute({
    sql: `INSERT INTO identity_sso_state (state, return_path, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?)`,
    args: [state, returnPath ?? null, now, expiresAt, null],
  });
  // Fire-and-forget: prune fully-expired rows (consumed or abandoned). Without
  // this the table grows unbounded and the rate-limit COUNT(*) above slows down.
  void client
    .execute({
      sql: `DELETE FROM identity_sso_state WHERE expires_at < ?`,
      args: [now],
    })
    .catch(() => {});
  return state;
}

export interface SsoStateConsumeResult {
  ok: boolean;
  returnPath: string | null;
}

/**
 * Atomically consume a `state` value. Returns `{ ok: true, returnPath }` only
 * when the state existed, had not expired, and had not been consumed before —
 * and this call is the one that transitioned it to consumed (single-use,
 * enforced via a conditional UPDATE so a double callback can't both pass).
 * Any other condition returns `{ ok: false }`.
 */
export async function consumeSsoState(
  state: string,
): Promise<SsoStateConsumeResult> {
  if (!state) return { ok: false, returnPath: null };
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  const { rows } = await client.execute({
    sql: `SELECT state, return_path, expires_at, consumed_at FROM identity_sso_state WHERE state = ?`,
    args: [state],
  });
  if (rows.length === 0) return { ok: false, returnPath: null };
  const row: any = rows[0];
  const expiresAt = numOrNull(row.expires_at ?? row.expiresAt);
  const consumedAt = numOrNull(row.consumed_at ?? row.consumedAt);
  if (consumedAt != null) return { ok: false, returnPath: null };
  if (expiresAt != null && expiresAt < now) {
    return { ok: false, returnPath: null };
  }

  // Single-use: only the caller that flips `consumed_at` from NULL wins.
  const result = await client.execute({
    sql: `UPDATE identity_sso_state SET consumed_at = ? WHERE state = ? AND consumed_at IS NULL`,
    args: [now, state],
  });
  if (result.rowsAffected === 0) {
    // Lost the race to a concurrent callback — treat as already consumed.
    return { ok: false, returnPath: null };
  }
  const returnPath = (row.return_path ?? row.returnPath ?? null) as
    | string
    | null;
  return { ok: true, returnPath };
}

// ---------------------------------------------------------------------------
// Replay (jti) guard
// ---------------------------------------------------------------------------

/**
 * Returns true when the given identity-token `jti` has already been seen
 * (i.e. this is a replay). On the first sighting, records the `jti` and
 * returns false. Best-effort: a store/DB error returns `false` (not a
 * replay) so a transient Neon WS drop never blocks a legitimate first-time
 * sign-in — signature + exp + scope + single-use CSRF state remain the hard
 * gates; this only adds defence in depth against token replay.
 */
export async function isJtiReplayed(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  try {
    await ensureTable();
    const client = getDbExec();
    await client.execute({
      sql: `INSERT INTO identity_sso_jti (jti, seen_at) VALUES (?, ?)`,
      args: [jti, Date.now()],
    });
    // The INSERT completed without throwing → this jti was never seen → not a
    // replay. (A replay manifests as a PK-conflict *exception*, handled below.)
    // Don't key off rowsAffected: some drivers report 0 for a successful insert,
    // which would wrongly flag a legitimate first-time sign-in as a replay.
    return false;
  } catch (err) {
    // Primary-key conflict = the jti already exists = replay.
    const msg = String((err as any)?.message ?? "").toLowerCase();
    if (
      msg.includes("unique") ||
      msg.includes("duplicate") ||
      msg.includes("constraint")
    ) {
      return true;
    }
    // Any other error (incl. connection blips): fail open — do not block a
    // legitimate first sign-in over a transient DB issue.
    if (isConnectionError(err)) return false;
    return false;
  }
}
