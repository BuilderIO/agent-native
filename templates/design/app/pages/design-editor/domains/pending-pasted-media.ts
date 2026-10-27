import { buildCodeLayerProjection } from "@shared/code-layer";

export type PendingPastedMediaByScreen = Map<string, Map<string, boolean>>;

export function cancelRemovedPendingPastedMedia(
  pendingByScreen: PendingPastedMediaByScreen,
  screenId: string,
  previousContent: string,
  nextContent: string,
) {
  const pending = pendingByScreen.get(screenId);
  if (!pending) return;

  const getNodeIds = (content: string) =>
    new Set(
      buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId: screenId },
      })
        .nodes.map((node) => node.dataAttributes["data-agent-native-node-id"])
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    );
  const previousNodeIds = getNodeIds(previousContent);
  const nextNodeIds = getNodeIds(nextContent);

  for (const nodeId of pending.keys()) {
    if (previousNodeIds.has(nodeId) && !nextNodeIds.has(nodeId)) {
      pending.set(nodeId, true);
    }
  }
}
