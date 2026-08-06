/**
 * Credential provider abstraction.
 *
 * Every feature that needs an external credential (Anthropic API key,
 * Google OAuth tokens, OpenAI key, Slack bot token, etc.) should go through
 * one of the resolve*() helpers here instead of reading `process.env`
 * directly. That way the same feature can work in three modes:
 *
 *   1. User set their own key in .env              → use it directly
 *   2. User connected Builder via `/cli-auth`      → route through Builder proxy
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

import { CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE } from "../agent/engine/credential-errors.js";
import { isLocalDatabase, isTransientDatabaseError } from "../db/client.js";
import { getRequestUserEmail, getRequestOrgId } from "./request-context.js";

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

/**
 * The one place that decides when an unanswered credential lookup becomes a
 * user-visible retryable error. A store that is not configured at all is a real
 * "no credential"; a store that timed out or dropped the connection is not.
 */
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
  return process.env[key] || undefined;
}

const APP_PROVIDED_DEPLOY_CREDENTIAL_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "EMAIL_FROM",
  "EMAIL_INBOUND_WEBHOOK_SECRET",
  "EMAIL_AGENT_ADDRESS",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENROUTER_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "RESEND_API_KEY",
  "SENDGRID_API_KEY",
]);

function isAppProvidedDeployCredentialKey(key: string | undefined): boolean {
  return !!key && APP_PROVIDED_DEPLOY_CREDENTIAL_KEYS.has(key);
}

/**
 * Deployment-level credentials are safe as a runtime fallback only in local /
 * single-tenant contexts. In hosted production with a shared database, every
 * signed-in user needs their own user/org/workspace credential for
 * identity-bearing provider keys so one deploy key does not silently
 * impersonate another tenant. App-provided service credentials are different:
 * they configure the deployed app itself rather than identifying a user. This
 * includes LLM keys that let the app developer pay for model usage, email
 * transport configuration owned by the deployment, and OAuth client
 * credentials whose per-user identity remains in scoped OAuth tokens. Key-aware
 * callers may use those env vars.
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
  const email = getRequestUserEmail();
  if (!email) return true;
  if (isAppProvidedDeployCredentialKey(key)) return true;
  if (isHostedWorkspaceRuntime()) return false;
  if (!isProductionLikeRuntime()) return true;
  return isLocalDatabase();
}

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

function isHostedWorkspaceRuntime(): boolean {
  const hasFusionPreview = Boolean(
    process.env.FUSION_ENVIRONMENT ||
    process.env.FUSION_ENV_ORIGIN ||
    process.env.VITE_FUSION_ENV_ORIGIN,
  );
  return (
    /^(1|true)$/i.test(process.env.AGENT_NATIVE_WORKSPACE ?? "") ||
    /^(1|true)$/i.test(process.env.VITE_AGENT_NATIVE_WORKSPACE ?? "") ||
    hasFusionPreview
  );
}

function isProductionLikeRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
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

/**
 * Whether deployment-level Builder env keys may back the current request.
 *
 * This is intentionally self-contained rather than delegating to
 * `canUseDeployCredentialFallbackForRequest`. That generic helper blocks the
 * deploy fallback for any signed-in user in a hosted workspace runtime, so the
 * Builder dogfooding escape hatch must apply its own hosted-workspace exception
 * here instead of inheriting the generic helper's stricter (and hatch-unaware)
 * decision. Reading the env once into locals keeps the rules legible.
 *
 * Rules (all evaluated against the live request/runtime, not a build-time value):
 *  - No signed-in user → safe to use the deploy env (nobody to mis-identify).
 *  - Hosted workspace + signed-in user → deploy-level Builder keys would
 *    impersonate that user, so block them — UNLESS a developer has explicitly
 *    opted into the local dogfooding escape hatch (non-prod only). Default OFF;
 *    hosted/shared production deployments are never affected.
 *  - Otherwise → allowed in non-prod, or on a local/single-tenant database.
 */
