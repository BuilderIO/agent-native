interface SyncEventLike {
  source?: string;
  key?: string;
  resourceType?: string;
  resourceId?: string;
  requestSource?: string;
}

// Actions whose `designChangeResource` event only changes the design's files,
// screens, or breakpoints. Any other action keeps the broad refetch.
const DESIGN_CONTENT_ACTIONS = new Set([
  "add-breakpoint",
  "add-localhost-screens",
  "create-file",
  "delete-file",
  "remove-breakpoint",
  "rename-screen",
  "update-design",
  "update-file",
  "update-screen-source",
]);

// Reads that nothing in a collaborator's file or screen edit can change. Their
// own mutations publish their own events, which are not content events.
const CONTENT_INDEPENDENT_QUERIES = new Set([
  "get-agentkit-capabilities",
  "get-feature-flags",
  "get-lab-states",
  "get-localhost-write-consent-request",
  "get-visual-edit-pending",
  "list-localhost-connections",
  "list-resource-shares",
  "list-review-comments",
]);

export function isContentIndependentDesignQuery(name: unknown): boolean {
  return typeof name === "string" && CONTENT_INDEPENDENT_QUERIES.has(name);
}

function isContentEvent(event: SyncEventLike): boolean {
  if (
    event.resourceType !== "design" ||
    typeof event.resourceId !== "string" ||
    event.resourceId.trim() === ""
  ) {
    return false;
  }
  if (event.source === "collab") return true;
  return (
    event.source === "action" &&
    typeof event.key === "string" &&
    DESIGN_CONTENT_ACTIONS.has(event.key)
  );
}

// Browser saves can checkpoint while an agent edit is active, so requestSource
// alone cannot determine whether the version list changed.
function mayCreateVersion(event: SyncEventLike): boolean {
  return (
    event.source === "action" &&
    typeof event.key === "string" &&
    DESIGN_CONTENT_ACTIONS.has(event.key)
  );
}

/**
 * Content edits and export-capability heartbeats only refresh their affected
 * reads. Unknown data changes retain the broad refetch.
 */
export function shouldInvalidateDesignQueryForSync(
  query: { queryKey: readonly unknown[] },
  events: readonly SyncEventLike[],
): boolean {
  if (query.queryKey[0] !== "action") return false;
  const name = query.queryKey[1];
  if (typeof name !== "string") return true;
  const changes = events.filter(
    (event) => event.source !== "app-state" && event.source !== "awareness",
  );
  const contextChanged = changes.some(
    (event) =>
      event.source === "action" &&
      event.key === "register-native-render-context",
  );
  if (contextChanged && name === "get-native-render-contexts") return true;
  const relevant = changes.filter(
    (event) =>
      event.source !== "action" ||
      event.key !== "register-native-render-context",
  );
  if (contextChanged && relevant.length === 0) return false;
  if (relevant.length === 0 || !relevant.every(isContentEvent)) return true;
  if (isContentIndependentDesignQuery(name)) return false;
  if (name === "list-design-versions") return relevant.some(mayCreateVersion);
  return true;
}
