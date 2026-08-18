import { getOrgContext } from "@agent-native/core/org";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import type { H3Event } from "h3";

export interface SlidesRequestAuthContext {
  email?: string;
  orgId?: string;
}

/**
 * A session lookup that failed outright (DB blip, cookie race) — distinct
 * from `getSession` resolving to `null`, which means "no session" and is a
 * legitimate outcome for anonymous callers (public share/deck viewers).
 * `getSession` only throws on a real backend failure, never merely because a
 * request carries no session cookie, so this never fires for genuine
 * anonymous access. Previously this was swallowed into the same
 * `email: undefined` an anonymous visitor gets, so a transient failure
 * presented as "unauthorized" on the upload path and as an untraceable error
 * on deck creation — see `resolveSlidesRequestAuth` for the caller-facing
 * shape.
 */
export class SlidesSessionLookupError extends Error {
  readonly statusCode = 503;
  constructor(cause: unknown) {
    super("Could not verify your session. Please try again.");
    this.name = "SlidesSessionLookupError";
    this.cause = cause;
  }
}

export async function resolveSlidesRequestAuthContext(
  event: H3Event,
): Promise<SlidesRequestAuthContext> {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(event);
  } catch (err) {
    throw new SlidesSessionLookupError(err);
  }

  // Prefer the live active org context over `session.orgId`. Better Auth's
  // session.orgId is set at sign-in and not refreshed when the user switches
  // orgs — so reading it directly returns the *previous* active org after
  // any switch. `getOrgContext()` resolves the user's current active-org-id
  // user-setting on every request, which is what we actually want.
  let orgId: string | undefined;
  if (session?.email) {
    try {
      const orgContext = await getOrgContext(event);
      orgId = orgContext.orgId ?? undefined;
    } catch {
      // Org tables can be unavailable during first boot; fall back below.
    }
  }
  // Last-resort fallback: if `getOrgContext` threw or returned no orgId,
  // accept the session-embedded value so first-boot / solo deployments
  // and unauthenticated callers still work.
  if (!orgId && session?.orgId) {
    orgId = session.orgId;
  }

  return {
    email: session?.email,
    orgId,
  };
}

/** Discriminated result for route handlers that must fail closed on a
 * session-lookup error rather than treat it as "logged out". */
export type SlidesRequestAuthResolution =
  | { ok: true; context: SlidesRequestAuthContext }
  | { ok: false; statusCode: number; error: string };

/**
 * Like `resolveSlidesRequestAuthContext`, but turns a `SlidesSessionLookupError`
 * into a response the caller can return directly instead of a 401 — so a
 * route handler that gates on `!context.email` never mistakes "the session
 * lookup failed" for "this visitor is signed out". A route with legitimate
 * anonymous access (e.g. a public deck view) still gets `email: undefined`
 * for real anonymous callers via `ok: true`; only a genuine lookup failure
 * takes the `ok: false` branch.
 */
export async function resolveSlidesRequestAuth(
  event: H3Event,
): Promise<SlidesRequestAuthResolution> {
  try {
    return { ok: true, context: await resolveSlidesRequestAuthContext(event) };
  } catch (err) {
    return {
      ok: false,
      statusCode:
        err instanceof SlidesSessionLookupError ? err.statusCode : 500,
      error:
        err instanceof Error ? err.message : "Failed to verify your session.",
    };
  }
}

export async function withSlidesRequestContext<T>(
  event: H3Event,
  fn: (session: SlidesRequestAuthContext) => Promise<T>,
  preResolvedContext?: SlidesRequestAuthContext,
): Promise<T> {
  const ctx =
    preResolvedContext ?? (await resolveSlidesRequestAuthContext(event));
  return runWithRequestContext({ userEmail: ctx.email, orgId: ctx.orgId }, () =>
    fn(ctx),
  );
}
