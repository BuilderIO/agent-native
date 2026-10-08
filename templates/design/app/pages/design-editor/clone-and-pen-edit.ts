import {
  applyVisualEdit,
  buildCodeLayerProjection,
  PEN_CORNER_RADIUS_ATTRIBUTE,
  type CodeLayerNode,
  type CodeLayerSource,
} from "@shared/code-layer";
import {
  analyzeComponentLinks,
  componentSubtreeForProjection,
  isValidComponentReferenceSubtree,
  materializeComponentLink,
  type ComponentSourceDocument,
} from "@shared/component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  linkedComponentRootForNode,
} from "@shared/component-model";
import { resolveLayerNameAttribute } from "@shared/layer-name";
import {
  createCornerNode,
  createSmoothNode,
  getPenPathGeometry,
  penCornerRadiusFromAttribute,
  serializePenPath,
  serializePenNodes,
  scalePenPathToGeometry,
  serializeRoundedPenPath,
  translatePenPath,
  type PenPath,
} from "@shared/pen-path";

import {
  DEFAULT_LINE_STROKE,
  DEFAULT_SHAPE_FILL,
} from "@/components/design/canvas-primitive-style";

import { hidePenPathFill, restoreClosedPenPathFill } from "./pen-path-paint";

const AUTO_OPEN_STROKE_MARKER = "data-an-auto-open-stroke";
import type { PortableStyleSnapshot } from "@/components/design/types";
import {
  applyDesignClipboardManagedStyles,
  type DesignClipboardManagedStyleSnapshot,
} from "@/lib/design-clipboard-managed-styles";

import { uniqueLayerId } from "./canvas-primitive-insert";
import {
  reassignClonedAuthoredIds,
  reassignClonedSourceIdentity,
} from "./clone-idrefs";
import { queryUniqueSelector } from "./dom-utils";
import { isStandaloneHttpUrl } from "./editor-state";
import {
  applyPortableStyles,
  elementAtPortableStylePath,
  styleHost,
} from "./portable-style";

function restoreClosedPenPathPaint(path: SVGPathElement): void {
  restoreClosedPenPathFill(path);
  if (!path.hasAttribute(AUTO_OPEN_STROKE_MARKER)) return;
  if (path.getAttribute("fill") === "none") {
    path.setAttribute("fill", DEFAULT_SHAPE_FILL);
  }
  path.setAttribute("stroke", "none");
  path.removeAttribute(AUTO_OPEN_STROKE_MARKER);
}

export function setPenNodesAttributeOnElement(
  content: string,
  nodeId: string,
  penPath: PenPath,
): string {
  if (typeof window === "undefined") return content;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
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

export function writeBackVectorEditedPenPath(
  content: string,
  nodeId: string,
  penPath: PenPath,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
    const svgElement = doc.querySelector(
      `[data-agent-native-node-id="${safeNodeId}"]`,
    );
    if (!svgElement) return null;
    if (svgElement.tagName.toLowerCase() === "path") {
      const path = svgElement as SVGPathElement;
      const svg = path.ownerSVGElement;
      if (
        !svg ||
        svg.getAttribute("data-an-primitive") !== "pasted-svg" ||
        !path.hasAttribute("data-an-pen-nodes")
      ) {
        return null;
      }

      const isClosed = Boolean(penPath.closed && penPath.nodes.length > 1);
      path.setAttribute("d", serializePenPath(penPath));
      if (isClosed) {
        restoreClosedPenPathPaint(path);
      } else {
        hidePenPathFill(path);
        if (path.getAttribute("stroke") === "none") {
          path.setAttribute("stroke", DEFAULT_LINE_STROKE);
          path.setAttribute(AUTO_OPEN_STROKE_MARKER, "");
        }
      }
      path.setAttribute("data-an-pen-nodes", serializePenNodes(penPath));
      svg.style.overflow = "visible";
      return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    }
    if (svgElement.tagName.toLowerCase() !== "svg") return null;
    const svg = svgElement as SVGSVGElement;
    const path = svg.querySelector("path");
    if (!path) return null;

    const cornerRadiusAttribute = svg.getAttribute(PEN_CORNER_RADIUS_ATTRIBUTE);
    const cornerRadius = penCornerRadiusFromAttribute(cornerRadiusAttribute);
    const d = serializeRoundedPenPath(penPath, cornerRadius);
    const geometry = getPenPathGeometry(penPath);
    const isClosed = Boolean(penPath.closed && penPath.nodes.length > 1);
    const oldViewBox = parseViewBox(svg.getAttribute("viewBox"));
    const oldLeft = parsePixelValue(svg.style.left);
    const oldTop = parsePixelValue(svg.style.top);
    if (!oldViewBox || oldLeft === null || oldTop === null) return null;

    const strokeOverlay = svg.querySelector<SVGUseElement>(
      ":scope > use[data-an-vector-stroke-overlay]",
    );
    const originalOverflow = svg.getAttribute(
      "data-an-vector-stroke-original-overflow",
    );
    const originalOverflowPriority =
      svg.getAttribute("data-an-vector-stroke-original-overflow-priority") ??
      "";
    const strokePosition = svg.getAttribute("data-an-vector-stroke-position");

    path.setAttribute("d", d);
    if (isClosed) {
      restoreClosedPenPathPaint(path);
    } else {
      hidePenPathFill(path);
      if (strokeOverlay) {
        const overlayStyle = strokeOverlay.style;
        for (const property of [
          "stroke",
          "stroke-width",
          "stroke-opacity",
          "stroke-dasharray",
          "stroke-dashoffset",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-miterlimit",
        ]) {
          const value =
            property === "stroke-width"
              ? strokeOverlay.getAttribute("data-an-vector-logical-width")
              : overlayStyle.getPropertyValue(property);
          if (value) path.style.setProperty(property, value);
        }
        svg
          .querySelectorAll(":scope > defs[data-an-vector-stroke-defs]")
          .forEach((defs) => defs.remove());
        svg
          .querySelectorAll(":scope > use[data-an-vector-stroke-overlay]")
          .forEach((overlay) => overlay.remove());
        svg.removeAttribute("data-an-vector-stroke-position");
        svg.removeAttribute("data-an-vector-stroke-original-overflow");
        svg.removeAttribute("data-an-vector-stroke-original-overflow-priority");
      }
      if (path.getAttribute("stroke") === "none") {
        path.setAttribute("stroke", DEFAULT_LINE_STROKE);
        path.setAttribute(AUTO_OPEN_STROKE_MARKER, "");
      }
    }

    svg.setAttribute("data-an-pen-nodes", serializePenNodes(penPath));
    svg.setAttribute(
      "viewBox",
      `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`,
    );
    svg.style.left = `${oldLeft + geometry.x - oldViewBox.x}px`;
    svg.style.top = `${oldTop + geometry.y - oldViewBox.y}px`;
    svg.style.width = `${Math.max(1, geometry.width)}px`;
    svg.style.height = `${Math.max(1, geometry.height)}px`;
    if (strokeOverlay) svg.style.overflow = "visible";
    if (!isClosed && strokeOverlay && originalOverflow !== null) {
      const svgStyle = svg.style;
      if (originalOverflow) {
        svgStyle.setProperty(
          "overflow",
          originalOverflow,
          originalOverflowPriority,
        );
      } else {
        svgStyle.removeProperty("overflow");
      }
    }

    const updatedHtml = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    if (isClosed && strokeOverlay && strokePosition) {
      const rebuilt = applyVisualEdit(updatedHtml, {
        kind: "style",
        target: { nodeId },
        property: "--an-vector-stroke-position",
        value: strokePosition,
      });
      if (rebuilt.result.status === "applied") return rebuilt.content;
      return null;
    }
    return updatedHtml;
    // coercion-ok: null refuses the commit and the caller shows the vector-edit error.
  } catch {
    return null;
  }
}

