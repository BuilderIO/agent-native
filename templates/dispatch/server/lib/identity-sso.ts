/**
 * Identity-authority primitives for "Sign in with Agent-Native".
 *
 * Dispatch is the identity authority. The browser receives only a short-lived
 * one-time authorization code. The client redeems it server-to-server with a
 * PKCE verifier; only that server-to-server response may contain the signed
 * identity assertion used to create the app-local session.
 *
 * This module also owns the exact app registry and the additive code store.
 * Canonical apps are compiled into the registry. Custom workspace apps must be
 * explicitly registered with `IDENTITY_SSO_APP_REGISTRY_JSON`; host suffixes
 * and wildcard domains are never accepted.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getDbExec, intType } from "@agent-native/core/db";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const APP_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const IDENTITY_SCOPE = "identity";
export const IDENTITY_TOKEN_TTL_SECONDS = 120;
export const IDENTITY_TOKEN_TTL = "2m";
export const IDENTITY_AUTHORIZATION_CODE_TTL_MS =
  IDENTITY_TOKEN_TTL_SECONDS * 1_000;
export const IDENTITY_SSO_CALLBACK_PATH = "/_agent-native/identity/callback";
export const IDENTITY_SSO_TOKEN_PATH = "/_agent-native/identity/token";

export function isValidSsoState(value: unknown): value is string {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

export function normalizeIdentityAuthority(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || CONTROL_CHARS.test(raw)) {
    return null;
  }
  try {
    const url = new URL(raw.trim());
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch (error) {
    void error;
    return null;
  }
}

/** Exact first-party app origins. Never replace this with a suffix check. */
export const CANONICAL_IDENTITY_SSO_APP_ORIGINS = {
  analytics: "https://analytics.agent-native.com",
  assets: "https://assets.agent-native.com",
  brain: "https://brain.agent-native.com",
  calendar: "https://calendar.agent-native.com",
  chat: "https://chat.agent-native.com",
  clips: "https://clips.agent-native.com",
  content: "https://content.agent-native.com",
  crm: "https://crm.agent-native.com",
  design: "https://design.agent-native.com",
  dispatch: "https://dispatch.agent-native.com",
  forms: "https://forms.agent-native.com",
  macros: "https://macros.agent-native.com",
  mail: "https://mail.agent-native.com",
  plan: "https://plan.agent-native.com",
  slides: "https://slides.agent-native.com",
  tasks: "https://tasks.agent-native.com",
} as const;

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.values(
  CANONICAL_IDENTITY_SSO_APP_ORIGINS,
);

export interface IdentitySsoAppRegistration {
  appId: string;
  clientId: string;
  origin: string;
  callbackPath: typeof IDENTITY_SSO_CALLBACK_PATH;
}

function canonicalRegistrations(): IdentitySsoAppRegistration[] {
  return Object.entries(CANONICAL_IDENTITY_SSO_APP_ORIGINS).map(
    ([appId, origin]) => ({
      appId,
      clientId: appId,
      origin,
      callbackPath: IDENTITY_SSO_CALLBACK_PATH,
    }),
  );
}

function exactOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || CONTROL_CHARS.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname))
    ) {
      return null;
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch (error) {
    void error;
    return null;
  }
}

function parseCustomRegistrations(
  env: NodeJS.ProcessEnv,
): IdentitySsoAppRegistration[] {
  const raw = env.IDENTITY_SSO_APP_REGISTRY_JSON?.trim();
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    void error;
    return [];
  }
  if (!Array.isArray(value)) return [];

  const registrations: IdentitySsoAppRegistration[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const appId = candidate.appId;
    const clientId = candidate.clientId;
    const origin = exactOrigin(candidate.origin);
    const callbackPath = candidate.callbackPath;
    const capabilities = candidate.capabilities;
    if (
      typeof appId !== "string" ||
      !APP_ID.test(appId) ||
      typeof clientId !== "string" ||
      !CLIENT_ID.test(clientId) ||
      !origin ||
      callbackPath !== IDENTITY_SSO_CALLBACK_PATH ||
      !Array.isArray(capabilities) ||
      !capabilities.includes("identity-sso") ||
      seen.has(appId) ||
      Object.prototype.hasOwnProperty.call(
        CANONICAL_IDENTITY_SSO_APP_ORIGINS,
        appId,
      )
    ) {
      continue;
    }
    seen.add(appId);
    registrations.push({
      appId,
      clientId,
      origin,
      callbackPath: IDENTITY_SSO_CALLBACK_PATH,
    });
  }
  return registrations;
}

/**
 * Return the exact configured registry. Invalid custom entries are ignored;
 * they never broaden the canonical registry. A deployment can therefore roll
 * back custom registration by removing the env without changing code or data.
 */
