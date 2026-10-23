import { fail, type ActionRunContext } from "../action.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import { getRequestContext } from "../server/request-context.js";
import type { IntegrationScopeAccess } from "./scope-store.js";

export async function requireIntegrationScopeAccess(
  ctx: ActionRunContext | undefined,
  manage = false,
): Promise<IntegrationScopeAccess> {
  const request = getRequestContext();
  if (request?.isIntegrationCaller || request?.integration) {
    fail("Integration callers cannot manage conversation scopes.", {
      statusCode: 403,
      errorCode: "forbidden",
    });
  }
  const ownerEmail = ctx?.userEmail?.trim();
  if (!ownerEmail)
    fail("Sign in to access conversation scopes.", { statusCode: 401 });
  const orgId = ctx?.orgId?.trim() || null;
  if (manage && orgId) {
    const role = await readOrgMemberRole(orgId, ownerEmail);
    if (role !== "owner" && role !== "admin") {
      fail(
        "Only organization owners and admins can manage conversation scopes.",
        {
          statusCode: 403,
          errorCode: "forbidden",
        },
      );
    }
  }
  return { ownerEmail, orgId };
}