function penPathScreenContentMapping(svg: SVGSVGElement): {
  scaleX: number;
  scaleY: number;
  offset: { x: number; y: number };
  viewBox: { x: number; y: number; width: number; height: number };
} | null {
  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  const matrix = svg.getScreenCTM();
  if (!viewBox || !matrix) return null;
  if (
    Math.abs(matrix.b) > 0.001 ||
    Math.abs(matrix.c) > 0.001 ||
    !(matrix.a > 0) ||
    !(matrix.d > 0)
  ) {
    return null;
  }
  const view = svg.ownerDocument.defaultView;
  const offset = {
    x: matrix.a * viewBox.x + matrix.e + (view?.scrollX ?? 0) - viewBox.x,
    y: matrix.d * viewBox.y + matrix.f + (view?.scrollY ?? 0) - viewBox.y,
  };
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
  return { scaleX: matrix.a, scaleY: matrix.d, offset, viewBox };
}

export function penPathScreenContentOffset(svg: SVGSVGElement): {
  x: number;
  y: number;
} | null {
  const mapping = penPathScreenContentMapping(svg);
  if (
    !mapping ||
    Math.abs(mapping.scaleX - 1) > 0.001 ||
    Math.abs(mapping.scaleY - 1) > 0.001
  ) {
    return null;
  }
  return mapping.offset;
}

export function penPathForVectorEdit(
  svg: SVGSVGElement,
  path: PenPath,
  renderOffset: { x: number; y: number },
): { path: PenPath; sourceOffset: { x: number; y: number } } | null {
  const mapping = penPathScreenContentMapping(svg);
  if (!mapping) return null;
  const { viewBox, scaleX, scaleY } = mapping;
  const boxStretchMatches = (scale: number, box: string, extent: number) => {
    const size = parsePixelValue(box);
    if (size === null) return false;
    return extent === 0 || Math.abs(scale - size / extent) <= 0.001;
  };
  if (
    !boxStretchMatches(scaleX, svg.style.width, viewBox.width) ||
    !boxStretchMatches(scaleY, svg.style.height, viewBox.height)
  ) {
    return null;
  }
  const sourceOffset = {
    x: mapping.offset.x - renderOffset.x,
    y: mapping.offset.y - renderOffset.y,
  };
  const unscaled = scalePenPathToGeometry(path, viewBox, {
    ...viewBox,
    width: viewBox.width * scaleX,
    height: viewBox.height * scaleY,
  });
  return {
    path: translatePenPath(unscaled, sourceOffset.x, sourceOffset.y),
    sourceOffset,
  };
}

export function boardRenderOffset(element: Element): { x: number; y: number } {
  let root = element;
  while (root.parentElement && root.parentElement !== root.ownerDocument.body) {
    root = root.parentElement;
  }
  const view = root.ownerDocument.defaultView;
  const translate = view?.getComputedStyle(root).translate ?? "none";
  if (translate === "none") return { x: 0, y: 0 };
  const [x = 0, y = 0] = translate.split(/\s+/).map((part) => parseFloat(part));
  return { x, y };
}

export function penPathForPrimitive(
  kind: "ellipse" | "rectangle",
  geometry: { x: number; y: number; width: number; height: number },
): PenPath {
  const { x, y, width, height } = geometry;
  if (kind === "rectangle") {
    return {
      closed: true,
      nodes: [
        createCornerNode({ x, y }),
        createCornerNode({ x: x + width, y }),
        createCornerNode({ x: x + width, y: y + height }),
        createCornerNode({ x, y: y + height }),
      ],
    };
  }

  const radiusX = width / 2;
  const radiusY = height / 2;
  const control = 0.5522847498307936;
  const centerX = x + radiusX;
  const centerY = y + radiusY;
  return {
    closed: true,
    nodes: [
      createSmoothNode(
        { x: centerX, y },
        { x: centerX + control * radiusX, y },
      ),
      createSmoothNode(
        { x: x + width, y: centerY },
        { x: x + width, y: centerY + control * radiusY },
      ),
      createSmoothNode(
        { x: centerX, y: y + height },
        { x: centerX - control * radiusX, y: y + height },
      ),
      createSmoothNode(
        { x, y: centerY },
        { x, y: centerY - control * radiusY },
      ),
    ],
  };
}

export interface PrimitiveVectorEditSource {
  geometry: { x: number; y: number; width: number; height: number };
  kind: "ellipse" | "rectangle";
  fill: string;
  path: PenPath;
}

