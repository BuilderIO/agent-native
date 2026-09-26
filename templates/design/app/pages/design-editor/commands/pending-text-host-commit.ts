import type { TextCommitStatus } from "@/pages/design-editor/command-types";

function escapeNodeId(nodeId: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(nodeId)
    : nodeId.replace(/["\\]/g, "\\$&");
}

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
