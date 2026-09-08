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

import {
  getDbExec,
  isProductionServerlessFunctionRuntime,
} from "@agent-native/core/db";
import {
  CANONICAL_WORKSPACE_SSO_APP_ORIGINS,
  parseWorkspaceSsoAppRegistrations,
} from "@agent-native/dispatch/shared/workspace-sso";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const APP_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const IDENTITY_SCOPE = "identity";
export const IDENTITY_TOKEN_TTL_SECONDS = 120;
export const IDENTITY_TOKEN_TTL = "2m";
export const IDENTITY_AUTHORIZATION_CODE_TTL_MS =
  IDENTITY_TOKEN_TTL_SECONDS * 1_000;
export const IDENTITY_SSO_CALLBACK_PATH = "/_agent-native/identity/callback";
export const IDENTITY_SSO_TOKEN_PATH = "/_agent-native/identity/token";
export const IDENTITY_SSO_BOOTSTRAP_PATH = "/_agent-native/identity/bootstrap";
export const IDENTITY_SSO_BOOTSTRAP_ACTIVATE_PATH = `${IDENTITY_SSO_BOOTSTRAP_PATH}/activate`;
export const IDENTITY_SSO_BOOTSTRAP_TTL_MS = 2 * 60_000;
export const IDENTITY_SSO_BOOTSTRAP_SCOPE = "identity-bootstrap";

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
  ...CANONICAL_WORKSPACE_SSO_APP_ORIGINS,
} as const;

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.values(
  CANONICAL_IDENTITY_SSO_APP_ORIGINS,
);

export interface IdentitySsoAppRegistration {
  appId: string;
  clientId: string;
  origin: string;
  callbackPath: typeof IDENTITY_SSO_CALLBACK_PATH;
  federationSecret?: string;
}

function federationSecretEnvKey(appId: string): string {
  return `AGENT_NATIVE_IDENTITY_FEDERATION_SECRET_${appId
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase()}`;
}

function attachFederationSecret(
  registration: IdentitySsoAppRegistration,
  env: NodeJS.ProcessEnv,
): IdentitySsoAppRegistration {
  const federationSecret =
    env[federationSecretEnvKey(registration.appId)]?.trim();
  return federationSecret
    ? { ...registration, federationSecret }
    : registration;
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

function parseCustomRegistrations(
  env: NodeJS.ProcessEnv,
): IdentitySsoAppRegistration[] {
  return parseWorkspaceSsoAppRegistrations(
    env.IDENTITY_SSO_APP_REGISTRY_JSON,
  ).map((registration) => ({
    appId: registration.appId,
    clientId: registration.clientId,
    origin: registration.origin,
    callbackPath: IDENTITY_SSO_CALLBACK_PATH,
  }));
}

/**
 * Return the exact configured registry. Invalid custom entries are ignored;
 * they never broaden the canonical registry. A deployment can therefore roll
 * back custom registration by removing the env without changing code or data.
 */
export function getIdentitySsoAppRegistry(
  env: NodeJS.ProcessEnv = process.env,
): IdentitySsoAppRegistration[] {
  return [...canonicalRegistrations(), ...parseCustomRegistrations(env)].map(
    (registration) => attachFederationSecret(registration, env),
  );
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
  org_id?: string;
  org_name?: string;
  org_role?: "owner" | "admin" | "member";
  scope: typeof IDENTITY_SCOPE;
  jti: string;
}

export function buildIdentityClaims(input: {
  email: string;
  name?: string | null;
  orgDomain?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  orgRole?: "owner" | "admin" | "member" | null;
}): IdentityClaims {
  const claims: IdentityClaims = {
    sub: input.email,
    email: input.email,
    scope: IDENTITY_SCOPE,
    jti: randomBytes(16).toString("base64url"),
  };
  if (input.name?.trim()) claims.name = input.name.trim();
  if (input.orgDomain?.trim()) claims.org_domain = input.orgDomain.trim();
  if (input.orgId?.trim() && input.orgName?.trim() && input.orgRole) {
    claims.org_id = input.orgId.trim();
    claims.org_name = input.orgName.trim();
    claims.org_role = input.orgRole;
  }
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
  orgId?: string | null;
  orgName?: string | null;
  orgRole?: "owner" | "admin" | "member" | null;
  bootstrapHandle?: string | null;
  bootstrapAuthProvider?: "google" | null;
}

export interface ConsumedIdentityAuthorizationCode {
  email: string;
  name?: string;
  orgDomain?: string;
  orgId?: string;
  orgName?: string;
  orgRole?: "owner" | "admin" | "member";
  bootstrapHandleHash?: string;
  bootstrapAuthProvider?: "google";
  jti: string;
}

let codeTableInitPromise: Promise<void> | undefined;
let bootstrapTableInitPromise: Promise<void> | undefined;

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
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      consumed_at BIGINT,
      org_id TEXT,
      org_name TEXT,
      org_role TEXT,
      bootstrap_handle_hash TEXT,
      bootstrap_auth_provider TEXT
    )
  `;
}

async function ensureCodeTable(): Promise<void> {
  // The Dispatch release migration owns this table in production serverless
  // deployments. Do not turn a missing release migration into request-time DDL.
  if (isProductionServerlessFunctionRuntime()) return;
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

function buildBootstrapTableSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS identity_sso_bootstrap (
      handle_hash TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      app_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      authority TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      consumed_at BIGINT,
      activation_hash TEXT,
      activation_expires_at BIGINT,
      activated_at BIGINT,
      org_id TEXT,
      auth_provider TEXT,
      browser_binding_hash TEXT
    )
  `;
}