export function primitiveVectorEditSource(
  element: HTMLElement,
): PrimitiveVectorEditSource | null {
  const primitive = element.getAttribute("data-an-primitive");
  if (
    primitive !== "ellipse" &&
    primitive !== "rectangle" &&
    primitive !== "rect"
  ) {
    return null;
  }
  if (element.children.length > 0) return null;
  const view = element.ownerDocument.defaultView;
  if (!view || !hasOnlyTranslationTransforms(element)) return null;
  const style = view.getComputedStyle(element);
  if (
    style.position !== "absolute" ||
    parsePixelValue(element.style.left) === null ||
    parsePixelValue(element.style.top) === null
  ) {
    return null;
  }
  if (style.backgroundImage && style.backgroundImage !== "none") return null;
  if (
    [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].some((width) => (Number.parseFloat(width) || 0) > 0)
  ) {
    return null;
  }
  if (
    primitive !== "ellipse" &&
    [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].some((radius) => (Number.parseFloat(radius) || 0) > 0)
  ) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const geometry = {
    x: rect.left + view.scrollX,
    y: rect.top + view.scrollY,
    width: rect.width,
    height: rect.height,
  };
  return {
    geometry,
    kind: primitive === "ellipse" ? "ellipse" : "rectangle",
    fill: style.backgroundColor || "none",
    path: penPathForPrimitive(
      primitive === "ellipse" ? "ellipse" : "rectangle",
      geometry,
    ),
  };
}

function hasOnlyTranslationTransforms(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const style = view.getComputedStyle(current);
    if (
      (style.perspective && style.perspective !== "none") ||
      (style.zoom && style.zoom !== "1" && style.zoom !== "normal")
    ) {
      return false;
    }
    const scale = (style.scale ?? "").trim().split(/\s+/);
    if (
      scale[0] &&
      scale[0] !== "none" &&
      (Number(scale[0]) !== 1 || (scale[1] && Number(scale[1]) !== 1))
    ) {
      return false;
    }
    if (style.rotate && style.rotate !== "none" && style.rotate !== "0deg") {
      return false;
    }
    if (!style.transform || style.transform === "none") continue;
    try {
      const matrix = new DOMMatrixReadOnly(style.transform);
      if (
        !matrix.is2D ||
        Math.abs(matrix.a - 1) > 0.001 ||
        Math.abs(matrix.b) > 0.001 ||
        Math.abs(matrix.c) > 0.001 ||
        Math.abs(matrix.d - 1) > 0.001
      ) {
        return false;
      }
      // coercion-ok: false rejects vector editing when the transform cannot be verified.
    } catch {
      return false;
    }
  }
  return true;
}

export function writeBackPrimitiveAsVector(
  content: string,
  nodeId: string,
  penPath: PenPath,
  originalGeometry: { x: number; y: number; width: number; height: number },
  fill: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
    const source = doc.querySelector(
      `[data-agent-native-node-id="${safeNodeId}"]`,
    );
    const kind = source?.getAttribute("data-an-primitive");
    if (
      !source ||
      source.children.length > 0 ||
      !["ellipse", "rect", "rectangle"].includes(kind ?? "")
    ) {
      return null;
    }

    const sourceStyle = (source as HTMLElement).style;
    const left = parsePixelValue(sourceStyle.left);
    const top = parsePixelValue(sourceStyle.top);
    if (left === null || top === null) return null;
    const geometry = getPenPathGeometry(penPath);
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const attribute of Array.from(source.attributes)) {
      svg.setAttribute(attribute.name, attribute.value);
    }
    svg.setAttribute("data-an-primitive", "path");
    svg.setAttribute("data-an-pen-nodes", serializePenNodes(penPath));
    svg.setAttribute(
      "viewBox",
      `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`,
    );
    svg.setAttribute("preserveAspectRatio", "none");

    const style = svg.style;
    for (const property of [
      "background",
      "background-color",
      "background-image",
      "border",
      "border-radius",
    ]) {
      style.removeProperty(property);
    }
    style.background = "none";
    style.border = "none";
    style.borderRadius = "0";
    style.left = `${left + geometry.x - originalGeometry.x}px`;
    style.top = `${top + geometry.y - originalGeometry.y}px`;
    style.width = `${Math.max(1, geometry.width)}px`;
    style.height = `${Math.max(1, geometry.height)}px`;
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", serializeRoundedPenPath(penPath, 0));
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", "none");
    svg.appendChild(path);
    source.replaceWith(svg);
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    // coercion-ok: null refuses the commit and the caller shows the vector-edit error.
  } catch {
    return null;
  }
}

function parseViewBox(value: string | null): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const parts = value
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !parts ||
    parts.length !== 4 ||
    parts.some((part) => !Number.isFinite(part)) ||
    parts[2]! <= 0 ||
    parts[3]! <= 0
  ) {
    return null;
  }
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

