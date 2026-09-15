import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdInHtml,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "@shared/code-layer";

export function prepareLayerNodeIdentities(args: {
  content: string;
  nodes: readonly CodeLayerNode[];
  renderedProjection: CodeLayerProjection;
}) {
  const source = args.renderedProjection.source;
  const currentProjection = buildCodeLayerProjection(args.content, { source });
  const countAuthoredId = (
    projection: CodeLayerProjection,
    authoredId: string,
  ) =>
    projection.nodes.filter(
      (node) => node.dataAttributes["data-agent-native-node-id"] === authoredId,
    ).length;
  const nodeIds = new Map<string, string>();
  let content = args.content;

  for (const node of args.nodes) {
    const authoredId = node.dataAttributes["data-agent-native-node-id"];
    if (
      authoredId &&
      countAuthoredId(args.renderedProjection, authoredId) === 1 &&
      countAuthoredId(currentProjection, authoredId) === 1
    ) {
      nodeIds.set(node.id, authoredId);
      continue;
    }
    if (
      !args.renderedProjection.nodes.some(
        (candidate) => candidate.id === node.id,
      )
    ) {
      continue;
    }
    if (
      currentProjection.projectionId !== args.renderedProjection.projectionId
    ) {
      continue;
    }
    const identity = ensureCodeLayerNodeIdInHtml(content, node.id, {
      source,
      selector: node.path,
    });
    if (!identity.nodeId) continue;
    content = identity.content;
    nodeIds.set(node.id, identity.nodeId);
  }

  return { content, nodeIds };
}