async function ensureBootstrapTable(): Promise<void> {
  if (isProductionServerlessFunctionRuntime()) return;
  if (!bootstrapTableInitPromise) {
    bootstrapTableInitPromise = getDbExec()
      .execute(buildBootstrapTableSql())
      .then(() => undefined)
      .catch((error) => {
        bootstrapTableInitPromise = undefined;
        throw error;
      });
  }
  return bootstrapTableInitPromise;
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
    (input.bootstrapHandle != null && !CODE.test(input.bootstrapHandle)) ||
    (input.bootstrapAuthProvider != null &&
      input.bootstrapAuthProvider !== "google") ||
    !resolveIdentitySsoApp(input.appId, input.clientId, input.redirectUri)
  ) {
    throw new Error("INVALID_IDENTITY_AUTHORIZATION_CODE");
  }
  await ensureCodeTable();
  const code = randomBytes(32).toString("base64url");
  const now = Date.now();
  const claims = buildIdentityClaims(input);
  const bootstrapHandleHash = input.bootstrapHandle
    ? identityCodeHash(input.bootstrapHandle)
    : null;
  await getDbExec().execute({
    sql:
      "INSERT INTO identity_sso_authorization_code " +
      "(code_hash, state, app_id, client_id, redirect_uri, authority, code_challenge, email, name, org_domain, jti, created_at, expires_at, consumed_at, org_id, org_name, org_role, bootstrap_handle_hash, bootstrap_auth_provider) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
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
      claims.org_id ?? null,
      claims.org_name ?? null,
      claims.org_role ?? null,
      bootstrapHandleHash,
      input.bootstrapAuthProvider ?? null,
    ],
  });
  void getDbExec()
    .execute({
      sql: "DELETE FROM identity_sso_authorization_code WHERE expires_at < $1",
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
      "SELECT state, app_id, client_id, redirect_uri, authority, code_challenge, email, name, org_domain, jti, expires_at, consumed_at, org_id, org_name, org_role, bootstrap_handle_hash, bootstrap_auth_provider " +
      "FROM identity_sso_authorization_code WHERE code_hash = $1",
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
      "UPDATE identity_sso_authorization_code SET consumed_at = $1 " +
      "WHERE code_hash = $2 AND consumed_at IS NULL",
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
    ...(typeof row.org_id === "string" && row.org_id
      ? { orgId: row.org_id }
      : {}),
    ...(typeof row.org_name === "string" && row.org_name
      ? { orgName: row.org_name }
      : {}),
    ...(row.org_role === "owner" ||
    row.org_role === "admin" ||
    row.org_role === "member"
      ? { orgRole: row.org_role }
      : {}),
    ...(typeof row.bootstrap_handle_hash === "string" &&
    row.bootstrap_handle_hash
      ? { bootstrapHandleHash: row.bootstrap_handle_hash }
      : {}),
    ...(row.bootstrap_auth_provider === "google"
      ? { bootstrapAuthProvider: "google" as const }
      : {}),
    jti: row.jti,
  };
}

