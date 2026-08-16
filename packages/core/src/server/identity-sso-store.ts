/**
 * Framework-table store for the cross-app SSO client.
 *
 * The current protocol uses a fresh flow-state table instead of extending the
 * original `identity_sso_state` table. That keeps the migration additive for
 * deployments that already have the merged PR's schema:
 *
 *   - `identity_sso_flow_state` binds state to the exact app, client,
 *     authority, callback, and PKCE challenge. State is single-use.
 *   - `identity_sso_jti` is the legacy-named shared replay guard for short-lived
 *     server-to-server assertions, including identity SSO and privileged A2A
 *     mutations.
 *
 * Uses the same portable raw-SQL pattern as the other framework stores. Local
 * development may initialize these tables lazily; production release
 * migrations own their creation before serverless requests are served.
 */

import { randomBytes } from "node:crypto";

import {
  getDbExec,
  intType,
  isConnectionError,
  isPostgres,
  isProductionServerlessFunctionRuntime,
} from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

const DESKTOP_SSO_USER_AGENT = /AgentNativeDesktop(?:SsoCanary)?\//i;
const DESKTOP_SSO_CANARY_USER_AGENT = /AgentNativeDesktopSsoCanary\//i;
export const CANONICAL_IDENTITY_SSO_HUB_URL =
  "https://dispatch.agent-native.com";
const CANONICAL_IDENTITY_SSO_APP_ORIGINS = new Set([
  "https://analytics.agent-native.com",
  "https://assets.agent-native.com",
  "https://brain.agent-native.com",
  "https://calendar.agent-native.com",
  "https://chat.agent-native.com",
  "https://clips.agent-native.com",
  "https://content.agent-native.com",
  "https://crm.agent-native.com",
  "https://design.agent-native.com",
  "https://dispatch.agent-native.com",
  "https://forms.agent-native.com",
  "https://macros.agent-native.com",
  "https://mail.agent-native.com",
  "https://plan.agent-native.com",
  "https://slides.agent-native.com",
  "https://tasks.agent-native.com",
]);

export const SSO_STATE_TTL_MS = 10 * 60_000;
export const SSO_LOGIN_MAX = 60;
export const SSO_LOGIN_WINDOW_MS = 60_000;

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const CANONICAL_IDENTITY_SSO_CLIENT_ORIGINS = new Set(
  [...CANONICAL_IDENTITY_SSO_APP_ORIGINS].filter(
    (origin) => origin !== CANONICAL_IDENTITY_SSO_HUB_URL,
  ),
);

// ---------------------------------------------------------------------------
// Feature switch — this module is intentionally dependency-light because the
// auth guard and the route handler both import the same pure switch.
// ---------------------------------------------------------------------------

function configuredAppOrigin(): string | undefined {
  for (const raw of [
    process.env.APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.VITE_APP_URL,
    process.env.VITE_BETTER_AUTH_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
  ]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
    } catch (error) {
      void error;
    }
  }
  return undefined;
}

export function getIdentityHubUrl(): string | undefined {
  const raw = process.env.AGENT_NATIVE_IDENTITY_HUB_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (
        u.protocol !== "https:" &&
        !(u.protocol === "http:" && LOCALHOST_HOSTS.has(u.hostname))
      ) {
        return undefined;
      }
      if (u.username || u.password || u.search || u.hash) return undefined;
      return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
    } catch (error) {
      void error;
      return undefined;
    }
  }

  // Canonical hosted apps are all registered with Dispatch already. Keep
  // self-hosted deployments opt-in, and never make Dispatch federate to itself.
  const appOrigin = configuredAppOrigin();
  return isCanonicalIdentitySsoClientOrigin(appOrigin)
    ? CANONICAL_IDENTITY_SSO_HUB_URL
    : undefined;
}

export function isIdentitySsoExplicitlyEnabled(): boolean {
  return Boolean(
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL?.trim() && getIdentityHubUrl(),
  );
}

export function isIdentitySsoEnabled(): boolean {
  return !!getIdentityHubUrl();
}

export function isDesktopSsoCanaryUserAgent(
  userAgent: string | undefined,
): boolean {
  return DESKTOP_SSO_CANARY_USER_AGENT.test(userAgent ?? "");
}

export function isDesktopSsoUserAgent(userAgent: string | undefined): boolean {
  return DESKTOP_SSO_USER_AGENT.test(userAgent ?? "");
}

