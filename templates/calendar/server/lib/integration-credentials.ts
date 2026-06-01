/**
 * Per-user credential helpers for the calendar CRM integrations
 * (Apollo / HubSpot / Gong / Pylon).
 *
 * SECURITY: Raw third-party API keys are secrets. They MUST live in the
 * encrypted credentials vault (`saveCredential`/`resolveCredential`), scoped to
 * the requesting user — never in `application_state` (which is serialized back
 * to the browser by the framework's getState handler) and never returned to the
 * client. See `.agents/skills/security` and
 * `packages/core/src/credentials/index.ts`.
 *
 * Every read passes the caller's CredentialContext so the underlying SQL
 * settings store scopes by `u:<email>` (falling back to `o:<orgId>` when an org
 * credential exists). A hardcoded shared scope would leak one tenant's key to
 * another.
 */
import {
  resolveCredential,
  saveCredential,
  deleteCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import { getSession } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { type H3Event } from "h3";

export type IntegrationProvider = "apollo" | "hubspot" | "gong" | "pylon";

/** Vault credential key for a provider's API key. */
function credentialKey(provider: IntegrationProvider): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Build a CredentialContext from the request's session. Returns null when the
 * request is unauthenticated. Prefers `getOrgContext` for the org id (the
 * session's active org can go stale) and falls back to the session value.
 */
export async function getIntegrationContext(
  event: H3Event,
): Promise<CredentialContext | null> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return null;
  const ctx = await getOrgContext(event).catch(() => null);
  const orgId = ctx?.orgId ?? session.orgId ?? null;
  return { userEmail: session.email, orgId };
}

/**
 * Resolve a provider's API key for the requesting user. Returns undefined when
 * unauthenticated or not connected.
 */
export async function getIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
): Promise<string | undefined> {
  const ctx = await getIntegrationContext(event);
  if (!ctx) return undefined;
  return resolveCredential(credentialKey(provider), ctx);
}

/** Persist a provider's API key in the encrypted vault, scoped to the user. */
export async function saveIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
  apiKey: string,
): Promise<boolean> {
  const ctx = await getIntegrationContext(event);
  if (!ctx) return false;
  await saveCredential(credentialKey(provider), apiKey, ctx);
  return true;
}

/** Remove a provider's API key from the user's vault. */
export async function deleteIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
): Promise<boolean> {
  const ctx = await getIntegrationContext(event);
  if (!ctx) return false;
  await deleteCredential(credentialKey(provider), ctx);
  return true;
}
