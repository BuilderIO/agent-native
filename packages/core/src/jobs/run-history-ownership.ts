import {
  organizationIdFromResourceOwner,
  organizationResourceOwner,
  SHARED_OWNER,
} from "../resources/store.js";

export function automationRunOwnership(
  resourceOwner: string,
  executionOwner: string,
  executionOrgId?: string | null,
): { owner: string; scope: "personal" | "organization"; orgId: string | null } {
  // Legacy shared resources have no organization in their owner. Personal
  // resources can carry an execution org without belonging to that org.
  const orgId =
    organizationIdFromResourceOwner(resourceOwner) ??
    (resourceOwner === SHARED_OWNER ? (executionOrgId ?? null) : null);
  return {
    owner:
      resourceOwner === SHARED_OWNER
        ? orgId
          ? organizationResourceOwner(orgId)
          : executionOwner
        : resourceOwner,
    scope: orgId ? "organization" : "personal",
    orgId,
  };
}
