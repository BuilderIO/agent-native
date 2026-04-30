/**
 * Lib helpers in `server/lib/*.ts` (bigquery, hubspot, slack, etc.) all need
 * to resolve credentials. Credentials are now per-user / per-org and require
 * a CredentialContext. To avoid threading the context through every public
 * method of every helper (which would force every action and every script to
 * pass it explicitly), the helpers grab it from the active request context
 * via `getCredentialContext()` from `@agent-native/core/server`.
 *
 * Where the context comes from:
 *   - Framework actions auto-mounted at `/_agent-native/actions/...` —
 *     `runWithRequestContext({ userEmail, orgId }, fn)` is called for you.
 *   - Custom `/api/*` routes — wrap the handler body in
 *     `withRequestContextFromEvent(event, async (ctx) => { ... })` from
 *     `./credentials.ts`. The wrapper reads the session and runs `fn`
 *     inside `runWithRequestContext`.
 *
 * Calling a lib helper outside any request context (e.g. from a CLI script
 * with no AGENT_USER_EMAIL env var) will throw a clear error pointing the
 * developer at the missing wrapping. This is intentional — the previous
 * "fall back to process.env" behavior is exactly the leak we're fixing.
 */
import {
  getCredentialContext,
  type RequestContext,
} from "@agent-native/core/server";
import type { CredentialContext } from "@agent-native/core/credentials";

/**
 * Read the current request's credential context, or throw a helpful error
 * naming the credential the caller was about to resolve.
 */
export function requireRequestCredentialContext(
  credentialKey: string,
): CredentialContext {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error(
      `Cannot resolve credential "${credentialKey}" outside a user request. ` +
        `Either run from a framework action (auto-wrapped) or call ` +
        `withRequestContextFromEvent(event, ...) at the top of your custom route.`,
    );
  }
  return ctx;
}

/**
 * Same as above but returns null instead of throwing. Use when the caller
 * wants to surface a friendlier "missing credential" error.
 */
export function tryRequestCredentialContext(): CredentialContext | null {
  return getCredentialContext();
}

export type { RequestContext, CredentialContext };
