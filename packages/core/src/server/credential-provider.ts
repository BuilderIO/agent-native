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

import { getRequestUserEmail } from "./request-context.js";
import { DEV_MODE_USER_EMAIL } from "./auth.js";

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
// Builder credential resolution — two mutually-exclusive deployment modes:
//
//   1. **Single-tenant / env-managed.** When BUILDER_PRIVATE_KEY is set at
//      the deployment level, it is THE Builder identity for every user of
//      this deploy. The operator setting the env explicitly opts in to
//      "everyone shares one Builder space" — same shape as DATABASE_URL or
//      BETTER_AUTH_SECRET. The UI hides the per-user connect/disconnect
//      flow when env-managed (see `isBuilderEnvManaged`).
//
//   2. **Multi-tenant / per-user OAuth.** When the env is unset, each user
//      OAuth-connects their own Builder via the cli-auth flow. Their keys
//      land in `app_secrets` (scope=user, scopeId=email) via the callback
//      handler. They can disconnect via the settings panel.
//
// To run multi-tenant SaaS: leave the env unset. Setting BUILDER_PRIVATE_KEY
// on a multi-tenant deploy will silently route every authenticated user
// through the env-key owner's Builder identity — that was the KVesta Space
// cross-tenant attribution leak (2026-04). The mode is binary: env-set
// means single-tenant intent.
// ---------------------------------------------------------------------------

export async function resolveBuilderCredential(
  key: string,
): Promise<string | null> {
  // Env-managed mode wins when set: deploy-level Builder identity for
  // every user. Per-user app_secrets (left over from a previous OAuth
  // connection or a mode switch) are intentionally ignored — the
  // operator's deploy-level config is authoritative.
  const envValue = readDeployCredentialEnv(key);
  if (envValue) return envValue;

  // No env value: per-user OAuth fallback.
  const email = getRequestUserEmail();
  if (email) {
    try {
      const { readAppSecret } = await import("../secrets/storage.js");
      const secret = await readAppSecret({
        key,
        scope: "user",
        scopeId: email,
      });
      if (secret) return secret.value;
    } catch {
      // Secrets table not ready — treat as missing.
    }
  }
  return null;
}

/**
 * True when `BUILDER_PRIVATE_KEY` is set at the deployment level — every
 * user of this deploy shares the operator's Builder identity, and per-user
 * connect/disconnect is disabled. UIs read this via `/builder/status` to
 * swap the "Connect Builder" prompts for a read-only "managed by deployment"
 * chip and to suppress the disconnect button.
 */
export function isBuilderEnvManaged(): boolean {
  return !!process.env.BUILDER_PRIVATE_KEY;
}

/**
 * Resolve the current user's Builder private key.
 * Checks per-user app_secrets first, then falls back to process.env.
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

/**
 * Write Builder credentials for the current user to per-user app_secrets.
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
): Promise<void> {
  const { writeAppSecret } = await import("../secrets/storage.js");
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
      writeAppSecret({ key, value, scope: "user", scopeId: email }),
    ),
  );
}

/**
 * Delete Builder credentials for the current user from app_secrets.
 */
export async function deleteBuilderCredentials(email: string): Promise<void> {
  const { deleteAppSecret } = await import("../secrets/storage.js");
  const keys = [
    "BUILDER_PRIVATE_KEY",
    "BUILDER_PUBLIC_KEY",
    "BUILDER_USER_ID",
    "BUILDER_ORG_NAME",
    "BUILDER_ORG_KIND",
  ];
  await Promise.all(
    keys.map((key) =>
      deleteAppSecret({ key, scope: "user", scopeId: email }).catch(() => {}),
    ),
  );
}

// ---------------------------------------------------------------------------
// Generic per-user secret resolution
//
// New consumers should prefer this over reading `process.env.X` directly.
// User-pasted secrets live in `app_secrets` (encrypted, scope=user); the
// settings UI / onboarding panels write here. Deploy-level env vars are
// the fallback for unauthenticated/CLI/background contexts where there's
// no user to scope by — never the silent fallback for an authenticated
// request, since on a multi-tenant deploy that would silently identify
// every user as whoever set the deploy-level key (KVesta Space, 2026-04).
// ---------------------------------------------------------------------------

/**
 * Resolve a per-user secret. Reads from `app_secrets` first (scoped by
 * the current request's authenticated user); falls back to `process.env`
 * only for unauthenticated/CLI/background contexts.
 */
export async function resolveSecret(key: string): Promise<string | null> {
  const email = getRequestUserEmail();
  if (email && email !== DEV_MODE_USER_EMAIL) {
    try {
      const { readAppSecret } = await import("../secrets/storage.js");
      const secret = await readAppSecret({
        key,
        scope: "user",
        scopeId: email,
      });
      if (secret?.value) return secret.value;
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
 * proxy origin above — the public gateway lives at api.builder.io/codegen,
 * while the internal origin is ai-services.builder.io).
 * Override via BUILDER_GATEWAY_BASE_URL for staging / testing.
 */
export function getBuilderGatewayBaseUrl(): string {
  return (
    process.env.BUILDER_GATEWAY_BASE_URL ||
    "https://api.builder.io/codegen/gateway/v1"
  );
}

/** Authorization header value for Builder-proxied calls (env-only). */
export function getBuilderAuthHeader(): string | null {
  const key = process.env.BUILDER_PRIVATE_KEY;
  return key ? `Bearer ${key}` : null;
}
