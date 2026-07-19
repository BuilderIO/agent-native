import { getOrgRoleForEmail } from "../mcp/actions/service-token-access.js";
import { canManageOrg } from "../org/permissions.js";

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

/** Require an org admin/owner, or an explicit production no-org allowlist entry. */
export async function requireFeatureFlagManager(scope: {
  userEmail?: string;
  orgId?: string | null;
}): Promise<{ email: string; orgId: string | null }> {
  const email = scope.userEmail?.trim().toLowerCase();
  if (!email) {
    throw new FeatureFlagPermissionError(
      "Sign in to manage feature flags.",
      401,
    );
  }
  const orgId = scope.orgId?.trim() || null;
  if (orgId) {
    const role = await getOrgRoleForEmail(orgId, email);
    if (!canManageOrg(role)) {
      throw new FeatureFlagPermissionError(
        "Only organization owners or admins can manage feature flags.",
        403,
      );
    }
    return { email, orgId };
  }
  if (process.env.NODE_ENV !== "production") return { email, orgId: null };
  if (!productionAdminAllowlist().has(email)) {
    throw new FeatureFlagPermissionError(
      "Feature flag management without an organization requires an explicit admin allowlist entry.",
      403,
    );
  }
  return { email, orgId: null };
}
