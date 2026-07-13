import { normalizePoisonedBoardNestedCoords } from "@shared/board-file";
import type { CodeLayerNode } from "@shared/code-layer";

import { authoredElementPosition } from "@/components/design/multi-screen/primitive-drop-target";

import { escapeHtmlAttributeValue } from "./dom-utils";

const ABS_POSITION_PROPS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
] as const;

// Flex/grid-item-only inline properties. Mirrors FLEX_ITEM_INLINE_PROPS in
// editor-chrome.bridge.ts's prepareFlowMembersForAbsoluteDrop (the live
// in-iframe optimistic strip) — a former flow child persisted here as
// position:absolute must lose these too, or the source round-trip re-adds
// back exactly the flex-item styling the live DOM already dropped, and any
// later reparent back into flow (including undo) resurrects a stale,
// source-parent-relative grow/shrink/basis/align-self/order.
const FLEX_ITEM_PROPS = [
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "order",
] as const;

/**
 * Remove absolute-positioning style properties from the element identified by
 * `data-agent-native-node-id` so that it becomes a flow child after being
 * reparented into a container. Returns the updated HTML, or the original HTML
 * if the node cannot be found or parsing is unavailable.
 *
 * Uses DOMParser + CSSStyleDeclaration.removeProperty() rather than
 * applyVisualEdit({kind:"style",value:""}) because the substrate rejects
 * empty-string values in isSafeStyleValue, making that approach a silent no-op.
 */
export function removeAbsolutePositioningFromNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

/** Persist the bridge's narrow fallback for a flow insertion whose authored
 * stylesheet still resolves the moved child to absolute/fixed after its
 * editable inline/utility positioning has been stripped. `!important` is
 * intentional: the stylesheet declaration that forced this path may itself
 * be important. Left/top are removed because they are inert in static flow
 * and should not become surprising offsets if positioning changes later. */
export function setFlowPositioningOverrideForNodeInHtml(
  content: string,
  nodeAttrId: string,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    for (const prop of ABS_POSITION_PROPS) {
      element.style.removeProperty(prop);
    }
    element.style.setProperty("position", "static", "important");
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

export function setAbsolutePositioningForNodeInHtml(
  content: string,
  nodeAttrId: string,
  point: { x: number; y: number },
  pointerOffset?: { x: number; y: number },
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return content;
    element.style.position = "absolute";
    element.style.left = `${Math.round(point.x - (pointerOffset?.x ?? 0))}px`;
    element.style.top = `${Math.round(point.y - (pointerOffset?.y ?? 0))}px`;
    element.style.removeProperty("right");
    element.style.removeProperty("bottom");
    for (const prop of FLEX_ITEM_PROPS) {
      element.style.removeProperty(prop);
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

export function getAbsolutePositioningForNodeInHtml(
  content: string,
  nodeAttrId: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    ) as HTMLElement | null;
    if (!element) return null;
    // Walk every ancestor up to <body> (authoredElementPosition, shared with
    // MultiScreenCanvas's drop-target math) instead of reading only this
    // node's own inline left/top. A node nested two-plus containers deep has
    // a style.left/top that's relative to its OWN immediate parent, not the
    // screen root, so a flat read here previously fed
    // computeReparentedChildPosition two positions from different coordinate
    // spaces whenever the source/target containers weren't both direct
    // children of the screen root — producing a garbage delta and making the
    // dropped element jump away from the cursor. For a root-level node this
    // walk terminates after one step and returns the exact same left/top as
    // before, so root-level reparents are unaffected.
    return authoredElementPosition(element);
  } catch {
    return null;
  }
}

/**
 * Finding 4: normalizePoisonedBoardNestedCoords (shared/board-file.ts)
 * heuristically rewrites persisted nested board coords with no built-in
 * trace of its own (kept side-effect-free so it stays safely callable from
 * any context — see its doc comment). Every call site that applies its
 * result and persists it goes through this shared logger instead, so a bad
 * heuristic firing in the wild is visible: file id, how many nodes were
 * rebased, and a small before/after sample.
 */
export function warnIfPoisonedBoardCoordsNormalized(
  fileId: string,
  result: ReturnType<typeof normalizePoisonedBoardNestedCoords>,
): void {
  if (!result.changed) return;
  console.warn(
    "[design] normalized poisoned nested board coordinates on load/reparent",
    {
      fileId,
      fixedNodeCount: result.fixedNodeCount,
      samples: result.samples,
    },
  );
}

export function isAbsoluteCodeLayerNode(
  node: CodeLayerNode | null | undefined,
) {
  const position = String(node?.style.position ?? "").toLowerCase();
  return position === "absolute" || position === "fixed";
}

export function setCodeLayerAttributeInHtml(
  content: string,
  node: CodeLayerNode,
  name: string,
  value: string | null,
): string | null {
  if (!node.source) return null;
  const openStart = node.source.openStart;
  const openEnd = node.source.openEnd;
  if (openStart < 0 || openEnd <= openStart || openEnd > content.length) {
    return null;
  }

  const openTag = content.slice(openStart, openEnd);
  const attrPattern = new RegExp(
    `\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>]+))?`,
    "i",
  );
  const replacement =
    value === null || value === ""
      ? ""
      : ` ${name}="${escapeHtmlAttributeValue(value)}"`;

  if (attrPattern.test(openTag)) {
    const nextOpenTag = openTag.replace(attrPattern, replacement);
    return `${content.slice(0, openStart)}${nextOpenTag}${content.slice(openEnd)}`;
  }

  if (value === null || value === "") return content;
  const insertAt = openTag.endsWith("/>") ? openEnd - 2 : openEnd - 1;
  return `${content.slice(0, insertAt)}${replacement}${content.slice(insertAt)}`;
}

export function getBodyInlineStyles(content: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const body = doc.body;
    if (!body) return {};
    return {
      backgroundColor: body.style.backgroundColor,
      backgroundImage: body.style.backgroundImage,
      backgroundPosition: body.style.backgroundPosition,
      backgroundRepeat: body.style.backgroundRepeat,
      backgroundSize: body.style.backgroundSize,
      fontFamily: body.style.fontFamily,
      fontSize: body.style.fontSize,
    };
  } catch {
    return {};
  }
}
