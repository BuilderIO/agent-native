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
import { getRequestUserEmail, getRequestOrgId } from "./request-context.js";
import { isLocalDatabase } from "../db/client.js";

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
        `Feature requires credential "${opts.requiredCredential}". Connect Builder or set your own key.`,
    );
    this.name = "FeatureNotConfiguredError";
    this.requiredCredential = opts.requiredCredential;
    this.builderConnectUrl = opts.builderConnectUrl;
    this.byokDocsUrl = opts.byokDocsUrl;
  }
}

/**
 * Deployment-level credential fallback for single-tenant/local operation.
 * Multi-tenant call sites must gate this explicitly before calling.
 */
export function readDeployCredentialEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

/**
 * Deployment-level credentials are safe as a runtime fallback only in local /
 * single-tenant contexts. In hosted production with a shared database, every
 * signed-in user needs their own user/org/workspace credential so one deploy
 * key does not silently power another tenant's chat.
 */
export function isDeployCredentialFallbackAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return isLocalDatabase();
}

export function canUseDeployCredentialFallbackForRequest(): boolean {
  const email = getRequestUserEmail();
  if (!email) return true;
  return isDeployCredentialFallbackAllowed();
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

function canUseBuilderDeployCredentialFallbackForRequest(): boolean {
  const email = getRequestUserEmail();
  // Builder workspace previews can run with NODE_ENV=development and their DB
  // detection can look local during early startup. Once a real signed-in user
  // is present, hosted workspace flags are enough to make deployment-level
  // Builder keys unsafe as an identity fallback.
  if (email && isHostedWorkspaceRuntime()) return false;
  return canUseDeployCredentialFallbackForRequest();
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

function isCompleteBuilderConnection(creds: BuilderResolvedCredentials) {
  return Boolean(creds.privateKey && creds.publicKey);
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
  readAppSecret: typeof import("../secrets/storage.js").readAppSecret,
  scope: "user" | "org" | "workspace",
  scopeId: string,
): Promise<BuilderResolvedCredentials> {
  const values = await Promise.all(
    BUILDER_CREDENTIAL_KEYS.map(async (key) => {
      const secret = await readAppSecret({ key, scope, scopeId });
      return [key, secret?.value ?? null] as const;
    }),
  );
  const map = new Map<string, string | null>(values);
  return {
    privateKey: map.get("BUILDER_PRIVATE_KEY") ?? null,
    publicKey: map.get("BUILDER_PUBLIC_KEY") ?? null,
    userId: map.get("BUILDER_USER_ID") ?? null,
    orgName: map.get("BUILDER_ORG_NAME") ?? null,
    orgKind: map.get("BUILDER_ORG_KIND") ?? null,
    subscription: map.get("BUILDER_SUBSCRIPTION") ?? null,
    subscriptionLevel: map.get("BUILDER_SUBSCRIPTION_LEVEL") ?? null,
    subscriptionName: map.get("BUILDER_SUBSCRIPTION_NAME") ?? null,
    isEnterprise: readOptionalBuilderBoolean(map.get("BUILDER_IS_ENTERPRISE")),
    isFreeAccount: readOptionalBuilderBoolean(
      map.get("BUILDER_IS_FREE_ACCOUNT"),
    ),
    source: scope === "workspace" ? "workspace" : scope,
  };
}

async function resolveScopedBuilderCredential(
  key: string,
): Promise<{ value: string; source: "user" | "org" | "workspace" } | null> {
  const email = getRequestUserEmail();
  if (!email) return null;

  // Trace only when explicitly requested. These diagnostics are useful for
  // support, but they include account identifiers and run on hot paths.
  const traceLookup = shouldTraceCredentialResolve();
  let scopeAttempted = "user";
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
      return { value: userSecret.value, source: "user" };
    }

    // 2. Per-org shared credential: when one teammate connects Builder
    //    as an owner/admin we write the OAuth result at org scope so
    //    every member of that org gets the AI chat working without
    //    re-running the connect flow. Resolution falls back here
    //    silently — the caller never has to know which scope answered.
    const orgId = getRequestOrgId();
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
            `[builder-credential] key=${key} email=${email} orgId=${orgId} scope=org hit=true`,
          );
        }
        return { value: orgSecret.value, source: "org" };
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
            `[builder-credential] key=${key} email=${email} orgId=${orgId} scope=workspace hit=true`,
          );
        }
        return { value: workspaceSecret.value, source: "workspace" };
      }
      if (traceLookup) {
        console.log(
          `[builder-credential] key=${key} email=${email} orgId=${orgId} miss tried=user,org,workspace`,
        );
      }
    } else {
      scopeAttempted = "workspace-solo";
      const soloWorkspaceSecret = await readAppSecret({
        key,
        scope: "workspace",
        scopeId: `solo:${email}`,
      });
      if (soloWorkspaceSecret) {
        if (traceLookup) {
          console.log(
            `[builder-credential] key=${key} email=${email} scope=workspace-solo hit=true`,
          );
        }
        return { value: soloWorkspaceSecret.value, source: "workspace" };
      }
      if (traceLookup) {
        console.log(
          `[builder-credential] key=${key} email=${email} orgId=(none) miss tried=user,workspace-solo`,
        );
      }
    }
  } catch (err) {
    if (traceLookup) {
      console.log(
        `[builder-credential] key=${key} email=${email} scope=${scopeAttempted} error=${(err as Error)?.message ?? err}`,
      );
    }
    // Secrets table not ready — treat as missing.
  }
  return null;
}