export function getIdentitySsoAppRegistry(
  env: NodeJS.ProcessEnv = process.env,
): IdentitySsoAppRegistration[] {
  return [...canonicalRegistrations(), ...parseCustomRegistrations(env)];
}

function parseAbsoluteUrl(raw: string): URL | null {
  if (!raw || CONTROL_CHARS.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    return url;
  } catch (error) {
    void error;
    return null;
  }
}

/**
 * General redirect-origin validation. The authorize route additionally calls
 * `resolveIdentitySsoApp`, which enforces the exact registered callback.
 * Localhost remains available for development, but only with exact callback
 * path and client binding in the app resolver below.
 */
export function isAllowedRedirectUri(rawRedirectUri: unknown): boolean {
  if (typeof rawRedirectUri !== "string") return false;
  const url = parseAbsoluteUrl(rawRedirectUri);
  if (!url) return false;
  if (url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname)) {
    return true;
  }
  return (
    url.protocol === "https:" && DEFAULT_ALLOWED_ORIGINS.includes(url.origin)
  );
}

function exactCallbackMatches(
  registration: IdentitySsoAppRegistration,
  rawRedirectUri: string,
): boolean {
  const url = parseAbsoluteUrl(rawRedirectUri);
  if (!url) return false;
  return (
    url.origin === registration.origin &&
    url.pathname === registration.callbackPath &&
    !url.search &&
    !url.hash
  );
}

/**
 * Resolve an app only when app id, client id, exact origin, and callback path
 * all agree. Loopback is the narrowly-scoped development exception and still
 * requires a valid app/client id pair plus the fixed callback path.
 */
export function resolveIdentitySsoApp(
  appId: unknown,
  clientId: unknown,
  rawRedirectUri: unknown,
  env: NodeJS.ProcessEnv = process.env,
): IdentitySsoAppRegistration | null {
  if (
    typeof appId !== "string" ||
    !APP_ID.test(appId) ||
    typeof clientId !== "string" ||
    !CLIENT_ID.test(clientId) ||
    typeof rawRedirectUri !== "string"
  ) {
    return null;
  }
  const redirectUri = rawRedirectUri as string;
  const parsedRedirect = parseAbsoluteUrl(redirectUri);
  if (!parsedRedirect) return null;
  const registered = getIdentitySsoAppRegistry(env).find(
    (candidate) =>
      candidate.appId === appId &&
      candidate.clientId === clientId &&
      exactCallbackMatches(candidate, redirectUri),
  );
  if (registered) return registered;

  const url = parseAbsoluteUrl(redirectUri);
  if (
    url &&
    LOCALHOST_HOSTS.has(url.hostname) &&
    clientId === appId &&
    url.pathname === IDENTITY_SSO_CALLBACK_PATH &&
    !url.search &&
    !url.hash
  ) {
    return {
      appId,
      clientId,
      origin: url.origin,
      callbackPath: IDENTITY_SSO_CALLBACK_PATH,
    };
  }
  return null;
}

