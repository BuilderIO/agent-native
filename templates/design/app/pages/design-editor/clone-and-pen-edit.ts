import {
  getPenPathGeometry,
  serializePenNodes,
  serializePenPath,
  type PenPath,
} from "@shared/pen-path";

import type { PortableStyleSnapshot } from "@/components/design/types";
import {
  applyDesignClipboardManagedStyles,
  type DesignClipboardManagedStyleSnapshot,
} from "@/lib/design-clipboard-managed-styles";

import { uniqueLayerId } from "./canvas-primitive-insert";
import { reassignClonedAuthoredIds } from "./clone-idrefs";
import { queryUniqueSelector } from "./dom-utils";
import {
  applyPortableStyles,
  elementAtPortableStylePath,
  styleHost,
} from "./portable-style";

/**
 * Vector-edit foundations: stamps `data-an-pen-nodes` (the compact
 * serializePenNodes encoding — see shared/pen-path.ts) onto the committed
 * pen-path SVG element identified by `data-agent-native-node-id === nodeId`,
 * so the structured node/handle data survives independently of the
 * flattened `d` attribute and can later be re-hydrated into vector edit
 * mode. Returns `content` unchanged (never null) if the node can't be found
 * or `content` fails to parse — this is a best-effort enrichment step, never
 * a hard requirement for the primitive to commit successfully.
 */
