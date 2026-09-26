/**
 * Credential provider abstraction.
 *
 * Every feature that needs an external credential (Anthropic API key,
 * Google OAuth tokens, OpenAI key, Slack bot token, etc.) should go through
 * one of the resolve*() helpers here instead of reading `process.env`
 * directly. That way the same feature can work in three modes:
 *
 *   1. User set their own key in .env              → use it directly
 *   2. User connected Builder via OAuth            → authorize managed Builder requests
 *   3. Neither                                      → throw FeatureNotConfigured
 *
 * Templates catch FeatureNotConfigured and show a "Connect Builder (1 click) /
 * set up your own key (guide)" card.
 *
 * Today these helpers are used by the Builder-hosted LLM gateway, and the
 * shape is meant to grow to cover future managed credential integrations
 * (e.g. additional Builder-hosted services) without rewrites.
 */

import { createHash } from "node:crypto";

import {
  CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE,
  GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
} from "../agent/engine/credential-errors.js";
import { getAppConfig } from "../app-config/index.js";
import {
  getDbExec,
  isLocalDatabase,
  isTransientDatabaseError,
} from "../db/client.js";
import { getOrgSetting } from "../settings/org-settings.js";
import {
  BuilderOAuthScopeError,
  BUILDER_OAUTH_SCOPE,
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
} from "./builder-oauth.js";
import { isHostedWorkspaceRuntime } from "./deployment-protection.js";
export {
  isHostedWorkspaceRuntime,
  resolveVercelDeploymentProtectionHeaders,
} from "./deployment-protection.js";
import {
  getRequestContext,
  getRequestUserEmail,
  getRequestOrgId,
} from "./request-context.js";

const DISPATCH_VAULT_ACCESS_SETTINGS_KEY = "dispatch-vault-access-settings";

type DesignatedVaultFallbackAccess =
  | { status: "allowed" }
  | {
      status: "denied";
      reason: "missing-app-id" | "no-active-grant";
    }
  | { status: "unavailable"; cause: unknown };

async function canReadDesignatedVaultFallback(
  vaultOrgId: string,
  credentialKey: string,
): Promise<DesignatedVaultFallbackAccess> {
  const access = await getOrgSetting(
    vaultOrgId,
    DISPATCH_VAULT_ACCESS_SETTINGS_KEY,
  );
  if (access?.mode !== "manual") return { status: "allowed" };

  const app = getAppConfig().app;
  const appId = app.workspaceId ?? app.id ?? app.name;
  if (!appId) {
    return { status: "denied", reason: "missing-app-id" };
  }

  try {
    const result = await getDbExec().execute({
      sql: `SELECT 1
        FROM vault_grants AS grants
        INNER JOIN vault_secrets AS secrets ON secrets.id = grants.secret_id
        WHERE grants.org_id = ?
          AND grants.app_id = ?
          AND grants.status = 'active'
          AND secrets.org_id = grants.org_id
          AND secrets.credential_key = ?
        LIMIT 1`,
      args: [vaultOrgId, appId, credentialKey],
    });
    return result.rows.length > 0
      ? { status: "allowed" }
      : { status: "denied", reason: "no-active-grant" };
  } catch (cause) {
    return { status: "unavailable", cause };
  }
}

/**
 * Decide which `app_secrets` scope a Builder/credential write should use.
 *
 * Org scope ("everyone in this org sees these credentials") wins when the
 * connecting user is an owner or admin of an active org — the write
 * privileges shared infra. A plain member or a user without an active
 * org falls through to per-user scope so a teammate can't silently
 * overwrite the org-shared connection.
 */
export function resolveCredentialWriteScope(
  email: string,
  orgId: string | null | undefined,
  role: string | null | undefined,
): { scope: "user" | "org"; scopeId: string } {
  if (orgId && (role === "owner" || role === "admin")) {
    return { scope: "org", scopeId: orgId };
  }
  return { scope: "user", scopeId: email };
}

export class FeatureNotConfiguredError extends Error {
  readonly requiredCredential: string;
  readonly builderConnectUrl?: string;
  readonly byokDocsUrl?: string;

  constructor(opts: {
    requiredCredential: string;
    message?: string;
    builderConnectUrl?: string;
    byokDocsUrl?: string;
  }) {
    super(
      opts.message ??
        `Feature requires credential "${opts.requiredCredential}". Connect Builder (free tier available) or set your own key.`,
    );
    this.name = "FeatureNotConfiguredError";
    this.requiredCredential = opts.requiredCredential;
    this.builderConnectUrl = opts.builderConnectUrl;
    this.byokDocsUrl = opts.byokDocsUrl;
  }
}

/**
 * The credential store could not be read — which is NOT the same as the
 * credential being absent. Never render this as "not configured": the user has
 * nothing to configure, they have something to retry.
 */
export class CredentialStoreUnavailableError extends Error {
  readonly errorCode = CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE;
  readonly retryable = true;

  constructor(cause?: unknown) {
    super(
      "Could not read your saved connections — the app database did not answer. This is temporary; try again in a moment.",
      { cause },
    );
    this.name = "CredentialStoreUnavailableError";
  }
}

export function assertCredentialStoreReadable(result: {
  lookupFailed: boolean;
  cause?: unknown;
}): void {
  if (result.lookupFailed && isTransientDatabaseError(result.cause)) {
    throw new CredentialStoreUnavailableError(result.cause);
  }
}

/**
 * Deployment-level credential fallback for single-tenant/local operation.
 * Multi-tenant call sites must gate this explicitly before calling.
 */
export function readDeployCredentialEnv(key: string): string | undefined {
  if (
    HOSTED_MODEL_PROVIDER_ENV_KEYS.has(key) &&
    !canUseDeployCredentialFallbackForRequest(key)
  ) {
    return undefined;
  }
  return process.env[key] || undefined;
}

const HOSTED_MODEL_PROVIDER_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "BUILDER_GATEWAY_SPACE_ID",
  "BUILDER_GATEWAY_TOKEN",
  "COHERE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "JEV_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TYPESAFE_API_KEY",
  "VOYAGE_API_KEY",
]);

const APP_PROVIDED_DEPLOY_CREDENTIAL_KEYS = new Set([
  "EMAIL_FROM",
  "EMAIL_INBOUND_WEBHOOK_SECRET",
  "EMAIL_AGENT_ADDRESS",
  "OPENAI_BASE_URL",
  "OLLAMA_BASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NOTION_CLIENT_ID",
  "NOTION_CLIENT_SECRET",
  "SLACK_BOT_TOKEN",
  "RESEND_API_KEY",
  "SENDGRID_API_KEY",
]);

function isAppProvidedDeployCredentialKey(key: string | undefined): boolean {
  return !!key && APP_PROVIDED_DEPLOY_CREDENTIAL_KEYS.has(key);
}

/**
 * Deployment-level credentials are safe as a runtime fallback only in local /
 * single-tenant contexts. In hosted production with a shared database, every
 * signed-in user needs their own user/org/workspace credential for provider
 * keys. Model-provider env keys are never shared with hosted users because
 * they bill the app owner. Other app-provided service credentials configure
 * the deployed app itself, such as email transport and OAuth client
 * credentials whose per-user identity remains in scoped OAuth tokens.
 *
 * @deprecated Use `canUseDeployCredentialFallbackForRequest()` for generic
 * provider secrets. This stricter helper remains for legacy call sites with
 * identity-bearing deploy credentials.
 */
export function isDeployCredentialFallbackAllowed(): boolean {
  if (!isProductionLikeRuntime()) return true;
  return isLocalDatabase();
}

export function canUseDeployCredentialFallbackForRequest(
  key?: string,
): boolean {
  if (getRequestContext()?.isSyntheticTraffic === true) return false;
  if (key && HOSTED_MODEL_PROVIDER_ENV_KEYS.has(key)) {
    if (isHostedWorkspaceRuntime()) return false;
    if (isProductionLikeRuntime() && !isLocalDatabase()) return false;
  }
  const email = getRequestUserEmail();
  if (!email) return true;
  if (isAppProvidedDeployCredentialKey(key)) return true;
  if (isHostedWorkspaceRuntime()) return false;
  if (!isProductionLikeRuntime()) return true;
  return isLocalDatabase();
}