async function resolveScopedBuilderCredentials(): Promise<BuilderResolvedCredentials | null> {
  const email = getRequestUserEmail();
  if (!email) return null;

  const traceLookup = shouldTraceCredentialResolve();
  let scopeAttempted = "user";
  try {
    const { readAppSecret } = await import("../secrets/storage.js");
    const traceScope = (creds: BuilderResolvedCredentials, scopeId: string) => {
      if (!traceLookup) return;
      console.log(
        `[builder-credential] scope=${creds.source} scopeId=${scopeId} email=${email} complete=${isCompleteBuilderConnection(creds)} private=${Boolean(creds.privateKey)} public=${Boolean(creds.publicKey)}`,
      );
    };

    const userCreds = await readBuilderCredentialScope(
      readAppSecret,
      "user",
      email,
    );
    traceScope(userCreds, email);
    if (isCompleteBuilderConnection(userCreds)) return userCreds;

    const orgId = getRequestOrgId();
    if (orgId) {
      scopeAttempted = "org";
      const orgCreds = await readBuilderCredentialScope(
        readAppSecret,
        "org",
        orgId,
      );
      traceScope(orgCreds, orgId);
      if (isCompleteBuilderConnection(orgCreds)) return orgCreds;

      scopeAttempted = "workspace";
      const workspaceCreds = await readBuilderCredentialScope(
        readAppSecret,
        "workspace",
        orgId,
      );
      traceScope(workspaceCreds, orgId);
      if (isCompleteBuilderConnection(workspaceCreds)) return workspaceCreds;
    } else {
      scopeAttempted = "workspace-solo";
      const scopeId = `solo:${email}`;
      const workspaceCreds = await readBuilderCredentialScope(
        readAppSecret,
        "workspace",
        scopeId,
      );
      traceScope(workspaceCreds, scopeId);
      if (isCompleteBuilderConnection(workspaceCreds)) return workspaceCreds;
    }
  } catch (err) {
    if (traceLookup) {
      console.log(
        `[builder-credential] email=${email} scope=${scopeAttempted} credentials error=${(err as Error)?.message ?? err}`,
      );
    }
  }
  return null;
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
  if (scoped) return scoped.value;
  if (!canUseBuilderDeployCredentialFallbackForRequest()) return null;
  return readDeployCredentialEnv(key) ?? null;
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
  const scoped = await resolveScopedBuilderCredentials();
  if (scoped) return scoped.source;
  return canUseBuilderDeployCredentialFallbackForRequest() &&
    process.env.BUILDER_PRIVATE_KEY
    ? "env"
    : null;
}