export function isCanonicalAgentNativeAppOrigin(
  origin: string | undefined,
): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      CANONICAL_IDENTITY_SSO_APP_ORIGINS.has(parsed.origin)
    );
  } catch (error) {
    void error;
    return false;
  }
}

export function isCanonicalIdentitySsoClientOrigin(
  origin: string | undefined,
): boolean {
  return Boolean(origin && CANONICAL_IDENTITY_SSO_CLIENT_ORIGINS.has(origin));
}

export function isCanonicalAgentNativeAppRequest(
  host: string | undefined,
  forwardedProtocol: string | undefined,
): boolean {
  if (!host || forwardedProtocol !== "https") return false;
  return isCanonicalAgentNativeAppOrigin(`https://${host}`);
}

export function isCanonicalIdentitySsoClientRequest(
  host: string | undefined,
  forwardedProtocol: string | undefined,
): boolean {
  if (!host || forwardedProtocol !== "https") return false;
  return isCanonicalIdentitySsoClientOrigin(`https://${host}`);
}

/**
 * The conditional login entry is the only browser UI this feature adds. It
 * stays byte-for-byte absent on self-hosted apps; canonical hosted clients
 * use their exact registered origin as the implicit opt-in.
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

export interface CreateSsoStateInput {
  returnPath: string | null;
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  codeChallenge: string;
}

export interface SsoStateBinding {
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  codeChallenge: string;
}

export interface SsoStateConsumeResult {
  ok: boolean;
  returnPath: string | null;
}

function buildIdentitySsoFlowStateCreateSql(): string {
  return `
        CREATE TABLE IF NOT EXISTS identity_sso_flow_state (
          state TEXT PRIMARY KEY,
          return_path TEXT,
          app_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          authority TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
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
  // Release migrations own schema in production serverless functions. A
  // request must not turn a missing migration into request-time DDL.
  if (isProductionServerlessFunctionRuntime()) return;
  if (!_initPromise) {
    _initPromise = (async () => {
      const flowStateSql = buildIdentitySsoFlowStateCreateSql();
      const jtiSql = buildIdentitySsoJtiCreateSql();
      if (isPostgres()) {
        await ensureTableExists("identity_sso_flow_state", flowStateSql);
        await ensureTableExists("identity_sso_jti", jtiSql);
        return;
      }

      const client = getDbExec();
      await client.execute(flowStateSql);
      await client.execute(jtiSql);
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function affectedRows(result: any): number {
  return Number(result?.rowsAffected ?? result?.rowCount ?? result?.count ?? 0);
}

function isSafeStateInput(input: CreateSsoStateInput): boolean {
  if (
    !input.appId ||
    !input.clientId ||
    !input.redirectUri ||
    !input.authority ||
    !input.codeChallenge
  ) {
    return false;
  }
  if (!APP_ID_PATTERN.test(input.appId)) return false;
  if (!CLIENT_ID_PATTERN.test(input.clientId)) return false;
  if (!CODE_CHALLENGE_PATTERN.test(input.codeChallenge)) return false;
  if (
    CONTROL_CHARS.test(input.redirectUri) ||
    CONTROL_CHARS.test(input.authority)
  ) {
    return false;
  }
  try {
    const redirect = new URL(input.redirectUri);
    const authority = new URL(input.authority);
    if (
      redirect.username ||
      redirect.password ||
      authority.username ||
      authority.password
    ) {
      return false;
    }
    const secureOrLoopback = (url: URL) =>
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname));
    if (!secureOrLoopback(redirect) || !secureOrLoopback(authority)) {
      return false;
    }
  } catch (error) {
    void error;
    return false;
  }
  return true;
}

/** Mint and persist a bound, crypto-random state value. */
export async function createSsoState(
  input: CreateSsoStateInput,
): Promise<string> {
  if (!isSafeStateInput(input)) throw new Error("INVALID_SSO_STATE");
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  try {
    const { rows } = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM identity_sso_flow_state WHERE created_at > ?",
      args: [now - SSO_LOGIN_WINDOW_MS],
    });
    const count = Number(rows[0]?.n ?? rows[0]?.["COUNT(*)"] ?? 0);
    if (Number.isFinite(count) && count >= SSO_LOGIN_MAX) {
      throw new Error("RATE_LIMITED");
    }
  } catch (error: any) {
    if (error?.message === "RATE_LIMITED") throw error;
    // A rate-limit read failure does not widen the auth boundary. The state
    // remains high entropy, bound, short-lived, and single-use.
  }

  const state = randomBytes(32).toString("base64url");
  await client.execute({
    sql:
      "INSERT INTO identity_sso_flow_state " +
      "(state, return_path, app_id, client_id, redirect_uri, authority, code_challenge, created_at, expires_at, consumed_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      state,
      input.returnPath,
      input.appId,
      input.clientId,
      input.redirectUri,
      input.authority,
      input.codeChallenge,
      now,
      now + SSO_STATE_TTL_MS,
      null,
    ],
  });
  void client
    .execute({
      sql: "DELETE FROM identity_sso_flow_state WHERE expires_at < ?",
      args: [now],
    })
    .catch(() => {});
  return state;
}