export const BUILDER_GATEWAY_TOKEN_ENV_VAR = "BUILDER_GATEWAY_TOKEN";
export const BUILDER_GATEWAY_SPACE_ID_ENV_VAR = "BUILDER_GATEWAY_SPACE_ID";

const BUILDER_CREDENTIAL_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
  "BUILDER_SUBSCRIPTION",
  "BUILDER_SUBSCRIPTION_LEVEL",
  "BUILDER_SUBSCRIPTION_NAME",
  "BUILDER_IS_ENTERPRISE",
  "BUILDER_IS_FREE_ACCOUNT",
] as const;

function isBuilderCredentialKey(key: string): boolean {
  return (BUILDER_CREDENTIAL_KEYS as readonly string[]).includes(key);
}

export function hasPlatformRuntimeMarker(): boolean {
  return (
    /^(1|true)$/i.test(process.env.NETLIFY ?? "") ||
    /^(1|true)$/i.test(process.env.VERCEL ?? "") ||
    /^(1|true)$/i.test(process.env.CF_PAGES ?? "") ||
    Boolean(
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.FUNCTIONS_WORKER_RUNTIME ||
      process.env.K_SERVICE ||
      process.env.RENDER,
    )
  );
}

export function isProductionLikeRuntime(): boolean {
  return process.env.NODE_ENV === "production" || hasPlatformRuntimeMarker();
}

/**
 * Whether this process is a genuinely self-hosted, single-tenant deployment
 * rather than the hosted multi-tenant workspace runtime — the same bar
 * `canUseDeployCredentialFallbackForRequest` uses to decide whether relaxing
 * a security boundary for "this is the operator's own machine" is safe.
 * `NODE_ENV` alone proves nothing (it travels with a copied `.env`), so a
 * production-shaped runtime still counts as trusted when it is backed by the
 * local embedded database, which has no cross-tenant blast radius.
 *
 * Used to allow a user-supplied Ollama endpoint to target a LAN address
 * instead of only loopback — see `provider-endpoint-validation.ts`.
 */
export function isTrustedSelfHostedRuntime(): boolean {
  if (isHostedWorkspaceRuntime()) return false;
  if (!isProductionLikeRuntime()) return true;
  return isLocalDatabase();
}

function canUseBuilderDeployCredentialFallbackForRequest(): boolean {
  const email = getRequestUserEmail();
  if (!email) return true;

  const isProductionRuntime = isProductionLikeRuntime();
  const localDevOptIn =
    !isProductionRuntime &&
    /^(1|true)$/i.test(process.env.AGENT_NATIVE_LOCAL_BUILDER_ENV ?? "");

  if (isHostedWorkspaceRuntime() && !localDevOptIn) return false;

  return !isProductionRuntime || isLocalDatabase();
}

function shouldTraceCredentialResolve(): boolean {
  return /^(1|true)$/i.test(
    process.env.AGENT_NATIVE_DEBUG_CREDENTIAL_RESOLVE ??
      process.env.DEBUG_CREDENTIAL_RESOLVE ??
      "",
  );
}


type BuilderCredentialSource = "user" | "org" | "workspace" | "env";
interface BuilderResolvedCredentials {
  privateKey: string | null;
  publicKey: string | null;
  userId: string | null;
  orgName: string | null;
  orgKind: string | null;
  subscription: string | null;
  subscriptionLevel: string | null;
  subscriptionName: string | null;
  isEnterprise: boolean | null;
  isFreeAccount: boolean | null;
  source: Exclude<BuilderCredentialSource, "env">;
}

async function isCompleteBuilderConnection(
  creds: BuilderResolvedCredentials,
): Promise<boolean> {
  if (!creds.privateKey || !creds.publicKey) return false;
  const failure = await getBuilderCredentialAuthFailure({
    privateKey: creds.privateKey,
    publicKey: creds.publicKey,
  });
  return !failure;
}

function readOptionalBuilderBoolean(
  value: string | null | undefined,
): boolean | null {
  if (value == null || value === "") return null;
  return /^(1|true)$/i.test(value);
}

function isBuilderAuthToken(value: string | null | undefined): boolean {
  return typeof value === "string" && /^(?:bpk|btk)-/.test(value.trim());
}

async function readBuilderCredentialScope(
  readAppSecrets: typeof import("../secrets/storage.js").readAppSecrets,
  scope: "user" | "org" | "workspace",
  scopeId: string,
): Promise<BuilderResolvedCredentials> {
  const secrets = await readAppSecrets({
    keys: BUILDER_CREDENTIAL_KEYS,
    scope,
    scopeId,
  });
  const value = (key: string): string | null => secrets.get(key)?.value ?? null;
  return {
    privateKey: value("BUILDER_PRIVATE_KEY"),
    publicKey: value("BUILDER_PUBLIC_KEY"),
    userId: value("BUILDER_USER_ID"),
    orgName: value("BUILDER_ORG_NAME"),
    orgKind: value("BUILDER_ORG_KIND"),
    subscription: value("BUILDER_SUBSCRIPTION"),
    subscriptionLevel: value("BUILDER_SUBSCRIPTION_LEVEL"),
    subscriptionName: value("BUILDER_SUBSCRIPTION_NAME"),
    isEnterprise: readOptionalBuilderBoolean(value("BUILDER_IS_ENTERPRISE")),
    isFreeAccount: readOptionalBuilderBoolean(value("BUILDER_IS_FREE_ACCOUNT")),
    source: scope === "workspace" ? "workspace" : scope,
  };
}

async function resolveOrgIdForRequestEmail(
  email: string,
): Promise<{ orgId: string | null; cause?: unknown }> {
  try {
    const { resolveOrgIdForEmail } = await import("../org/context.js");
    return { orgId: await resolveOrgIdForEmail(email) };
  } catch (err) {
    return { orgId: null, cause: err };
  }
}

interface ScopedCredentialResult {
  value: string | null;
  source: "user" | "org" | "workspace" | null;
  cause?: unknown;
  lookupFailed: boolean;
}

const NOT_FOUND: ScopedCredentialResult = {
  value: null,
  source: null,
  lookupFailed: false,
};

