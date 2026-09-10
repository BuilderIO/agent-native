/**
 * Organization scoping for `token_usage` reads.
 *
 * `token_usage.org_id` is best-effort attribution, not an ownership column.
 * `recordUsage` fills it from the active request context, so anything with no
 * request context — recurring jobs, automations, webhook-driven runs, CLI
 * scripts — writes NULL, and every row written before the column started being
 * populated is NULL forever.
 *
 * That makes NULL mean "which organization this belonged to is unknown", and
 * the two dimensions of a usage row are not equally recoverable from it:
 *
 * - The OWNER is known. `owner_email` is always written, so an unattributed row
 *   can be attributed to the person who spent it.
 * - The ORGANIZATION is not known, and no join recovers it. Current
 *   `org_members` rows describe membership now, not membership when the row was
 *   written, and a membership that was deleted leaves no trace at all.
 *
 * So an unattributed row may be admitted only when the query is already
 * narrowed to the viewer's own `owner_email`: the viewer is entitled to their
 * own spend no matter which organization produced it, and no other person's
 * data can enter that result. A workspace roll-up over other members' emails
 * keeps strict equality, because admitting NULL there would claim rows for an
 * organization that cannot be shown to own them — and for a member who belongs
 * to more than one organization that is a real cross-organization read, not a
 * hypothetical one. Workspace totals therefore still omit unattributed spend;
 * that is a known gap, and it is the honest one.
 */
export interface UsageOrgScope {
  /** SQL predicate, or an empty string when no org filter applies. */
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
