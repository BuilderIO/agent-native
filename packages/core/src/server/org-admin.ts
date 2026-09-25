import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export async function currentRequestUserIsOrgAdmin(
  orgId = getRequestOrgId() ?? undefined,
): Promise<boolean> {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!orgId || !email) return false;

  try {
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
  } catch {
    return false;
  }
}

export async function assertCurrentRequestUserIsOrgAdmin(
  orgId = getRequestOrgId() ?? undefined,
): Promise<void> {
  if (!(await currentRequestUserIsOrgAdmin(orgId))) {
    throw new Error("Only organization owners and admins can do this.");
  }
}
