/**
 * Credential helpers for the calendar CRM integrations
 * (Apollo / HubSpot / Gong / Pylon).
 *
 * SECURITY: Raw third-party API keys are secrets. They MUST live in the
 * encrypted credentials vault (`saveCredential`/`resolveCredential`), scoped to
 * the requesting user or their organization — never in `application_state` (which is serialized back
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
  deleteResolvedCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import { getOrgContext } from "@agent-native/core/org";
import { canManageOrg } from "@agent-native/core/org/permissions";
import { getSession } from "@agent-native/core/server";
import { createError, type H3Event } from "h3";

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

function orgKeyForbidden() {
  return createError({
    statusCode: 403,
    statusMessage:
      "Only organization owners and admins can change the organization's key",
  });
}

// Read without a fallback: an unreadable role must fail the request, never
// land an owner's or admin's key in their personal row.
async function managedOrgId(event: H3Event): Promise<string | null> {
  const org = await getOrgContext(event);
  return org.orgId && canManageOrg(org.role) ? org.orgId : null;
}

/**
 * Owners and admins save for the organization unless they ask for "user";
 * members, and anyone without an organization, save personally.
 */
export async function saveIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
  apiKey: string,
  requestedScope?: unknown,
): Promise<boolean> {
  if (
    requestedScope !== undefined &&
    requestedScope !== "user" &&
    requestedScope !== "org"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'scope must be "user" or "org"',
    });
  }
  const ctx = await getIntegrationContext(event);
  if (!ctx) return false;
  const orgId = await managedOrgId(event);
  const scope =
    requestedScope === "user" || requestedScope === "org"
      ? requestedScope
      : orgId
        ? "org"
        : "user";
  if (scope === "org" && !orgId) throw orgKeyForbidden();
  await saveCredential(credentialKey(provider), apiKey, {
    ...ctx,
    orgId: orgId ?? ctx.orgId,
    scope,
  });
  return true;
}

/** Removes the row the status and lookups answer with. */
export async function deleteIntegrationKey(
  event: H3Event,
  provider: IntegrationProvider,
): Promise<boolean> {
  const ctx = await getIntegrationContext(event);
  if (!ctx) return false;
  await deleteResolvedCredential(credentialKey(provider), ctx);
  return true;
}