/**
 * Atomically consume state only when every security binding still matches.
 * A missing or mismatched binding is indistinguishable from an unknown state.
 */
export async function consumeSsoState(
  state: string,
  expected: SsoStateBinding,
): Promise<SsoStateConsumeResult> {
  if (
    !STATE_PATTERN.test(state) ||
    !isSafeStateInput({ ...expected, returnPath: null })
  ) {
    return { ok: false, returnPath: null };
  }
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const { rows } = await client.execute({
    sql:
      "SELECT return_path, app_id, client_id, redirect_uri, authority, code_challenge, expires_at, consumed_at " +
      "FROM identity_sso_flow_state WHERE state = ?",
    args: [state],
  });
  if (rows.length === 0) return { ok: false, returnPath: null };
  const row: any = rows[0];
  const expiresAt = numOrNull(row.expires_at ?? row.expiresAt);
  const consumedAt = numOrNull(row.consumed_at ?? row.consumedAt);
  if (consumedAt != null || (expiresAt != null && expiresAt < now)) {
    return { ok: false, returnPath: null };
  }

  const appId = stringOrNull(row.app_id ?? row.appId);
  const clientId = stringOrNull(row.client_id ?? row.clientId);
  const redirectUri = stringOrNull(row.redirect_uri ?? row.redirectUri);
  const authority = stringOrNull(row.authority);
  const codeChallenge = stringOrNull(row.code_challenge ?? row.codeChallenge);
  if (
    appId !== expected.appId ||
    clientId !== expected.clientId ||
    redirectUri !== expected.redirectUri ||
    authority !== expected.authority ||
    codeChallenge !== expected.codeChallenge
  ) {
    return { ok: false, returnPath: null };
  }

  const result = await client.execute({
    sql:
      "UPDATE identity_sso_flow_state SET consumed_at = ? " +
      "WHERE state = ? AND consumed_at IS NULL AND app_id = ? AND client_id = ? " +
      "AND redirect_uri = ? AND authority = ? AND code_challenge = ?",
    args: [
      now,
      state,
      expected.appId,
      expected.clientId,
      expected.redirectUri,
      expected.authority,
      expected.codeChallenge,
    ],
  });
  if (affectedRows(result) !== 1) return { ok: false, returnPath: null };

  return {
    ok: true,
    returnPath: stringOrNull(row.return_path ?? row.returnPath),
  };
}

/**
 * Strict replay defense for the server-to-server assertion. A database error
 * fails closed here: code exchange already provides the primary single-use
 * guarantee, and refusing a login is safer than accepting an unverifiable
 * replay boundary.
 */
export async function consumeOneTimeJti(
  jti: string | undefined,
): Promise<boolean> {
  if (!jti) return true;
  try {
    await ensureTable();
    const client = getDbExec();
    const now = Date.now();
    await client.execute({
      sql: "INSERT INTO identity_sso_jti (jti, seen_at) VALUES (?, ?)",
      args: [jti, now],
    });
    void client
      .execute({
        sql: "DELETE FROM identity_sso_jti WHERE seen_at < ?",
        args: [now - SSO_STATE_TTL_MS],
      })
      .catch(() => {});
    return false;
  } catch (error) {
    const message = String((error as any)?.message ?? "").toLowerCase();
    if (
      message.includes("unique") ||
      message.includes("duplicate") ||
      message.includes("constraint")
    ) {
      return true;
    }
    if (isConnectionError(error)) return true;
    return true;
  }
}

export const isJtiReplayed = consumeOneTimeJti;
