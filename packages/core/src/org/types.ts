/**
 * Shared types for the org module. Server and client both depend on these.
 */

export type OrgRole = "owner" | "admin" | "member";

export type RequiredAuthProvider = "google" | null;

export type WorkspaceAppDefaultVisibility = "private" | "org";

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
   * Origin of the org's own workspace deployment, when it runs one. Members
   * who land on a different host (a shared hosted app reached from the
   * template catalog) get pointed here instead of concluding their team's
   * apps are missing. Null for the common case of an org with no separate
   * workspace.
   */
  workspaceUrl: string | null;
  /** Sign-in provider required for members of the active org. */
  requiredAuthProvider: RequiredAuthProvider;
  /** Default visibility applied when a new workspace app is first registered. */
  workspaceAppDefaultVisibility?: WorkspaceAppDefaultVisibility;
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
