import type { H3Event } from "h3";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";

export interface SlidesRequestAuthContext {
  email?: string;
  orgId?: string;
}

export async function resolveSlidesRequestAuthContext(
  event: H3Event,
): Promise<SlidesRequestAuthContext> {
  const session = await getSession(event).catch(() => null);
  let orgId = session?.orgId ?? undefined;

  if (session?.email && !orgId) {
    try {
      const orgContext = await getOrgContext(event);
      orgId = orgContext.orgId ?? undefined;
    } catch {
      // Org tables can be unavailable during first boot; keep the session-only
      // context so unauthenticated and solo deployments continue to work.
    }
  }

  return {
    email: session?.email,
    orgId,
  };
}

export async function withSlidesRequestContext<T>(
  event: H3Event,
  fn: (session: SlidesRequestAuthContext) => Promise<T>,
): Promise<T> {
  const ctx = await resolveSlidesRequestAuthContext(event);
  return runWithRequestContext({ userEmail: ctx.email, orgId: ctx.orgId }, () =>
    fn(ctx),
  );
}
