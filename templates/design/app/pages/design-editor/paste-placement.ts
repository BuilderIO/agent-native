import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerSource,
} from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";

import { resolveCodeLayerNodeFromElementInfo } from "./code-layer-state";
import { authoredDocumentPositionForNode } from "./html-layer-positioning";
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

/**
 * A live screen has no stored document to project, so the selected element's
 * measured payload stands in for its code-layer node. Null when the payload
 * leaves out the child count and the answer depends on it.
 */
export function pasteTargetFromElementInfo(
  element: Pick<
    ElementInfo,
    | "tagName"
    | "childElementCount"
    | "textContent"
    | "primitiveKind"
    | "isFlexContainer"
    | "isGridContainer"
  >,
): PasteTargetNode | null {
  const node: PasteTargetNode = {
    tag: element.tagName,
    hasElementChildren: (element.childElementCount ?? 0) > 0,
    hasText: Boolean(element.textContent?.trim()),
    container: describeFlowContainer({
      style: element.isGridContainer
        ? { display: "grid" }
        : element.isFlexContainer
          ? { display: "flex" }
          : {},
    }),
    primitiveKind: element.primitiveKind ?? null,
  };
  if (
    element.childElementCount === undefined &&
    isPasteContainer(node) !==
      isPasteContainer({ ...node, hasElementChildren: true })
  ) {
    return null;
  }
  return node;
}

export type PastePlacement = "inside" | "after";

export interface PastePlacementDecision {
  placement: PastePlacement;
  targetNodeId: string;
  position?: { x: number; y: number };
  positionError?:
    | "paste-position-geometry-unavailable"
    | "paste-position-geometry-invalid";
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
  point?: { x: number; y: number };
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
  const decision = resolvePastePlacement(pasteTargetFromCodeLayerNode(node));
  if (!args.point) return decision;
  const container =
    decision.placement === "inside"
      ? node
      : projection.nodes.find((candidate) => candidate.id === node.parentId);
  const display =
    decision.placement === "inside"
      ? args.selectedElement.computedStyles?.display
      : (args.selectedElement.parentDisplay ??
        args.selectedElement.parentLayout?.display);
  const flow = container ? describeFlowContainer(container).kind : "none";
  if (
    flow === "flex" ||
    flow === "grid" ||
    display === "flex" ||
    display === "inline-flex" ||
    display === "grid" ||
    display === "inline-grid"
  )
    return decision;
  const origin =
    decision.placement === "inside"
      ? args.selectedElement.boundingRect
      : (args.selectedElement.positionContainingBlockOrigin ??
        args.selectedElement.parentBoundingRect);
  if (!origin)
    return {
      ...decision,
      positionError: "paste-position-geometry-unavailable",
    };
  if (![origin.x, origin.y, args.point.x, args.point.y].every(Number.isFinite))
    return { ...decision, positionError: "paste-position-geometry-invalid" };
  return {
    ...decision,
    position: {
      x: args.point.x - origin.x,
      y: args.point.y - origin.y,
    },
  };
}

export interface PasteLayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pasteGroupBounds(layers: ReadonlyArray<PasteLayerBox>) {
  const left = Math.min(...layers.map((layer) => layer.x));
  const top = Math.min(...layers.map((layer) => layer.y));
  const right = Math.max(...layers.map((layer) => layer.x + layer.width));
  const bottom = Math.max(...layers.map((layer) => layer.y + layer.height));
  return { left, top, width: right - left, height: bottom - top };
}

function placeGroupAt(
  layers: ReadonlyArray<PasteLayerBox>,
  origin: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const bounds = pasteGroupBounds(layers);
  return layers.map((layer) => ({
    x: Math.round(origin.x + layer.x - bounds.left),
    y: Math.round(origin.y + layer.y - bounds.top),
  }));
}

/**
 * A paste into a frame: the copy keeps its offset from its
 * old parent when that still fits inside the frame, and is centered in the
 * frame when it would overflow. Multiple layers move as one group.
 */
export function fitPasteLayersInFrame(
  layers: ReadonlyArray<PasteLayerBox>,
  frame: { width: number; height: number },
): Array<{ x: number; y: number }> {
  if (layers.length === 0) return [];
  const bounds = pasteGroupBounds(layers);
  const fits =
    bounds.left >= 0 &&
    bounds.top >= 0 &&
    bounds.left + bounds.width <= frame.width &&
    bounds.top + bounds.height <= frame.height;
  if (fits) {
    return layers.map((layer) => ({
      x: Math.round(layer.x),
      y: Math.round(layer.y),
    }));
  }
  return placeGroupAt(layers, {
    x: (frame.width - bounds.width) / 2,
    y: (frame.height - bounds.height) / 2,
  });
}

export type CanvasPastePlacement =
  | {
      at: "original" | "view-center";
      positions: Array<{ x: number; y: number }>;
    }
  | { at: "unplaceable" };

/**
 * A paste with nothing selected: the copy lands free on the
 * canvas where the original sits when that spot is in view, and centered on
 * the view otherwise. `original` is null when the original's canvas spot is
 * unknown (another design, or a deleted source); `layers` then gives only the
 * copy's shape.
 */