export function setPenNodesAttributeOnElement(
  content: string,
  nodeId: string,
  penPath: PenPath,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    // nodeId always comes from uniqueLayerId(...) (alphanumeric/hyphen/UUID
    // chars only, never quotes), but escape defensively anyway since this
    // value is interpolated into a CSS attribute-selector string.
    const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
    const element = doc.querySelector(
      `[data-agent-native-node-id="${safeNodeId}"]`,
    );
    if (!element) return content;
    element.setAttribute("data-an-pen-nodes", serializePenNodes(penPath));
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

/**
 * Vector-edit foundations: writes an edited PenPath back onto its committed
 * SVG element — the `<path>` child's `d` (serializePenPath, matching what
 * appendCanvasPrimitiveToHtml's explicitPathData branch produces) AND the
 * `<svg>` root's `data-an-pen-nodes` (serializePenNodes, the structured
 * round-trip source), plus the root's `viewBox`/left/top/width/height so the
 * element's bounding box stays correct after anchors/handles moved it.
 * `nodeId` is the element's `data-agent-native-node-id` value (screen-content
 * space — same coordinate system the path's own nodes are already in, see
 * parsePenPathFromSerializedD's doc comment for that finding).
 *
 * Returns `content` unchanged (never null/throws) if the element can't be
 * found, isn't an SVG pen-path root, or has no `<path>` child — the caller
 * treats that as a no-op commit rather than losing the user's edit.
 */
export function writeBackVectorEditedPenPath(
  content: string,
  nodeId: string,
  penPath: PenPath,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
    const svg = doc.querySelector(
      `[data-agent-native-node-id="${safeNodeId}"]`,
    );
    const path = svg?.querySelector("path");
    if (!svg || !path) return content;

    const d = serializePenPath(penPath);
    const geometry = getPenPathGeometry(penPath);
    const isClosed = Boolean(penPath.closed && penPath.nodes.length > 1);

    path.setAttribute("d", d);
    if (isClosed && path.getAttribute("fill") === "none") {
      path.setAttribute("fill", "#D9D9D9");
    } else if (!isClosed) {
      path.setAttribute("fill", "none");
    }

    svg.setAttribute("data-an-pen-nodes", serializePenNodes(penPath));
    svg.setAttribute(
      "viewBox",
      `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`,
    );
    const existingStyle = svg.getAttribute("style") ?? "";
    const rotationMatch = existingStyle.match(/transform:[^;]+/);
    svg.setAttribute(
      "style",
      [
        "position:absolute",
        `left:${Math.round(geometry.x)}px`,
        `top:${Math.round(geometry.y)}px`,
        `width:${Math.max(1, Math.round(geometry.width))}px`,
        `height:${Math.max(1, Math.round(geometry.height))}px`,
        "overflow:visible",
        rotationMatch?.[0] ?? "",
      ]
        .filter(Boolean)
        .join(";"),
    );

    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}

export function cloneHtmlLayerAtPosition(
  content: string,
  layerHtml: string,
  position: { x: number; y: number },
): string | null {
  return (
    insertClonedHtmlLayers(content, [layerHtml], {
      positions: [position],
    })?.content ?? null
  );
}

function clearRootLayerPosition(element: Element) {
  const host = styleHost(element);
  if (!host) return;
  host.style.position = "";
  host.style.left = "";
  host.style.top = "";
  host.style.right = "";
  host.style.bottom = "";
}

function setRootLayerPosition(
  element: Element,
  position: { x: number; y: number },
) {
  const host = styleHost(element);
  if (!host) return;
  // Use explicit style property assignments rather than prepending a raw
  // string. Prepending creates duplicate CSS properties in the same style
  // attribute, and in CSS the LAST occurrence wins, so existing left/top
  // values from the cloned element would override the new position.
  host.style.position = "absolute";
  host.style.left = `${Math.max(0, Math.round(position.x))}px`;
  host.style.top = `${Math.max(0, Math.round(position.y))}px`;
  host.style.right = "";
  host.style.bottom = "";
}

function prepareClonedHtmlLayer(
  doc: Document,
  layerHtml: string,
  styleSnapshot?: PortableStyleSnapshot,
): {
  element: Element;
  rootNodeId: string;
  // U14: old data-agent-native-node-id -> new id, for every node that was
  // re-stamped (root + descendants). Callers use this to remap motion
  // tracks (MotionTrack.targetNodeId) onto the clone so a duplicated/pasted
  // animated layer keeps its animation instead of silently losing it.
  nodeIdMap: Map<string, string>;
} | null {
  const layerDoc = new DOMParser().parseFromString(
    `<template>${layerHtml}</template>`,
    "text/html",
  );
  const source =
    layerDoc.querySelector("template")?.content.firstElementChild ??
    layerDoc.body.firstElementChild;
  if (!source) return null;
  const clone = doc.importNode(source, true) as Element;
  if (styleSnapshot) {
    clone.setAttribute("data-agent-native-preserve-styles", "true");
    styleSnapshot.nodes.forEach((node) => {
      const target = elementAtPortableStylePath(clone, node);
      if (target) applyPortableStyles(target, node.styles);
    });
  }
  const nodeIdMap = new Map<string, string>();
  const previousRootNodeId = clone.getAttribute("data-agent-native-node-id");
  const rootNodeId = uniqueLayerId("copy");
  clone.setAttribute("data-agent-native-node-id", rootNodeId);
  if (previousRootNodeId) nodeIdMap.set(previousRootNodeId, rootNodeId);
  Array.from(clone.querySelectorAll("[data-agent-native-node-id]")).forEach(
    (node) => {
      const previousChildId = node.getAttribute("data-agent-native-node-id");
      const nextChildId = uniqueLayerId("copy-child");
      node.setAttribute("data-agent-native-node-id", nextChildId);
      if (previousChildId) nodeIdMap.set(previousChildId, nextChildId);
    },
  );
  // U14: also regenerate plain `id="..."` attributes on the clone (root +
  // descendants). Without this, duplicating/pasting an element that (or
  // whose descendants) carries an authored id="..." produces two elements
  // with the same id in the same document — CSS #id selectors and any
  // later selector-based edit then resolve to whichever one the browser
  // happens to match first (typically the ORIGINAL, not the new copy),
  // silently misapplying edits meant for the duplicate.
  reassignClonedAuthoredIds(clone, () => uniqueLayerId("copy-id"));
  return { element: clone, rootNodeId, nodeIdMap };
}

export function insertClonedHtmlLayers(
  content: string,
  layerHtmls: string[],
  options: {
    targetSelectors?: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
    stripRootPosition?: boolean;
    positions?: Array<{ x: number; y: number } | null | undefined>;
    styleSnapshots?: Array<PortableStyleSnapshot | null | undefined>;
    managedStyleSnapshots?: Array<
      DesignClipboardManagedStyleSnapshot | null | undefined
    >;
  } = {},
): {
  content: string;
  rootNodeIds: string[];
  // U14: merged old-id -> new-id map across every cloned layer, for
  // remapping motion tracks onto the copies.
  nodeIdMap: Map<string, string>;
} | null {
  if (typeof window === "undefined" || layerHtmls.length === 0) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const fragment = doc.createDocumentFragment();
    const rootNodeIds: string[] = [];
    const nodeIdMap = new Map<string, string>();
    layerHtmls.forEach((layerHtml, index) => {
      const prepared = prepareClonedHtmlLayer(
        doc,
        layerHtml,
        options.styleSnapshots?.[index] ?? undefined,
      );
      if (!prepared) return;
      const position = options.positions?.[index];
      if (position) {
        setRootLayerPosition(prepared.element, position);
      } else if (options.stripRootPosition) {
        clearRootLayerPosition(prepared.element);
      }
      rootNodeIds.push(prepared.rootNodeId);
      prepared.nodeIdMap.forEach((value, key) => nodeIdMap.set(key, value));
      fragment.appendChild(prepared.element);
    });
    if (rootNodeIds.length === 0) return null;

    const target = queryFirstSelector(doc, options.targetSelectors ?? []);
    const anchor =
      queryFirstSelector(doc, options.anchorSelectors ?? []) ?? target;
    const placement = options.placement ?? "after";
    if (!anchor) {
      doc.body.appendChild(fragment);
    } else if (placement === "inside") {
      anchor.appendChild(fragment);
    } else if (placement === "before") {
      if (anchor.parentElement)
        anchor.parentElement.insertBefore(fragment, anchor);
      else doc.body.appendChild(fragment);
    } else {
      if (anchor.parentElement) {
        anchor.parentElement.insertBefore(fragment, anchor.nextSibling);
      } else {
        doc.body.appendChild(fragment);
      }
    }
    const contentWithClones = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    return {
      content: applyDesignClipboardManagedStyles(
        contentWithClones,
        options.managedStyleSnapshots ?? [],
        nodeIdMap,
      ),
      rootNodeIds,
      nodeIdMap,
    };
  } catch {
    return null;
  }
}

