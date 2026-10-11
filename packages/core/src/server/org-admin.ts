import { fail } from "../action.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export async function currentRequestUserIsOrgAdmin(
  orgId = getRequestOrgId() ?? undefined,
): Promise<boolean> {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!orgId || !email) return false;

  const { validateFederatedOrganizationMembershipForCurrentRequest } =
    await import("../org/federation.js");
  const membership =
    await validateFederatedOrganizationMembershipForCurrentRequest({
      orgId,
      email,
    });
  return (
    membership.active &&
    (membership.role === "owner" || membership.role === "admin")
  );
}

export async function assertCurrentRequestUserIsOrgAdmin(
  orgId = getRequestOrgId() ?? undefined,
): Promise<void> {
  if (!(await currentRequestUserIsOrgAdmin(orgId))) {
    fail("Only organization owners and admins can do this.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
}
