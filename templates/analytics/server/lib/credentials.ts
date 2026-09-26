/**
 * Analytics-template credential helpers.
 *
 * SECURITY: Every credential read MUST pass the caller's CredentialContext so
 * the underlying SQL settings store can scope by `u:<email>` / `o:<orgId>`.
 * Reading a credential without a context is a per-tenant leak — see
 * `packages/core/src/credentials/index.ts` for the full guard rail.
 *
 * Two ways to obtain the context:
 *   1. Inside an HTTP route — call `getSession(event)` and pass
 *      `{ userEmail: session.email, orgId: session.orgId ?? null }`. Wrap the
 *      handler body in `runWithRequestContext(ctx, fn)` so any nested helpers
 *      that look at `getCredentialContext()` see the same identity.
 *   2. Inside a framework action (`/_agent-native/actions/...`) — the action
 *      router already wraps execution in `runWithRequestContext`, so you can
 *      use `getCredentialContext()` directly.
 *
 * Library helpers in `server/lib/*.ts` accept the context as their first
 * argument so the call chain is explicit and the type system enforces it.
 */
export {
  resolveCredential,
  resolveCredentialDetailed,
  assertCredentialCanReachEndpoint,
  hasCredential,
  saveCredential,
  deleteCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import {
  resolveCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import { getOrgContext } from "@agent-native/core/org";
import {
  getSession,
  getCredentialContext as getCredentialContextFromRequest,
  runWithRequestContext,
} from "@agent-native/core/server";
import type { MissingKeyResponse } from "@agent-native/core/server";
import { setResponseStatus, type H3Event } from "h3";

/**
 * Build a CredentialContext from the current H3 event's session. Throws a
 * 401-style result if the user isn't authenticated.
 *
 * Org resolution: ALWAYS prefer `getOrgContext(event)` over the raw
 * `session.orgId`. Better Auth's `active_organization_id` on the session
 * row is only refreshed when the user explicitly switches via the auth
 * endpoint, so it goes stale after the framework's `switchOrgHandler`
 * updates the active-org setting through any other path. Reading the
 * stale session value would route credential lookups to the *previous*
 * org's `o:<orgId>:` row, surfacing data from the wrong tenant in a
 * dashboard. Falling back to the session value only after `getOrgContext`
 * fails keeps tokens/cookies that predate the org plugin still working.
 */
export async function getCredentialContextFromEvent(
  event: H3Event,
): Promise<CredentialContext | null> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return null;
  const ctx = await getOrgContext(event).catch(() => null);
  const orgId = ctx?.orgId ?? session.orgId ?? null;
  return { userEmail: session.email, orgId };
}

export async function requireCredentialContext(
  event: H3Event,
): Promise<CredentialContext | null> {
  const fromRequest = getCredentialContextFromRequest();
  if (fromRequest) return fromRequest;
  return getCredentialContextFromEvent(event);
}

export async function withRequestContextFromEvent<T>(
  event: H3Event,
  fn: (ctx: CredentialContext) => Promise<T>,
): Promise<T | null> {
  const ctx = await getCredentialContextFromEvent(event);
  if (!ctx) return null;
  return runWithRequestContext(
    { userEmail: ctx.userEmail, orgId: ctx.orgId ?? undefined },
    () => fn(ctx),
  );
}

export async function runApiHandlerWithContext<T>(
  event: H3Event,
  fn: (ctx: CredentialContext) => Promise<T>,
): Promise<T | MissingKeyResponse> {
  const result = await withRequestContextFromEvent(event, fn);
  if (result !== null) return result;
  setResponseStatus(event, 401);
  return {
    error: "missing_api_key",
    key: "AUTH",
    label: "Authentication",
    message: "Sign in to access this data source.",
    settingsPath: "/data-sources",
  };
}

export async function requireCredential(
  event: H3Event,
  key: string,
  label: string,
  options?: { message?: string; settingsPath?: string },
): Promise<MissingKeyResponse | null> {
  const ctx = await requireCredentialContext(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return {
      error: "missing_api_key",
      key,
      label,
      message: "Sign in to access this data source.",
      settingsPath: options?.settingsPath ?? "/data-sources",
    };
  }

  const value = await resolveCredential(key, ctx);
  if (value) return null;

  setResponseStatus(event, 200);
  return {
    error: "missing_api_key",
    key,
    label,
    message:
      options?.message ?? `Connect your ${label} account to see this data`,
    settingsPath: options?.settingsPath ?? "/data-sources",
  };
}