export interface CreateIdentityBootstrapHandleInput {
  state: string;
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  codeChallenge: string;
  email: string;
  name?: string | null;
  orgId?: string | null;
  authProvider?: "google" | null;
}

export interface ConsumedIdentityBootstrapHandle {
  state: string;
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  codeChallenge: string;
  email: string;
  name?: string;
  orgId?: string;
  authProvider?: "google";
}

export async function createIdentityBootstrapHandle(
  input: CreateIdentityBootstrapHandleInput,
): Promise<string> {
  if (
    !isValidSsoState(input.state) ||
    !APP_ID.test(input.appId) ||
    !CLIENT_ID.test(input.clientId) ||
    !CODE_CHALLENGE.test(input.codeChallenge) ||
    !input.email.includes("@") ||
    (input.orgId != null && !ORG_ID_PATTERN.test(input.orgId)) ||
    (input.authProvider != null && input.authProvider !== "google") ||
    !resolveIdentitySsoApp(input.appId, input.clientId, input.redirectUri)
  ) {
    throw new Error("INVALID_IDENTITY_BOOTSTRAP_HANDLE");
  }
  await ensureBootstrapTable();
  const handle = randomBytes(32).toString("base64url");
  const now = Date.now();
  await getDbExec().execute({
    sql:
      "INSERT INTO identity_sso_bootstrap " +
      "(handle_hash, state, app_id, client_id, redirect_uri, authority, code_challenge, email, name, created_at, expires_at, consumed_at, org_id, auth_provider) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      identityCodeHash(handle),
      input.state,
      input.appId,
      input.clientId,
      input.redirectUri,
      input.authority,
      input.codeChallenge,
      input.email.trim().toLowerCase(),
      input.name?.trim() || null,
      now,
      now + IDENTITY_SSO_BOOTSTRAP_TTL_MS,
      null,
      input.orgId?.trim() || null,
      input.authProvider ?? null,
    ],
  });
  void getDbExec()
    .execute({
      sql: "DELETE FROM identity_sso_bootstrap WHERE expires_at < ?",
      args: [now],
    })
    .catch(() => {});
  return handle;
}

export async function consumeIdentityBootstrapHandle(
  handle: string,
): Promise<ConsumedIdentityBootstrapHandle | null> {
  if (!CODE.test(handle)) return null;
  await ensureBootstrapTable();
  const handleHash = identityCodeHash(handle);
  const { rows } = await getDbExec().execute({
    sql:
      "SELECT state, app_id, client_id, redirect_uri, authority, code_challenge, email, name, expires_at, consumed_at, org_id, auth_provider " +
      "FROM identity_sso_bootstrap WHERE handle_hash = ?",
    args: [handleHash],
  });
  if (rows.length !== 1) return null;
  const row: any = rows[0];
  const expiresAt = Number(row.expires_at ?? row.expiresAt);
  if (
    row.consumed_at != null ||
    !Number.isFinite(expiresAt) ||
    expiresAt < Date.now() ||
    !isValidSsoState(row.state) ||
    typeof row.app_id !== "string" ||
    typeof row.client_id !== "string" ||
    typeof row.redirect_uri !== "string" ||
    typeof row.authority !== "string" ||
    typeof row.code_challenge !== "string" ||
    typeof row.email !== "string" ||
    !row.email.includes("@")
  ) {
    return null;
  }
  const result = await getDbExec().execute({
    sql:
      "UPDATE identity_sso_bootstrap SET consumed_at = ? " +
      "WHERE handle_hash = ? AND consumed_at IS NULL",
    args: [Date.now(), handleHash],
  });
  if (affectedRows(result) !== 1) return null;
  return {
    state: row.state,
    appId: row.app_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    authority: row.authority,
    codeChallenge: row.code_challenge,
    email: row.email.trim().toLowerCase(),
    ...(typeof row.name === "string" && row.name.trim()
      ? { name: row.name.trim() }
      : {}),
    ...(typeof row.org_id === "string" && row.org_id
      ? { orgId: row.org_id }
      : {}),
    ...(row.auth_provider === "google"
      ? { authProvider: "google" as const }
      : {}),
  };
}

export async function bindIdentityBootstrapHandle(
  handle: string,
  browserBinding: string,
): Promise<boolean> {
  if (!CODE.test(handle) || !CODE.test(browserBinding)) return false;
  await ensureBootstrapTable();
  const result = await getDbExec().execute({
    sql:
      "UPDATE identity_sso_bootstrap SET browser_binding_hash = ? " +
      "WHERE handle_hash = ? AND consumed_at IS NOT NULL AND browser_binding_hash IS NULL",
    args: [identityCodeHash(browserBinding), identityCodeHash(handle)],
  });
  return affectedRows(result) === 1;
}