async function resolveScopedBuilderCredential(
  key: string,
  identity?: BuilderCredentialLookupIdentity,
): Promise<ScopedCredentialResult> {
  const email =
    identity === undefined ? getRequestUserEmail() : identity.userEmail?.trim();
  if (!email) return NOT_FOUND;

  const traceLookup = shouldTraceCredentialResolve();
  let scopeAttempted = "user";
  let orgLookupCause: unknown;
  try {
    const { readAppSecret } = await import("../secrets/storage.js");

    const userSecret = await readAppSecret({
      key,
      scope: "user",
      scopeId: email,
    });
    if (userSecret) {
      if (traceLookup) {
        console.log(
          `[builder-credential] key=${key} email=${email} scope=user hit=true`,
        );
      }
      return { value: userSecret.value, source: "user", lookupFailed: false };
    }

    let orgId: string | null | undefined =
      identity === undefined ? getRequestOrgId() : identity.orgId?.trim();
    let orgSource: "request" | "email-fallback" | "none" = orgId
      ? "request"
      : "none";
    if (!orgId && !(identity !== undefined && identity.orgId === null)) {
      const resolved = await resolveOrgIdForRequestEmail(email);
      orgLookupCause = resolved.cause;
      orgId = resolved.orgId;
      if (orgId) orgSource = "email-fallback";
    }

    //    silently — the caller never has to know which scope answered.
    if (orgId) {
      scopeAttempted = "org";
      const orgSecret = await readAppSecret({
        key,
        scope: "org",
        scopeId: orgId,
      });
      if (orgSecret) {
        if (traceLookup) {
          console.log(
            `[builder-credential] key=${key} email=${email} orgId=${orgId} orgSource=${orgSource} scope=org hit=true`,
          );
        }
        return { value: orgSecret.value, source: "org", lookupFailed: false };
      }

      scopeAttempted = "workspace";
      const workspaceSecret = await readAppSecret({
        key,
        scope: "workspace",
        scopeId: orgId,
      });
      if (workspaceSecret) {
        if (traceLookup) {
          console.log(
            `[builder-credential] key=${key} email=${email} orgId=${orgId} orgSource=${orgSource} scope=workspace hit=true`,
          );
        }
        return {
          value: workspaceSecret.value,
          source: "workspace",
          lookupFailed: false,
        };
      }
      if (traceLookup) {
        console.log(
          `[builder-credential] key=${key} email=${email} orgId=${orgId} orgSource=${orgSource} miss tried=user,org,workspace`,
        );
      }
    }

    if (orgLookupCause !== undefined) {
      return {
        value: null,
        source: null,
        lookupFailed: true,
        cause: orgLookupCause,
      };
    }

    scopeAttempted = "workspace-solo";
    const soloWorkspaceSecret = await readAppSecret({
      key,
      scope: "workspace",
      scopeId: `solo:${email}`,
    });
    if (soloWorkspaceSecret) {
      if (traceLookup) {
        console.log(
          `[builder-credential] key=${key} email=${email} orgId=${orgId ?? "(none)"} orgSource=${orgSource} scope=workspace-solo hit=true`,
        );
      }
      return {
        value: soloWorkspaceSecret.value,
        source: "workspace",
        lookupFailed: false,
      };
    }
    if (traceLookup) {
      console.log(
        `[builder-credential] key=${key} email=${email} orgId=${orgId ?? "(none)"} orgSource=${orgSource} miss tried=${orgId ? "user,org,workspace,workspace-solo" : "user,workspace-solo"}`,
      );
    }
  } catch (err) {
    if (traceLookup) {
      console.log(
        `[builder-credential] key=${key} email=${email} scope=${scopeAttempted} error=${(err as Error)?.message ?? err}`,
      );
    }
    return { value: null, source: null, lookupFailed: true, cause: err };
  }
  return {
    value: null,
    source: null,
    lookupFailed: orgLookupCause !== undefined,
    cause: orgLookupCause,
  };
}

interface ScopedBuilderCredentialsResult {
  creds: BuilderResolvedCredentials | null;
  cause?: unknown;
  /**
   * True when reading the credential store itself threw (db timeout, etc),
   * as opposed to the store answering cleanly with "no row". Callers must
   * report this as retryable rather than "not configured".
   */
  lookupFailed: boolean;
}

export interface BuilderCredentialLookupIdentity {
  userEmail?: string | null;
  orgId?: string | null;
}

async function resolveScopedBuilderCredentials(
  identity?: BuilderCredentialLookupIdentity,
): Promise<ScopedBuilderCredentialsResult> {
  const email =
    identity === undefined ? getRequestUserEmail() : identity.userEmail?.trim();
  if (!email) return { creds: null, lookupFailed: false };

  const traceLookup = shouldTraceCredentialResolve();
  let scopeAttempted = "user";
  let orgLookupCause: unknown;
  try {
    const { readAppSecrets } = await import("../secrets/storage.js");
    const traceScope = async (
      creds: BuilderResolvedCredentials,
      scopeId: string,
      extra = "",
    ) => {
      if (!traceLookup) return;
      console.log(
        `[builder-credential] scope=${creds.source} scopeId=${scopeId} email=${email}${extra} complete=${await isCompleteBuilderConnection(creds)} private=${Boolean(creds.privateKey)} public=${Boolean(creds.publicKey)}`,
      );
    };

    const userCreds = await readBuilderCredentialScope(
      readAppSecrets,
      "user",
      email,
    );
    await traceScope(userCreds, email);
    if (await isCompleteBuilderConnection(userCreds)) {
      return { creds: userCreds, lookupFailed: false };
    }

    let orgId: string | null | undefined =
      identity === undefined ? getRequestOrgId() : identity.orgId?.trim();
    let orgSource: "request" | "email-fallback" | "none" = orgId
      ? "request"
      : "none";
    if (!orgId && !(identity !== undefined && identity.orgId === null)) {
      const resolved = await resolveOrgIdForRequestEmail(email);
      orgLookupCause = resolved.cause;
      orgId = resolved.orgId;
      if (orgId) orgSource = "email-fallback";
    }

    if (orgId) {
      scopeAttempted = "org";
      const orgCreds = await readBuilderCredentialScope(
        readAppSecrets,
        "org",
        orgId,
      );
      await traceScope(orgCreds, orgId, ` orgSource=${orgSource}`);
      if (await isCompleteBuilderConnection(orgCreds)) {
        return { creds: orgCreds, lookupFailed: false };
      }

      scopeAttempted = "workspace";
      const workspaceCreds = await readBuilderCredentialScope(
        readAppSecrets,
        "workspace",
        orgId,
      );
      await traceScope(workspaceCreds, orgId, ` orgSource=${orgSource}`);
      if (await isCompleteBuilderConnection(workspaceCreds)) {
        return { creds: workspaceCreds, lookupFailed: false };
      }
    }

    if (orgLookupCause !== undefined) {
      return { creds: null, lookupFailed: true, cause: orgLookupCause };
    }

    scopeAttempted = "workspace-solo";
    const soloScopeId = `solo:${email}`;
    const soloCreds = await readBuilderCredentialScope(
      readAppSecrets,
      "workspace",
      soloScopeId,
    );
    await traceScope(
      soloCreds,
      soloScopeId,
      ` orgId=${orgId ?? "(none)"} orgSource=${orgSource}`,
    );
    if (await isCompleteBuilderConnection(soloCreds)) {
      return { creds: soloCreds, lookupFailed: false };
    }
  } catch (err) {
    if (traceLookup) {
      console.log(
        `[builder-credential] email=${email} scope=${scopeAttempted} credentials error=${(err as Error)?.message ?? err}`,
      );
    }
    return { creds: null, lookupFailed: true, cause: err };
  }
  return {
    creds: null,
    lookupFailed: orgLookupCause !== undefined,
    cause: orgLookupCause,
  };
}

/**
 * Resolve a Builder credential for the current request. User/org credentials
 * win; deployment env is only a fallback. This lets local/root .env keys keep
 * a template working while still allowing users to connect their own Builder
 * account from Settings or onboarding.
 */
export async function resolveBuilderCredential(
  key: string,
  identity?: BuilderCredentialLookupIdentity,
): Promise<string | null> {
  const scoped = await resolveScopedBuilderCredential(key, identity);
  if (scoped.value) return scoped.value;
  const envValue = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv(key) ?? null)
    : null;
  if (envValue) {
    assertCredentialStoreReadable(scoped);
    return envValue;
  }
  assertCredentialStoreReadable(scoped);
  return null;
}

export function isBuilderEnvManaged(): boolean {
  return !!process.env.BUILDER_PRIVATE_KEY;
}

export async function resolveBuilderPrivateKey(
  identity?: BuilderCredentialLookupIdentity,
): Promise<string | null> {
  return resolveBuilderCredential("BUILDER_PRIVATE_KEY", identity);
}

export async function resolveBuilderAuthHeader(): Promise<string | null> {
  const key = await resolveBuilderPrivateKey();
  return key ? `Bearer ${key}` : null;
}

export async function resolveHasBuilderPrivateKey(): Promise<boolean> {
  return !!(await resolveBuilderPrivateKey());
}

export async function resolveHasCompleteBuilderConnection(): Promise<boolean> {
  const creds = await resolveBuilderCredentials();
  return !!(creds.privateKey && creds.publicKey);
}

/**
 * Resolve where the effective Builder assistant connection came from. This
 * intentionally requires a complete private+public key pair from one scope so
 * status UIs don't report a mixed user/org credential set as connected.
 */
export async function resolveBuilderCredentialSource(): Promise<BuilderCredentialSource | null> {
  const detailed = await resolveBuilderCredentialsDetailed();
  return detailed.source;
}

