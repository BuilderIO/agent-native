import { fail, type ActionRunContext } from "../action.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";

export async function requireOrgMember(ctx?: ActionRunContext, admin = false) {
  const email = ctx?.userEmail?.trim();
  const orgId = ctx?.orgId?.trim();
  if (!email || !orgId)
    fail("An authenticated organization member is required.", {
      errorCode: "unauthorized",
      statusCode: 401,
    });
  const role = await readOrgMemberRole(orgId, email);
  if (!role)
    fail("You are not a member of the active organization.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  if (admin && role !== "owner" && role !== "admin")
    fail("Organization admin role required.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  return { email, orgId, role };
}
