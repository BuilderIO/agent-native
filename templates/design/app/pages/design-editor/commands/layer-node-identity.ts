import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdInHtml,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "@shared/code-layer";

interface LayerNodeIdentityIndex {
  authoredIdCounts: Map<string, number>;
  nodeIds: Set<string>;
}

const identityIndexes = new WeakMap<
  CodeLayerProjection,
  LayerNodeIdentityIndex
>();

function identityIndex(
  projection: CodeLayerProjection,
): LayerNodeIdentityIndex {
  const cached = identityIndexes.get(projection);
  if (cached) return cached;

  const authoredIdCounts = new Map<string, number>();
  const nodeIds = new Set<string>();
  for (const node of projection.nodes) {
    nodeIds.add(node.id);
    const authoredId = node.dataAttributes["data-agent-native-node-id"];
    if (authoredId) {
      authoredIdCounts.set(
        authoredId,
        (authoredIdCounts.get(authoredId) ?? 0) + 1,
      );
    }
  }

  const index = { authoredIdCounts, nodeIds };
  identityIndexes.set(projection, index);
  return index;
}

export function prepareLayerNodeIdentities(args: {
  content: string;
  nodes: readonly CodeLayerNode[];
  renderedProjection: CodeLayerProjection;
}) {
  const source = args.renderedProjection.source;
  const currentProjection = buildCodeLayerProjection(args.content, { source });
  const renderedIndex = identityIndex(args.renderedProjection);
  const currentIndex = identityIndex(currentProjection);
  const nodeIds = new Map<string, string>();
  let content = args.content;

  for (const node of args.nodes) {
    const authoredId = node.dataAttributes["data-agent-native-node-id"];
    if (
      authoredId &&
      renderedIndex.authoredIdCounts.get(authoredId) === 1 &&
      currentIndex.authoredIdCounts.get(authoredId) === 1
    ) {
      nodeIds.set(node.id, authoredId);
      continue;
    }
    if (!renderedIndex.nodeIds.has(node.id)) continue;
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