export interface BuilderCredentialsDetailed {
  privateKey: string | null;
  publicKey: string | null;
  userId: string | null;
  orgName: string | null;
  orgKind: string | null;
  subscription: string | null;
  subscriptionLevel: string | null;
  subscriptionName: string | null;
  isEnterprise: boolean | null;
  isFreeAccount: boolean | null;
  source: BuilderCredentialSource | null;
  /**
   * True when reading the credential store itself failed (db timeout, etc).
   * Callers must report this as retryable rather than "not configured".
   */
  lookupFailed: boolean;
  cause?: unknown;
}

/**
 * Resolve the Builder assistant credential bundle from one complete scope,
 * plus where it came from and whether the credential-store read itself
 * failed. A partial user row is treated as a miss so the org-shared
 * connection can still power the assistant for teammates.
 *
 * Callers that only need the plain credential bundle (the historical shape)
 * should use `resolveBuilderCredentials()` instead.
 */
export async function resolveBuilderCredentialsDetailed(
  identity?: BuilderCredentialLookupIdentity,
): Promise<BuilderCredentialsDetailed> {
  const {
    creds: scoped,
    lookupFailed,
    cause,
  } = await resolveScopedBuilderCredentials(identity);
  if (scoped) {
    const {
      privateKey,
      publicKey,
      userId,
      orgName,
      orgKind,
      subscription,
      subscriptionLevel,
      subscriptionName,
      isEnterprise,
      isFreeAccount,
      source,
    } = scoped;
    return {
      privateKey,
      publicKey,
      userId,
      orgName,
      orgKind,
      subscription,
      subscriptionLevel,
      subscriptionName,
      isEnterprise,
      isFreeAccount,
      source,
      lookupFailed: false,
    };
  }
  const canUseEnv = canUseBuilderDeployCredentialFallbackForRequest();
  const privateKey = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_PRIVATE_KEY") ?? null)
    : null;
  const publicKey = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_PUBLIC_KEY") ?? null)
    : null;
  const userId = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_USER_ID") ?? null)
    : null;
  const orgName = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_ORG_NAME") ?? null)
    : null;
  const orgKind = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_ORG_KIND") ?? null)
    : null;
  const subscription = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_SUBSCRIPTION") ?? null)
    : null;
  const subscriptionLevel = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_SUBSCRIPTION_LEVEL") ?? null)
    : null;
  const subscriptionName = canUseEnv
    ? (readDeployCredentialEnv("BUILDER_SUBSCRIPTION_NAME") ?? null)
    : null;
  const isEnterprise = canUseEnv
    ? readOptionalBuilderBoolean(
        readDeployCredentialEnv("BUILDER_IS_ENTERPRISE"),
      )
    : null;
  const isFreeAccount = canUseEnv
    ? readOptionalBuilderBoolean(
        readDeployCredentialEnv("BUILDER_IS_FREE_ACCOUNT"),
      )
    : null;
  // credential just because no per-user/org row exists to shadow it.
  const envFailure =
    privateKey && publicKey
      ? await getBuilderCredentialAuthFailure({ privateKey, publicKey })
      : null;
  if (envFailure) {
    return {
      privateKey: null,
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
      source: null,
      lookupFailed,
      cause,
    };
  }
  return {
    privateKey,
    publicKey,
    userId,
    orgName,
    orgKind,
    subscription,
    subscriptionLevel,
    subscriptionName,
    isEnterprise,
    isFreeAccount,
    source: canUseEnv && privateKey ? "env" : null,
    lookupFailed,
    cause,
  };
}

export async function resolveBuilderCredentials(
  identity?: BuilderCredentialLookupIdentity,
): Promise<{
  privateKey: string | null;
  publicKey: string | null;
  userId: string | null;
  orgName: string | null;
  orgKind: string | null;
  subscription: string | null;
  subscriptionLevel: string | null;
  subscriptionName: string | null;
  isEnterprise: boolean | null;
  isFreeAccount: boolean | null;
}> {
  const {
    privateKey,
    publicKey,
    userId,
    orgName,
    orgKind,
    subscription,
    subscriptionLevel,
    subscriptionName,
    isEnterprise,
    isFreeAccount,
  } = await resolveBuilderCredentialsDetailed(identity);
  return {
    privateKey,
    publicKey,
    userId,
    orgName,
    orgKind,
    subscription,
    subscriptionLevel,
    subscriptionName,
    isEnterprise,
    isFreeAccount,
  };
}

export type BuilderGatewayLane = "identity" | "gateway-deploy";

export interface BuilderGatewayCredentialsDetailed extends BuilderCredentialsDetailed {
  lane: BuilderGatewayLane | null;
}

export async function resolveUsableBuilderGatewayDeployCredentials(): Promise<{
  token: string;
  spaceId: string;
} | null> {
  const token = canUseDeployCredentialFallbackForRequest(
    BUILDER_GATEWAY_TOKEN_ENV_VAR,
  )
    ? readDeployCredentialEnv(BUILDER_GATEWAY_TOKEN_ENV_VAR)
    : undefined;
  const spaceId = canUseDeployCredentialFallbackForRequest(
    BUILDER_GATEWAY_SPACE_ID_ENV_VAR,
  )
    ? readDeployCredentialEnv(BUILDER_GATEWAY_SPACE_ID_ENV_VAR)
    : undefined;
  if (!token || !spaceId) return null;
  const failure = await getProviderCredentialAuthFailure({
    key: BUILDER_GATEWAY_TOKEN_ENV_VAR,
    value: token,
  });
  return failure ? null : { token, spaceId };
}

export function isBuilderGatewayDeployConfigured(): boolean {
  return (
    canUseDeployCredentialFallbackForRequest(BUILDER_GATEWAY_TOKEN_ENV_VAR) &&
    Boolean(readDeployCredentialEnv(BUILDER_GATEWAY_TOKEN_ENV_VAR))
  );
}

export function gatewayLaneUnavailableMessage(ownerFacing: string): string {
  return isBuilderGatewayDeployConfigured()
    ? GATEWAY_UNAVAILABLE_VISITOR_MESSAGE
    : ownerFacing;
}

/**
 * Gateway-lane credentials. Fall-through: the request's own Builder connection,
 * then the deployment's credits pair, then the legacy pair.
 *
 * Identity-bearing calls (asset upload, design systems, Admin GraphQL, browser
 * agent) must keep using `resolveBuilderCredentials`: a `['gateway']` token 403s
 * on all of them.
 */
export async function resolveBuilderGatewayCredentialsDetailed(
  identity?: BuilderCredentialLookupIdentity,
): Promise<BuilderGatewayCredentialsDetailed> {
  const scoped = await resolveBuilderCredentialsDetailed(identity);
  if (scoped.source && scoped.source !== "env") {
    return { ...scoped, lane: "identity" };
  }
  if (scoped.privateKey && scoped.publicKey) {
    return { ...scoped, lane: "identity" };
  }
  const gateway = await resolveUsableBuilderGatewayDeployCredentials();
  if (gateway) {
    assertCredentialStoreReadable(scoped);
    return {
      privateKey: gateway.token,
      publicKey: gateway.spaceId,
      userId: null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
      source: "env",
      lookupFailed: scoped.lookupFailed,
      cause: scoped.cause,
      lane: "gateway-deploy",
    };
  }
  return { ...scoped, lane: scoped.source ? "identity" : null };
}

/**
 * @deprecated Use `resolveBuilderGatewayAuth()` instead — it also checks the
 * request owner's Builder OAuth grant, which this key-only shape cannot
 * represent. Kept only so an external caller built against the old export
 * does not break; no code in this repo calls it anymore.
 */
export async function resolveBuilderGatewayCredentials(
  identity?: BuilderCredentialLookupIdentity,
): Promise<{
  privateKey: string | null;
  publicKey: string | null;
  userId: string | null;
  orgName: string | null;
  orgKind: string | null;
  subscription: string | null;
  subscriptionLevel: string | null;
  subscriptionName: string | null;
  isEnterprise: boolean | null;
  isFreeAccount: boolean | null;
}> {
  const {
    privateKey,
    publicKey,
    userId,
    orgName,
    orgKind,
    subscription,
    subscriptionLevel,
    subscriptionName,
    isEnterprise,
    isFreeAccount,
  } = await resolveBuilderGatewayCredentialsDetailed(identity);
  return {
    privateKey,
    publicKey,
    userId,
    orgName,
    orgKind,
    subscription,
    subscriptionLevel,
    subscriptionName,
    isEnterprise,
    isFreeAccount,
  };
}

