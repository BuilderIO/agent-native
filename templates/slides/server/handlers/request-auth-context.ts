import { getOrgContext } from "@agent-native/core/org";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import type { H3Event } from "h3";

export interface SlidesRequestAuthContext {
  email?: string;
  orgId?: string;
}

export async function resolveSlidesRequestAuthContext(
  event: H3Event,
): Promise<SlidesRequestAuthContext> {
  const session = await getSession(event).catch(() => null);

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
