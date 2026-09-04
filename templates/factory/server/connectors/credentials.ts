import { resolveCredential } from "@agent-native/core/credentials";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { readAppSecret } from "@agent-native/core/secrets";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";

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
const VAULT_ONLY_KEYS = new Set([
  ...Object.keys(WORKSPACE_PROVIDER_BY_KEY),
  ...GITHUB_APP_KEYS,
  "SENTRY_ORG_SLUG",
]);

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /no such table/i.test(message) ||
    /relation .* does not exist/i.test(message)
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
 * Resolve a workspace connector key for the requested organization only.
 * The designated vault org is the only extra org searched — never every
 * membership — so an org-A Factory job cannot pick up org-B's token.
 */
export async function resolveConnectorSecret(
  key: string,
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<string | undefined> {
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
      if (connected.available && connected.value) return connected.value.trim();
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  const userSecret = await readVaultSecret(key, "user", userEmail);
  if (userSecret) return userSecret;

  const vaultOrgId = getVaultOrgId();
  const orgIds = Array.from(
    new Set(
      [requestedOrgId, vaultOrgId].filter((id): id is string => Boolean(id)),
    ),
  );

  for (const orgId of orgIds) {
    for (const scope of ["org", "workspace"] as const) {
      const scopedSecret = await readVaultSecret(key, scope, orgId);
      if (scopedSecret) return scopedSecret;
    }
  }

  if (!requestedOrgId) {
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

  if (!VAULT_ONLY_KEYS.has(key)) {
    const environmentSecret = process.env[key]?.trim(); // guard:allow-env-credential - generic deploy-level connector fallback
    if (environmentSecret) return environmentSecret;
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

/** Presence only — never return the secret value to callers. */
export async function hasConnectorSecret(
  keys: string | readonly string[],
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<boolean> {
  const list = typeof keys === "string" ? [keys] : keys;
  for (const key of list) {
    const value = await resolveConnectorSecret(key, ownerEmail, options);
    if (value) return true;
  }
  return false;
}

async function hasGitHubConnectorSecret(
  ownerEmail: string,
  options: ResolveConnectorSecretOptions,
): Promise<boolean> {
  if (await hasConnectorSecret("GITHUB_TOKEN", ownerEmail, options)) {
    return true;
  }
  const appSecrets = await Promise.all(
    GITHUB_APP_KEYS.map((key) => hasConnectorSecret(key, ownerEmail, options)),
  );
  return appSecrets.every(Boolean);
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
  const readinessOptions = { ...options, recordUsage: false };
  const [slack, slackSecondary, github, sentry] = await Promise.all([
    hasConnectorSecret("SLACK_BOT_TOKEN", ownerEmail, readinessOptions),
    hasConnectorSecret("SLACK_BOT_TOKEN_2", ownerEmail, readinessOptions),
    hasGitHubConnectorSecret(ownerEmail, readinessOptions),
    hasConnectorSecret(
      ["SENTRY_SERVER_TOKEN", "SENTRY_AUTH_TOKEN"],
      ownerEmail,
      readinessOptions,
    ),
  ]);
  return { slack, slackSecondary, github, sentry };
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