function parsePixelValue(value: string): number | null {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))px$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cloneHtmlLayerAtPosition(
  content: string,
  layerHtml: string,
  position: { x: number; y: number },
): string | null {
  return (
    insertClonedHtmlLayers(content, [layerHtml], {
      positions: [{ ...position, space: "visual" }],
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

export function preserveClipboardLayerName(
  layerHtml: string,
  layerName: string | null | undefined,
): string {
  const normalizedName = layerName?.trim();
  if (typeof window === "undefined" || !normalizedName) return layerHtml;
  try {
    const doc = new DOMParser().parseFromString(
      `<template>${layerHtml}</template>`,
      "text/html",
    );
    const root = doc.querySelector("template")?.content.firstElementChild;
    if (!root) return layerHtml;
    if (!root.hasAttribute("data-agent-native-layer-name")) {
      root.setAttribute("data-agent-native-layer-name", normalizedName);
    }
    return root.outerHTML;
  } catch {
    return layerHtml;
  }
}

type ClonePositionSpace = "layout" | "visual";
type CloneLayerPosition = {
  x: number;
  y: number;
  space?: ClonePositionSpace;
};

function cssLength(value: string, reference: number): number {
  if (value.endsWith("%")) return (Number.parseFloat(value) / 100) * reference;
  const parsed = Number.parseFloat(value);
  if (
    !Number.isFinite(parsed) ||
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value)
  ) {
    throw new Error(`Cannot resolve transform geometry length: ${value}`);
  }
  return parsed;
}

function transformOriginCoordinate(
  value: string | undefined,
  size: number,
  axis: "x" | "y",
): number {
  const origin = value || "50%";
  if (origin === "center") return size / 2;
  if (origin === (axis === "x" ? "left" : "top")) return 0;
  if (origin === (axis === "x" ? "right" : "bottom")) return size;
  return cssLength(origin, size);
}

function inlineLength(value: string, reference: number): number | null {
  if (!value || value === "auto") return null;
  return cssLength(value, reference);
}

function transformedBoundsOffset(
  element: HTMLElement | SVGElement,
): { x: number; y: number } | null {
  const transform = element.style.transform;
  if (!transform || transform === "none") return { x: 0, y: 0 };
  if (typeof DOMMatrixReadOnly === "undefined") {
    throw new Error("DOMMatrixReadOnly is required for transformed placement");
  }
  const matrix = new DOMMatrixReadOnly(transform);
  if (!matrix.is2D) {
    throw new Error(`Cannot resolve 3D transform placement: ${transform}`);
  }
  const width = inlineLength(element.style.width, 0);
  const height = inlineLength(element.style.height, 0);
  if (width === null || height === null) return null;
  let [originX, originY] = element.style.transformOrigin
    .split(/\s+/)
    .slice(0, 2);
  if (
    (originX === "top" || originX === "bottom") &&
    (originY === "left" || originY === "right")
  ) {
    [originX, originY] = [originY, originX];
  }
  const ox = transformOriginCoordinate(originX, width, "x");
  const oy = transformOriginCoordinate(originY, height, "y");
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => ({
    x: ox + matrix.a * (x! - ox) + matrix.c * (y! - oy) + matrix.e,
    y: oy + matrix.b * (x! - ox) + matrix.d * (y! - oy) + matrix.f,
  }));
  return {
    x: Math.min(...corners.map((point) => point.x)),
    y: Math.min(...corners.map((point) => point.y)),
  };
}

function setRootLayerPosition(element: Element, position: CloneLayerPosition) {
  const host = styleHost(element);
  if (!host) return;
  const offset = (position.space === "visual"
    ? transformedBoundsOffset(host)
    : null) ?? {
    x: 0,
    y: 0,
  };
  host.style.position = "absolute";
  host.style.left = `${Math.round(position.x - offset.x)}px`;
  host.style.top = `${Math.round(position.y - offset.y)}px`;
  host.style.right = "";
  host.style.bottom = "";
}

function claimClonedNodeId(
  previousId: string | null,
  fallbackPrefix: string,
  reservedNodeIds: Set<string> | null,
): string {
  if (!reservedNodeIds || !previousId || reservedNodeIds.has(previousId)) {
    return uniqueLayerId(fallbackPrefix);
  }
  reservedNodeIds.add(previousId);
  return previousId;
}

const DURABLE_NODE_ID_ATTR = "data-agent-native-node-id";

interface ComponentCloneContext {
  sourceFileId: string;
  sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
  targetSource: CodeLayerSource;
  documents: readonly ComponentSourceDocument[];
}

export interface ComponentCloneBatchContext {
  sourceFileIds: readonly (string | undefined)[];
  sourceNodeIdMaps?: readonly (
    | readonly (readonly [string, string])[]
    | null
    | undefined
  )[];
  targetSource: CodeLayerSource;
  documents: readonly ComponentSourceDocument[];
}

function componentContextForLayer(
  content: string,
  batch: ComponentCloneBatchContext | undefined,
  index: number,
): ComponentCloneContext | undefined {
  const sourceFileId = batch?.sourceFileIds[index];
  const targetFileId = batch?.targetSource.fileId;
  if (!batch || !sourceFileId || !targetFileId) return undefined;
  const targetMatches = batch.documents.filter(
    (document) => document.source.fileId === targetFileId,
  );
  if (targetMatches.length > 1) return undefined;
  const documents = batch.documents.map((document) =>
    document.source.fileId === targetFileId
      ? { ...document, content }
      : document,
  );
  if (targetMatches.length === 0) {
    documents.push({ source: batch.targetSource, content });
  }
  return {
    sourceFileId,
    sourceNodeIdMap: batch.sourceNodeIdMaps?.[index],
    targetSource: batch.targetSource,
    documents,
  };
}

function sourceNodeIdForCloneId(
  sourceNodeIdMap: readonly (readonly [string, string])[] | null | undefined,
  cloneNodeId: string | null | undefined,
): string | undefined {
  if (sourceNodeIdMap === null) return undefined;
  if (!sourceNodeIdMap) return cloneNodeId?.trim() || undefined;
  if (!cloneNodeId) return undefined;
  const matches = sourceNodeIdMap.filter(
    ([, mappedCloneId]) => mappedCloneId === cloneNodeId,
  );
  return matches.length === 1 ? matches[0]?.[0] : undefined;
}

function componentNodeIdMapForPreparedClone(
  nodeIdMap: ReadonlyMap<string, string>,
  context: ComponentCloneContext | undefined,
): ReadonlyMap<string, string> | null {
  if (context?.sourceNodeIdMap === null) return null;
  if (!context?.sourceNodeIdMap) return nodeIdMap;
  const sourceToClone = new Map<string, string>();
  const cloneIds = new Set<string>();
  for (const [sourceId, incomingCloneId] of context.sourceNodeIdMap) {
    const preparedCloneId = nodeIdMap.get(incomingCloneId);
    if (
      !sourceId.trim() ||
      !incomingCloneId.trim() ||
      !preparedCloneId ||
      sourceToClone.has(sourceId) ||
      cloneIds.has(incomingCloneId)
    ) {
      return null;
    }
    sourceToClone.set(sourceId, preparedCloneId);
    cloneIds.add(incomingCloneId);
  }
  return sourceToClone;
}

function linkedCloneElement(
  sourceRoot: Element,
  clone: Element,
  nodeIdMap: ReadonlyMap<string, string>,
  context: ComponentCloneContext | undefined,
  sourceNodeIdOverride?: string,
): Element | null {
  const componentId = sourceRoot.getAttribute(COMPONENT_ID_ATTR);
  const componentRef = sourceRoot.getAttribute(COMPONENT_REF_ATTR);
  if (componentId === null && componentRef === null) return clone;
  if (
    context === undefined ||
    (componentId !== null && componentRef !== null) ||
    context.targetSource.kind !== "design-file" ||
    context.targetSource.designId !==
      context.documents.find(
        (document) => document.source.fileId === context.sourceFileId,
      )?.source.designId ||
    !context.targetSource.designId ||
    !context.targetSource.fileId
  ) {
    return null;
  }
  const sourceDocumentMatches = context.documents.filter(
    (document) => document.source.fileId === context.sourceFileId,
  );
  if (sourceDocumentMatches.length !== 1) return null;
  const sourceDocument = sourceDocumentMatches[0]!;
  if (
    sourceDocument.source.kind !== "design-file" ||
    sourceDocument.source.designId !== context.targetSource.designId
  ) {
    return null;
  }
  const projections = context.documents.map((document) =>
    buildCodeLayerProjection(document.content, { source: document.source }),
  );
  if (
    projections.some(
      (projection, index) =>
        context.documents.filter(
          (document) =>
            document.source.fileId === context.documents[index]?.source.fileId,
        ).length !== 1 ||
        projection.source.designId !== context.targetSource.designId,
    )
  ) {
    return null;
  }
  const sourceProjectionIndex = context.documents.findIndex(
    (document) => document.source.fileId === context.sourceFileId,
  );
  const sourceProjection = projections[sourceProjectionIndex];
  if (!sourceProjection) return null;
  const sourceNodeId =
    sourceNodeIdOverride ??
    sourceRoot.getAttribute(DURABLE_NODE_ID_ATTR)?.trim();
  if (!sourceNodeId) return null;
  const sourceNodeMatches = sourceProjection.nodes.filter(
    (node) =>
      node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim() === sourceNodeId,
  );
  if (sourceNodeMatches.length !== 1) return null;
  const sourceNode = sourceNodeMatches[0]!;
  const identity = componentId ?? componentRef;
  if (!identity || !identity.trim()) return null;
  const analysis = analyzeComponentLinks(projections);
  if (
    analysis.invalidNodes.some(
      ({ node }) =>
        node.id === sourceNode.id && node.source === sourceNode.source,
    )
  ) {
    return null;
  }
  const resolution = analysis.components.find(
    (entry) => entry.componentId === identity,
  );
  if (!resolution || resolution.status !== "resolved") return null;

  if (componentId !== null) {
    if (
      resolution.main.id !== sourceNode.id ||
      resolution.source.fileId !== context.sourceFileId
    ) {
      return null;
    }
    const materialized = materializeComponentLink({
      mainProjection: sourceProjection,
      projections,
      mainNode: sourceNode,
      targetSource: context.targetSource,
      cloneHtml: clone.outerHTML,
      nodeIdMap,
    });
    if (materialized.status !== "materialized") return null;
    const resultDoc = new DOMParser().parseFromString(
      `<template>${materialized.content}</template>`,
      "text/html",
    );
    const resultRoot =
      resultDoc.querySelector("template")?.content.firstElementChild;
    return resultRoot ? clone.ownerDocument.importNode(resultRoot, true) : null;
  }

  if (
    !isValidComponentReferenceSubtree({
      documents: context.documents,
      componentId: identity,
      referenceFileId: context.sourceFileId,
      referenceNodeId: sourceNodeId,
    })
  ) {
    return null;
  }
  const sourceSubtree = componentSubtreeForProjection(
    sourceNode,
    sourceProjection,
  );
  if (!sourceSubtree) return null;
  for (const node of sourceSubtree) {
    const sourceId = node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim();
    if (!sourceId || !nodeIdMap.get(sourceId)) return null;
  }
  return clone;
}

function linkedCloneSubtree(
  sourceRoot: Element,
  clone: Element,
  nodeIdMap: ReadonlyMap<string, string>,
  context: ComponentCloneContext | undefined,
): Element | null {
  const hasIdentity = (element: Element) =>
    element.hasAttribute(COMPONENT_ID_ATTR) ||
    element.hasAttribute(COMPONENT_REF_ATTR);
  const sourceElements = [sourceRoot, ...sourceRoot.querySelectorAll("*")];
  const identityElements = sourceElements.filter(hasIdentity);
  if (!identityElements.length) return clone;
  const componentNodeIdMap = componentNodeIdMapForPreparedClone(
    nodeIdMap,
    context,
  );
  if (!componentNodeIdMap) return null;
  if (hasIdentity(sourceRoot)) {
    const sourceNodeId = sourceNodeIdForCloneId(
      context?.sourceNodeIdMap,
      sourceRoot.getAttribute(DURABLE_NODE_ID_ATTR),
    );
    if (!sourceNodeId) return null;
    return linkedCloneElement(
      sourceRoot,
      clone,
      componentNodeIdMap,
      context,
      sourceNodeId,
    );
  }
  if (!context || !context.targetSource.designId || !context.sourceFileId) {
    return null;
  }
  const sourceDocuments = context.documents.filter(
    ({ source }) => source.fileId === context.sourceFileId,
  );
  if (
    sourceDocuments.length !== 1 ||
    sourceDocuments[0]?.source.kind !== "design-file" ||
    sourceDocuments[0].source.designId !== context.targetSource.designId ||
    context.targetSource.kind !== "design-file"
  ) {
    return null;
  }
  const sourceProjection = buildCodeLayerProjection(
    sourceDocuments[0].content,
    { source: sourceDocuments[0].source },
  );
  const sourceRootId = sourceNodeIdForCloneId(
    context.sourceNodeIdMap,
    sourceRoot.getAttribute(DURABLE_NODE_ID_ATTR),
  );
  if (!sourceRootId) return null;
  const sourceRoots = sourceProjection.nodes.filter(
    (node) =>
      node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim() === sourceRootId,
  );
  if (sourceRoots.length !== 1 || !sourceRoots[0]) return null;
  const sourceSubtree = componentSubtreeForProjection(
    sourceRoots[0],
    sourceProjection,
  );
  if (!sourceSubtree) return null;
  const subtreeIds = new Set(sourceSubtree.map((node) => node.id));
  const identityNodes = sourceSubtree.filter(
    (node) =>
      Object.prototype.hasOwnProperty.call(
        node.dataAttributes,
        COMPONENT_ID_ATTR,
      ) ||
      Object.prototype.hasOwnProperty.call(
        node.dataAttributes,
        COMPONENT_REF_ATTR,
      ),
  );
  const identityNodeIds = new Set(identityNodes.map((node) => node.id));
  const nodesById = new Map(
    sourceProjection.nodes.map((node) => [node.id, node]),
  );
  const topLevelIdentityNodes = identityNodes.filter((node) => {
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && subtreeIds.has(parentId) && !seen.has(parentId)) {
      if (parentId !== node.id && identityNodeIds.has(parentId)) return false;
      seen.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? undefined;
    }
    return true;
  });

  let result = clone;
  for (const sourceNode of topLevelIdentityNodes) {
    const sourceNodeId =
      sourceNode.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim();
    const cloneInputId = context.sourceNodeIdMap
      ? context.sourceNodeIdMap.find(
          ([mappedSourceId]) => mappedSourceId === sourceNodeId,
        )?.[1]
      : sourceNodeId;
    const cloneNodeId = cloneInputId ? nodeIdMap.get(cloneInputId) : undefined;
    if (!sourceNodeId || !cloneNodeId) return null;
    const sourceMatches = sourceElements.filter(
      (element) =>
        element.getAttribute(DURABLE_NODE_ID_ATTR)?.trim() === cloneInputId,
    );
    const cloneElements = [result, ...result.querySelectorAll("*")].filter(
      (element) =>
        element.getAttribute(DURABLE_NODE_ID_ATTR)?.trim() === cloneNodeId,
    );
    if (sourceMatches.length !== 1 || cloneElements.length !== 1) return null;
    const sourceElement = sourceMatches[0];
    const cloneElement = cloneElements[0];
    if (!sourceElement || !cloneElement) return null;
    const linked = linkedCloneElement(
      sourceElement,
      cloneElement,
      componentNodeIdMap,
      context,
      sourceNodeId,
    );
    if (!linked) return null;
    if (linked === cloneElement) continue;
    if (cloneElement === result) {
      result = linked;
    } else {
      cloneElement.replaceWith(linked);
    }
  }
  return result;
}

export function portableStyleSnapshotForPasteTarget(
  entry: {
    sourceFileId?: string;
    styleSnapshotCaptureFailed?: boolean;
    portableStyleSnapshot?: PortableStyleSnapshot;
  },
  targetFileId: string | null | undefined,
): PortableStyleSnapshot | null | undefined {
  if (!entry.styleSnapshotCaptureFailed) return entry.portableStyleSnapshot;
  return entry.sourceFileId &&
    targetFileId &&
    entry.sourceFileId === targetFileId
    ? undefined
    : null;
}

export function prepareClonedHtmlLayer(
  doc: Document,
  layerHtml: string,
  styleSnapshot?: PortableStyleSnapshot | null,
  reservedNodeIds: Set<string> | null = null,
  componentContext?: ComponentCloneContext,
  preserveIncomingNodeIds = false,
): {
  element: Element;
  rootNodeId: string;
  nodeIdMap: Map<string, string>;
} | null {
  if (styleSnapshot === null) return null;
  const layerDoc = new DOMParser().parseFromString(
    `<template>${layerHtml}</template>`,
    "text/html",
  );
  const source =
    layerDoc.querySelector("template")?.content.firstElementChild ??
    layerDoc.body.firstElementChild;
  if (!source) return null;
  let clone = doc.importNode(source, true) as Element;
  const sourceLayerName =
    resolveLayerNameAttribute((attribute) => source.getAttribute(attribute))
      ?.value ?? "";
  const sourceNodeId = source.getAttribute("data-agent-native-node-id") || "";
  const sourceIsLegacyGroup =
    /^an-[a-z0-9]+$/i.test(sourceNodeId) &&
    /^group(?: \d+)?$/i.test(sourceLayerName.trim()) &&
    source.getAttribute("data-agent-native-preserve-styles") === "true" &&
    source.getAttribute("data-agent-native-clone-root") !== "true";
  if (
    sourceIsLegacyGroup &&
    source.getAttribute("data-agent-native-group-wrapper") !== "true"
  ) {
    clone.setAttribute("data-agent-native-group-wrapper", "true");
  }
  if (styleSnapshot) {
    clone.setAttribute("data-agent-native-preserve-styles", "true");
    clone.setAttribute("data-agent-native-clone-root", "true");
    styleSnapshot.nodes.forEach((node) => {
      const target = elementAtPortableStylePath(clone, node);
      if (target) applyPortableStyles(target, node.styles);
    });
  }
  if (
    !resolveLayerNameAttribute((attribute) => clone.getAttribute(attribute))
  ) {
    const sourceNode = buildCodeLayerProjection(layerHtml).nodes[0];
    if (sourceNode && sourceNode.layerNameSource !== "tag") {
      clone.setAttribute("data-agent-native-layer-name", sourceNode.layerName);
    }
  }
  const nodeIdMap = new Map<string, string>();
  const previousRootNodeId = clone.getAttribute("data-agent-native-node-id");
  const rootNodeId = preserveIncomingNodeIds
    ? previousRootNodeId || uniqueLayerId("move")
    : claimClonedNodeId(previousRootNodeId, "copy", reservedNodeIds);
  clone.setAttribute("data-agent-native-node-id", rootNodeId);
  if (previousRootNodeId) {
    nodeIdMap.set(previousRootNodeId, rootNodeId);
  }
  if (!preserveIncomingNodeIds) {
    Array.from(clone.querySelectorAll("[data-agent-native-node-id]")).forEach(
      (node) => {
        const previousChildId = node.getAttribute("data-agent-native-node-id");
        const nextChildId = claimClonedNodeId(
          previousChildId,
          "copy-child",
          reservedNodeIds,
        );
        node.setAttribute("data-agent-native-node-id", nextChildId);
        if (previousChildId) nodeIdMap.set(previousChildId, nextChildId);
      },
    );
  } else {
    Array.from(clone.querySelectorAll("[data-agent-native-node-id]")).forEach(
      (node) => {
        const nodeId = node.getAttribute("data-agent-native-node-id");
        if (nodeId) nodeIdMap.set(nodeId, nodeId);
      },
    );
  }
  if (!preserveIncomingNodeIds) {
    reassignClonedAuthoredIds(clone, () => uniqueLayerId("copy-id"));
    reassignClonedSourceIdentity(clone, () => uniqueLayerId("copy-child"));
  }
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    const runtimeInstanceId = element.getAttribute(
      "data-agent-native-runtime-instance-id",
    );
    if (!runtimeInstanceId) continue;
    const nextInstanceId =
      nodeIdMap.get(runtimeInstanceId) ??
      element.getAttribute("data-agent-native-node-id");
    if (nextInstanceId) {
      element.setAttribute(
        "data-agent-native-runtime-instance-id",
        nextInstanceId,
      );
    }
  }
  const linkedClone = linkedCloneSubtree(
    source,
    clone,
    nodeIdMap,
    componentContext,
  );
  if (!linkedClone) return null;
  clone = linkedClone;
  return { element: clone, rootNodeId, nodeIdMap };
}

