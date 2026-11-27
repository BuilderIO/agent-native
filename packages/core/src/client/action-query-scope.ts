/**
 * Which action queries a change can reach. Queries and writes can name a whole
 * resource type or a single record as `type:id`; sync events carry those parts
 * separately. A query that names no resources has no known affected set, so
 * every scoped change still reaches it.
 */

export const ACTION_RESOURCES_META_KEY = "actionResources";

/**
 * A query that keeps itself current (its own change subscription and explicit
 * refetch) sets this so no write or sync event refetches it. Without it, a
 * write that names no resources refetches the read, and a second write cancels
 * that refetch while it is in flight, which the browser reports as
 * net::ERR_ABORTED.
 */
export const ACTION_SELF_REFRESHING_META_KEY = "actionSelfRefreshing";

export interface ActionScopedQuery {
  queryKey: readonly unknown[];
  meta?: Record<string, unknown> | undefined;
}

function actionQueryMatches(
  query: ActionScopedQuery,
  matches: (tag: string) => boolean,
): boolean {
  if (query.queryKey[0] !== "action") return false;
  if (query.meta?.[ACTION_SELF_REFRESHING_META_KEY] === true) return false;
  const tags = query.meta?.[ACTION_RESOURCES_META_KEY];
  if (!Array.isArray(tags) || tags.length === 0) return true;
  return tags.some((tag) => typeof tag === "string" && matches(tag));
}

export function actionQueryAffectedByResources(
  query: ActionScopedQuery,
  resourceTypes: ReadonlySet<string>,
): boolean {
  return actionQueryMatches(query, (tag) => {
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

export interface ActionResourceChange {
  type: string;
  id?: string;
}

export function actionQueryAffectedByChanges(
  query: ActionScopedQuery,
  changes: readonly ActionResourceChange[],
): boolean {
  return actionQueryMatches(query, (tag) =>
    changes.some(({ type, id }) =>
      id
        ? tag === type || tag === `${type}:${id}`
        : tag === type || tag.startsWith(`${type}:`),
    ),
  );
}
