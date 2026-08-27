import { resolveCredential } from "@agent-native/core/credentials";
import { isLocalDatabase } from "@agent-native/core/db";
import { orgMembers, resolveOrgIdForEmail } from "@agent-native/core/org";
import { readAppSecret } from "@agent-native/core/secrets";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";
import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";

function getVaultOrgId(): string | undefined {
  return process.env.AGENT_VAULT_ORG_ID?.trim() || undefined;
}

export interface ResolveConnectorSecretOptions {
  orgId?: string | null;
}

const WORKSPACE_PROVIDER_BY_KEY: Record<string, string> = {
  GITHUB_TOKEN: "github",
  SENTRY_AUTH_TOKEN: "sentry",
  SENTRY_SERVER_TOKEN: "sentry",
  SLACK_BOT_TOKEN: "slack",
  SLACK_BOT_TOKEN_2: "slack",
};
const VAULT_ONLY_KEYS = new Set([
  ...Object.keys(WORKSPACE_PROVIDER_BY_KEY),
  "SENTRY_ORG_SLUG",
]);

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /no such table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

function isExplicitLocalNodeEnv(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

function isNetlifyCliLocalRuntime(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return true;
  if (process.env.NETLIFY === "false") return true;
  if (/^(1|true)$/i.test(process.env.NETLIFY_DEV ?? "")) return true;
  return process.env.CONTEXT === "dev";
}

function isNetlifyHostedRuntime(): boolean {
  if (isNetlifyCliLocalRuntime()) return false;
  if (/^(1|true)$/i.test(process.env.NETLIFY ?? "")) return true;
  // NETLIFY is a build-only variable. Deployed Functions document SITE_ID as
  // the runtime host marker. `netlify dev` also injects SITE_ID, so local
  // sqlite keeps the .env fallback only when a CLI-local signal is present.
  return Boolean(process.env.SITE_ID); // guard:allow-env-credential — Netlify's read-only public site identifier is a runtime host marker, not a user credential.
}

function isHostedPlatformRuntime(): boolean {
  return (
    isNetlifyHostedRuntime() ||
    /^(1|true)$/i.test(process.env.VERCEL ?? "") ||
    /^(1|true)$/i.test(process.env.CF_PAGES ?? "") ||
    Boolean(
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.FUNCTIONS_WORKER_RUNTIME ||
      process.env.K_SERVICE ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME ||
      process.env.RAILWAY_ENVIRONMENT_ID || // guard:allow-env-credential — Railway runtime host marker, not a user credential
      process.env.RAILWAY_SERVICE_ID, // guard:allow-env-credential — Railway runtime host marker, not a user credential
    )
  );
}

function isHostedWorkspaceRuntime(): boolean {
  return (
    /^(1|true)$/i.test(process.env.AGENT_NATIVE_WORKSPACE ?? "") ||
    /^(1|true)$/i.test(process.env.VITE_AGENT_NATIVE_WORKSPACE ?? "") ||
    Boolean(process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON?.trim()) ||
    Boolean(process.env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON?.trim()) ||
    Boolean(
      process.env.FUSION_ENVIRONMENT ||
      process.env.FUSION_ENV_ORIGIN ||
      process.env.VITE_FUSION_ENV_ORIGIN,
    )
  );
}

function canUseLocalProviderEnvFallback(): boolean {
  // Allowlist: sqlite `pnpm dev` / vitest. A file: URL on an unnamed hosted
  // runtime is not local development, even when NODE_ENV is unset.
  return (
    isLocalDatabase() &&
    isExplicitLocalNodeEnv() &&
    !isHostedPlatformRuntime() &&
    !isHostedWorkspaceRuntime()
  );
}

export class VaultUnavailableError extends Error {
  cause: unknown;

  constructor(cause: unknown) {
    super(
      "Couldn't reach the secret vault (transient) - retry in a moment. The key may be configured; this is not a missing-key error.",
    );
    this.cause = cause;
  }
}

async function listOrgIdsForEmail(userEmail: string): Promise<string[]> {
  const rows = await getDb()
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(sql`lower(${orgMembers.email})`, userEmail));
  return Array.from(new Set(rows.map((row) => row.orgId).filter(Boolean)));
}

async function readVaultSecret(
  key: string,
  scope: "user" | "org" | "workspace",
  scopeId: string,
  attempts = 3,
  delayMs = 250,
): Promise<string | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const secret = await readAppSecret({ key, scope, scopeId });
      return secret?.value?.trim() || undefined;
    } catch (error) {
      if (isMissingTableError(error)) return undefined;
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs * (attempt + 1)),
        );
      }
    }
  }
  throw new VaultUnavailableError(lastError);
}

/**
 * Resolve a workspace connector key without assuming the caller's active org.
 * Dispatch may sync a workspace key under another org, so memberships and the
 * designated vault org are part of the lookup rather than a fallback afterthought.
 */
export async function resolveConnectorSecret(
  key: string,
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<string | undefined> {
  const userEmail = ownerEmail.trim().toLowerCase();
  const primaryOrgId =
    options.orgId?.trim() || (await resolveOrgIdForEmail(userEmail));

  const workspaceProvider = WORKSPACE_PROVIDER_BY_KEY[key];
  if (workspaceProvider) {
    try {
      const connected = await resolveWorkspaceConnectionCredentialForApp({
        appId: "factory",
        provider: workspaceProvider,
        key,
        userEmail,
        orgId: primaryOrgId,
      });
      if (connected.available && connected.value) return connected.value.trim();
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  const userSecret = await readVaultSecret(key, "user", userEmail);
  if (userSecret) return userSecret;

  const membershipOrgIds = await listOrgIdsForEmail(userEmail);
  const orgIds = Array.from(
    new Set(
      [primaryOrgId, ...membershipOrgIds].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  );

  for (const orgId of orgIds) {
    for (const scope of ["org", "workspace"] as const) {
      const scopedSecret = await readVaultSecret(key, scope, orgId);
      if (scopedSecret) return scopedSecret;
    }
  }

  if (orgIds.length === 0) {
    const soloSecret = await readVaultSecret(
      key,
      "workspace",
      `solo:${userEmail}`,
    );
    if (soloSecret) return soloSecret;
  }

  for (const orgId of orgIds.length > 0 ? orgIds : [undefined]) {
    const legacySecret = await resolveCredential(key, { userEmail, orgId });
    if (legacySecret?.trim()) return legacySecret.trim();
  }

  const vaultOrgId = getVaultOrgId();
  if (vaultOrgId && !orgIds.includes(vaultOrgId)) {
    for (const scope of ["org", "workspace"] as const) {
      const vaultSecret = await readVaultSecret(key, scope, vaultOrgId);
      if (vaultSecret) return vaultSecret;
    }
  }

  // Hosted Factory keeps Slack/GitHub/Sentry vault-only. Local `pnpm dev`
  // sqlite may still read `.env` so polling works without a Dispatch connection.
  if (!VAULT_ONLY_KEYS.has(key) || canUseLocalProviderEnvFallback()) {
    const environmentSecret = process.env[key]?.trim(); // guard:allow-env-credential - local sqlite and generic deploy-level connector fallback
    if (environmentSecret) return environmentSecret;
  }

  return undefined;
}
