import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerSource,
  type EditIntent,
} from "@shared/code-layer";
import {
  COMPONENT_ID_ATTR,
  componentNodeIdMatches,
  linkedComponentRootForNode,
} from "@shared/component-model";

import type { GeometryHistorySelection } from "../history";
import { captureHistorySelectionSources } from "../history-identity";
import type { LinkedComponentEdit } from "./linked-component-mutation";

export type ApplyLinkedComponentEdit = (
  fileId: string,
  nodeId: string,
  edit: LinkedComponentEdit,
  selectionBefore?: GeometryHistorySelection,
  onApplied?: () => void,
) => void;

export function resolveLinkedComponentStructureTarget(args: {
  content: string;
  source: CodeLayerSource;
  intents: EditIntent[];
}): { fileId: string; nodeId: string } | null {
  if (!args.source.fileId) return null;
  const projection = buildCodeLayerProjection(args.content, {
    source: args.source,
  });
  const resolve = (target: { nodeId?: string; selector?: string }) => {
    const matches = projection.nodes.filter((node) =>
      target.nodeId
        ? componentNodeIdMatches(node, target.nodeId)
        : Boolean(target.selector && node.selectors.includes(target.selector)),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const parent = (node: CodeLayerNode | undefined) =>
    projection.nodes.find((candidate) => candidate.id === node?.parentId);
  const affected = args.intents.flatMap((intent) => {
    switch (intent.kind) {
      case "wrapNodes":
      case "booleanSubtract":
        return intent.targetIds.map((nodeId) => parent(resolve({ nodeId })));
      case "unwrap":
        return [resolve({ nodeId: intent.targetId })];
      case "deleteNode":
        return [parent(resolve(intent.target))];
      case "moveNode": {
        const anchor = resolve(intent.anchor);
        return [
          parent(resolve(intent.target)),
          intent.placement === "inside" ? anchor : parent(anchor),
        ];
      }
      default:
        return [];
    }
  });
  const roots = affected.map(
    (node) => node && linkedComponentRootForNode(node, projection),
  );
  const main = roots[0];
  if (
    !main?.dataAttributes[COMPONENT_ID_ATTR] ||
    roots.some((root) => root?.id !== main.id)
  )
    return null;
  const nodeId = main?.dataAttributes["data-agent-native-node-id"];
  return nodeId ? { fileId: args.source.fileId, nodeId } : null;
}

export function dispatchLinkedComponentStructure(args: {
  content: string;
  source: CodeLayerSource;
  intents: EditIntent[];
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
}): boolean {
  if (!args.applyLinkedComponentEdit) return false;
  const target = resolveLinkedComponentStructureTarget(args);
  if (!target) return false;
  args.applyLinkedComponentEdit(target.fileId, target.nodeId, {
    kind: "structure",
    intents: args.intents,
  });
  return true;
}

export function resolveLinkedComponentSelection(args: {
  content: string;
  fileId: string;
  nodeIds: string[];
  previous: GeometryHistorySelection;
}) {
  const projection = buildCodeLayerProjection(args.content, {
    source: { kind: "design-file", fileId: args.fileId },
  });
  const nodes = args.nodeIds.map((nodeId) => {
    const matches = projection.nodes.filter(
      (node) => node.dataAttributes["data-agent-native-node-id"] === nodeId,
    );
    if (matches.length !== 1) {
      throw new Error(
        "The saved component selection could not be resolved uniquely.",
      );
    }
    return matches[0]!;
  });
  return {
    nodes,
    snapshot: captureHistorySelectionSources(
      {
        ...args.previous,
        activeFileId: args.fileId,
        selectedLayerIds: nodes.map((node) => node.id),
      },
      { ...args.previous.sourceContentByFileId, [args.fileId]: args.content },
    ),
  };
}
