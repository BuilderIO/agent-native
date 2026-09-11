import type { OrgRole } from "./types.js";

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export function orgRoleRank(role: OrgRole | null | undefined): number {
  return role ? (ORG_ROLE_RANK[role] ?? 0) : 0;
}

export function orgRoleAtLeast(
  role: OrgRole | null | undefined,
  minimum: OrgRole,
): boolean {
  return orgRoleRank(role) >= orgRoleRank(minimum);
}

export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return orgRoleAtLeast(role, "admin");
}

export function canInviteOrgMembers(role: OrgRole | null | undefined): boolean {
  return orgRoleAtLeast(role, "admin");
}

export function canManageOrgDomain(role: OrgRole | null | undefined): boolean {
  return role === "owner";
}
