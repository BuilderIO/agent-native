import type { TextCommitStatus } from "@/pages/design-editor/command-types";

/** `CSS.escape` is not present in every non-browser test environment, and a
 *  node id only ever needs quotes and backslashes escaped for this selector. */
function escapeNodeId(nodeId: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(nodeId)
    : nodeId.replace(/["\\]/g, "\\$&");
}

/**
 * The writer behind the capture's host-side fallback. It reports what the
 * commit path itself said — never a re-read of the source.
 *
 * Re-reading was wrong in a way no better readback can fix: a screen whose
 * content lives in `liveScreenSnapshotsById` is written there, and
 * `getScreenContent` does not read that map. A stale snapshot survives a
 * localhost→fusion source transition (the prune drops entries only when a FILE
 * ID disappears), so the live branch runs, the write is accepted, and the
 * readback sees nothing — classifying an accepted write as lost and reporting
 * the user's text unrecoverable. Acceptance is the commit path's answer to
 * give, so it is the boundary this consumes.
 */
export function runPendingTextHostCommit(
  commitText: (
    screenId: string,
    selector: string,
    value: string,
  ) => TextCommitStatus,
  screenId: string,
  nodeId: string,
  text: string,
): boolean {
  const selector = `[data-agent-native-node-id="${escapeNodeId(nodeId)}"]`;
  return commitText(screenId, selector, text) === "accepted";
}
