import type { CodeLayerProjection } from "@shared/code-layer";

export function projectMotionLayerVisibility(
  projection: CodeLayerProjection,
  hiddenLayerIds: ReadonlySet<string>,
) {
  const codeLayerIdByMotionNodeId = new Map<string, string>();
  const hiddenMotionNodeIds = new Set<string>();

  for (const node of projection.nodes) {
    codeLayerIdByMotionNodeId.set(node.id, node.id);

    const motionNodeId = node.dataAttributes["data-agent-native-node-id"];
    if (!motionNodeId) continue;
    codeLayerIdByMotionNodeId.set(motionNodeId, node.id);

    if (hiddenLayerIds.has(node.id)) {
      hiddenMotionNodeIds.add(node.id);
      hiddenMotionNodeIds.add(motionNodeId);
    }
  }

  return { codeLayerIdByMotionNodeId, hiddenMotionNodeIds };
}
