import { useOrgRole } from "@agent-native/core/client/org";

/**
 * Whether the viewer can open Settings › Infrastructure › File uploads and
 * storage: owners and admins of an organization, or anyone without one. False
 * while the organization is still loading, so no one is sent to a page they
 * can't see.
 */
export function useCanManageStorage(): boolean {
  const { org, canManageOrg } = useOrgRole();
  return canManageOrg || (org !== undefined && !org.orgId);
}
