/**
 * Which action queries a change can reach. A query names the resource types it
 * reads (`useActionQuery(..., { resources })`), a write names the types it
 * changes (`useActionMutation(..., { resources })`), and a server sync event
 * carries the type its action's `changeResource` declared. A query that names
 * no resources has no known affected set, so every scoped change still reaches it.
 */

export const ACTION_RESOURCES_META_KEY = "actionResources";

export interface ActionScopedQuery {
  queryKey: readonly unknown[];
  meta?: Record<string, unknown> | undefined;
}

export function actionQueryAffectedByResources(
  query: ActionScopedQuery,
  resourceTypes: ReadonlySet<string>,
): boolean {
  if (query.queryKey[0] !== "action") return false;
  const tags = query.meta?.[ACTION_RESOURCES_META_KEY];
  if (!Array.isArray(tags) || tags.length === 0) return true;
  return tags.some((tag) => resourceTypes.has(tag));
}
