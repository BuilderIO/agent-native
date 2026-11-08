import { getOrgRoleForEmail } from "../mcp/actions/service-token-access.js";
import { canManageOrg } from "../org/permissions.js";
import type { FeatureFlagRuleScope } from "./store.js";

export class FeatureFlagPermissionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function productionAdminAllowlist(): Set<string> {
  return new Set(
    (process.env.AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isFeatureFlagAdminEmail(email: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized && productionAdminAllowlist().has(normalized));
}

export interface FeatureFlagManagerAccess {
  email: string;
  orgId: string | null;
  canManageOrg: boolean;
  canManageGlobal: boolean;
}

/**
 * What the caller may change: their active org's own rule (org owner/admin)
 * and the global rule (this app's admin list, whatever org they are in).
 * The two are independent; being on the list grants nothing in an org.
 */
export async function getFeatureFlagManagerAccess(
  scope: { userEmail?: string; orgId?: string | null } | undefined,
): Promise<FeatureFlagManagerAccess> {
  const email = scope?.userEmail?.trim().toLowerCase();
  if (!email) {
    throw new FeatureFlagPermissionError(
      "Sign in to manage feature flags.",
      401,
    );
  }
  const orgId = scope?.orgId?.trim() || null;
  return {
    email,
    orgId,
    canManageOrg: orgId
      ? canManageOrg(await getOrgRoleForEmail(orgId, email))
      : false,
    canManageGlobal:
      isFeatureFlagAdminEmail(email) ||
      (!orgId && process.env.NODE_ENV !== "production"),
  };
}

/**
 * Authorizes one write and names the row it lands in. With no `requested`
 * scope, a caller in an org writes that org's rule and a caller with no org
 * writes the global rule, so an older caller never writes wider than before.
 */
export async function requireFeatureFlagManager(
  scope: { userEmail?: string; orgId?: string | null } | undefined,
  requested?: FeatureFlagRuleScope,
): Promise<{
  email: string;
  orgId: string | null;
  scope: FeatureFlagRuleScope;
}> {
  const access = await getFeatureFlagManagerAccess(scope);
  const target = requested ?? (access.orgId ? "org" : "global");
  if (target === "org") {
    if (!access.orgId) {
      throw new FeatureFlagPermissionError(
        "An active organization is required to change its feature flag rule.",
        400,
      );
    }
    if (!access.canManageOrg) {
      throw new FeatureFlagPermissionError(
        "Only organization owners or admins can manage feature flags.",
        403,
      );
    }
    return { email: access.email, orgId: access.orgId, scope: "org" };
  }
  if (!access.canManageGlobal) {
    throw new FeatureFlagPermissionError(
      "Changing a feature flag for every organization requires this app's feature flag admin list.",
      403,
    );
  }
  return { email: access.email, orgId: null, scope: "global" };
}