export interface BuilderGatewayAuth {
  authorization: string;
  spaceId: string | null;
  userId: string | null;
}

export class BuilderCredentialLookupError extends Error {
  override readonly cause: unknown;

  constructor(cause?: unknown) {
    super("Builder credential lookup is temporarily unavailable.");
    this.name = "BuilderCredentialLookupError";
    this.cause = cause;
  }
}

export async function resolveHasBuilderGatewayCredential(): Promise<boolean> {
  return Boolean(await resolveBuilderGatewayAuth());
}

/**
 * Gateway-lane `resolveBuilderAuthHeader`, same fall-through order, with the
 * request owner's Builder OAuth grant checked first. Mirrors
 * `resolveBuilderRequestAuthorization`'s OAuth-before-legacy-key precedence in
 * builder-api-auth.ts, including that helper's rule that OAuth custody wins
 * outright: once a stored grant exists, a broken one (expired, missing scope,
 * needs reconnect) reports "not configured" rather than falling through to a
 * key-based credential that could belong to a different Builder identity.
 */
export async function resolveBuilderGatewayAuth(
  identity?: BuilderCredentialLookupIdentity,
): Promise<BuilderGatewayAuth | null> {
  const ownerEmail =
    identity === undefined ? getRequestUserEmail() : identity.userEmail?.trim();
  const orgId = identity === undefined ? getRequestOrgId() : identity.orgId;
  let hasOAuthSession = false;
  if (ownerEmail) {
    try {
      hasOAuthSession = await hasBuilderOAuthSession(ownerEmail, orgId);
    } catch (error) {
      throw new BuilderCredentialLookupError(error);
    }
  }
  if (ownerEmail && hasOAuthSession) {
    try {
      const session = await getBuilderOAuthSession(
        ownerEmail,
        orgId,
        BUILDER_OAUTH_SCOPE,
      );
      return session
        ? {
            authorization: `Bearer ${session.accessToken}`,
            spaceId: null,
            userId: null,
          }
        : null;
    } catch (error) {
      if (error instanceof BuilderOAuthScopeError) return null;
      throw new BuilderCredentialLookupError(error);
    }
  }
  try {
    const creds = await resolveBuilderGatewayCredentialsDetailed(identity);
    if (creds.lookupFailed) {
      throw new BuilderCredentialLookupError(creds.cause);
    }
    const token = creds.privateKey?.trim();
    const spaceId = creds.publicKey?.trim();
    if (token && spaceId) {
      return {
        authorization: `Bearer ${token}`,
        spaceId,
        userId: creds.userId?.trim() || null,
      };
    }
    // `bpk-` private key alone. A gateway token never reaches this branch — its
    const legacyKey = (await resolveBuilderPrivateKey(identity))?.trim();
    return legacyKey
      ? { authorization: `Bearer ${legacyKey}`, spaceId: null, userId: null }
      : null;
  } catch (error) {
    if (error instanceof CredentialStoreUnavailableError) {
      throw new BuilderCredentialLookupError(error);
    }
    throw error;
  }
}

/**
 * Both auth-failure markers below are fingerprinted on the credential VALUE, so
 * a rotated or corrected credential never matches the old marker and is usable
 * immediately — the TTL is not what unpins it. The TTL covers only the case
 * where the SAME value starts working again: a plan upgrade, a re-enabled
 * gateway, a transient upstream 401.
 *
 * Re-admitting on a flat timer means a credential that is simply wrong is
 * retested on that cadence forever, and each retest is paid for by whichever
 * user's turn happens to land first — they get a 401 while the next lane serves
 * everyone after them. That is the whole shape of the recurring "the saved
 * provider key was rejected" report. Back off per consecutive strike so a dead
 * credential stops costing a turn every quarter hour, while one that genuinely
 * recovers is still retried within the day.
 */
const AUTH_FAILURE_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_FAILURE_MAX_STRIKES = 8;

function authFailureStrikes(row: Record<string, unknown> | null): number {
  const raw = row?.strikes;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1
    ? Math.min(Math.floor(raw), AUTH_FAILURE_MAX_STRIKES)
    : 1;
}

function authFailureTtlMs(
  baseTtlMs: number,
  row: Record<string, unknown> | null,
): number {
  return Math.min(
    baseTtlMs * 2 ** (authFailureStrikes(row) - 1),
    AUTH_FAILURE_MAX_TTL_MS,
  );
}

async function nextAuthFailureStrikes(settingKey: string): Promise<number> {
  const { getSetting } = await import("../settings/store.js");
  const prior = await getSetting(settingKey, { bypassCache: true });
  return Math.min(
    authFailureStrikes(prior) + (prior ? 1 : 0),
    AUTH_FAILURE_MAX_STRIKES,
  );
}

const BUILDER_AUTH_FAILURE_SETTING_PREFIX = "builder-auth-failure:";
export const BUILDER_AUTH_FAILURE_TTL_MS = 15 * 60 * 1000;

export interface BuilderCredentialAuthFailure {
  fingerprint: string;
  message: string;
  status?: number;
  code?: string;
  at: number;
  ownerEmail?: string | null;
  orgId?: string | null;
}

export function builderCredentialFingerprint(
  privateKey?: string | null,
  publicKey?: string | null,
): string | null {
  if (!privateKey || !publicKey) return null;
  return createHash("sha256")
    .update(privateKey)
    .update("\0")
    .update(publicKey)
    .digest("hex")
    .slice(0, 24);
}

function builderAuthFailureSettingKey(fingerprint: string): string {
  return `${BUILDER_AUTH_FAILURE_SETTING_PREFIX}${fingerprint}`;
}

export async function getBuilderCredentialAuthFailure(
  creds: {
    privateKey?: string | null;
    publicKey?: string | null;
  } = {},
): Promise<BuilderCredentialAuthFailure | null> {
  const fingerprint = builderCredentialFingerprint(
    creds.privateKey,
    creds.publicKey,
  );
  if (!fingerprint) return null;
  try {
    const settings = await import("../settings/store.js");
    const settingKey = builderAuthFailureSettingKey(fingerprint);
    const row = await settings.getSetting(settingKey);
    if (!row) return null;
    const at = typeof row.at === "number" ? row.at : Date.now();
    if (Date.now() - at > authFailureTtlMs(BUILDER_AUTH_FAILURE_TTL_MS, row)) {
      return null;
    }
    return {
      fingerprint,
      message:
        typeof row.message === "string" && row.message
          ? row.message
          : "Builder rejected the connected credentials. Reconnect Builder.io (free tier available).",
      status: typeof row.status === "number" ? row.status : undefined,
      code: typeof row.code === "string" ? row.code : undefined,
      at,
      ownerEmail:
        typeof row.ownerEmail === "string" ? row.ownerEmail : undefined,
      orgId: typeof row.orgId === "string" ? row.orgId : undefined,
    };
  } catch {
    return null;
  }
}

export async function recordBuilderCredentialAuthFailure(details?: {
  status?: number;
  code?: string;
  message?: string;
}): Promise<void> {
  try {
    const creds = await resolveBuilderCredentials();
    const fingerprint = builderCredentialFingerprint(
      creds.privateKey,
      creds.publicKey,
    );
    if (!fingerprint) return;
    const { putSetting } = await import("../settings/store.js");
    const settingKey = builderAuthFailureSettingKey(fingerprint);
    const strikes = await nextAuthFailureStrikes(settingKey);
    await putSetting(settingKey, {
      fingerprint,
      message:
        details?.message ||
        "Builder rejected the connected credentials. Reconnect Builder.io (free tier available).",
      ...(typeof details?.status === "number" && { status: details.status }),
      ...(details?.code && { code: details.code }),
      strikes,
      at: Date.now(),
      ownerEmail: getRequestUserEmail() ?? null,
      orgId: getRequestOrgId() ?? null,
    });
  } catch {
    // Best-effort marker only; the chat error is still returned to the user.
  }
}

