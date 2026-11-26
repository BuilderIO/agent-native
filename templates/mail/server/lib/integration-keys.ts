/**
 * API keys for Mail's optional contact-sidebar integrations (Apollo, HubSpot,
 * Gong, Pylon).
 *
 * New keys live in the encrypted credential store, which `db-query` and the
 * application-state routes cannot read. Keys saved to `application_state`
 * before that stay readable as a fallback; nothing here copies or deletes them.
 */
import {
  appStateGet,
  appStateGetMany,
} from "@agent-native/core/application-state";
import {
  deleteCredential,
  resolveCredential,
  saveCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import { getSession } from "@agent-native/core/server";
import type { H3Event } from "h3";

export const INTEGRATION_PROVIDERS = [
  "apollo",
  "hubspot",
  "gong",
  "pylon",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

const CREDENTIAL_KEYS: Record<IntegrationProvider, string> = {
  apollo: "APOLLO_API_KEY",
  hubspot: "HUBSPOT_PRIVATE_APP_TOKEN",
  gong: "GONG_API_KEY",
  pylon: "PYLON_API_KEY",
};

// Where a request with no signed-in user kept its legacy rows.
const LOCAL_SESSION_ID = "local";

function apiKeyFromState(
  state: Record<string, unknown> | null | undefined,
): string | undefined {
  const apiKey = state?.apiKey;
  return typeof apiKey === "string" && apiKey.trim().length > 0
    ? apiKey
    : undefined;
}

export async function integrationContextFor(
  event: H3Event,
): Promise<CredentialContext | null> {
  const session = await getSession(event);
  return session
    ? { userEmail: session.email, orgId: session.orgId ?? null }
    : null;
}

export async function readLegacyIntegrationKey(
  provider: IntegrationProvider,
  sessionId: string,
): Promise<string | undefined> {
  return apiKeyFromState(await appStateGet(sessionId, provider));
}

/** The key the credential store holds for this person, else a legacy row. */
export async function readIntegrationKey(
  provider: IntegrationProvider,
  ctx: CredentialContext | null,
): Promise<string | undefined> {
  if (ctx) {
    const stored = await resolveCredential(CREDENTIAL_KEYS[provider], ctx);
    if (stored) return stored;
  }
  return readLegacyIntegrationKey(provider, ctx?.userEmail ?? LOCAL_SESSION_ID);
}

export async function readIntegrationStatuses(
  ctx: CredentialContext,
): Promise<Record<IntegrationProvider, boolean>> {
  const legacy = await appStateGetMany(ctx.userEmail, INTEGRATION_PROVIDERS);
  const entries = await Promise.all(
    INTEGRATION_PROVIDERS.map(
      async (provider) =>
        [
          provider,
          apiKeyFromState(legacy[provider]) !== undefined ||
            (await resolveCredential(CREDENTIAL_KEYS[provider], ctx)) !==
              undefined,
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<IntegrationProvider, boolean>;
}

export async function saveIntegrationKey(
  provider: IntegrationProvider,
  apiKey: string,
  ctx: CredentialContext,
): Promise<void> {
  await saveCredential(CREDENTIAL_KEYS[provider], apiKey, {
    ...ctx,
    scope: "user",
  });
}

export async function deleteIntegrationKey(
  provider: IntegrationProvider,
  ctx: CredentialContext,
): Promise<void> {
  await deleteCredential(CREDENTIAL_KEYS[provider], {
    ...ctx,
    scope: "user",
  });
}
