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

export interface OrgInfo {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: OrgRole | null;
  orgs: OrgSummary[];
  pendingInvitations: OrgInvitationSummary[];
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
}