export async function clearBuilderCredentialAuthFailure(creds: {
  privateKey?: string | null;
  publicKey?: string | null;
}): Promise<void> {
  const fingerprint = builderCredentialFingerprint(
    creds.privateKey,
    creds.publicKey,
  );
  if (!fingerprint) return;
  try {
    const { deleteSetting } = await import("../settings/store.js");
    await deleteSetting(builderAuthFailureSettingKey(fingerprint));
  } catch {
    // A stale failure marker should not block writing fresh credentials.
  }
}

const PROVIDER_AUTH_FAILURE_SETTING_PREFIX = "provider-auth-failure:";
export const PROVIDER_AUTH_FAILURE_TTL_MS = 15 * 60 * 1000;

export interface ProviderCredentialAuthFailure {
  fingerprint: string;
  key: string;
  message: string;
  status?: number;
  code?: string;
  at: number;
  ownerEmail?: string | null;
  orgId?: string | null;
}

export function providerCredentialFingerprint(
  key?: string | null,
  value?: string | null,
): string | null {
  const normalizedKey = key?.trim().toUpperCase();
  const normalizedValue = value?.trim();
  if (!normalizedKey || !normalizedValue) return null;
  return createHash("sha256")
    .update(normalizedKey)
    .update("\0")
    .update(normalizedValue)
    .digest("hex")
    .slice(0, 24);
}

function providerAuthFailureSettingKey(fingerprint: string): string {
  return `${PROVIDER_AUTH_FAILURE_SETTING_PREFIX}${fingerprint}`;
}

export async function getProviderCredentialAuthFailure(opts: {
  key?: string | null;
  value?: string | null;
}): Promise<ProviderCredentialAuthFailure | null> {
  const key = opts.key?.trim().toUpperCase() ?? "";
  const fingerprint = providerCredentialFingerprint(key, opts.value);
  if (!fingerprint) return null;
  try {
    const settings = await import("../settings/store.js");
    const settingKey = providerAuthFailureSettingKey(fingerprint);
    const row = await settings.getSetting(settingKey);
    if (!row) return null;
    if (row.fingerprint !== fingerprint) return null;
    const at = typeof row.at === "number" ? row.at : Date.now();
    if (Date.now() - at > authFailureTtlMs(PROVIDER_AUTH_FAILURE_TTL_MS, row)) {
      return null;
    }
    return {
      fingerprint,
      key:
        typeof row.key === "string" && row.key
          ? row.key
          : key || "UNKNOWN_PROVIDER_KEY",
      message:
        typeof row.message === "string" && row.message
          ? row.message
          : "The model provider rejected the saved API key.",
      status: typeof row.status === "number" ? row.status : undefined,
      code: typeof row.code === "string" ? row.code : undefined,
      at,
      ownerEmail:
        typeof row.ownerEmail === "string" ? row.ownerEmail : undefined,
      orgId: typeof row.orgId === "string" ? row.orgId : undefined,
    };
  } catch {
    return null;
  }
}

export async function recordProviderCredentialAuthFailure(opts: {
  key?: string | null;
  value?: string | null;
  status?: number;
  code?: string;
  message?: string;
}): Promise<void> {
  try {
    const key = opts.key?.trim().toUpperCase() ?? "";
    const value = opts.value?.trim();
    const fingerprint = providerCredentialFingerprint(key, value);
    if (!fingerprint) return;
    const { putSetting } = await import("../settings/store.js");
    const settingKey = providerAuthFailureSettingKey(fingerprint);
    const strikes = await nextAuthFailureStrikes(settingKey);
    await putSetting(settingKey, {
      fingerprint,
      key,
      message: opts.message || "The model provider rejected the saved API key.",
      ...(typeof opts.status === "number" && { status: opts.status }),
      ...(opts.code && { code: opts.code }),
      strikes,
      at: Date.now(),
      ownerEmail: getRequestUserEmail() ?? null,
      orgId: getRequestOrgId() ?? null,
    });
  } catch {
    // Best-effort marker only; the chat error is still returned to the user.
  }
}

export async function clearProviderCredentialAuthFailure(opts: {
  key?: string | null;
  value?: string | null;
}): Promise<void> {
  const fingerprint = providerCredentialFingerprint(opts.key, opts.value);
  if (!fingerprint) return;
  try {
    const { deleteSetting } = await import("../settings/store.js");
    await deleteSetting(providerAuthFailureSettingKey(fingerprint));
  } catch {
    // A stale failure marker should not block writing or using fresh keys.
  }
}

/**
 * `builderCredentialFingerprint` needs both legacy keys, so on a credits site the
 * legacy marker is a no-op and a rejected token would be resent forever. The
 * gateway lane fingerprints its single token through the provider marker.
 */
export async function recordBuilderGatewayAuthFailure(details?: {
  status?: number;
  code?: string;
  message?: string;
}): Promise<void> {
  try {
    const creds = await resolveBuilderGatewayCredentialsDetailed();
    if (creds.lane === "gateway-deploy" && creds.privateKey) {
      await recordProviderCredentialAuthFailure({
        key: BUILDER_GATEWAY_TOKEN_ENV_VAR,
        value: creds.privateKey,
        ...details,
      });
      return;
    }
  } catch {
    return;
  }
  await recordBuilderCredentialAuthFailure(details);
}

export async function clearBuilderGatewayAuthFailure(creds: {
  privateKey?: string | null;
  publicKey?: string | null;
}): Promise<void> {
  await clearBuilderCredentialAuthFailure(creds);
  await clearProviderCredentialAuthFailure({
    key: BUILDER_GATEWAY_TOKEN_ENV_VAR,
    value: creds.privateKey,
  });
}

export async function writeBuilderCredentials(
  email: string,
  creds: {
    privateKey: string;
    publicKey: string;
    userId?: string | null;
    orgName?: string | null;
    orgKind?: string | null;
    subscription?: string | null;
    subscriptionLevel?: string | null;
    subscriptionName?: string | null;
    isEnterprise?: boolean | null;
    isFreeAccount?: boolean | null;
  },
  options?: { orgId?: string | null; role?: string | null },
): Promise<{ scope: "user" | "org"; scopeId: string }> {
  const privateKey = creds.privateKey.trim();
  const publicKey = creds.publicKey.trim();
  if (!isBuilderAuthToken(privateKey)) {
    throw new Error(
      "Builder returned an unsupported credential (expected a bpk- private key or btk- personal access token). Restart the Builder connect flow and choose a space that can issue a usable credential.",
    );
  }
  if (!publicKey) {
    throw new Error(
      "Builder did not return a public API key. Restart the Builder connect flow.",
    );
  }

  const { writeAppSecret, deleteAppSecret } =
    await import("../secrets/storage.js");
  const target = resolveCredentialWriteScope(
    email,
    options?.orgId ?? null,
    options?.role ?? null,
  );

  const cleanups: Array<Promise<unknown>> = BUILDER_CREDENTIAL_KEYS.map((key) =>
    deleteAppSecret({
      key,
      scope: target.scope,
      scopeId: target.scopeId,
    }).catch(() => {}),
  );
  if (target.scope === "org") {
    for (const key of BUILDER_CREDENTIAL_KEYS) {
      cleanups.push(
        deleteAppSecret({ key, scope: "user", scopeId: email }).catch(() => {}),
      );
    }
  }
  await Promise.all(cleanups);

  const entries: Array<{ key: string; value: string }> = [
    { key: "BUILDER_PRIVATE_KEY", value: privateKey },
    { key: "BUILDER_PUBLIC_KEY", value: publicKey },
  ];
  if (creds.userId) {
    entries.push({ key: "BUILDER_USER_ID", value: creds.userId });
  }
  if (creds.orgName) {
    entries.push({ key: "BUILDER_ORG_NAME", value: creds.orgName });
  }
  if (creds.orgKind) {
    entries.push({ key: "BUILDER_ORG_KIND", value: creds.orgKind });
  }
  if (creds.subscription) {
    entries.push({ key: "BUILDER_SUBSCRIPTION", value: creds.subscription });
  }
  if (creds.subscriptionLevel) {
    entries.push({
      key: "BUILDER_SUBSCRIPTION_LEVEL",
      value: creds.subscriptionLevel,
    });
  }
  if (creds.subscriptionName) {
    entries.push({
      key: "BUILDER_SUBSCRIPTION_NAME",
      value: creds.subscriptionName,
    });
  }
  if (typeof creds.isEnterprise === "boolean") {
    entries.push({
      key: "BUILDER_IS_ENTERPRISE",
      value: String(creds.isEnterprise),
    });
  }
  if (typeof creds.isFreeAccount === "boolean") {
    entries.push({
      key: "BUILDER_IS_FREE_ACCOUNT",
      value: String(creds.isFreeAccount),
    });
  }
  await Promise.all(
    entries.map(({ key, value }) =>
      writeAppSecret({
        key,
        value,
        scope: target.scope,
        scopeId: target.scopeId,
      }),
    ),
  );
  await clearBuilderCredentialAuthFailure({
    privateKey,
    publicKey,
  });
  return target;
}

