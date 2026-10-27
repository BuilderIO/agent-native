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

export function cancelPendingPastedMediaRemovedByReplay(
  pendingByScreen: PendingPastedMediaByScreen,
  screenId: string,
  previousContent: string,
  replayedContent: string,
) {
  const pending = pendingByScreen.get(screenId);
  if (!pending) return;

  const previousNodeIds = getPendingNodeIds(previousContent, screenId);
  const replayedNodeIds = getPendingNodeIds(replayedContent, screenId);

  for (const nodeId of pending.keys()) {
    if (previousNodeIds.has(nodeId) && !replayedNodeIds.has(nodeId)) {
      pending.set(nodeId, true);
    }
  }
}
