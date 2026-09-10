/**
 * Organization scoping for `token_usage` reads.
 *
 * `token_usage.org_id` is best-effort, not an ownership column. `recordUsage`
 * fills it from the active request context, so anything with no request
 * context — recurring jobs, automations, webhook-driven runs, CLI scripts —
 * writes NULL, and every row written before the column started being
 * populated is NULL forever.
 *
 * An `org_id = ?` equality filter therefore silently drops real spend that the
 * caller's owner scope had already restricted to the right people, and the
 * usage dashboard renders it as "no usage recorded". Ownership lives in
 * `owner_email`; org is a grouping on top of it. Unattributed rows belong to
 * whichever owner wrote them, so they stay in scope. A row carrying a
 * DIFFERENT org id is the leak this filter exists to stop, and stays excluded.
 */
export interface UsageOrgScope {
  /** SQL predicate, or an empty string when no org filter applies. */
  where: string;
  args: unknown[];
}

/**
 * Build the org predicate for a `token_usage` query that is already scoped to
 * one or more owner emails.
 *
 * Callers MUST pair this with that owner scope. On its own it admits every
 * unattributed row in the table.
 */
export function usageOrgScope(orgId: string | null | undefined): UsageOrgScope {
  const trimmed = orgId?.trim();
  if (!trimmed) return { where: "", args: [] };
  return { where: "(org_id = ? OR org_id IS NULL)", args: [trimmed] };
}