function canUseBuilderDeployCredentialFallbackForRequest(): boolean {
  const email = getRequestUserEmail();
  if (!email) return true;

  const isProductionRuntime = isProductionLikeRuntime();
  // Local dogfooding escape hatch: lets the env / root-`.env` Builder key back
  // a signed-in user so running the app locally doesn't require completing the
  // Builder connect flow first. Non-prod only.
  const localDevOptIn =
    !isProductionRuntime &&
    /^(1|true)$/i.test(process.env.AGENT_NATIVE_LOCAL_BUILDER_ENV ?? "");

  if (isHostedWorkspaceRuntime() && !localDevOptIn) return false;

  // Deploy fallback is safe in non-prod or on a local/single-tenant database.
  return !isProductionRuntime || isLocalDatabase();
}

function shouldTraceCredentialResolve(): boolean {
  return /^(1|true)$/i.test(
    process.env.AGENT_NATIVE_DEBUG_CREDENTIAL_RESOLVE ??
      process.env.DEBUG_CREDENTIAL_RESOLVE ??
      "",
  );
}

// ---------------------------------------------------------------------------
// Builder credential resolution:
//
//   1. **Request-scoped credentials.** A signed-in user can connect Builder
//      through the CLI-auth flow. Owner/admin connections land at org scope;
//      member/no-org connections land at user scope.
//
//   2. **Deployment fallback.** BUILDER_PRIVATE_KEY in env still makes local
//      and single-tenant deploys work out of the box, but it no longer blocks
//      per-user connect. Request-scoped credentials win whenever present.
//
// To run multi-tenant SaaS: prefer leaving BUILDER_PRIVATE_KEY unset unless a
// shared fallback identity is intentional.
// ---------------------------------------------------------------------------

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

/**
 * A complete key pair is not necessarily a usable one: the gateway may have
 * already rejected this exact private+public pair (see
 * `recordBuilderCredentialAuthFailure`). Treating a marked-bad pair as
 * "complete" is how a rejected credential got resent on every subsequent
 * turn forever — this is the read side of that write, symmetric with
 * `resolveUsableProviderSecret` for every non-Builder provider.
 */
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

export function isBuilderPrivateKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().startsWith("bpk-");
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

/**
 * A transient org_members read failure makes getOrgContext report no org, which
 * would otherwise hide an org-scoped Builder connection behind a permanent-
 * sounding "not configured" error. resolveOrgIdForEmail honors an explicit
 * Personal selection, so this cannot promote a user into an org they left.
 */
async function resolveOrgIdForRequestEmail(
  email: string,
): Promise<{ orgId: string | null; cause?: unknown }> {
  try {
    const { resolveOrgIdForEmail } = await import("../org/context.js");
    return { orgId: await resolveOrgIdForEmail(email) };
  } catch (err) {
    // Could not read org membership, so org- and workspace-scoped rows were
    // never searched. Report the failure instead of the empty answer.
    return { orgId: null, cause: err };
  }
}

interface ScopedCredentialResult {
  value: string | null;
  source: "user" | "org" | "workspace" | null;
  /** The failure, when there was one, so callers can classify it. */
  cause?: unknown;
  /**
   * True when reading the store (or the org membership that decides which
   * scopes to search) failed, as opposed to the store answering "no row".
   */
  lookupFailed: boolean;
}

const NOT_FOUND: ScopedCredentialResult = {
  value: null,
  source: null,
  lookupFailed: false,
};