/**
 * Resolve the Builder assistant credential bundle from one complete scope.
 * A partial user row is treated as a miss so the org-shared connection can
 * still power the assistant for teammates.
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
  const scoped = await resolveScopedBuilderCredentials();
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
    };
  }
  const privateKey = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_PRIVATE_KEY") ?? null)
    : null;
  const publicKey = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_PUBLIC_KEY") ?? null)
    : null;
  const userId = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_USER_ID") ?? null)
    : null;
  const orgName = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_ORG_NAME") ?? null)
    : null;
  const orgKind = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_ORG_KIND") ?? null)
    : null;
  const subscription = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_SUBSCRIPTION") ?? null)
    : null;
  const subscriptionLevel = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_SUBSCRIPTION_LEVEL") ?? null)
    : null;
  const subscriptionName = canUseBuilderDeployCredentialFallbackForRequest()
    ? (readDeployCredentialEnv("BUILDER_SUBSCRIPTION_NAME") ?? null)
    : null;
  const isEnterprise = canUseBuilderDeployCredentialFallbackForRequest()
    ? readOptionalBuilderBoolean(
        readDeployCredentialEnv("BUILDER_IS_ENTERPRISE"),
      )
    : null;
  const isFreeAccount = canUseBuilderDeployCredentialFallbackForRequest()
    ? readOptionalBuilderBoolean(
        readDeployCredentialEnv("BUILDER_IS_FREE_ACCOUNT"),
      )
    : null;
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
    const { getSetting } = await import("../settings/store.js");
    const row = await getSetting(builderAuthFailureSettingKey(fingerprint));
    if (!row) return null;
    return {
      fingerprint,
      message:
        typeof row.message === "string" && row.message
          ? row.message
          : "Builder rejected the connected credentials. Reconnect Builder.io.",
      status: typeof row.status === "number" ? row.status : undefined,
      code: typeof row.code === "string" ? row.code : undefined,
      at: typeof row.at === "number" ? row.at : Date.now(),
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
        "Builder rejected the connected credentials. Reconnect Builder.io.",
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
// contexts where there's no user to scope by — never the silent fallback
// for an authenticated request, since on a multi-tenant deploy that would
// silently identify every user as whoever set the deploy-level key
// (KVesta Space, 2026-04).
// ---------------------------------------------------------------------------

/**
 * Resolve a request-scoped secret. Reads from `app_secrets` first (current
 * user override, active org, then workspace row); falls back to `process.env`
 * only when the deploy fallback policy allows it.
 */
export async function resolveSecret(key: string): Promise<string | null> {
  const traceLookup = shouldTraceCredentialResolve();
  const email = getRequestUserEmail();
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
        return userSecret.value;
      }

      const orgId = getRequestOrgId();
      if (orgId) {
        // Fall back to the active org's shared row, when present. Builder
        // Connect uses this first-class org scope.
        const orgSecret = await readAppSecret({
          key,
          scope: "org",
          scopeId: orgId,
        });
        if (orgSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} orgId=${orgId} scope=org hit=true`,
            );
          }
          return orgSecret.value;
        }

        // Registered secrets historically used "workspace" scope for
        // org-shared configuration. Keep reading it so Settings status and
        // runtime resolution agree.
        const workspaceSecret = await readAppSecret({
          key,
          scope: "workspace",
          scopeId: orgId,
        });
        if (workspaceSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} orgId=${orgId} scope=workspace hit=true`,
            );
          }
          return workspaceSecret.value;
        }
      } else {
        const soloWorkspaceSecret = await readAppSecret({
          key,
          scope: "workspace",
          scopeId: `solo:${email}`,
        });
        if (soloWorkspaceSecret?.value) {
          if (traceLookup) {
            console.log(
              `[resolve-secret] key=${key} email=${email} scope=workspace-solo hit=true`,
            );
          }
          return soloWorkspaceSecret.value;
        }
      }
    } catch (err) {
      if (traceLookup) {
        console.log(
          `[resolve-secret] key=${key} email=${email} scope=error err=${(err as Error)?.message ?? err}`,
        );
      }
      // Secrets table not ready — treat as missing.
    }
    // Authenticated multi-tenant context: never fall back to process.env.
    // The deploy-level value would silently impersonate the actual key
    // owner across every tenant. Local/single-tenant deployments keep the
    // original env fallback for BYO-server workflows.
    const envFallback = (
      isBuilderCredentialKey(key)
        ? canUseBuilderDeployCredentialFallbackForRequest()
        : canUseDeployCredentialFallbackForRequest()
    )
      ? process.env[key] || null
      : null;
    if (traceLookup) {
      console.log(
        `[resolve-secret] key=${key} email=${email} orgId=${getRequestOrgId() ?? "(none)"} scope=${envFallback ? "env-fallback" : "none"} hit=${!!envFallback}`,
      );
    }
    return envFallback;
  }
  // Unauthenticated / local-dev / CLI / background context: env fallback
  // is safe because there's no user to mis-identify.
  const value = process.env[key] || null;
  if (traceLookup) {
    console.log(
      `[resolve-secret] key=${key} email=(none) scope=env-anonymous hit=${!!value}`,
    );
  }
  return value;
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

/** Authorization header value for Builder-proxied calls (env-only). */
export function getBuilderAuthHeader(): string | null {
  const key = process.env.BUILDER_PRIVATE_KEY;
  return key ? `Bearer ${key}` : null;
}