const ACTIVE_CLONED_LAYER_ELEMENTS =
  "script,style,template,noscript,link,meta,title,iframe,object,embed,base,foreignObject,video,audio,source,track,animate,set";

function sanitizeClonedHtmlLayer(element: Element): boolean {
  if (
    /^(?:body|head|html)$/i.test(element.tagName) ||
    element.matches(ACTIVE_CLONED_LAYER_ELEMENTS)
  ) {
    return false;
  }
  element
    .querySelectorAll(ACTIVE_CLONED_LAYER_ELEMENTS)
    .forEach((node) => node.remove());
  [element, ...Array.from(element.querySelectorAll("*"))].forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "autofocus" ||
        name === "action" ||
        name === "formaction" ||
        /(?:javascript|vbscript)\s*:/i.test(value) ||
        /data\s*:\s*text\/html/i.test(value)
      ) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return true;
}

export function prepareClonedHtmlLayersForLiveInsert(
  destinationContent: string,
  layerHtmls: string[],
  options: {
    stripRootPosition?: boolean;
    positions?: Array<CloneLayerPosition | null | undefined>;
    styleSnapshots?: Array<PortableStyleSnapshot | null | undefined>;
    preserveIncomingNodeIds?: boolean;
  } = {},
): {
  destinationContent: string;
  htmlFragments: string[];
  rootNodeIds: string[];
  nodeIdMap: Map<string, string>;
} | null {
  if (
    typeof window === "undefined" ||
    layerHtmls.length === 0 ||
    options.styleSnapshots?.some((snapshot) => snapshot === null) ||
    !isStandaloneHttpUrl(destinationContent)
  ) {
    return null;
  }
  try {
    const doc = document.implementation.createHTMLDocument("");
    const htmlFragments: string[] = [];
    const rootNodeIds: string[] = [];
    const nodeIdMap = new Map<string, string>();
    layerHtmls.forEach((layerHtml, index) => {
      const prepared = prepareClonedHtmlLayer(
        doc,
        layerHtml,
        options.styleSnapshots?.[index],
        null,
        undefined,
        options.preserveIncomingNodeIds,
      );
      if (!prepared) return;
      const position = options.positions?.[index];
      if (position) {
        setRootLayerPosition(prepared.element, position);
      } else if (options.stripRootPosition) {
        clearRootLayerPosition(prepared.element);
      }
      if (!sanitizeClonedHtmlLayer(prepared.element)) return;
      rootNodeIds.push(prepared.rootNodeId);
      prepared.nodeIdMap.forEach((value, key) => nodeIdMap.set(key, value));
      htmlFragments.push(prepared.element.outerHTML);
    });
    if (htmlFragments.length !== layerHtmls.length) return null;
    return {
      destinationContent,
      htmlFragments,
      rootNodeIds,
      nodeIdMap,
    };
  } catch {
    return null;
  }
}

