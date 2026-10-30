import { buildCodeLayerProjection } from "@shared/code-layer";

export type PendingPastedMediaByScreen = Map<string, Map<string, boolean>>;

function getPendingNodeIds(content: string, screenId: string) {
  return new Set(
    buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: screenId },
    })
      .nodes.map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((nodeId): nodeId is string => Boolean(nodeId)),
  );
}

export function cancelPendingPastedMediaAbsentFromContent(
  pendingByScreen: PendingPastedMediaByScreen,
  screenId: string,
  content: string,
) {
  const pending = pendingByScreen.get(screenId);
  if (!pending) return;

  const contentNodeIds = getPendingNodeIds(content, screenId);
  for (const nodeId of pending.keys()) {
    if (!contentNodeIds.has(nodeId)) pending.set(nodeId, true);
  }
}