export function isAllowedIdentityRedirect(
  appId: unknown,
  rawRedirectUri: unknown,
  options: { clientId?: unknown; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const clientId = options.clientId ?? appId;
  return !!resolveIdentitySsoApp(appId, clientId, rawRedirectUri, options.env);
}

export interface IdentityClaims {
  sub: string;
  email: string;
  name?: string;
  org_domain?: string;
  scope: typeof IDENTITY_SCOPE;
  jti: string;
}

export function buildIdentityClaims(input: {
  email: string;
  name?: string | null;
  orgDomain?: string | null;
}): IdentityClaims {
  const claims: IdentityClaims = {
    sub: input.email,
    email: input.email,
    scope: IDENTITY_SCOPE,
    jti: randomBytes(16).toString("base64url"),
  };
  if (input.name?.trim()) claims.name = input.name.trim();
  if (input.orgDomain?.trim()) claims.org_domain = input.orgDomain.trim();
  return claims;
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function createCodeChallenge(verifier: string): string | null {
  if (!CODE_VERIFIER.test(verifier)) return null;
  return sha256Base64Url(verifier);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildRedirectLocation(
  rawRedirectUri: string,
  code: string,
  state: string | null | undefined,
): string {
  const url = new URL(rawRedirectUri);
  url.searchParams.set("code", code);
  if (typeof state === "string" && state.length > 0) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export interface CreateIdentityAuthorizationCodeInput {
  state: string;
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  codeChallenge: string;
  email: string;
  name?: string | null;
  orgDomain?: string | null;
}

export interface ConsumedIdentityAuthorizationCode {
  email: string;
  name?: string;
  orgDomain?: string;
  jti: string;
}

let codeTableInitPromise: Promise<void> | undefined;

function buildCodeTableSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS identity_sso_authorization_code (
      code_hash TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      app_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      authority TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      org_domain TEXT,
      jti TEXT NOT NULL,
      created_at ${intType()} NOT NULL,
      expires_at ${intType()} NOT NULL,
      consumed_at ${intType()}
    )
  `;
}

async function ensureCodeTable(): Promise<void> {
  if (!codeTableInitPromise) {
    codeTableInitPromise = getDbExec()
      .execute(buildCodeTableSql())
      .then(() => undefined)
      .catch((error) => {
        codeTableInitPromise = undefined;
        throw error;
      });
  }
  return codeTableInitPromise;
}

function affectedRows(result: any): number {
  return Number(result?.rowsAffected ?? result?.rowCount ?? result?.count ?? 0);
}

function identityCodeHash(code: string): string {
  return sha256Base64Url(code);
}

export async function createIdentityAuthorizationCode(
  input: CreateIdentityAuthorizationCodeInput,
): Promise<string> {
  if (
    !STATE_PATTERN.test(input.state) ||
    !APP_ID.test(input.appId) ||
    !CLIENT_ID.test(input.clientId) ||
    !CODE_CHALLENGE.test(input.codeChallenge) ||
    !input.email ||
    !resolveIdentitySsoApp(input.appId, input.clientId, input.redirectUri)
  ) {
    throw new Error("INVALID_IDENTITY_AUTHORIZATION_CODE");
  }
  await ensureCodeTable();
  const code = randomBytes(32).toString("base64url");
  const now = Date.now();
  const claims = buildIdentityClaims(input);
  await getDbExec().execute({
    sql:
      "INSERT INTO identity_sso_authorization_code " +
      "(code_hash, state, app_id, client_id, redirect_uri, authority, code_challenge, email, name, org_domain, jti, created_at, expires_at, consumed_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      identityCodeHash(code),
      input.state,
      input.appId,
      input.clientId,
      input.redirectUri,
      input.authority,
      input.codeChallenge,
      claims.email,
      claims.name ?? null,
      claims.org_domain ?? null,
      claims.jti,
      now,
      now + IDENTITY_AUTHORIZATION_CODE_TTL_MS,
      null,
    ],
  });
  void getDbExec()
    .execute({
      sql: "DELETE FROM identity_sso_authorization_code WHERE expires_at < ?",
      args: [now],
    })
    .catch(() => {});
  return code;
}

export async function consumeIdentityAuthorizationCode(input: {
  code: string;
  state: string;
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  codeVerifier: string;
}): Promise<ConsumedIdentityAuthorizationCode | null> {
  if (
    !CODE.test(input.code) ||
    !isValidSsoState(input.state) ||
    !APP_ID.test(input.appId) ||
    !CLIENT_ID.test(input.clientId) ||
    !CODE_VERIFIER.test(input.codeVerifier)
  ) {
    return null;
  }
  const challenge = createCodeChallenge(input.codeVerifier);
  if (!challenge) return null;
  await ensureCodeTable();
  const codeHash = identityCodeHash(input.code);
  const { rows } = await getDbExec().execute({
    sql:
      "SELECT state, app_id, client_id, redirect_uri, authority, code_challenge, email, name, org_domain, jti, expires_at, consumed_at " +
      "FROM identity_sso_authorization_code WHERE code_hash = ?",
    args: [codeHash],
  });
  if (rows.length !== 1) return null;
  const row: any = rows[0];
  const expiresAt = Number(row.expires_at ?? row.expiresAt);
  if (
    row.consumed_at != null ||
    !Number.isFinite(expiresAt) ||
    expiresAt < Date.now() ||
    row.state !== input.state ||
    row.app_id !== input.appId ||
    row.client_id !== input.clientId ||
    row.redirect_uri !== input.redirectUri ||
    row.authority !== input.authority ||
    !safeEqual(String(row.code_challenge ?? ""), challenge)
  ) {
    return null;
  }
  const result = await getDbExec().execute({
    sql:
      "UPDATE identity_sso_authorization_code SET consumed_at = ? " +
      "WHERE code_hash = ? AND consumed_at IS NULL",
    args: [Date.now(), codeHash],
  });
  if (affectedRows(result) !== 1) return null;
  if (typeof row.email !== "string" || !row.email.includes("@")) return null;
  if (typeof row.jti !== "string" || !row.jti) return null;
  return {
    email: row.email,
    ...(typeof row.name === "string" && row.name ? { name: row.name } : {}),
    ...(typeof row.org_domain === "string" && row.org_domain
      ? { orgDomain: row.org_domain }
      : {}),
    jti: row.jti,
  };
}
