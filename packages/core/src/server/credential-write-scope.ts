/**
 * Where a Builder.io credential write lands, decided once for every save path.
 * Owners and admins write for the organization; members write personally, and
 * only while the org allows personal keys.
 *
 * Activation creates a brand-new Builder.io account, so it never runs over an
 * org that already has a connection: for an owner or admin it would replace
 * the connection every member bills, and a member's new account would shadow
 * it, because reads try personal first. Both shipped once, and both read back
 * as "your Builder credits are used up" on an Enterprise or org-connected
 * workspace.
 */
export type CredentialWriteAction = "connect" | "activate";
export type CredentialWriteScope = "org" | "personal";
export type CredentialWriteRefusal =
  | "org_admin_required"
  | "managers_write_for_org"
  | "personal_restricted"
  /** A member: an owner or admin reconnects the org's account. */
  | "org_already_connected"
  /** An owner or admin: log in to the org's existing account to reconnect it. */
  | "org_reconnect_by_login";
export type CredentialWriteDecision =
  | { scope: CredentialWriteScope }
  | { refuse: CredentialWriteRefusal };

export function decideCredentialWriteScope(input: {
  action: CredentialWriteAction;
  role: string | null | undefined;
  orgId: string | null | undefined;
  /** The connection the caller named; null lets the role decide. */
  requestedScope: CredentialWriteScope | null;
  /** Whether the org's policy allows this writer a personal credential. */
  personalAllowed: boolean;
  /** Whether the org already holds a Builder.io connection. */
  orgConnected?: boolean;
}): CredentialWriteDecision {
  const manager =
    Boolean(input.orgId) && (input.role === "owner" || input.role === "admin");
  if (input.requestedScope === "org" && !manager) {
    return { refuse: "org_admin_required" };
  }
  if (input.requestedScope === "personal" && manager) {
    return { refuse: "managers_write_for_org" };
  }
  if (
    input.action === "activate" &&
    input.orgConnected &&
    input.requestedScope !== "personal"
  ) {
    return {
      refuse: manager ? "org_reconnect_by_login" : "org_already_connected",
    };
  }
  const scope = input.requestedScope ?? (manager ? "org" : "personal");
  if (scope === "personal" && input.orgId && !input.personalAllowed) {
    return { refuse: "personal_restricted" };
  }
  return { scope };
}
