import { resolveCredential } from "@agent-native/core/credentials";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { readAppSecret } from "@agent-native/core/secrets";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";

import { noteCredentialSource } from "../lib/workflow-run-observer.js";
import type { CredentialSource } from "../tripwire/types.js";

function getVaultOrgId(): string | undefined {
  return process.env.AGENT_VAULT_ORG_ID?.trim() || undefined;
}

export interface ResolveConnectorSecretOptions {
  orgId?: string | null;
  recordUsage?: boolean;
}

const WORKSPACE_PROVIDER_BY_KEY: Record<string, string> = {
  GITHUB_TOKEN: "github",
  SENTRY_AUTH_TOKEN: "sentry",
  SENTRY_SERVER_TOKEN: "sentry",
  SLACK_BOT_TOKEN: "slack",
  SLACK_BOT_TOKEN_2: "slack",
};
const GITHUB_APP_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY",
] as const;
/** Which provider a connector key belongs to, for the run's credential-source note; undefined for a key that is not a credential. */
function providerForKey(key: string): string | undefined {
  if (WORKSPACE_PROVIDER_BY_KEY[key]) return WORKSPACE_PROVIDER_BY_KEY[key];
  return (GITHUB_APP_KEYS as readonly string[]).includes(key)
    ? "github"
    : undefined;
}

/** Where in the vault a connector credential was found, as a word and never an id: the organization it was requested for, the designated vault organization, or a personal, solo or legacy entry. */
type VaultScopeKind = "user" | "own-org" | "vault-org" | "solo" | "legacy";

/** Tells the run where a connector credential came from; readiness checks pass `recordUsage: false` and say nothing. */
function noteConnectorSource(
  key: string,
  source: CredentialSource,
  options: ResolveConnectorSecretOptions,
  scopeKind?: VaultScopeKind,
): void {
  const provider = providerForKey(key);
  if (options.recordUsage === false || !provider) return;
  noteCredentialSource({
    provider,
    source,
    details: { via: "connector", ...(scopeKind ? { scopeKind } : {}) },
  });
}

const VAULT_ONLY_KEYS = new Set([
  ...Object.keys(WORKSPACE_PROVIDER_BY_KEY),
  ...GITHUB_APP_KEYS,
  "SENTRY_ORG_SLUG",
]);

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /relation .* does not exist/i.test(message);
}