export async function deleteBuilderCredentials(
  email: string,
  options?: { orgId?: string | null; role?: string | null },
): Promise<{ scope: "user" | "org"; scopeId: string }> {
  const { deleteAppSecret } = await import("../secrets/storage.js");
  const target = resolveCredentialWriteScope(
    email,
    options?.orgId ?? null,
    options?.role ?? null,
  );
  await Promise.all(
    BUILDER_CREDENTIAL_KEYS.map((key) =>
      deleteAppSecret({
        key,
        scope: target.scope,
        scopeId: target.scopeId,
      }),
    ),
  );
  return target;
}

// contexts where there's no user to scope by. Hosted requests never use a

/**
 * Warm this request's secret memo for many keys with one read per scope.
 *
 * `resolveSecret` walks four scopes per key, so a status endpoint asking about
 * a dozen keys costs ~50 round trips against a remote database. Reading each
 * scope once for the whole key set collapses that to four, and the subsequent
 * `resolveSecret` calls answer from the per-request memo — same precedence,
 * same identity scoping, no new cache to invalidate.
 *
 * Best-effort on purpose: `readAppSecrets` only memoizes keys a statement
 * actually covered, so a failure here leaves each key's own lookup to run and
 * report the failure. It must never turn an unreadable store into "not set".
 */
export async function prefetchSecrets(keys: readonly string[]): Promise<void> {
  const email = getRequestUserEmail();
  if (!email || keys.length === 0) return;
  const { readAppSecrets } = await import("../secrets/storage.js");
  const syntheticTraffic = getRequestContext()?.isSyntheticTraffic === true;
  const orgId = syntheticTraffic
    ? undefined
    : getRequestOrgId() || (await resolveOrgIdForRequestEmail(email)).orgId;
  const scopes: Array<{
    scope: "user" | "org" | "workspace";
    scopeId: string;
  }> = [{ scope: "user", scopeId: email }];
  if (orgId && !syntheticTraffic) {
    scopes.push(
      { scope: "org", scopeId: orgId },
      { scope: "workspace", scopeId: orgId },
    );
  }
  if (!syntheticTraffic) {
    scopes.push({ scope: "workspace", scopeId: `solo:${email}` });
  }
  await Promise.all(
    scopes.map((s) => readAppSecrets({ keys, ...s }).catch(() => undefined)),
  );
}

/**
 * Resolve a request-scoped secret. Reads from `app_secrets` first (current
 * user override, active org, workspace row for that org, the solo workspace
 * row, then the explicitly designated workspace vault organization); falls
 * back to `process.env` only when the deploy fallback policy allows it.
 *
 * Resolving several keys in one request? Call `prefetchSecrets` first.
 */
export async function resolveSecret(key: string): Promise<string | null> {
  const resolved = await resolveSecretDetailed(key);
  if (resolved.value) return resolved.value;
  assertCredentialStoreReadable(resolved);
  return null;
}

type SecretPairKeys = readonly [string, string];
type ResolveSecretPairOptions = {
  allowUserScope?: boolean;
  preferWorkspaceScope?: boolean;
};

export async function resolveSecretPairs(
  keyPairs: ReadonlyArray<SecretPairKeys>,
  options?: ResolveSecretPairOptions,
): Promise<[string, string] | null> {
  if (keyPairs.length === 0) return null;

  const allowUserScope = options?.allowUserScope ?? true;
  const preferWorkspaceScope = options?.preferWorkspaceScope ?? false;
  const readPair = async (
    keys: SecretPairKeys,
    scope: "user" | "org" | "workspace",
    scopeId: string,
  ): Promise<[string, string] | null> => {
    const { readAppSecrets } = await import("../secrets/storage.js");
    const secrets = await readAppSecrets({ keys, scope, scopeId });
    const [firstKey, secondKey] = keys;
    const first = secrets.get(firstKey)?.value;
    const second = secrets.get(secondKey)?.value;
    return first && second ? [first, second] : null;
  };
  const readPairs = async (
    scope: "user" | "org" | "workspace",
    scopeId: string,
  ): Promise<[string, string] | null> => {
    for (const keys of keyPairs) {
      const pair = await readPair(keys, scope, scopeId);
      if (pair) return pair;
    }
    return null;
  };
  const readEnvironmentPairs = (): [string, string] | null => {
    for (const [firstKey, secondKey] of keyPairs) {
      if (
        !canUseDeployCredentialFallbackForRequest(firstKey) ||
        !canUseDeployCredentialFallbackForRequest(secondKey)
      ) {
        continue;
      }
      const first = process.env[firstKey];
      const second = process.env[secondKey];
      if (first && second) return [first, second];
    }
    return null;
  };

  const email = getRequestUserEmail();
  if (!email) return readEnvironmentPairs();

  let lookupFailed = false;
  let cause: unknown;
  try {
    let pair: [string, string] | null = null;
    if (allowUserScope) {
      pair = await readPairs("user", email);
      if (pair) return pair;
    }

    let orgId: string | null | undefined = getRequestOrgId();
    if (!orgId) {
      const resolved = await resolveOrgIdForRequestEmail(email);
      cause = resolved.cause;
      lookupFailed = cause !== undefined;
      orgId = resolved.orgId;
    }

    if (lookupFailed) {
      const environmentPair = readEnvironmentPairs();
      if (environmentPair) return environmentPair;
      assertCredentialStoreReadable({ lookupFailed, cause });
      return null;
    }

    if (orgId) {
      if (preferWorkspaceScope) {
        pair = await readPairs("workspace", orgId);
        if (pair) return pair;
      }
      pair = await readPairs("org", orgId);
      if (pair) return pair;
      if (!preferWorkspaceScope) {
        pair = await readPairs("workspace", orgId);
        if (pair) return pair;
      }
    }

    if (allowUserScope) {
      pair = await readPairs("workspace", `solo:${email}`);
      if (pair) return pair;
    }

    const vaultOrgId = process.env.AGENT_VAULT_ORG_ID?.trim();
    if (vaultOrgId && vaultOrgId !== orgId) {
      const readDesignatedVaultPairs = async (
        scope: "org" | "workspace",
      ): Promise<[string, string] | null> => {
        for (const keys of keyPairs) {
          const access = await Promise.all(
            keys.map((key) => canReadDesignatedVaultFallback(vaultOrgId, key)),
          );
          const unavailable = access.find(
            (result) => result.status === "unavailable",
          );
          if (unavailable?.status === "unavailable") {
            lookupFailed = true;
            cause = unavailable.cause;
            continue;
          }
          if (access.every((result) => result.status === "allowed")) {
            const pair = await readPair(keys, scope, vaultOrgId);
            if (pair) return pair;
          }
        }
        return null;
      };
      const designatedScopes: Array<"org" | "workspace"> = preferWorkspaceScope
        ? ["workspace", "org"]
        : ["org", "workspace"];
      for (const scope of designatedScopes) {
        pair = await readDesignatedVaultPairs(scope);
        if (pair) return pair;
      }
    }
  } catch (error) {
    lookupFailed = true;
    cause = error;
  }

  const environmentPair = readEnvironmentPairs();
  if (environmentPair) return environmentPair;
  assertCredentialStoreReadable({ lookupFailed, cause });
  return null;
}

