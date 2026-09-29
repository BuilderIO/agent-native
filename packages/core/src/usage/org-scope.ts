export interface UsageOrgScope {
  where: string;
  args: unknown[];
}

export interface UsageOrgScopeOptions {
  orgId: string | null | undefined;
  /**
   * True only when the surrounding owner scope is exactly the viewer's own
   * `owner_email`. Never pass true for a workspace roll-up, an
   * admin-selected other member, or an app-wide read.
   */
  selfScoped: boolean;
}

/**
 * Build the org predicate for a `token_usage` query that is already scoped to
 * one or more owner emails.
 *
 * Callers MUST pair this with that owner scope. On its own the self-scoped
 * form admits every unattributed row in the table.
 */
export function usageOrgScope(options: UsageOrgScopeOptions): UsageOrgScope {
  const trimmed = options.orgId?.trim();
  if (!trimmed) return { where: "", args: [] };
  return options.selfScoped
    ? { where: "(org_id = ? OR org_id IS NULL)", args: [trimmed] }
    : { where: "org_id = ?", args: [trimmed] };
}

export function isSelfScopedUsageRead(
  ownerEmails: readonly string[],
  viewerEmail: string,
): boolean {
  const viewer = viewerEmail.trim().toLowerCase();
  if (!viewer || ownerEmails.length !== 1) return false;
  return ownerEmails[0]!.trim().toLowerCase() === viewer;
}