export function insertClonedHtmlLayers(
  content: string,
  layerHtmls: string[],
  options: {
    onUnsupportedStructure?: () => void;
    targetSelectors?: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
    stripRootPosition?: boolean;
    positions?: Array<CloneLayerPosition | null | undefined>;
    styleSnapshots?: Array<PortableStyleSnapshot | null | undefined>;
    managedStyleSnapshots?: Array<
      DesignClipboardManagedStyleSnapshot | null | undefined
    >;
    preserveIncomingNodeIds?: boolean;
    additionalReservedNodeIds?: Iterable<string>;
    componentLinks?: ComponentCloneBatchContext;
    allowMainComponentStructure?: boolean;
  } = {},
): {
  content: string;
  rootNodeIds: string[];
  nodeIdMap: Map<string, string>;
} | null {
  if (
    typeof window === "undefined" ||
    layerHtmls.length === 0 ||
    options.styleSnapshots?.some((snapshot) => snapshot === null)
  ) {
    return null;
  }
  if (isStandaloneHttpUrl(content)) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const fragment = doc.createDocumentFragment();
    const rootNodeIds: string[] = [];
    const nodeIdMap = new Map<string, string>();
    const reservedNodeIds = options.preserveIncomingNodeIds
      ? new Set([
          ...Array.from(doc.querySelectorAll("[data-agent-native-node-id]"))
            .map((node) => node.getAttribute("data-agent-native-node-id"))
            .filter((value): value is string => Boolean(value)),
          ...(options.additionalReservedNodeIds ?? []),
        ])
      : null;
    layerHtmls.forEach((layerHtml, index) => {
      const prepared = prepareClonedHtmlLayer(
        doc,
        layerHtml,
        options.styleSnapshots?.[index],
        reservedNodeIds,
        componentContextForLayer(content, options.componentLinks, index),
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
    if (rootNodeIds.length !== layerHtmls.length) return null;

    const target = queryFirstSelector(doc, options.targetSelectors ?? []);
    const anchor =
      queryFirstSelector(doc, options.anchorSelectors ?? []) ?? target;
    const placement = options.placement ?? "after";
    const parent = anchor
      ? placement === "inside"
        ? anchor
        : anchor.parentElement
      : null;
    if (parent) {
      const projection = buildCodeLayerProjection(content);
      const parentId = parent.getAttribute("data-agent-native-node-id");
      const parentNode = projection.nodes.find((node) =>
        parentId
          ? node.dataAttributes["data-agent-native-node-id"] === parentId
          : node.selectors.some(
              (selector) => queryFirstSelector(doc, [selector]) === parent,
            ),
      );
      const linkedRoot = parentNode
        ? linkedComponentRootForNode(parentNode, projection)
        : null;
      const isCanonicalMain = Boolean(
        linkedRoot?.dataAttributes[COMPONENT_ID_ATTR]?.trim() &&
        !linkedRoot?.dataAttributes[COMPONENT_REF_ATTR],
      );
      if (
        linkedRoot &&
        !(options.allowMainComponentStructure && isCanonicalMain)
      ) {
        options.onUnsupportedStructure?.();
        return null;
      }
    }
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

export interface LinkedComponentStructureClonePlan {
  mainBefore: string;
  mainAfter: string;
  targetNodeId: string;
  selectionNodeIds: string[];
  rootNodeIds: string[];
  nodeIdMap: Map<string, string>;
}

function linkedMainInsertionTarget(
  content: string,
  options: {
    targetSelectors?: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
    componentLinks?: ComponentCloneBatchContext;
  },
): { nodeId: string; span: { start: number; end: number } } | null {
  const doc = new DOMParser().parseFromString(content, "text/html");
  const target = queryFirstSelector(doc, options.targetSelectors ?? []);
  const anchor =
    queryFirstSelector(doc, options.anchorSelectors ?? []) ?? target;
  const placement = options.placement ?? "after";
  const parent = anchor
    ? placement === "inside"
      ? anchor
      : anchor.parentElement
    : null;
  if (!parent) return null;
  const projection = buildCodeLayerProjection(content, {
    source: options.componentLinks?.targetSource,
  });
  const parentId = parent.getAttribute(DURABLE_NODE_ID_ATTR);
  const parentNode = projection.nodes.find((node) =>
    parentId
      ? node.dataAttributes[DURABLE_NODE_ID_ATTR] === parentId
      : node.selectors.some(
          (selector) => queryFirstSelector(doc, [selector]) === parent,
        ),
  );
  const linkedRoot = parentNode
    ? linkedComponentRootForNode(parentNode, projection)
    : null;
  if (
    !linkedRoot?.dataAttributes[COMPONENT_ID_ATTR]?.trim() ||
    linkedRoot.dataAttributes[COMPONENT_REF_ATTR] ||
    !linkedRoot.source
  ) {
    return null;
  }
  const nodeId = linkedRoot.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim();
  if (!nodeId) return null;
  return { nodeId, span: linkedRoot.source };
}

export function planLinkedComponentStructureClone(
  content: string,
  layerHtmls: string[],
  options: Parameters<typeof insertClonedHtmlLayers>[2] = {},
): LinkedComponentStructureClonePlan | null {
  if (layerHtmls.length === 0) return null;
  const target = linkedMainInsertionTarget(content, options);
  if (!target) return null;
  const result = insertClonedHtmlLayers(content, layerHtmls, {
    ...options,
    allowMainComponentStructure: true,
  });
  if (!result) return null;

  const afterProjection = buildCodeLayerProjection(result.content, {
    source: options.componentLinks?.targetSource,
  });
  const afterRoots = afterProjection.nodes.filter(
    (node) =>
      node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim() === target.nodeId,
  );
  const afterRoot = afterRoots.length === 1 ? afterRoots[0] : undefined;
  if (!afterRoot?.source) return null;
  const selectionNodeIds = [...result.rootNodeIds];
  if (
    selectionNodeIds.length === 0 ||
    new Set(selectionNodeIds).size !== selectionNodeIds.length ||
    selectionNodeIds.some(
      (nodeId) =>
        !nodeId.trim() ||
        afterProjection.nodes.filter(
          (node) =>
            node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim() === nodeId,
        ).length !== 1,
    )
  ) {
    return null;
  }
  const mainAfter =
    content.slice(0, target.span.start) +
    result.content.slice(afterRoot.source.start, afterRoot.source.end) +
    content.slice(target.span.end);
  if (
    mainAfter.slice(0, target.span.start) !==
      content.slice(0, target.span.start) ||
    mainAfter.slice(mainAfter.length - (content.length - target.span.end)) !==
      content.slice(target.span.end)
  ) {
    return null;
  }
  const finalProjection = buildCodeLayerProjection(mainAfter, {
    source: options.componentLinks?.targetSource,
  });
  const finalRootMatches = finalProjection.nodes.filter(
    (node) =>
      node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim() === target.nodeId,
  );
  const finalRoot = finalRootMatches.length === 1 ? finalRootMatches[0] : null;
  if (!finalRoot) return null;
  const nodesById = new Map(
    finalProjection.nodes.map((node) => [node.id, node]),
  );
  const isInsideFinalRoot = (node: CodeLayerNode) => {
    const visited = new Set<string>();
    let current: CodeLayerNode | undefined = node;
    while (current && !visited.has(current.id)) {
      if (current.id === finalRoot.id) return true;
      visited.add(current.id);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return false;
  };
  const selectedNodes = selectionNodeIds.map((nodeId) => {
    const matches = finalProjection.nodes.filter(
      (node) => node.dataAttributes[DURABLE_NODE_ID_ATTR]?.trim() === nodeId,
    );
    return matches.length === 1 ? matches[0] : undefined;
  });
  if (
    applyDesignClipboardManagedStyles(
      mainAfter,
      options.managedStyleSnapshots ?? [],
      result.nodeIdMap,
      { ensureGroupRuntime: false },
    ) !== mainAfter
  ) {
    return null;
  }
  if (selectedNodes.some((node) => !node || !isInsideFinalRoot(node))) {
    return null;
  }
  return {
    mainBefore: content,
    mainAfter,
    targetNodeId: target.nodeId,
    selectionNodeIds,
    rootNodeIds: result.rootNodeIds,
    nodeIdMap: result.nodeIdMap,
  };
}

export function queryFirstSelector(
  root: ParentNode,
  selectors: Array<string | undefined>,
): Element | null {
  for (const selector of selectors) {
    if (!selector) continue;
    const match = queryUniqueSelector(root, selector);
    if (match) return match;
  }
  return null;
}

export function insertClonedHtmlLayer(
  content: string,
  cloneHtml: string,
  options: {
    onUnsupportedStructure?: () => void;
    targetSelectors: string[];
    anchorSelectors?: string[];
    placement?: "before" | "after" | "inside";
    preserveIncomingNodeIds?: boolean;
    componentLinks?: ComponentCloneBatchContext;
  },
): string | null {
  return (
    insertClonedHtmlLayers(content, [cloneHtml], {
      onUnsupportedStructure: options.onUnsupportedStructure,
      targetSelectors: options.targetSelectors,
      anchorSelectors: options.anchorSelectors,
      placement: options.placement,
      preserveIncomingNodeIds: options.preserveIncomingNodeIds,
      componentLinks: options.componentLinks,
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
