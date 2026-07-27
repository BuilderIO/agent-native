/**
 * Shared types for the org module. Server and client both depend on these.
 */

export type OrgRole = "owner" | "admin" | "member";

export interface OrgContext {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: OrgRole | null;
}

export interface OrgSummary {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

export interface OrgInvitationSummary {
  id: string;
  orgId: string;
  orgName: string;
  invitedBy: string;
}

export interface DomainMatchOrg {
  orgId: string;
  orgName: string;
}

export interface OrgInfo {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: OrgRole | null;
  orgs: OrgSummary[];
  pendingInvitations: OrgInvitationSummary[];
  domainMatches: DomainMatchOrg[];
  allowedDomain: string | null;
  /**
   * Whether the active org has an A2A secret. The value itself is never part
   * of this payload — owners/admins fetch it on demand from
   * `GET /_agent-native/org/a2a-secret`.
   */
  a2aSecretSet?: boolean;
}

export interface OrgMember {
  email: string;
  role: OrgRole;
  joinedAt: number;
}

export interface OrgPendingInvitation {
  id: string;
  email: string;
  invitedBy: string;
  createdAt: number;
  status: string;
  role: "admin" | "member";
}