async function resolveScopedBuilderCredential(
  key: string,
): Promise<ScopedCredentialResult> {
  const email = getRequestUserEmail();
  if (!email) return NOT_FOUND;

  // Trace only when explicitly requested. These diagnostics are useful for
  // support, but they include account identifiers and run on hot paths.
  const traceLookup = shouldTraceCredentialResolve();
  let scopeAttempted = "user";
  let orgLookupCause: unknown;
  try {
    const { readAppSecret } = await import("../secrets/storage.js");

    // 1. Per-user override: a user can paste their own key in settings to
    //    overrule the org-shared one (handy for a personal sandbox).
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

    let orgId: string | null | undefined = getRequestOrgId();
    let orgSource: "request" | "email-fallback" | "none" = orgId
      ? "request"
      : "none";
    if (!orgId) {
      const resolved = await resolveOrgIdForRequestEmail(email);
      orgLookupCause = resolved.cause;
      orgId = resolved.orgId;
      if (orgId) orgSource = "email-fallback";
    }

    // 2. Per-org shared credential: when one teammate connects Builder
    //    as an owner/admin we write the OAuth result at org scope so
    //    every member of that org gets the AI chat working without
    //    re-running the connect flow. Resolution falls back here
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

      // Older setup flows wrote shared credentials at workspace scope.
      // Keep reading those rows so status UIs and runtime resolution agree
      // for users who connected before org-scoped Builder credentials existed.
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

    // Membership lookup failure means the org scopes were never searched.
    // Do not let a pre-org solo row silently impersonate the current org while
    // the membership read is retryable.
    if (orgLookupCause !== undefined) {
      return {
        value: null,
        source: null,
        lookupFailed: true,
        cause: orgLookupCause,
      };
    }

    // 3. Solo-workspace fallback: always checked, even when an org id was
    //    found above. Older no-org connect flows wrote here, so a credential
    //    written before the user joined/created an org must not become
    //    unreachable once that org exists.
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
  /** The failure, when there was one, so callers can classify it. */
  cause?: unknown;
  /**
   * True when reading the credential store itself threw (db timeout, etc),
   * as opposed to the store answering cleanly with "no row". Callers must
   * report this as retryable rather than "not configured".
   */
  lookupFailed: boolean;
}

async function resolveScopedBuilderCredentials(): Promise<ScopedBuilderCredentialsResult> {
  const email = getRequestUserEmail();
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

    let orgId: string | null | undefined = getRequestOrgId();
    let orgSource: "request" | "email-fallback" | "none" = orgId
      ? "request"
      : "none";
    if (!orgId) {
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

    // Solo-workspace fallback: always checked, even when an org id was found
    // above. See resolveScopedBuilderCredential for why this must not be
    // gated behind "no org".
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
): Promise<string | null> {
  const scoped = await resolveScopedBuilderCredential(key);
  if (scoped.value) return scoped.value;
  const envValue = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv(key) ?? null)
    : null;
  if (envValue) return envValue;
  // Nothing answered AND the store never gave a real answer: that is not
  // "not connected", it is "we could not look".
  assertCredentialStoreReadable(scoped);
  return null;
}

/**
 * True when `BUILDER_PRIVATE_KEY` is set at the deployment level. This means
 * a deploy-level fallback exists; it does not prevent per-user connect.
 */
export function isBuilderEnvManaged(): boolean {
  return !!process.env.BUILDER_PRIVATE_KEY;
}

/**
 * Resolve the Builder private key for the current request. User/org OAuth
 * credentials win; deploy-level `BUILDER_PRIVATE_KEY` is the fallback.
 */
export async function resolveBuilderPrivateKey(): Promise<string | null> {
  return resolveBuilderCredential("BUILDER_PRIVATE_KEY");
}

/**
 * Resolve the current user's Builder auth header.
 * Returns `"Bearer <key>"` or null.
 */
export async function resolveBuilderAuthHeader(): Promise<string | null> {
  const key = await resolveBuilderPrivateKey();
  return key ? `Bearer ${key}` : null;
}

/**
 * Check whether the current user has a Builder private key configured
 * (per-user or deployment-level).
 */
export async function resolveHasBuilderPrivateKey(): Promise<boolean> {
  return !!(await resolveBuilderPrivateKey());
}

/**
 * Check whether the current request has the complete Builder credential bundle
 * needed for Builder-backed assistant/image-generation calls.
 */
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
  /** Which scope answered, or null when nothing did. */
  source: BuilderCredentialSource | null;
  /**
   * True when reading the credential store itself failed (db timeout, etc).
   * Callers must report this as retryable rather than "not configured".
   */
  lookupFailed: boolean;
  /** The failure, when there was one, so callers can classify it. */
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
export async function resolveBuilderCredentialsDetailed(): Promise<BuilderCredentialsDetailed> {
  const {
    creds: scoped,
    lookupFailed,
    cause,
  } = await resolveScopedBuilderCredentials();
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
  // The deploy-level fallback is a candidate scope like any other: a pair the
  // gateway already rejected must not be handed back as the "configured"
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

/**
 * Resolve the Builder assistant credential bundle from one complete scope.
 * Kept to its original return shape (no `source`/`lookupFailed`) for existing
 * callers; use `resolveBuilderCredentialsDetailed()` for those fields.
 */
export async function resolveBuilderCredentials(): Promise<{
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
  } = await resolveBuilderCredentialsDetailed();
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

const BUILDER_AUTH_FAILURE_SETTING_PREFIX = "builder-auth-failure:";
/**
 * Stale markers expire so a rejected model or a transient gateway failure
 * cannot pin a signed-in user to "Builder not connected" forever. Only a
 * successful gateway call clears the marker early, and that call never happens
 * while the marker is what makes the connection look broken.
 */
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
    if (Date.now() - at > BUILDER_AUTH_FAILURE_TTL_MS) {
      if (typeof settings.deleteSetting === "function") {
        await settings.deleteSetting(settingKey).catch(() => {});
      }
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
    await putSetting(builderAuthFailureSettingKey(fingerprint), {
      fingerprint,
      message:
        details?.message ||
        "Builder rejected the connected credentials. Reconnect Builder.io (free tier available).",
      ...(typeof details?.status === "number" && { status: details.status }),
      ...(details?.code && { code: details.code }),
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
/** Stale failure markers expire so a transient 401 cannot permanently block deploy keys. */
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
    if (Date.now() - at > PROVIDER_AUTH_FAILURE_TTL_MS) {
      if (typeof settings.deleteSetting === "function") {
        await settings.deleteSetting(settingKey).catch(() => {});
      }
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
    await putSetting(providerAuthFailureSettingKey(fingerprint), {
      fingerprint,
      key,
      message: opts.message || "The model provider rejected the saved API key.",
      ...(typeof opts.status === "number" && { status: opts.status }),
      ...(opts.code && { code: opts.code }),
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
 * Write Builder credentials to `app_secrets`.
 *
 * Scope decision (see `resolveCredentialWriteScope`): when the connecting
 * user is owner/admin of an active org we write at `scope: "org"` so every
 * member of that org auto-resolves the credentials via
 * `resolveBuilderCredential`'s org fallback — no per-user re-connect
 * needed. A plain member or a user with no active org writes at
 * `scope: "user"` (the safe default that doesn't trample the org's shared
 * connection).
 *
 * Stale-credential cleanup: before writing the new values we (1) clear ALL
 * five BUILDER_* keys at the target scope, so optional fields the new
 * connection doesn't carry (e.g. user picked a Builder space that returns
 * no orgName) don't leave the previous connection's metadata behind, and
 * (2) when writing at org scope, also clear the writer's own user-scope
 * BUILDER_* rows so a stale personal override from an earlier connect
 * doesn't shadow the new org write on resolution (user scope wins org
 * scope by design — see `resolveScopedBuilderCredential`). The org-scope
 * row is intentionally left alone when writing at user scope: that row is
 * shared with the rest of the org and a single user's personal override
 * shouldn't blow it away. (Victoria's "I signed in again with my Builder
 * space and it still says no credits" report on 2026-05-11 was exactly
 * this stale-shadow case.)
 *
 * Returns the actual scope/scopeId used so the caller can show "Connected
 * for Builder.io" vs "Connected (personal)" in the UI.
 */
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
  if (!isBuilderPrivateKey(privateKey)) {
    throw new Error(
      "Builder returned a credential that is not a Builder private key (expected bpk-...). Restart the Builder connect flow and choose a space that can issue a private key.",
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

  // Clear stale rows before writing the new connection. See the function's
  // doc comment for the two cases this handles.
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

/**
 * Delete Builder credentials.
 *
 * Default behaviour: clears only this user's per-user override (so a
 * member can disconnect their personal Builder identity without
 * collapsing the org-wide connection for every teammate). To revoke the
 * org's shared connection, pass `{ orgId, role }` for an owner/admin —
 * matching the same authority gate `writeBuilderCredentials` uses on
 * write. Plain members can never reach the org-scoped row.
 */
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
      }).catch(() => {}),
    ),
  );
  return target;
}

// ---------------------------------------------------------------------------
// Generic request-scoped secret resolution
//
// New consumers should prefer this over reading `process.env.X` directly.
// User-pasted and shared secrets live in `app_secrets` (encrypted). The
// settings UI / onboarding panels can write user, org, or workspace rows.
// Deploy-level env vars are the fallback for unauthenticated/CLI/background
// contexts where there's no user to scope by. Authenticated requests may also
// use app-provided LLM provider keys such as OPENAI_API_KEY or
// ANTHROPIC_API_KEY, but Builder identity keys keep the stricter scoped policy.
// ---------------------------------------------------------------------------

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
  const orgId =
    getRequestOrgId() || (await resolveOrgIdForRequestEmail(email)).orgId;
  const scopes: Array<{
    scope: "user" | "org" | "workspace";
    scopeId: string;
  }> = [
    { scope: "user", scopeId: email },
    ...(orgId
      ? ([
          { scope: "org", scopeId: orgId },
          { scope: "workspace", scopeId: orgId },
        ] as const)
      : []),
    { scope: "workspace", scopeId: `solo:${email}` },
  ];
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
  // Nothing answered AND the store never gave a real answer. Reporting null
  // here is what turns a database blip into "you never configured this".
  assertCredentialStoreReadable(resolved);
  return null;
}

/**
 * `resolveSecret` without the throw: reports whether the miss is definitive
 * (`lookupFailed: false` — no such row anywhere the caller can reach) or just
 * unknown (`lookupFailed: true` — the store or the org membership behind it
 * could not be read).
 */
export async function resolveSecretDetailed(
  key: string,
): Promise<{ value: string | null; lookupFailed: boolean; cause?: unknown }> {
  const traceLookup = shouldTraceCredentialResolve();
  const email = getRequestUserEmail();
  let lookupFailed = false;
  let cause: unknown;
  if (email) {
    try {
      const { readAppSecret } = await import("../secrets/storage.js");

      // Per-user override first.
      const userSecret = await readAppSecret({
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
        return { value: userSecret.value, lookupFailed: false };
      }

      // Mirrors resolveScopedBuilderCredential: a transient org_members read
      // failure makes getOrgContext report no org, which would otherwise hide
      // an org-scoped vault row behind an intermittent "not configured" error.
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
        // These rows are independent once the org is known, so read them in
        // parallel while still applying precedence below in the same order.
        const [orgRead, workspaceRead] = await Promise.allSettled([
          readAppSecret({ key, scope: "org", scopeId: orgId }),
          readAppSecret({ key, scope: "workspace", scopeId: orgId }),
        ]);
        const unwrap = <T>(settled: PromiseSettledResult<T>): T => {
          if (settled.status === "rejected") throw settled.reason;
          return settled.value;
        };

        // Fall back to the active org's shared row, when present. Builder
        // Connect uses this first-class org scope.
        const orgSecret = unwrap(orgRead);
        if (orgSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} orgId=${orgId} scope=org hit=true`,
            );
          }
          return { value: orgSecret.value, lookupFailed: false };
        }

        // Registered secrets historically used "workspace" scope for
        // org-shared configuration. Keep reading it so Settings status and
        // runtime resolution agree.
        const workspaceSecret = unwrap(workspaceRead);
        if (workspaceSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} orgId=${orgId} scope=workspace hit=true`,
            );
          }
          return { value: workspaceSecret.value, lookupFailed: false };
        }
      }

      // Solo-workspace fallback: always checked, even when an org id was found
      // above. A secret written before the user joined/created an org lives
      // here, and must not become unreachable once that org exists. It stays
      // inside this try so a failed org-scoped read still surfaces as
      // retryable instead of being answered by a stale pre-org row.
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
        return { value: soloWorkspaceSecret.value, lookupFailed: false };
      }

      // Dispatch's workspace vault is stored under the organization that
      // performed the sync. AGENT_VAULT_ORG_ID is an explicit single-workspace
      // deployment assertion; without it, never guess which other tenant owns
      // a shared key. This fallback keeps workspace apps from requiring every
      // builder to copy a vault key into app-local settings.
      const vaultOrgId = process.env.AGENT_VAULT_ORG_ID?.trim();
      if (vaultOrgId && vaultOrgId !== orgId) {
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
          return { value: vaultOrgSecret.value, lookupFailed: false };
        }
        const vaultWorkspaceSecret = unwrap(vaultWorkspaceRead);
        if (vaultWorkspaceSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} vaultOrgId=${vaultOrgId} scope=workspace-vault hit=true`,
            );
          }
          return { value: vaultWorkspaceSecret.value, lookupFailed: false };
        }
      }
    } catch (err) {
      if (traceLookup) {
        console.log(
          `[resolve-secret] key=${key} email=${email} scope=error err=${(err as Error)?.message ?? err}`,
        );
      }
      // Keep looking (env may still have the key), but remember that the store
      // never actually answered "no row".
      lookupFailed = true;
      cause = err;
    }
    // Read deployment-provided env values as fallbacks; framework code must not
    // write to `process.env`, but keys supplied by the host remain valid config.
    // Builder credentials keep a narrower path below because those keys carry a
    // Builder identity rather than just enabling a provider call.
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
      lookupFailed: lookupFailed && !envFallback,
      cause,
    };
  }
  // Unauthenticated / local-dev / CLI / background context: env fallback
  // is safe because there's no user to mis-identify.
  const value = process.env[key] || null;
  if (traceLookup) {
    console.log(
      `[resolve-secret] key=${key} email=(none) scope=env-anonymous hit=${!!value}`,
    );
  }
  return { value, lookupFailed: false };
}

// ---------------------------------------------------------------------------
// Synchronous helpers — env-only fallbacks for contexts where per-user
// lookup isn't possible (sync isConfigured checks, CLI scripts).
// ---------------------------------------------------------------------------

/**
 * True when a Builder private key is configured at the deployment level.
 *
 * This is the same env-only check as `isBuilderEnvManaged()`. For "does this
 * request have access to Builder via user/org/env credentials?" use the async
 * `resolveHasBuilderPrivateKey()`.
 */
export function hasBuilderPrivateKey(): boolean {
  return !!process.env.BUILDER_PRIVATE_KEY;
}

/** The origin for Builder-proxied API calls. Overridable for testing. */
export function getBuilderProxyOrigin(): string {
  return (
    process.env.BUILDER_PROXY_ORIGIN ||
    process.env.AIR_HOST ||
    process.env.BUILDER_API_HOST ||
    "https://api.builder.io"
  );
}

/**
 * Base URL for the public Builder LLM gateway, which lives at
 * api.builder.io/agent-native/gateway.
 * Override via BUILDER_GATEWAY_BASE_URL for staging / testing.
 */
export function getBuilderGatewayBaseUrl(): string {
  return (
    process.env.BUILDER_GATEWAY_BASE_URL ||
    "https://api.builder.io/agent-native/gateway/v1"
  );
}

/**
 * Base URL for Builder-managed image generation.
 * Override via BUILDER_IMAGE_GENERATION_BASE_URL for staging / testing.
 */
export function getBuilderImageGenerationBaseUrl(): string {
  return (
    process.env.BUILDER_IMAGE_GENERATION_BASE_URL ||
    "https://api.builder.io/agent-native/images/v1"
  );
}

/**
 * Base URL for Builder-managed web search.
 * Override via BUILDER_WEB_SEARCH_BASE_URL for staging / testing.
 */
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
