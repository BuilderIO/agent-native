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