export async function resolveSecretPair(
  keys: SecretPairKeys,
  options?: ResolveSecretPairOptions,
): Promise<[string, string] | null> {
  return resolveSecretPairs([keys], options);
}

export type ResolvedSecretSource = "user" | "org" | "workspace" | "env";

export interface ResolvedSecretDetail {
  value: string | null;
  lookupFailed: boolean;
  cause?: unknown;
  source?: ResolvedSecretSource;
  scopeId?: string;
}

export async function resolveSecretDetailed(
  key: string,
  options: { skipUserScope?: boolean } = {},
): Promise<ResolvedSecretDetail> {
  const traceLookup = shouldTraceCredentialResolve();
  const email = getRequestUserEmail();
  const syntheticTraffic = getRequestContext()?.isSyntheticTraffic === true;
  let lookupFailed = false;
  let cause: unknown;
  if (email) {
    try {
      const { readAppSecret } = await import("../secrets/storage.js");

      const userSecret = options.skipUserScope
        ? null
        : await readAppSecret({
            key,
            scope: "user",
            scopeId: email,
          });
      if (userSecret?.value) {
        if (traceLookup) {
          console.log(
            `[resolve-secret] key=${key} email=${email} scope=user hit=true`,
          );
        }
        return {
          value: userSecret.value,
          lookupFailed: false,
          source: "user",
          scopeId: email,
        };
      }

      // The beta suite writes one user-scoped credential and must never turn a
      if (syntheticTraffic) return { value: null, lookupFailed: false };

      let orgId: string | null | undefined = getRequestOrgId();
      if (!orgId) {
        const resolved = await resolveOrgIdForRequestEmail(email);
        cause = resolved.cause;
        lookupFailed = cause !== undefined;
        orgId = resolved.orgId;
      }

      if (lookupFailed) {
        return { value: null, lookupFailed: true, cause };
      }

      if (orgId) {
        const [orgRead, workspaceRead] = await Promise.allSettled([
          readAppSecret({ key, scope: "org", scopeId: orgId }),
          readAppSecret({ key, scope: "workspace", scopeId: orgId }),
        ]);
        const unwrap = <T>(settled: PromiseSettledResult<T>): T => {
          if (settled.status === "rejected") throw settled.reason;
          return settled.value;
        };

        const orgSecret = unwrap(orgRead);
        if (orgSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} orgId=${orgId} scope=org hit=true`,
            );
          }
          return {
            value: orgSecret.value,
            lookupFailed: false,
            source: "org",
            scopeId: orgId,
          };
        }

        const workspaceSecret = unwrap(workspaceRead);
        if (workspaceSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} orgId=${orgId} scope=workspace hit=true`,
            );
          }
          return {
            value: workspaceSecret.value,
            lookupFailed: false,
            source: "workspace",
            scopeId: orgId,
          };
        }
      }

      const soloWorkspaceSecret = await readAppSecret({
        key,
        scope: "workspace",
        scopeId: `solo:${email}`,
      });
      if (soloWorkspaceSecret?.value) {
        if (traceLookup) {
          console.log(
            `[resolve-secret] key=${key} email=${email} orgId=${orgId ?? "(none)"} scope=workspace-solo hit=true`,
          );
        }
        return {
          value: soloWorkspaceSecret.value,
          lookupFailed: false,
          source: "workspace",
          scopeId: `solo:${email}`,
        };
      }

      const vaultOrgId = process.env.AGENT_VAULT_ORG_ID?.trim();
      if (vaultOrgId && vaultOrgId !== orgId) {
        const designatedVaultAccess = await canReadDesignatedVaultFallback(
          vaultOrgId,
          key,
        );
        if (designatedVaultAccess.status === "unavailable") {
          lookupFailed = true;
          cause = designatedVaultAccess.cause;
        }
        if (designatedVaultAccess.status === "allowed") {
          const [vaultOrgRead, vaultWorkspaceRead] = await Promise.allSettled([
            readAppSecret({ key, scope: "org", scopeId: vaultOrgId }),
            readAppSecret({ key, scope: "workspace", scopeId: vaultOrgId }),
          ]);
          const unwrap = <T>(settled: PromiseSettledResult<T>): T => {
            if (settled.status === "rejected") throw settled.reason;
            return settled.value;
          };
          const vaultOrgSecret = unwrap(vaultOrgRead);
          if (vaultOrgSecret?.value) {
            if (traceLookup) {
              console.log(
                `[resolve-secret] key=${key} email=${email} vaultOrgId=${vaultOrgId} scope=org-vault hit=true`,
              );
            }
            return {
              value: vaultOrgSecret.value,
              lookupFailed: false,
              source: "org",
              scopeId: vaultOrgId,
            };
          }
          const vaultWorkspaceSecret = unwrap(vaultWorkspaceRead);
          if (vaultWorkspaceSecret?.value) {
            if (traceLookup) {
              console.log(
                `[resolve-secret] key=${key} email=${email} vaultOrgId=${vaultOrgId} scope=workspace-vault hit=true`,
              );
            }
            return {
              value: vaultWorkspaceSecret.value,
              lookupFailed: false,
              source: "workspace",
              scopeId: vaultOrgId,
            };
          }
        }
      }
    } catch (err) {
      if (traceLookup) {
        console.log(
          `[resolve-secret] key=${key} email=${email} scope=error err=${(err as Error)?.message ?? err}`,
        );
      }
      lookupFailed = true;
      cause = err;
    }
    const envFallback = (
      isBuilderCredentialKey(key)
        ? canUseBuilderDeployCredentialFallbackForRequest()
        : canUseDeployCredentialFallbackForRequest(key)
    )
      ? process.env[key] || null
      : null;
    if (traceLookup) {
      console.log(
        `[resolve-secret] key=${key} email=${email} orgId=${getRequestOrgId() ?? "(none)"} scope=${envFallback ? "env-fallback" : "none"} hit=${!!envFallback}`,
      );
    }
    return {
      value: envFallback,
      lookupFailed,
      cause,
      ...(envFallback ? { source: "env" as const } : {}),
    };
  }
  const value = canUseDeployCredentialFallbackForRequest(key)
    ? process.env[key] || null
    : null;
  if (traceLookup) {
    console.log(
      `[resolve-secret] key=${key} email=(none) scope=env-anonymous hit=${!!value}`,
    );
  }
  return {
    value,
    lookupFailed: false,
    ...(value ? { source: "env" as const } : {}),
  };
}


export function hasBuilderPrivateKey(): boolean {
  return !!process.env.BUILDER_PRIVATE_KEY;
}

export function getBuilderProxyOrigin(): string {
  return (
    process.env.BUILDER_PROXY_ORIGIN ||
    process.env.AIR_HOST ||
    process.env.BUILDER_API_HOST ||
    "https://api.builder.io"
  );
}

export function getBuilderGatewayBaseUrl(): string {
  return (
    process.env.BUILDER_GATEWAY_BASE_URL ||
    "https://api.builder.io/agent-native/gateway/v1"
  );
}

export function getBuilderImageGenerationBaseUrl(): string {
  return (
    process.env.BUILDER_IMAGE_GENERATION_BASE_URL ||
    "https://api.builder.io/agent-native/images/v1"
  );
}

export function getBuilderEmbeddingsBaseUrl(): string {
  return "https://api.builder.io/agent-native/embeddings/v1";
}

export function getBuilderVideoGenerationBaseUrl(): string {
  return "https://api.builder.io/agent-native/videos/v1";
}

export function getBuilderWebSearchBaseUrl(): string {
  return (
    process.env.BUILDER_WEB_SEARCH_BASE_URL ||
    "https://api.builder.io/agent-native/web-search/v1"
  );
}

/** Authorization header value for Builder-proxied calls (env-only). */
export function getBuilderAuthHeader(): string | null {
  const key = process.env.BUILDER_PRIVATE_KEY;
  return key ? `Bearer ${key}` : null;
}
