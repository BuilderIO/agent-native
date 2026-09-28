import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerSource,
} from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";

import { resolveCodeLayerNodeFromElementInfo } from "./code-layer-state";
import { describeFlowContainer, type FlowContainerInfo } from "./nudge-intent";

const REPLACED_TAGS = new Set([
  "area",
  "audio",
  "br",
  "canvas",
  "circle",
  "embed",
  "hr",
  "iframe",
  "img",
  "input",
  "object",
  "path",
  "polygon",
  "rect",
  "select",
  "source",
  "svg",
  "textarea",
  "track",
  "video",
  "wbr",
]);

const TEXT_LEAF_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "button",
  "caption",
  "code",
  "em",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "i",
  "label",
  "legend",
  "li",
  "option",
  "p",
  "pre",
  "small",
  "span",
  "strong",
  "summary",
  "td",
  "th",
]);

export interface PasteTargetNode {
  tag: string;
  hasElementChildren: boolean;
  hasText: boolean;
  container: FlowContainerInfo;
  primitiveKind?: string | null;
}

export function isPasteContainer(node: PasteTargetNode): boolean {
  const tag = node.tag.toLowerCase();
  if (REPLACED_TAGS.has(tag)) return false;
  if (TEXT_LEAF_TAGS.has(tag)) return false;
  if (node.primitiveKind && node.primitiveKind !== "frame") return false;
  if (node.container.kind !== "none") return true;
  if (node.hasElementChildren) return true;
  return !node.hasText;
}

export type PastePlacement = "inside" | "after";

export interface PastePlacementDecision {
  placement: PastePlacement;
  targetNodeId: string;
}

function resolvePastePlacement(
  node: PasteTargetNode & { targetNodeId: string },
): PastePlacementDecision {
  return {
    placement: isPasteContainer(node) ? "inside" : "after",
    targetNodeId: node.targetNodeId,
  };
}

function pasteTargetFromCodeLayerNode(
  node: CodeLayerNode,
): PasteTargetNode & { targetNodeId: string } {
  return {
    tag: node.tag,
    hasElementChildren: node.children.length > 0,
    hasText: Boolean(node.textSnippet && node.textSnippet.trim()),
    container: describeFlowContainer(node),
    primitiveKind: node.dataAttributes["data-an-primitive"] ?? null,
    targetNodeId: node.id,
  };
}

export function resolvePastePlacementForSelection(args: {
  content: string;
  source?: CodeLayerSource;
  selectedElement: ElementInfo | null | undefined;
}): PastePlacementDecision | null {
  if (!args.content || !args.selectedElement) return null;
  const projection = buildCodeLayerProjection(args.content, {
    ...(args.source ? { source: args.source } : {}),
  });
  const node = resolveCodeLayerNodeFromElementInfo(
    projection,
    args.selectedElement,
  );
  if (!node) return null;
  return resolvePastePlacement(pasteTargetFromCodeLayerNode(node));
}

export interface PasteSourceAnchor {
  fileId: string;
  parentSelectors: string[] | null;
}

export function resolvePasteSourceAnchor(args: {
  entries: ReadonlyArray<{ rootNodeId?: string; sourceFileId: string }>;
  getContent: (fileId: string) => string | undefined;
}): PasteSourceAnchor | null {
  const first = args.entries[0];
  if (!first) return null;
  if (args.entries.some((entry) => entry.sourceFileId !== first.sourceFileId)) {
    return null;
  }
  const content = args.getContent(first.sourceFileId);
  if (!content) return null;
  const projection = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: first.sourceFileId },
  });
  const unresolved: PasteSourceAnchor = {
    fileId: first.sourceFileId,
    parentSelectors: null,
  };
  const parentIds = args.entries.map((entry) => {
    const node = entry.rootNodeId
      ? projection.nodes.find(
          (candidate) =>
            candidate.dataAttributes["data-agent-native-node-id"] ===
              entry.rootNodeId || candidate.id === entry.rootNodeId,
        )
      : undefined;
    return node?.parentId ?? null;
  });
  const [sharedParentId] = parentIds;
  if (!sharedParentId || parentIds.some((id) => id !== sharedParentId)) {
    return unresolved;
  }
  const parent = projection.nodes.find(
    (candidate) => candidate.id === sharedParentId,
  );
  if (!parent) return unresolved;
  const parentNodeId = parent.dataAttributes["data-agent-native-node-id"];
  const parentSelectors = [
    parentNodeId
      ? `[data-agent-native-node-id="${parentNodeId.replace(/["\\]/g, "\\$&")}"]`
      : null,
    parent.selector,
    ...parent.selectors,
  ].filter((selector): selector is string => Boolean(selector));
  if (parentSelectors.length === 0) return unresolved;
  return { fileId: first.sourceFileId, parentSelectors };
}
