import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";

import { resolveCodeLayerNodeFromElementInfo } from "./code-layer-state";
import { describeFlowContainer, type FlowContainerInfo } from "./nudge-intent";

/**
 * Figma parity — paste goes INSIDE a selected frame and AFTER a selected
 * object. Treating every selection as an object is the difference between
 * "paste into this card" and "paste a second card beside it".
 */

/** Elements that render their own content and can never host a pasted layer. */
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

/** Elements a designer reads as a text object rather than a frame, even when
 * markup nests inline children inside them. */
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
  selectedElement: ElementInfo | null | undefined;
}): PastePlacementDecision | null {
  if (!args.content || !args.selectedElement) return null;
  const projection = buildCodeLayerProjection(args.content);
  const node = resolveCodeLayerNodeFromElementInfo(
    projection,
    args.selectedElement,
  );
  if (!node) return null;
  return resolvePastePlacement(pasteTargetFromCodeLayerNode(node));
}

export interface PasteSourceAnchor {
  fileId: string;
  /**
   * null when the entries do not share one resolvable parent. Never an empty
   * array — a caller must not read "unresolved" as "insert at the root here",
   * because the stored left/top are relative to a parent that is not there.
   */
  parentSelectors: string[] | null;
}

/**
 * A copied layer's left/top are parent-relative, so a paste that lands
 * anywhere else reads them in the wrong coordinate space. Null means the
 * source is unknown — never "the document root".
 */
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
  const projection = buildCodeLayerProjection(content);
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
  // Layers copied out of different parents have no common coordinate space, so
  // forcing them into the first one's parent moves the rest.
  if (!sharedParentId || parentIds.some((id) => id !== sharedParentId)) {
    return unresolved;
  }
  const parent = projection.nodes.find(
    (candidate) => candidate.id === sharedParentId,
  );
  if (!parent) return unresolved;
  const parentNodeId = parent.dataAttributes["data-agent-native-node-id"];
  const parentSelectors = [
    // A node-id selector is unique by construction; the projection's
    // class/path aliases can match several siblings, and
    // insertClonedHtmlLayers fails closed on that ambiguity.
    parentNodeId
      ? `[data-agent-native-node-id="${parentNodeId.replace(/["\\]/g, "\\$&")}"]`
      : null,
    parent.selector,
    ...parent.selectors,
  ].filter((selector): selector is string => Boolean(selector));
  if (parentSelectors.length === 0) return unresolved;
  return { fileId: first.sourceFileId, parentSelectors };
}