export function queryFirstSelector(
  root: ParentNode,
  selectors: Array<string | undefined>,
): Element | null {
  for (const selector of selectors) {
    if (!selector) continue;
    // Fail-closed on ambiguity, same pattern as queryUniqueSelector's other
    // call sites in this file (and resolveCodeLayerNodeFromBridge in
    // design-editor/code-layer-state.ts): a selector alias that matches
    // MULTIPLE elements in this DOMParser pass (an imprecise class-based
    // alias colliding with unrelated siblings, e.g.) must not silently
    // resolve to whichever one querySelector happens to return first —
    // callers pass several alias selectors for the SAME intended node
    // (codeLayerSelectorAliases) specifically so a later, more specific
    // alias (e.g. a stable data-attribute id) can still resolve correctly
    // when an earlier one is ambiguous.
    const match = queryUniqueSelector(root, selector);
    if (match) return match;
  }
  return null;
}

export function insertClonedHtmlLayer(
  content: string,
  cloneHtml: string,
  options: {
    targetSelectors: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
  },
): string | null {
  return (
    insertClonedHtmlLayers(content, [cloneHtml], {
      targetSelectors: options.targetSelectors,
      anchorSelectors: options.anchorSelectors,
      placement: options.placement,
    })?.content ?? null
  );
}

export function getElementOuterHtml(
  content: string,
  selector: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    return queryUniqueSelector(doc, selector)?.outerHTML ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract the absolute position declared in the outerHTML of a layer element.
 * Used to position a pasted element near its source so the paste lands inside
 * the same design area instead of at an arbitrary canvas coordinate.
 * Returns null if the position cannot be parsed (e.g. non-absolute element).
 */
export function extractLayerPosition(
  layerHtml: string,
): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const layerDoc = new DOMParser().parseFromString(
      `<template>${layerHtml}</template>`,
      "text/html",
    );
    const source =
      (layerDoc.querySelector("template")?.content
        .firstElementChild as HTMLElement | null) ??
      (layerDoc.body.firstElementChild as HTMLElement | null);
    if (!source) return null;
    const left = parseFloat(source.style.left);
    const top = parseFloat(source.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { x: left, y: top };
  } catch {
    return null;
  }
}
