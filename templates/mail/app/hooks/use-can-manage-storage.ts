import {
  useOrgRole,
  type UseOrgRoleResult,
} from "@agent-native/core/client/org";

/**
 * Whether the viewer can open Settings › Infrastructure › File uploads and
 * storage, by the same rule as that page: owners and admins of an
 * organization, or a viewer without one on a single-tenant self-hosted
 * deployment. On a shared deployment anyone who signs up starts with no
 * organization and can't see the page. False while the organization is still
 * loading, so no one is sent to a page they can't see.
 */
export function canManageStorage(
  org: UseOrgRoleResult["org"],
  canManageOrg: boolean,
): boolean {
  if (canManageOrg) return true;
  return org !== undefined && !org.orgId && org.soloDeploymentAdmin === true;
}

export function useCanManageStorage(): boolean {
  const { org, canManageOrg } = useOrgRole();
  return canManageStorage(org, canManageOrg);
}