export async function releaseIdentityBootstrapHandle(
  handle: string,
): Promise<void> {
  if (!CODE.test(handle)) return;
  await ensureBootstrapTable();
  await getDbExec().execute({
    sql:
      "UPDATE identity_sso_bootstrap SET consumed_at = NULL, browser_binding_hash = NULL " +
      "WHERE handle_hash = ? AND consumed_at IS NOT NULL",
    args: [identityCodeHash(handle)],
  });
}

export async function createIdentityBootstrapActivation(
  bootstrapHandleHash: string,
): Promise<string | null> {
  if (!CODE.test(bootstrapHandleHash)) return null;
  await ensureBootstrapTable();
  const activation = randomBytes(32).toString("base64url");
  const now = Date.now();
  const result = await getDbExec().execute({
    sql:
      "UPDATE identity_sso_bootstrap SET activation_hash = ?, activation_expires_at = ?, activated_at = NULL " +
      "WHERE handle_hash = ? AND consumed_at IS NOT NULL AND activation_hash IS NULL AND activated_at IS NULL AND browser_binding_hash IS NOT NULL",
    args: [
      identityCodeHash(activation),
      now + IDENTITY_SSO_BOOTSTRAP_TTL_MS,
      bootstrapHandleHash,
    ],
  });
  return affectedRows(result) === 1 ? activation : null;
}

export interface ConsumedIdentityBootstrapActivation {
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
  email: string;
  name?: string;
  orgId?: string;
  authProvider?: "google";
}

export async function consumeIdentityBootstrapActivation(
  activation: string,
  browserBinding: string,
): Promise<ConsumedIdentityBootstrapActivation | null> {
  if (!CODE.test(activation) || !CODE.test(browserBinding)) return null;
  await ensureBootstrapTable();
  const activationHash = identityCodeHash(activation);
  const browserBindingHash = identityCodeHash(browserBinding);
  const { rows } = await getDbExec().execute({
    sql:
      "SELECT app_id, client_id, redirect_uri, authority, email, name, activation_expires_at, activated_at, org_id, auth_provider, browser_binding_hash " +
      "FROM identity_sso_bootstrap WHERE activation_hash = ?",
    args: [activationHash],
  });
  if (rows.length !== 1) return null;
  const row: any = rows[0];
  const expiresAt = Number(
    row.activation_expires_at ?? row.activationExpiresAt,
  );
  if (
    row.activated_at != null ||
    !safeEqual(String(row.browser_binding_hash ?? ""), browserBindingHash) ||
    !Number.isFinite(expiresAt) ||
    expiresAt < Date.now() ||
    typeof row.app_id !== "string" ||
    typeof row.client_id !== "string" ||
    typeof row.redirect_uri !== "string" ||
    typeof row.authority !== "string" ||
    typeof row.email !== "string" ||
    !row.email.includes("@")
  ) {
    return null;
  }
  const result = await getDbExec().execute({
    sql:
      "UPDATE identity_sso_bootstrap SET activated_at = ? " +
      "WHERE activation_hash = ? AND activated_at IS NULL AND browser_binding_hash = ?",
    args: [Date.now(), activationHash, browserBindingHash],
  });
  if (affectedRows(result) !== 1) return null;
  return {
    appId: row.app_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    authority: row.authority,
    email: row.email.trim().toLowerCase(),
    ...(typeof row.name === "string" && row.name.trim()
      ? { name: row.name.trim() }
      : {}),
    ...(typeof row.org_id === "string" && row.org_id
      ? { orgId: row.org_id }
      : {}),
    ...(row.auth_provider === "google"
      ? { authProvider: "google" as const }
      : {}),
  };
}

export async function releaseIdentityBootstrapActivation(
  activation: string,
): Promise<void> {
  if (!CODE.test(activation)) return;
  await ensureBootstrapTable();
  await getDbExec().execute({
    sql:
      "UPDATE identity_sso_bootstrap SET activated_at = NULL " +
      "WHERE activation_hash = ? AND activated_at IS NOT NULL",
    args: [identityCodeHash(activation)],
  });
}
