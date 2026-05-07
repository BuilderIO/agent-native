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

type BuilderCredentialSource = "user" | "org" | "env";

async function resolveScopedBuilderCredential(
  key: string,
): Promise<{ value: string; source: "user" | "org" } | null> {
  const email = getRequestUserEmail();
  if (!email) return null;

  try {
    const { readAppSecret } = await import("../secrets/storage.js");

    // 1. Per-user override: a user can paste their own key in settings to
    //    overrule the org-shared one (handy for a personal sandbox).
    const userSecret = await readAppSecret({
      key,
      scope: "user",
      scopeId: email,
    });
    if (userSecret) return { value: userSecret.value, source: "user" };

    // 2. Per-org shared credential: when one teammate connects Builder
    //    as an owner/admin we write the OAuth result at org scope so
    //    every member of that org gets the AI chat working without
    //    re-running the connect flow. Resolution falls back here
    //    silently — the caller never has to know which scope answered.
    const orgId = getRequestOrgId();
    if (orgId) {
      const orgSecret = await readAppSecret({
        key,
        scope: "org",
        scopeId: orgId,
      });
      if (orgSecret) return { value: orgSecret.value, source: "org" };
    }
  } catch {
    // Secrets table not ready — treat as missing.
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
 * Resolve the Builder private key for the current request. In env-managed
 * mode (deploy-level `BUILDER_PRIVATE_KEY` set) returns the env value for
 * every caller. Otherwise reads the current user's per-user OAuth-stored
 * key from `app_secrets`.
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
 * Resolve where the effective Builder private key came from. Used by status
 * UIs so they can distinguish a deploy fallback from a user/org connection.
 */
export async function resolveBuilderCredentialSource(): Promise<
  BuilderCredentialSource | null
> {
  const scoped = await resolveScopedBuilderCredential("BUILDER_PRIVATE_KEY");
  if (scoped) return scoped.source;
  return process.env.BUILDER_PRIVATE_KEY ? "env" : null;
}

/**
 * Resolve all per-user Builder credentials. Used by the status endpoint
 * and agent-chat-plugin to get orgName, userId, etc.
 */
export async function resolveBuilderCredentials(): Promise<{
  privateKey: string | null;
  publicKey: string | null;
  userId: string | null;
  orgName: string | null;
  orgKind: string | null;
}> {
  const [privateKey, publicKey, userId, orgName, orgKind] = await Promise.all([
    resolveBuilderCredential("BUILDER_PRIVATE_KEY"),
    resolveBuilderCredential("BUILDER_PUBLIC_KEY"),
    resolveBuilderCredential("BUILDER_USER_ID"),
    resolveBuilderCredential("BUILDER_ORG_NAME"),
    resolveBuilderCredential("BUILDER_ORG_KIND"),
  ]);
  return { privateKey, publicKey, userId, orgName, orgKind };
}

const BUILDER_CREDENTIAL_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
] as const;

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
  },
  options?: { orgId?: string | null; role?: string | null },
): Promise<{ scope: "user" | "org"; scopeId: string }> {
  const { writeAppSecret } = await import("../secrets/storage.js");
  const target = resolveCredentialWriteScope(
    email,
    options?.orgId ?? null,
    options?.role ?? null,
  );

  const entries: Array<{ key: string; value: string }> = [
    { key: "BUILDER_PRIVATE_KEY", value: creds.privateKey },
    { key: "BUILDER_PUBLIC_KEY", value: creds.publicKey },
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
 * only for unauthenticated/CLI/background contexts.
 */
export async function resolveSecret(key: string): Promise<string | null> {
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
      if (userSecret?.value) return userSecret.value;

      const orgId = getRequestOrgId();
      if (orgId) {
        // Fall back to the active org's shared row, when present. Builder
        // Connect uses this first-class org scope.
        const orgSecret = await readAppSecret({
          key,
          scope: "org",
          scopeId: orgId,
        });
        if (orgSecret?.value) return orgSecret.value;

        // Registered secrets historically used "workspace" scope for
        // org-shared configuration. Keep reading it so Settings status and
        // runtime resolution agree.
        const workspaceSecret = await readAppSecret({
          key,
          scope: "workspace",
          scopeId: orgId,
        });
        if (workspaceSecret?.value) return workspaceSecret.value;
      } else {
        const soloWorkspaceSecret = await readAppSecret({
          key,
          scope: "workspace",
          scopeId: `solo:${email}`,
        });
        if (soloWorkspaceSecret?.value) return soloWorkspaceSecret.value;
      }
    } catch {
      // Secrets table not ready — treat as missing.
    }
    // Authenticated multi-tenant context: never fall back to process.env.
    // The deploy-level value would silently impersonate the actual key
    // owner across every tenant.
    return null;
  }
  // Unauthenticated / local-dev / CLI / background context: env fallback
  // is safe because there's no user to mis-identify.
  return process.env[key] || null;
}

// ---------------------------------------------------------------------------
// Synchronous helpers — env-only fallbacks for contexts where per-user
// lookup isn't possible (sync isConfigured checks, CLI scripts).
// ---------------------------------------------------------------------------

/**
 * True when a Builder private key is configured at the deployment level.
 *
 * This is the same check as `isBuilderEnvManaged()` (env-managed mode is
 * defined as "deploy-level BUILDER_PRIVATE_KEY is set"). Prefer
 * `isBuilderEnvManaged()` for new call sites — its name reflects what the
 * boolean means semantically. For "does this user have access to Builder
 * (env or per-user)?" use the async `resolveHasBuilderPrivateKey()`.
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
    "https://ai-services.builder.io"
  );
}

/**
 * Base URL for the public Builder LLM gateway (distinct from the internal
 * proxy origin above — the public gateway lives at
 * api.builder.io/agent-native/gateway, while the internal origin is
 * ai-services.builder.io).
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
