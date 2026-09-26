import { isBoardFile } from "@shared/board-file";
import { normalizedDesignFileType } from "@shared/design-files";
import { isClosedPathData } from "@shared/pen-path";
import {
  vectorEndpointAttributesMarkup,
  vectorEndpointDefsMarkup,
  vectorEndpointPairForPrimitive,
  vectorEndpointMarkerId,
  VECTOR_END_ENDPOINT_PROPERTY,
  VECTOR_START_ENDPOINT_PROPERTY,
} from "@shared/vector-endpoints";

import {
  canvasPrimitiveVisual,
  canvasVectorPaint,
} from "@/components/design/canvas-primitive-style";
import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";

import {
  CANVAS_TEXT_DEFAULT_FONT_FAMILY,
  defaultCanvasFrameFill,
  defaultCanvasTextColor,
} from "./canvas-primitives";
import {
  BOARD_TEXT_AUTO_COLOR_MARKER,
  destinationBackgroundLightness,
  resolveDestinationBackgroundLightnessOrNull,
} from "./cross-screen-text-color";
import { escapeHtmlAttributeValue, escapeHtmlText } from "./dom-utils";
import { isStandaloneHttpUrl } from "./editor-state";
import { hidePenPathFill } from "./pen-path-paint";
import type { DesignFile } from "./types";

export { normalizedDesignFileType };

export function nextDuplicatedFilename(
  files: DesignFile[],
  filename: string,
): string {
  const existing = new Set(files.map((file) => file.filename));
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";
  let candidate = `${base}-copy${extension}`;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-copy-${index}${extension}`;
    index += 1;
  }
  return candidate;
}

export function nextBlankScreenFilename(files: DesignFile[]): string {
  const existing = new Set(files.map((file) => file.filename));
  const screenCount = files.filter(
    (file) =>
      normalizedDesignFileType(file.fileType) === "html" &&
      !isBoardFile(file.filename),
  ).length;
  let index = screenCount + 1;
  let candidate = `screen-${index}.html`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `screen-${index}.html`;
  }
  return candidate;
}

export function blankScreenHtml(title: string): string {
  const safeTitle = escapeHtmlText(title);
  const safeTitleAttribute = escapeHtmlAttributeValue(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style data-agent-native-screen-default-height>body { min-height: 100vh; }</style>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      /* A screen is a page: content past its edge is out of frame, not
         spilling onto the board. Frames stay unclipped by default so drawing
         over their edge keeps working. */
      overflow: hidden;
      background: var(--color-bg, #ffffff);
      color: var(--color-text, #111827);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  </style>
</head>
<body data-agent-native-layer-name="${safeTitleAttribute}">
</body>
</html>`;
}

