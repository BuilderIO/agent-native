import { getOrgContext } from "@agent-native/core/org";
import {
  getMcpOAuthBearerSession,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
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
  readonly cause: unknown;
  constructor(cause: unknown) {
    super("Could not verify your session. Please try again.");
    this.name = "SlidesSessionLookupError";
    this.cause = cause;
  }
}

export async function resolveSlidesRequestAuthContext(
  event: H3Event,
): Promise<SlidesRequestAuthContext> {
  // the browser org lookup after that would let a stale active-org cookie
  const mcpSession = await getMcpOAuthBearerSession(event);
  let session: Awaited<ReturnType<typeof getSession>>;
  if (mcpSession?.email) {
    session = mcpSession;
  } else {
    try {
      session = await getSession(event);
    } catch (err) {
      throw new SlidesSessionLookupError(err);
    }
  }

  let orgId: string | undefined;
  if (session?.email && !mcpSession?.email) {
    try {
      const orgContext = await getOrgContext(event);
      orgId = orgContext.orgId ?? undefined;
    } catch {
      // Org tables can be unavailable during first boot; fall back below.
    }
  }
  if (!orgId && session?.orgId) {
    orgId = session.orgId;
  }

  return {
    email: session?.email,
    orgId,
  };
}

export type SlidesRequestAuthResolution =
  | { ok: true; context: SlidesRequestAuthContext }
  | { ok: false; statusCode: number; error: string };

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
