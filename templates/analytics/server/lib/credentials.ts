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
  hasCredential,
  saveCredential,
  deleteCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import {
  resolveCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import {
  getSession,
  getCredentialContext as getCredentialContextFromRequest,
  runWithRequestContext,
} from "@agent-native/core/server";
import { setResponseStatus, type H3Event } from "h3";
import type { MissingKeyResponse } from "@agent-native/core/server";

/**
 * Build a CredentialContext from the current H3 event's session. Throws a
 * 401-style result if the user isn't authenticated.
 */
export async function getCredentialContextFromEvent(
  event: H3Event,
): Promise<CredentialContext | null> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return null;
  return { userEmail: session.email, orgId: session.orgId ?? null };
}

/**
 * Get the credential context from the active request — preferring the
 * AsyncLocalStorage context (set by the action router or by a wrapping
 * `runWithRequestContext` call) and falling back to a fresh session lookup
 * on `event` for hand-written `/api/*` routes.
 */
export async function requireCredentialContext(
  event: H3Event,
): Promise<CredentialContext | null> {
  const fromRequest = getCredentialContextFromRequest();
  if (fromRequest) return fromRequest;
  return getCredentialContextFromEvent(event);
}

/**
 * Run `fn` with a request context derived from `event`. Use this at the top
 * of any custom `/api/*` handler before reading credentials so the
 * `accessFilter` / `assertAccess` guards (and `resolveCredential` callers
 * downstream) see the same identity.
 */
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

/**
 * Async replacement for requireEnvKey that checks the per-user / per-org
 * SQL settings store. Returns a structured "missing_api_key" response if the
 * credential is not found, or null if it exists.
 *
 * Use inside a route handler. Reads the session from `event`. Returns 401
 * via the missing-key shape when there's no signed-in user.
 */
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