export function uniqueLayerId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function reassignDuplicatedNodeIds(content: string): string {
  const nodeIdMap = new Map<string, string>();
  const withNewNodeIds = content.replace(
    /data-agent-native-node-id=(['"])([^'"]*)\1/g,
    (_match, quote: string, oldNodeId: string) => {
      const nextNodeId = uniqueLayerId("copy");
      nodeIdMap.set(oldNodeId, nextNodeId);
      return `data-agent-native-node-id=${quote}${nextNodeId}${quote}`;
    },
  );
  if (nodeIdMap.size === 0) return withNewNodeIds;

  const legacyVectorEndpointMarkerId = (
    nodeId: string,
    side: "start" | "end",
  ): string => {
    const safeNodeId = nodeId.replace(/[^A-Za-z0-9_-]/g, "-") || "vector";
    return `${safeNodeId}-vector-marker-${side}`;
  };

  const rewriteReference = (id: string): string => {
    for (const [oldNodeId, nextNodeId] of nodeIdMap) {
      if (id === `${oldNodeId}-arrow`) return `${nextNodeId}-arrow`;
      for (const side of ["start", "end"] as const) {
        if (
          id === vectorEndpointMarkerId(oldNodeId, side) ||
          id === legacyVectorEndpointMarkerId(oldNodeId, side)
        ) {
          return vectorEndpointMarkerId(nextNodeId, side);
        }
      }
    }
    return id;
  };
  return withNewNodeIds
    .replace(
      /\bid=(['"])([^'"]*)\1/g,
      (_match, quote: string, id: string) =>
        `id=${quote}${rewriteReference(id)}${quote}`,
    )
    .replace(
      /url\(#([^)]*)\)/g,
      (_match, id: string) => `url(#${rewriteReference(id)})`,
    );
}

export function defaultTextLayerName(text: string | undefined): string {
  return text?.trim() || "Text";
}

export function primitiveLayerName(primitive: CanvasPrimitiveInsert): string {
  switch (primitive.kind) {
    case "frame":
      return "Frame";
    case "line":
      return "Line";
    case "arrow":
      return "Arrow";
    case "ellipse":
      return "Ellipse";
    case "polygon":
      return "Polygon";
    case "star":
      return "Star";
    case "path":
      return "Vector";
    case "text":
      return defaultTextLayerName(primitive.text);
    case "rectangle":
    default:
      return "Rectangle";
  }
}

export function polygonPointsForHtmlShape(
  kind: "polygon" | "star",
  width: number,
  height: number,
): string {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const cx = safeWidth / 2;
  const cy = safeHeight / 2;
  const radius = Math.max(1, Math.min(safeWidth, safeHeight) / 2);
  const points: Array<{ x: number; y: number }> = [];

  if (kind === "polygon") {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 3;
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
  } else {
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const pointRadius = index % 2 === 0 ? radius : radius * 0.45;
      points.push({
        x: cx + Math.cos(angle) * pointRadius,
        y: cy + Math.sin(angle) * pointRadius,
      });
    }
  }

  return points
    .map(
      (point) =>
        `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`,
    )
    .join(" ");
}


function absoluteRect(
  element: Element,
): { x: number; y: number; w: number; h: number } | null {
  const style = (element as HTMLElement).style;
  if (style.position !== "absolute") return null;
  const read = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const x = read(style.left);
  const y = read(style.top);
  const w = read(style.width);
  const h = read(style.height);
  if (x === null || y === null || w === null || h === null) return null;
  let originX = 0;
  let originY = 0;
  for (
    let ancestor = element.parentElement;
    ancestor && ancestor.tagName.toLowerCase() !== "body";
    ancestor = ancestor.parentElement
  ) {
    const position = ancestor.style.position;
    if (
      position !== "absolute" &&
      position !== "relative" &&
      position !== "fixed"
    ) {
      continue;
    }
    const inset = inlineBorderInset(ancestor);
    originX += (read(ancestor.style.left) ?? 0) + inset.x;
    originY += (read(ancestor.style.top) ?? 0) + inset.y;
  }
  return { x: originX + x, y: originY + y, w, h };
}

function inlineBorderInset(element: Element): { x: number; y: number } {
  const style = (element as HTMLElement).style;
  const read = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return { x: read(style.borderLeftWidth), y: read(style.borderTopWidth) };
}

function deepestFrameContaining(
  root: Element,
  x: number,
  y: number,
): { element: Element; x: number; y: number } | null {
  const contained = Array.from(
    root.querySelectorAll('[data-an-primitive="frame"]'),
  )
    .map((element) => ({ element, rect: absoluteRect(element) }))
    .filter(
      (
        candidate,
      ): candidate is {
        element: Element;
        rect: { x: number; y: number; w: number; h: number };
      } =>
        candidate.rect !== null &&
        x >= candidate.rect.x &&
        y >= candidate.rect.y &&
        x <= candidate.rect.x + candidate.rect.w &&
        y <= candidate.rect.y + candidate.rect.h,
    )
    .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
  const best = contained[0];
  return best
    ? { element: best.element, x: best.rect.x, y: best.rect.y }
    : null;
}

export function canvasPrimitiveInsertionHostNodeId(
  content: string,
  primitive: CanvasPrimitiveInsert,
  preserveNegativePosition = false,
): { kind: "body" } | { kind: "frame"; nodeId: string } | null {
  if (typeof window === "undefined" || isStandaloneHttpUrl(content))
    return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const left = preserveNegativePosition
      ? Math.round(primitive.geometry.x)
      : Math.max(0, Math.round(primitive.geometry.x));
    const top = preserveNegativePosition
      ? Math.round(primitive.geometry.y)
      : Math.max(0, Math.round(primitive.geometry.y));
    const host = deepestFrameContaining(doc.body, left, top)?.element;
    if (!host) return { kind: "body" };
    const id = host.getAttribute("data-agent-native-node-id");
    return id ? { kind: "frame", nodeId: id } : null;
  } catch {
    // coercion-ok: null is failure; the caller refuses insertion.
    return null;
  }
}

export function appendCanvasPrimitiveToHtml(
  content: string,
  primitive: CanvasPrimitiveInsert,
  options?: {
    preserveNegativePosition?: boolean;
    isBoardTarget?: boolean;
    positioning?: "absolute" | "flow";
    boardBackground?: string | null;
  },
): string | null {
  if (typeof window === "undefined") return null;
  if (isStandaloneHttpUrl(content)) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const geometry = primitive.geometry;
    const explicitPathData = primitive.pathData?.trim()
      ? primitive.pathData
      : null;
    const preserveNegativePosition =
      options?.preserveNegativePosition || explicitPathData !== null;
    const left = preserveNegativePosition
      ? Math.round(geometry.x)
      : Math.max(0, Math.round(geometry.x));
    const top = preserveNegativePosition
      ? Math.round(geometry.y)
      : Math.max(0, Math.round(geometry.y));
    const width = Math.max(1, Math.round(geometry.width));
    const height = Math.max(1, Math.round(geometry.height));
    const nodeId = primitive.nodeId ?? uniqueLayerId(primitive.kind);
    const layerName = primitiveLayerName(primitive);
    const host = deepestFrameContaining(doc.body, left, top);
    const hostOrBody: Element = host?.element ?? doc.body;
    const hostBorder = host ? inlineBorderInset(host.element) : { x: 0, y: 0 };
    const hostLeft = host ? left - host.x - hostBorder.x : left;
    const hostTop = host ? top - host.y - hostBorder.y : top;
    const finishPrimitive = (element: Element): string => {
      if (options?.positioning === "flow") {
        const style = (element as HTMLElement | SVGElement).style;
        for (const property of [
          "position",
          "left",
          "top",
          "right",
          "bottom",
          "inset",
        ] as const) {
          style.setProperty(
            property,
            property === "position" ? "relative" : "auto",
            "important",
          );
        }
      }
      hostOrBody.appendChild(element);
      return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    };

    if (
      primitive.kind === "path" ||
      primitive.kind === "line" ||
      primitive.kind === "arrow"
    ) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      const pathViewBoxWidth = Math.max(1, geometry.width);
      const pathViewBoxHeight = Math.max(1, geometry.height);
      const points = primitive.points?.length
        ? primitive.points
        : [
            { x: left, y: top + height / 2 },
            { x: left + width, y: top + height / 2 },
          ];
      const originX = Math.min(...points.map((point) => point.x));
      const originY = Math.min(...points.map((point) => point.y));
      path.setAttribute(
        "d",
        explicitPathData ??
          points
            .map((point, index) => {
              const command = index === 0 ? "M" : "L";
              return `${command} ${Math.round(point.x - originX)} ${Math.round(
                point.y - originY,
              )}`;
            })
            .join(" "),
      );
      const paint = canvasVectorPaint({
        outline: isClosedPathData(explicitPathData)
          ? "closed-path"
          : "open-path",
        fill: primitive.fill,
        stroke: primitive.stroke,
        strokeWidth: primitive.strokeWidth,
      });
      path.setAttribute("fill", paint.fill);
      if (explicitPathData && !isClosedPathData(explicitPathData)) {
        hidePenPathFill(path);
      }
      path.setAttribute("stroke", paint.stroke);
      path.setAttribute("stroke-width", String(paint.strokeWidth));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      const endpoints = vectorEndpointPairForPrimitive(
        primitive.kind,
        primitive.startPoint,
        primitive.endPoint,
      );
      const endpointDefs = vectorEndpointDefsMarkup(nodeId, endpoints);
      if (endpointDefs) {
        const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
        defs.setAttribute("data-an-vector-endpoints", "true");
        for (const side of ["start", "end"] as const) {
          const endpoint =
            endpoints[side === "start" ? "startPoint" : "endPoint"];
          const shape = endpoint === "none" ? null : endpoint;
          if (!shape) continue;
          const marker = doc.createElementNS(
            "http://www.w3.org/2000/svg",
            "marker",
          );
          const markerMarkup = endpointDefs.match(
            new RegExp(
              `<marker[^>]*data-an-vector-endpoint-marker="${side}"[\\s\\S]*?</marker>`,
            ),
          )?.[0];
          if (!markerMarkup) continue;
          const markerDoc = new DOMParser().parseFromString(
            `<svg xmlns="http://www.w3.org/2000/svg">${markerMarkup}</svg>`,
            "image/svg+xml",
          );
          const parsedMarker = markerDoc.documentElement.firstElementChild;
          if (!parsedMarker) continue;
          for (const attribute of Array.from(parsedMarker.attributes)) {
            marker.setAttribute(attribute.name, attribute.value);
          }
          for (const child of Array.from(parsedMarker.children)) {
            marker.appendChild(doc.importNode(child, true));
          }
          defs.appendChild(marker);
        }
        if (defs.children.length > 0) svg.appendChild(defs);
      }
      const endpointAttributes = vectorEndpointAttributesMarkup(
        nodeId,
        endpoints,
      );
      if (endpointAttributes) {
        for (const match of endpointAttributes.matchAll(
          /([\w-]+)="([^"]*)"/g,
        )) {
          path.setAttribute(match[1]!, match[2]!);
        }
      }
      svg.setAttribute("data-agent-native-node-id", nodeId);
      svg.setAttribute("data-agent-native-layer-name", layerName);
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute(
        "viewBox",
        explicitPathData
          ? `${geometry.x} ${geometry.y} ${pathViewBoxWidth} ${pathViewBoxHeight}`
          : `0 0 ${width} ${height}`,
      );
      svg.setAttribute("preserveAspectRatio", "none");
      const box = explicitPathData
        ? {
            left: hostLeft + geometry.x - left,
            top: hostTop + geometry.y - top,
            width: pathViewBoxWidth,
            height: pathViewBoxHeight,
          }
        : { left: hostLeft, top: hostTop, width, height };
      svg.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${box.left}px`,
          `top:${box.top}px`,
          `width:${box.width}px`,
          `height:${box.height}px`,
          "overflow:visible",
          `${VECTOR_START_ENDPOINT_PROPERTY}:${endpoints.startPoint}`,
          `${VECTOR_END_ENDPOINT_PROPERTY}:${endpoints.endPoint}`,
          geometry.rotation ? `transform:rotate(${geometry.rotation}deg)` : "",
        ]
          .filter(Boolean)
          .join(";"),
      );
      svg.appendChild(path);
      return finishPrimitive(svg);
    }

    if (primitive.kind === "polygon" || primitive.kind === "star") {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      const polygon = doc.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      polygon.setAttribute(
        "points",
        polygonPointsForHtmlShape(primitive.kind, width, height),
      );
      const polygonPaint = canvasVectorPaint({
        outline: "shape",
        fill: primitive.fill,
        stroke: primitive.stroke,
        strokeWidth: primitive.strokeWidth,
      });
      polygon.setAttribute("fill", polygonPaint.fill);
      polygon.setAttribute("stroke", polygonPaint.stroke);
      polygon.setAttribute("stroke-width", String(polygonPaint.strokeWidth));
      polygon.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("data-agent-native-node-id", nodeId);
      svg.setAttribute("data-agent-native-layer-name", layerName);
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${hostLeft}px`,
          `top:${hostTop}px`,
          `width:${width}px`,
          `height:${height}px`,
          "overflow:visible",
          geometry.rotation ? `transform:rotate(${geometry.rotation}deg)` : "",
        ]
          .filter(Boolean)
          .join(";"),
      );
      svg.appendChild(polygon);
      return finishPrimitive(svg);
    }

    const element = doc.createElement("div");
    element.setAttribute("data-agent-native-node-id", nodeId);
    element.setAttribute("data-agent-native-layer-name", layerName);
    element.setAttribute("data-an-primitive", primitive.kind);
    element.style.position = "absolute";
    element.style.left = `${hostLeft}px`;
    element.style.top = `${hostTop}px`;
    if (primitive.kind === "text" && primitive.autoSize) {
      element.style.width = "max-content";
      element.style.height = "auto";
    } else {
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    if (geometry.rotation) {
      element.style.transform = `rotate(${geometry.rotation}deg)`;
    }

    const canonical = canvasPrimitiveVisual(
      primitive.kind === "rectangle" ? "rect" : primitive.kind,
    );
    if (primitive.kind === "frame") {
      element.style.background = primitive.fill ?? defaultCanvasFrameFill();
      if (
        primitive.stroke !== undefined ||
        primitive.strokeWidth !== undefined
      ) {
        element.style.border = `${primitive.strokeWidth ?? 1}px solid ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`;
      }
      element.style.overflow = "hidden";
    } else if (primitive.kind === "text") {
      element.textContent = primitive.text ?? "";
      element.style.display = primitive.autoSize ? "inline-block" : "flex";
      if (!primitive.autoSize) {
        element.style.alignItems = "flex-start";
      }
      const boardSurfaceIsLight =
        options?.isBoardTarget === true
          ? resolveDestinationBackgroundLightnessOrNull([
              { color: options.boardBackground ?? null },
            ])
          : null;
      const measuredIsLight =
        options?.isBoardTarget === true && hostOrBody === doc.body
          ? null
          : destinationBackgroundLightness(hostOrBody);
      const surfaceIsLight = measuredIsLight ?? boardSurfaceIsLight;
      const autoTextNeedsLightFill =
        surfaceIsLight === null
          ? options?.isBoardTarget === true
          : !surfaceIsLight;
      const resolvedTextColor =
        primitive.fill ?? defaultCanvasTextColor(autoTextNeedsLightFill);
      element.style.color = resolvedTextColor;
      if (primitive.fill === undefined) {
        element.setAttribute(BOARD_TEXT_AUTO_COLOR_MARKER, "");
      }
      element.style.fontSize = "16px";
      element.style.lineHeight = "1.2";
      element.style.whiteSpace = "pre-wrap";
      element.style.border = canonical.border;
      element.style.borderRadius = canonical.borderRadius;
      element.style.fontFamily = CANVAS_TEXT_DEFAULT_FONT_FAMILY;
    } else if (primitive.kind === "ellipse") {
      element.style.background = primitive.fill ?? canonical.background;
      element.style.border =
        primitive.stroke !== undefined || primitive.strokeWidth !== undefined
          ? `${primitive.strokeWidth ?? 1}px solid ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`
          : canonical.border;
      element.style.borderRadius = canonical.borderRadius;
    } else {
      element.style.background = primitive.fill ?? canonical.background;
      element.style.border =
        primitive.stroke !== undefined || primitive.strokeWidth !== undefined
          ? `${primitive.strokeWidth ?? 1}px solid ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`
          : canonical.border;
      element.style.borderRadius = canonical.borderRadius;
    }

    return finishPrimitive(element);
  } catch {
    return null;
  }
}

export function extractCanvasPrimitiveHtml(
  content: string,
  nodeId: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
    const matches = doc.querySelectorAll(
      `[data-agent-native-node-id="${safeNodeId}"]`,
    );
    if (matches.length !== 1) return null;
    return matches[0]?.outerHTML ?? null;
  } catch {
    return null;
  }
}
