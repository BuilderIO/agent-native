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

export function cancelPendingPastedMediaAbsentFromReplay(
  pendingByScreen: PendingPastedMediaByScreen,
  screenId: string,
  replayedContent: string,
) {
  const pending = pendingByScreen.get(screenId);
  if (!pending) return;

  // Replays replace the preview wholesale, including nodes that are not in source yet.
  const replayedNodeIds = getPendingNodeIds(replayedContent, screenId);

  for (const nodeId of pending.keys()) {
    if (!replayedNodeIds.has(nodeId)) {
      pending.set(nodeId, true);
    }
  }
}
