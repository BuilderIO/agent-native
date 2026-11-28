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

/**
 * Invites work without an email provider: the invitation is stored and the
 * invitee accepts it on sign-in, so email availability only changes the copy.
 */
export function canInviteOrgMembers(role: OrgRole | null | undefined): boolean {
  return orgRoleAtLeast(role, "admin");
}

export type OrgMemberInvitationMode = "admins" | "members" | "org-setting";

export interface OrgInvitationPolicy {
  mode: OrgMemberInvitationMode;
  /** Meaningful in `org-setting` mode; derived from `mode` otherwise. */
  onlyAdminsCanInvite: boolean;
  /** The stored flag is corrupt; members stay refused until an admin resets it. */
  invalid?: boolean;
}

/**
 * Whether `role` may invite plain members under the resolved policy. Admin
 * invitations are a separate, owner-only rule enforced where the role is chosen.
 */
export function canInviteOrgMembersUnderPolicy(
  role: OrgRole | null | undefined,
  policy: OrgInvitationPolicy,
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role !== "member") return false;
  if (policy.mode === "admins") return false;
  return policy.mode === "members" || !policy.onlyAdminsCanInvite;
}

export function canManageOrgDomain(role: OrgRole | null | undefined): boolean {
  return orgRoleAtLeast(role, "admin");
}

/**
 * The cross-app secret signs the JWTs peer apps accept as first-party callers,
 * so reading, replacing, or syncing it stays with the owner.
 */
export function canManageOrgA2ASecret(
  role: OrgRole | null | undefined,
): boolean {
  return role === "owner";
}
