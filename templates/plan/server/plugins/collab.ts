import { createCollabPlugin } from "@agent-native/core/server";

/**
 * Real-time multi-user prose editing for plan `rich-text` blocks.
 *
 * Collaboration is PER BLOCK: a plan stores its content as JSON blocks (not a
 * single markdown column), so each editable block gets its own shared Y.Doc
 * keyed `plan:${planId}:${blockId}`. The client lead-seeds that doc from the
 * block's markdown and mirrors edits back through the `update-rich-text` patch
 * contract — markdown stays the source of truth in `plans.content`; the Y.Doc
 * is transient live state only. There is therefore no per-doc content column to
 * sync and `autoSeed` is off (seeding happens client-side, not on startup).
 *
 * Access is enforced at the parent plan level: `resolveResourceId` extracts the
 * planId out of the collab docId, and the framework runs a viewer check for
 * reads and an editor check for writes against the shareable `"plan"` resource.
 * An unparseable docId resolves to null → 404, so we never leak across plans.
 */
export default createCollabPlugin({
  // Per-block collab has no single content column to sync; the block markdown is
  // persisted via the `update-rich-text` patch path, not by the collab plugin.
  autoSeed: false,
  access: {
    mode: "resource",
    resourceType: "plan",
    resolveResourceId: (docId) => resolvePlanIdFromCollabDocId(docId),
  },
});

/**
 * `plan:${planId}:${blockId}` → planId. The blockId may itself be unconstrained,
 * so only split off the leading `plan:` prefix and the planId segment; anything
 * after the second `:` is the block id and is ignored for the access check.
 */
export function resolvePlanIdFromCollabDocId(docId: string): string | null {
  if (!docId.startsWith("plan:")) return null;
  const rest = docId.slice("plan:".length);
  const sep = rest.indexOf(":");
  const planId = sep === -1 ? rest : rest.slice(0, sep);
  return planId.trim() ? planId : null;
}
