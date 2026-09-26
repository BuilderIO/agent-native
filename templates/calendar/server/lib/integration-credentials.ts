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
import { getOrgContext } from "@agent-native/core/org";
import { getSession } from "@agent-native/core/server";
import { type H3Event } from "h3";

export type IntegrationProvider = "apollo" | "hubspot" | "gong" | "pylon";

function credentialKey(provider: IntegrationProvider): string {
  return credentialKeys(provider)[0]!;
}

export function credentialKeys(provider: IntegrationProvider): string[] {
  switch (provider) {
    case "apollo":
      return ["APOLLO_API_KEY"];
    case "hubspot":
      return [
        "HUBSPOT_PRIVATE_APP_TOKEN",
        "HUBSPOT_ACCESS_TOKEN",
        "HUBSPOT_API_KEY",
      ];
    case "gong":
      return ["GONG_API_KEY", "GONG_ACCESS_KEY", "GONG_ACCESS_SECRET"];
    case "pylon":
      return ["PYLON_API_KEY"];
  }
}

export async function getIntegrationContext(
  event: H3Event,
): Promise<CredentialContext | null> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return null;
  const ctx = await getOrgContext(event).catch(() => null);
  const orgId = ctx?.orgId ?? session.orgId ?? null;
  return { userEmail: session.email, orgId };
}

export async function getIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
): Promise<string | undefined> {
  const ctx = await getIntegrationContext(event);
  if (!ctx) return undefined;
  if (provider === "gong") {
    const legacyValue = await resolveCredential("GONG_API_KEY", ctx);
    if (legacyValue) return legacyValue;
    const accessKey = await resolveCredential("GONG_ACCESS_KEY", ctx);
    const accessSecret = await resolveCredential("GONG_ACCESS_SECRET", ctx);
    return accessKey && accessSecret
      ? `${accessKey}:${accessSecret}`
      : undefined;
  }
  for (const key of credentialKeys(provider)) {
    const value = await resolveCredential(key, ctx);
    if (value) return value;
  }
  return undefined;
}

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

export async function deleteIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
): Promise<boolean> {
  const ctx = await getIntegrationContext(event);
  if (!ctx) return false;
  await deleteCredential(credentialKey(provider), ctx);
  return true;
}
