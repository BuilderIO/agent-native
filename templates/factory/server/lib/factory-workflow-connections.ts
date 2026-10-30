import {
  resolveCredentialDetailed,
  type CredentialContext,
} from "@agent-native/core/credentials";
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
  /** `unknown` means the check itself failed or a saved key cannot be decrypted; it is never read as not connected. */
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

// Keys a read needs beside the credential the connector resolvers find. A Sentry
// issue path carries the organization slug, so a token alone cannot read one.
// Kept next to the same catalog spec as the table above.
export const PROVIDER_COMPANION_KEYS: Readonly<
  Record<string, readonly string[]>
> = {
  sentry: ["SENTRY_ORG_SLUG"],
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

/** What core throws for a saved value it cannot decrypt; core does not export the class, so it is read by its code. */
function isUnreadableSecret(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { errorCode?: unknown }).errorCode === "app_secret_unreadable"
  );
}

type KeyState = "present" | "absent" | "unreadable";

/**
 * One vault key as a read will meet it. A value that exists but cannot be
 * decrypted is `unreadable`, never `absent`: nobody can fix the first by adding
 * a key. Any other failure of the lookup itself still throws.
 */
async function keyState(
  key: string,
  ctx: CredentialContext,
): Promise<KeyState> {
  try {
    return (await resolveCredentialDetailed(key, ctx)) ? "present" : "absent";
  } catch (error) {
    if (isUnreadableSecret(error)) return "unreadable";
    throw error;
  }
}

function credentialContext(): CredentialContext {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error("Credential lookups need an authenticated request.");
  }
  return ctx;
}

/** `present` when every key is; otherwise the keys that are unreadable, which outrank the ones that are merely absent. */
async function keysState(
  keys: readonly string[],
): Promise<{ state: "present" | "absent" } | { unreadable: string[] }> {
  const ctx = credentialContext();
  const states = await Promise.all(keys.map((key) => keyState(key, ctx)));
  const unreadable = keys.filter((_, index) => states[index] === "unreadable");
  if (unreadable.length > 0) return { unreadable };
  return {
    state: states.every((state) => state === "present") ? "present" : "absent",
  };
}

function unreadableDetail(provider: string, keys: readonly string[]): string {
  return `${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} saved but could not be decrypted here, so a ${provider} read cannot run. Save ${keys.length === 1 ? "it" : "them"} again under Keys in Settings.`;
}

type VaultReading =
  | { state: "present" | "absent" }
  | { state: "unreadable"; keys: string[] };

/**
 * Whether a way of signing in is whole in the vault, trying them in order as
 * a read does: the first that is whole connects, and a key that cannot be
 * decrypted stops the search, because the read would stop there too.
 */
async function readVaultKeys(provider: string): Promise<VaultReading> {
  for (const keys of PROVIDER_VAULT_KEYS[provider] ?? []) {
    const reading = await keysState(keys);
    if ("unreadable" in reading) {
      return { state: "unreadable", keys: reading.unreadable };
    }
    if (reading.state === "present") return { state: "present" };
  }
  return { state: "absent" };
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

function companionKeysOf(provider: string): readonly string[] | undefined {
  return Object.entries(PROVIDER_COMPANION_KEYS).find(
    ([name]) => name === provider,
  )?.[1];
}

/**
 * A connector that has its credential still cannot read without the companion
 * keys the provider's paths carry. Absent is `not connected`; saved but
 * undecryptable is `unknown`, because adding the key would not fix it.
 */
async function withCompanionKeys(
  connection: ProviderConnection,
): Promise<ProviderConnection> {
  const { provider } = connection;
  const keys = companionKeysOf(provider);
  if (connection.status !== "connected" || !keys) return connection;
  const reading = await attempt(() => keysState(keys));
  if (!reading.ok) return unknown(provider, "vault", reading.message);
  if ("unreadable" in reading.value) {
    return unknown(
      provider,
      "vault",
      unreadableDetail(provider, reading.value.unreadable),
    );
  }
  if (reading.value.state === "present") return connection;
  return {
    provider,
    status: "not connected",
    connectWith: "vault",
    detail: `${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} not saved, so a ${provider} read has no organization to ask. Add ${keys.length === 1 ? "it" : "them"} under Keys in Settings.`,
  };
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
          : await withCompanionKeys(
              known(
                provider,
                "workspace-connection",
                connectors.value[provider] !== undefined,
                "Connect it in Dispatch or add a vault token.",
                connectors.value[provider] === "local-env"
                  ? LOCAL_ENV_ONLY
                  : undefined,
              ),
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
      const viaVault = await attempt(() => readVaultKeys(provider));
      if (viaVault.ok && viaVault.value.state === "present") {
        result.push({ provider, status: "connected", connectWith });
        continue;
      }
      const failure =
        viaConnection?.ok === false
          ? viaConnection.message
          : !viaVault.ok
            ? viaVault.message
            : viaVault.value.state === "unreadable"
              ? unreadableDetail(provider, viaVault.value.keys)
              : undefined;
      result.push(
        failure !== undefined
          ? unknown(provider, connectWith, failure)
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