export function resolveCanvasPastePositions(args: {
  layers: ReadonlyArray<PasteLayerBox>;
  original: ReadonlyArray<PasteLayerBox> | null;
  visibleRect: PasteLayerBox | null;
  cascadeOffset: number;
}): CanvasPastePlacement {
  const { original, visibleRect, cascadeOffset } = args;
  const shape = original ?? args.layers;
  if (shape.length === 0) return { at: "unplaceable" };
  if (original) {
    const bounds = pasteGroupBounds(original);
    const overlaps = (
      start: number,
      size: number,
      viewStart: number,
      viewSize: number,
    ) => viewStart + viewSize > start && start + size > viewStart;
    const inView =
      !visibleRect ||
      (overlaps(bounds.left, bounds.width, visibleRect.x, visibleRect.width) &&
        overlaps(bounds.top, bounds.height, visibleRect.y, visibleRect.height));
    if (inView) {
      return {
        at: "original",
        positions: original.map((layer) => ({
          x: Math.round(layer.x + cascadeOffset),
          y: Math.round(layer.y + cascadeOffset),
        })),
      };
    }
  }
  if (!visibleRect) return { at: "unplaceable" };
  const bounds = pasteGroupBounds(shape);
  return {
    at: "view-center",
    positions: placeGroupAt(shape, {
      x: visibleRect.x + (visibleRect.width - bounds.width) / 2 + cascadeOffset,
      y:
        visibleRect.y +
        (visibleRect.height - bounds.height) / 2 +
        cascadeOffset,
    }),
  };
}

function pixelLength(value: string | undefined): number | null {
  const match = value?.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))px$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The copy's box relative to the parent it was copied from. A layer with no
 * authored position (a flow child) reads as stacked 16px steps from the
 * parent's corner; an unknown size reads as zero.
 */
export function clipboardEntryPasteBox(
  entry: {
    html: string;
    portableStyleSnapshot?: {
      nodes: ReadonlyArray<{
        path: readonly number[];
        styles: Record<string, string>;
      }>;
    };
  },
  index: number,
): PasteLayerBox {
  let style: CSSStyleDeclaration | null = null;
  if (typeof window !== "undefined") {
    const doc = new DOMParser().parseFromString(
      `<template>${entry.html}</template>`,
      "text/html",
    );
    const root = doc.querySelector("template")?.content.firstElementChild;
    style = root instanceof HTMLElement ? root.style : null;
  }
  const snapshot = entry.portableStyleSnapshot?.nodes.find(
    (node) => node.path.length === 0,
  )?.styles;
  const read = (property: "left" | "top" | "width" | "height") =>
    pixelLength(style?.getPropertyValue(property)) ??
    pixelLength(snapshot?.[property]);
  const left = read("left");
  const top = read("top");
  const positioned = left !== null && top !== null;
  return {
    x: positioned ? left : index * 16,
    y: positioned ? top : index * 16,
    width: Math.max(0, read("width") ?? 0),
    height: Math.max(0, read("height") ?? 0),
  };
}

type ClipboardSourceEntry = {
  html: string;
  rootNodeId?: string;
  sourceFileId: string;
  sourceCanvasRect?: PasteLayerBox;
  portableStyleSnapshot?: Parameters<
    typeof clipboardEntryPasteBox
  >[0]["portableStyleSnapshot"];
};

interface ClipboardSourceCanvas {
  getContent: (fileId: string) => string | undefined;
  frames: ReadonlyArray<{ id: string; geometry: { x: number; y: number } }>;
  boardFileId: string | undefined;
}

/** One copied layer's original on this design's canvas, or null if unlocatable. */
export function clipboardSourceCanvasRect(
  entry: ClipboardSourceEntry,
  index: number,
  canvas: ClipboardSourceCanvas,
): PasteLayerBox | null {
  if (!entry.rootNodeId) return null;
  const origin =
    entry.sourceFileId === canvas.boardFileId
      ? { x: 0, y: 0 }
      : canvas.frames.find((frame) => frame.id === entry.sourceFileId)
          ?.geometry;
  if (!origin) return null;
  const content = canvas.getContent(entry.sourceFileId);
  if (!content) return null;
  const position = authoredDocumentPositionForNode(content, entry.rootNodeId);
  if (!position) return null;
  const box = clipboardEntryPasteBox(entry, index);
  return {
    x: origin.x + position.x,
    y: origin.y + position.y,
    width: box.width,
    height: box.height,
  };
}

/**
 * Where each copied layer's original sits on the canvas now, or null when any
 * of them cannot be located: its file is not in this design, the original is
 * gone, or its position is not authored inline. A copy from another design
 * falls back to the box the copy recorded. Board documents share the canvas's
 * coordinates; a screen's layers are offset by the screen's frame.
 */
export function resolveClipboardSourceCanvasRects(
  args: {
    entries: ReadonlyArray<ClipboardSourceEntry>;
  } & ClipboardSourceCanvas,
): PasteLayerBox[] | null {
  if (args.entries.length === 0) return null;
  const located = args.entries.map((entry, index) =>
    clipboardSourceCanvasRect(entry, index, args),
  );
  if (located.every(Boolean)) return located as PasteLayerBox[];
  const recorded = args.entries.map((entry) => entry.sourceCanvasRect);
  return recorded.every(Boolean) ? (recorded as PasteLayerBox[]) : null;
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