function isExplicitLocalNodeEnv(): boolean {
  return process.env.NODE_ENV === "development";
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
  return (
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
 * Where a connector credential came from. `local-env` is this machine's
 * `.env`, which only local development reads: a workflow run can use it, but
 * `provider-api-request` cannot, since that needs a workspace connection.
 */
type ConnectorSecretSource = "workspace" | "local-env";

/**
 * Resolve a workspace connector key for the requested organization only.
 * The designated vault org is the only extra org searched — never every
 * membership — so an org-A Factory job cannot pick up org-B's token.
 */
export async function resolveConnectorSecret(
  key: string,
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<string | undefined> {
  return (await resolveConnectorSecretWithSource(key, ownerEmail, options))
    ?.value;
}

async function resolveConnectorSecretWithSource(
  key: string,
  ownerEmail: string,
  options: ResolveConnectorSecretOptions,
): Promise<{ value: string; source: ConnectorSecretSource } | undefined> {
  const workspace = (
    value: string,
    via: "workspace-connection" | "vault",
    scopeKind?: VaultScopeKind,
  ) => {
    noteConnectorSource(key, via, options, scopeKind);
    return { value, source: "workspace" as const };
  };
  const userEmail = ownerEmail.trim().toLowerCase();
  const requestedOrgId =
    options.orgId?.trim() || (await resolveOrgIdForEmail(userEmail));

  const workspaceProvider = WORKSPACE_PROVIDER_BY_KEY[key];
  if (workspaceProvider) {
    try {
      const connected = await resolveWorkspaceConnectionCredentialForApp({
        appId: "factory",
        provider: workspaceProvider,
        key,
        userEmail,
        orgId: requestedOrgId,
        recordUsage: options.recordUsage,
      });
      if (connected.available && connected.value) {
        return workspace(connected.value.trim(), "workspace-connection");
      }
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  const userSecret = await readVaultSecret(key, "user", userEmail);
  if (userSecret) return workspace(userSecret, "vault", "user");

  const vaultOrgId = getVaultOrgId();
  const orgIds = Array.from(
    new Set(
      [requestedOrgId, vaultOrgId].filter((id): id is string => Boolean(id)),
    ),
  );

  for (const orgId of orgIds) {
    for (const scope of ["org", "workspace"] as const) {
      const scopedSecret = await readVaultSecret(key, scope, orgId);
      if (scopedSecret) {
        return workspace(
          scopedSecret,
          "vault",
          orgId === requestedOrgId ? "own-org" : "vault-org",
        );
      }
    }
  }

  if (!requestedOrgId) {
    const soloSecret = await readVaultSecret(
      key,
      "workspace",
      `solo:${userEmail}`,
    );
    if (soloSecret) return workspace(soloSecret, "vault", "solo");
  }

  for (const orgId of orgIds.length > 0 ? orgIds : [undefined]) {
    const legacySecret = await resolveCredential(key, { userEmail, orgId });
    if (legacySecret?.trim()) {
      return workspace(legacySecret.trim(), "vault", "legacy");
    }
  }

  if (!VAULT_ONLY_KEYS.has(key) || canUseLocalProviderEnvFallback()) {
    const environmentSecret = process.env[key]?.trim(); // guard:allow-env-credential - explicit local development or generic deploy-level connector fallback
    if (environmentSecret) {
      noteConnectorSource(key, "env", options);
      return { value: environmentSecret, source: "local-env" };
    }
  }

  return undefined;
}

export function slackConnectorKey(
  workspace: "primary" | "secondary" = "primary",
): "SLACK_BOT_TOKEN" | "SLACK_BOT_TOKEN_2" {
  return workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
}

export function connectorKeysForSource(
  source: "slack" | "github" | "sentry",
  slackWorkspace: "primary" | "secondary" = "primary",
): readonly string[] {
  if (source === "slack") return [slackConnectorKey(slackWorkspace)];
  if (source === "github") return ["GITHUB_TOKEN"];
  return ["SENTRY_SERVER_TOKEN", "SENTRY_AUTH_TOKEN"];
}

/** Where the first of `keys` that resolves came from. Never returns the secret value. */
async function connectorSecretSource(
  keys: string | readonly string[],
  ownerEmail: string,
  options: ResolveConnectorSecretOptions,
): Promise<ConnectorSecretSource | undefined> {
  const list = typeof keys === "string" ? [keys] : keys;
  for (const key of list) {
    const found = await resolveConnectorSecretWithSource(
      key,
      ownerEmail,
      options,
    );
    if (found) return found.source;
  }
  return undefined;
}

/** Presence only — never return the secret value to callers. */
export async function hasConnectorSecret(
  keys: string | readonly string[],
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<boolean> {
  return (await connectorSecretSource(keys, ownerEmail, options)) !== undefined;
}

async function gitHubConnectorSource(
  ownerEmail: string,
  options: ResolveConnectorSecretOptions,
): Promise<ConnectorSecretSource | undefined> {
  const token = await connectorSecretSource(
    "GITHUB_TOKEN",
    ownerEmail,
    options,
  );
  if (token) return token;
  const appKeys = await Promise.all(
    GITHUB_APP_KEYS.map((key) =>
      connectorSecretSource(key, ownerEmail, options),
    ),
  );
  if (appKeys.some((source) => source === undefined)) return undefined;
  return appKeys.includes("local-env") ? "local-env" : "workspace";
}

async function hasGitHubConnectorSecret(
  ownerEmail: string,
  options: ResolveConnectorSecretOptions,
): Promise<boolean> {
  return (await gitHubConnectorSource(ownerEmail, options)) !== undefined;
}

/** Where each Factory connector's credential comes from, `undefined` when it has none. */
export async function resolveFactoryConnectorSources(
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<{
  slack: ConnectorSecretSource | undefined;
  slackSecondary: ConnectorSecretSource | undefined;
  github: ConnectorSecretSource | undefined;
  sentry: ConnectorSecretSource | undefined;
}> {
  const readinessOptions = { ...options, recordUsage: false };
  const [slack, slackSecondary, github, sentry] = await Promise.all([
    connectorSecretSource("SLACK_BOT_TOKEN", ownerEmail, readinessOptions),
    connectorSecretSource("SLACK_BOT_TOKEN_2", ownerEmail, readinessOptions),
    gitHubConnectorSource(ownerEmail, readinessOptions),
    connectorSecretSource(
      ["SENTRY_SERVER_TOKEN", "SENTRY_AUTH_TOKEN"],
      ownerEmail,
      readinessOptions,
    ),
  ]);
  return { slack, slackSecondary, github, sentry };
}

export async function resolveFactoryConnectorReadiness(
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<{
  slack: boolean;
  slackSecondary: boolean;
  github: boolean;
  sentry: boolean;
}> {
  const sources = await resolveFactoryConnectorSources(ownerEmail, options);
  return {
    slack: sources.slack !== undefined,
    slackSecondary: sources.slackSecondary !== undefined,
    github: sources.github !== undefined,
    sentry: sources.sentry !== undefined,
  };
}

export async function assertFactoryConnectorReady(
  source: "slack" | "github" | "sentry",
  ownerEmail: string,
  options: ResolveConnectorSecretOptions & {
    slackWorkspace?: "primary" | "secondary";
    verb?: "creating" | "saving";
  } = {},
): Promise<void> {
  const verb = options.verb ?? "creating";
  const label =
    source === "slack" ? "Slack" : source === "github" ? "GitHub" : "Sentry";
  const ready =
    source === "github"
      ? await hasGitHubConnectorSecret(ownerEmail, options)
      : await hasConnectorSecret(
          connectorKeysForSource(source, options.slackWorkspace),
          ownerEmail,
          options,
        );
  if (!ready) {
    throw new Error(
      `Connect ${label} in Dispatch or add a vault token before ${verb} this job.`,
    );
  }
}
