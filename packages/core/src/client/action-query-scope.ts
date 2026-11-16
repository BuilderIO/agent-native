/**
 * Which action queries a change can reach. Queries and writes can name a whole
 * resource type or a single record as `type:id`; sync events carry those parts
 * separately. A query that names no resources has no known affected set, so
 * every scoped change still reaches it.
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
  return tags.some((tag) => {
    if (typeof tag !== "string") return false;
    const separator = tag.indexOf(":");
    if (separator !== -1) {
      return (
        resourceTypes.has(tag) || resourceTypes.has(tag.slice(0, separator))
      );
    }
    for (const changed of resourceTypes) {
      if (changed === tag || changed.startsWith(`${tag}:`)) return true;
    }
    return false;
  });
}
