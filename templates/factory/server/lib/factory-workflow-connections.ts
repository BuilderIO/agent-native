import { resolveCredentialDetailed } from "@agent-native/core/credentials";
import {
  canAuthorizeBuilderApiRequest,
  getCredentialContext,
  getEmailReadiness,
} from "@agent-native/core/server";
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

import { resolveFactoryConnectorSources } from "../connectors/credentials.js";
import { FACTORY_APP_ID } from "./provider-api.js";

export type ProviderConnectionStatus =
  | "connected"
  | "not connected"
  | "unknown";

export interface ProviderConnection {
  provider: string;
  /** `unknown` means the check itself failed; it is never read as not connected. */
  status: ProviderConnectionStatus;
  /** Where a person connects it when it is not connected. */
  connectWith: "workspace-connection" | "vault" | "settings" | null;
  /** Why the status is `unknown`, what is missing, or what limits a connection that works. */
  detail?: string;
}

// Providers the shared workspace-connection catalog knows, so a connection
// granted to Factory counts. A vault key counts too, as in provider-api-request.
const WORKSPACE_CONNECTION_PROVIDERS = new Set([
  "hubspot",
  "jira",
  "notion",
  "bigquery",
]);

// The keys a provider needs in the vault when it has no connection, one list
// per way of signing in. Kept next to a spec that checks each name against the
// provider API catalog, so a rename there cannot leave this silently wrong.
export const PROVIDER_VAULT_KEYS: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  hubspot: [["HUBSPOT_PRIVATE_APP_TOKEN"], ["HUBSPOT_ACCESS_TOKEN"]],
  jira: [["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"]],
  notion: [["NOTION_API_KEY"]],
  bigquery: [["BIGQUERY_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS_JSON"]],
  gong: [["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET"]],
  stripe: [["STRIPE_SECRET_KEY"]],
  pylon: [["PYLON_API_KEY"]],
  posthog: [["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"]],
};

type Attempt<T> = { ok: true; value: T } | { ok: false; message: string };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "The check could not run.",
    };
  }
}

function unknown(
  provider: string,
  connectWith: ProviderConnection["connectWith"],
  message: string,
): ProviderConnection {
  return { provider, status: "unknown", connectWith, detail: message };
}

function known(
  provider: string,
  connectWith: ProviderConnection["connectWith"],
  connected: boolean,
  missing: string,
  limit?: string,
): ProviderConnection {
  return connected
    ? {
        provider,
        status: "connected",
        connectWith,
        ...(limit ? { detail: limit } : {}),
      }
    : { provider, status: "not connected", connectWith, detail: missing };
}

// A workflow run resolves a credential the way the readiness check does,
// local `.env` included; provider-api-request needs a workspace connection.
const LOCAL_ENV_ONLY =
  "Connected through this machine's local .env only: workflow runs can use it, but provider-api-request needs a workspace connection.";

async function hasVaultKeys(provider: string): Promise<boolean> {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error("Credential lookups need an authenticated request.");
  }
  for (const keys of PROVIDER_VAULT_KEYS[provider] ?? []) {
    const found = await Promise.all(
      keys.map((key) => resolveCredentialDetailed(key, ctx)),
    );
    if (found.every(Boolean)) return true;
  }
  return false;
}

async function hasReadyConnection(provider: string): Promise<boolean> {
  const catalog = await listWorkspaceConnectionProviderCatalogForApp({
    appId: FACTORY_APP_ID,
    provider,
    includeConnections: "granted",
  });
  return catalog.providers.some(
    (entry) => entry.id === provider && entry.readiness.status === "ready",
  );
}

/**
 * Whether each provider has a usable credential for this caller, through the
 * same resolvers the workflow's calls will use. Presence only: no secret value
 * leaves this function, and no deployment environment is read.
 */
export async function readProviderConnections(
  providers: readonly string[],
  identity: { userEmail: string; orgId: string },
): Promise<ProviderConnection[]> {
  const wanted = [...new Set(providers)].sort();
  const connectors = wanted.some((p) =>
    ["slack", "github", "sentry"].includes(p),
  )
    ? await attempt(() =>
        resolveFactoryConnectorSources(identity.userEmail, {
          orgId: identity.orgId,
        }),
      )
    : null;

  const result: ProviderConnection[] = [];
  for (const provider of wanted) {
    if (provider === "factory") {
      result.push({ provider, status: "connected", connectWith: null });
    } else if (
      provider === "slack" ||
      provider === "github" ||
      provider === "sentry"
    ) {
      result.push(
        !connectors || !connectors.ok
          ? unknown(
              provider,
              "workspace-connection",
              connectors?.ok === false
                ? connectors.message
                : "Connector readiness is unavailable.",
            )
          : known(
              provider,
              "workspace-connection",
              connectors.value[provider] !== undefined,
              "Connect it in Dispatch or add a vault token.",
              connectors.value[provider] === "local-env"
                ? LOCAL_ENV_ONLY
                : undefined,
            ),
      );
    } else if (provider === "email") {
      const readiness = await getEmailReadiness();
      result.push(
        readiness.status === "unavailable"
          ? unknown(provider, "settings", "Email settings could not be read.")
          : known(
              provider,
              "settings",
              readiness.status === "ready",
              `Email is ${readiness.status.replace("-", " ")}.`,
            ),
      );
    } else if (provider === "builder") {
      const builder = await attempt(() =>
        canAuthorizeBuilderApiRequest("builder:agents:run"),
      );
      result.push(
        builder.ok
          ? known(
              provider,
              "settings",
              builder.value,
              "No Builder connection grants builder:agents:run.",
            )
          : unknown(provider, "settings", builder.message),
      );
    } else {
      const connectWith = WORKSPACE_CONNECTION_PROVIDERS.has(provider)
        ? "workspace-connection"
        : "vault";
      const viaConnection =
        connectWith === "workspace-connection"
          ? await attempt(() => hasReadyConnection(provider))
          : null;
      if (viaConnection?.ok && viaConnection.value) {
        result.push({ provider, status: "connected", connectWith });
        continue;
      }
      const viaVault = await attempt(() => hasVaultKeys(provider));
      if (viaVault.ok && viaVault.value) {
        result.push({ provider, status: "connected", connectWith });
        continue;
      }
      const failed = [viaConnection, viaVault].find(
        (entry): entry is { ok: false; message: string } =>
          entry !== null && !entry.ok,
      );
      result.push(
        failed
          ? unknown(provider, connectWith, failed.message)
          : {
              provider,
              status: "not connected",
              connectWith,
              detail:
                connectWith === "vault"
                  ? "Add its key to the vault."
                  : "Connect it in Dispatch or add its key to the vault.",
            },
      );
    }
  }
  return result;
}
