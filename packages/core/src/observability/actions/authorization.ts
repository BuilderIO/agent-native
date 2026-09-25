import { fail, type ActionRunContext } from "../../action.js";
import { currentRequestUserIsOrgAdmin } from "../../server/org-admin.js";

export async function requireObservabilityOrgAdmin(
  ctx: ActionRunContext | undefined,
): Promise<{ userId: string; orgId: string }> {
  const userId = ctx?.userEmail?.trim();
  if (!userId) fail("Sign in to review agent outputs.", { statusCode: 401 });
  const orgId = ctx?.orgId?.trim();
  if (!orgId || !(await currentRequestUserIsOrgAdmin(orgId))) {
    fail("Only organization owners and admins can review agent outputs.", {
      statusCode: 403,
    });
  }
  return { userId, orgId };
}
