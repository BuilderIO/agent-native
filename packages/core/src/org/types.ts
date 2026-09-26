/**
 * Shared types for the org module. Server and client both depend on these.
 */

import type { IconValue } from "../icons/index.js";
import type { OrgSignInMethods } from "./sign-in-methods.js";

export type OrgRole = "owner" | "admin" | "member";

export type RequiredAuthProvider = "google" | `sso:${string}` | null;

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
  icon: IconValue | null;
  iconRevision: number;
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
  /** Workspace visual identity resolved by the organization authority. */
  icon: IconValue | null;
  iconRevision: number;
  /** Whether invitations can be delivered by the configured email provider. */
  emailConfigured?: boolean;
  access?: {
    signup: "open" | "invited";
    orgCreation: "open" | "closed";
    sso?: { enabled: boolean };
    scim?: { enabled: boolean };
  };
  orgs: OrgSummary[];
  pendingRemovals?: OrgPendingRemoval[];
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
   * The deployment's sign-in methods. Owners and admins only; absent for
   * everyone else, which is not the same as "no methods".
   */
  signInMethods?: OrgSignInMethods;
  /**
   * Whether the active org has an A2A secret. Owners only; absent for
   * everyone else. The value itself is never part of this payload — the owner
   * fetches it on demand from `GET /_agent-native/org/a2a-secret`.
   */
  a2aSecretSet?: boolean;
  /**
   * Set only when the viewer has no active organization. True on a
   * single-tenant self-hosted deployment, where that viewer manages the
   * deployment's organization pages; false on a shared deployment.
   */
  soloDeploymentAdmin?: boolean;
}

export interface OrgPendingRemoval {
  orgId: string;
  orgName: string;
}

export interface OrgMember {
  email: string;
  role: OrgRole;
  joinedAt: number;
  name?: string | null;
  image?: string | null;
}

export interface OrgPendingInvitation {
  id: string;
  email: string;
  invitedBy: string;
  createdAt: number;
  status: string;
  role: "admin" | "member";
  appRoles?: Record<string, string[]>;
}
