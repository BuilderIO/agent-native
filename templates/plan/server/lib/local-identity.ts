export const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";

export function getLocalPlanOwnerEmail(): string {
  return process.env.PLAN_LOCAL_OWNER_EMAIL?.trim() || LOCAL_PLAN_OWNER_EMAIL;
}

export const GUEST_AUTHOR_DOMAIN = "agent-native.guest";

export function isGuestAuthorIdentity(
  email: string | null | undefined,
): boolean {
  return (
    typeof email === "string" &&
    /^guest-[0-9a-f-]+@agent-native\.guest$/i.test(email)
  );
}

export function isLocalPlanRuntime(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production" || nodeEnv === "prod") return false;

  if (process.env.PLAN_LOCAL_MODE === "0") return false;

  const authMode = process.env.AUTH_MODE;
  if (authMode && authMode !== "local") return false;

  if (process.env.PLAN_LOCAL_MODE === "1") return true;

  return true;
}

function shouldUseLocalPlanOwner(
  authenticatedEmail: string | undefined,
): boolean {
  if (!isLocalPlanRuntime()) return false;
  if (isAnonymousPublicViewer(authenticatedEmail)) return false;
  return true;
}

export type PlanAccessContext = {
  userEmail?: string;
  orgId?: string;
};

export function resolvePlanAccessContext(
  ctx: PlanAccessContext,
): PlanAccessContext {
  if (shouldUseLocalPlanOwner(ctx.userEmail)) {
    const localOrgId = process.env.PLAN_LOCAL_ORG_ID?.trim();
    return {
      userEmail: getLocalPlanOwnerEmail(),
      ...(localOrgId ? { orgId: localOrgId } : {}),
    };
  }
  return ctx;
}

/**
 * Resolve the org scope that should be persisted beside a newly written plan.
 * This mirrors `resolvePlanAccessContext()` so local single-user plans do not
 * get tagged with an authenticated dev-session org that the synthetic local
 * owner cannot later access.
 */
export function resolvePlanOrgIdForWrite(
  authenticatedEmail: string | undefined,
  requestOrgId: string | undefined,
): string | undefined {
  return resolvePlanAccessContext({
    userEmail: authenticatedEmail,
    orgId: requestOrgId,
  }).orgId;
}

export function resolvePlanOwnerEmail(
  authenticatedEmail: string | undefined,
): string | undefined {
  if (shouldUseLocalPlanOwner(authenticatedEmail)) {
    return getLocalPlanOwnerEmail();
  }
  if (authenticatedEmail) return authenticatedEmail;
  return undefined;
}

export function resolvePlanOwnerEmailForWrite(
  authenticatedEmail: string | undefined,
): string | undefined {
  if (shouldUseLocalPlanOwner(authenticatedEmail)) {
    return getLocalPlanOwnerEmail();
  }
  if (authenticatedEmail && !isGuestAuthorIdentity(authenticatedEmail)) {
    return authenticatedEmail;
  }
  return undefined;
}

export function requirePlanOwnerEmailForWrite(
  authenticatedEmail: string | undefined,
  action: string,
): string {
  const owner = resolvePlanOwnerEmailForWrite(authenticatedEmail);
  if (!owner) {
    throw new Error(`${action} requires an authenticated user.`);
  }
  return owner;
}

export function requirePlanOwnerEmail(
  authenticatedEmail: string | undefined,
  action: string,
): string {
  const owner = resolvePlanOwnerEmail(authenticatedEmail);
  if (!owner) {
    throw new Error(`${action} requires an authenticated user.`);
  }
  return owner;
}

export function isAnonymousPublicViewer(
  email: string | null | undefined,
): boolean {
  return (
    typeof email === "string" &&
    /^public-[0-9a-f-]+@agent-native\.local$/i.test(email)
  );
}
