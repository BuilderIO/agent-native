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
  // Blank screen = free canvas: <body> is the positioned root and drawn shapes
  // are absolute children (x,y in the HTML). A centering grid / <main> wrapper
  // trapped shapes at center and got auto-layout-converted on drop.
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

/**
 * Re-stamp every `data-agent-native-node-id` in duplicated screen content with a
 * fresh unique id. Without this, a duplicated screen carries the SAME node ids as
 * its source, which collapses the cross-file layer-owner map (selecting a layer
 * in one screen resolves to the other) and can produce a malformed aggregate
 * projection.
 */
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

/**
 * Figma's default text-layer name IS its content. A freshly drawn text
 * primitive is committed with no content yet (the draft is still empty), so
 * this only produces the real name once the user's typed value is known —
 * see `runTextContentChange`'s creation-finalizing commit, which re-derives
 * the layer name from this same function once typing lands.
 */
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

/**
 * Marker attribute stamped on board-drawn text whose inline `color` is the
 * auto-applied board default (defaultCanvasTextColor's "#ffffff" branch),
 * NOT a user-chosen color. Mirrors BOARD_TEXT_AUTO_COLOR_MARKER in
 * editor-chrome.bridge.ts (keep both in sync) — that bridge's
 * adaptAutoTextColorForNest reads this marker to decide whether an
 * in-screen re-parent should switch the forced white to `inherit` so the
 * text doesn't render white-on-white in a light container. Cross-screen
 * drops (handleCrossScreenElementDrop below) key off the same marker via
 * adaptAutoTextColorForCrossScreenNode. Any explicit user color edit must
 * remove this attribute so the text is never "helpfully" overridden again.
 */

/** Inline absolute rect, or null when the element is not absolutely placed. */
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
  // Inline left/top are relative to the nearest positioned ancestor, so a
  // nested frame must add its own offsets or it matches the wrong origin.
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

/**
 * Figma's frame is the container primitive and a rectangle is not, so only
 * `data-an-primitive="frame"` adopts. Bounds come from inline geometry
 * because this document is parsed, never laid out.
 */
/** Inline border widths, which an absolute child's offsets resolve inside of. */
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
        // Nest on the origin, as Figma does. Requiring the whole box to fit
        // drops a click-created text (default width) out to the root, where
        // it overlaps the frame it looks like it belongs to.
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

/**
 * Return the stable authored identity of the exact frame the insertion helper
 * will choose, a body marker when no frame contains the point, or `null` when
 * the content/host cannot be resolved. The command uses this only to verify the
 * host's computed layout in the target's live iframe before enabling flow
 * positioning; the inert source document itself is never used as a layout
 * oracle.
 */
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
    /** Let a verified auto-layout parent place this primitive. */
    positioning?: "absolute" | "flow";
    /** The canvas colour behind the board. The board document is transparent
     *  by design, so its surface can only be measured from the host. */
    boardBackground?: string | null;
  },
): string | null {
  if (typeof window === "undefined") return null;
  // A live/localhost screen stores its route URL here, not a document.
  // Appending to it parses the URL as body text and returns a whole HTML file,
  // which the caller then persists OVER the URL — the screen stops being live
  // and the route is gone. There is no correct append for this shape.
  if (isStandaloneHttpUrl(content)) return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const geometry = primitive.geometry;
    // A pen path's box is its path bounds; clamping it moves the box off the
    // drawn path, which the path data (in absolute coordinates) never follows.
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
    // Resolved once so every primitive kind nests identically, and so text can
    // pick a fill that is legible against its actual container.
    const host = deepestFrameContaining(doc.body, left, top);
    const hostOrBody: Element = host?.element ?? doc.body;
    // An absolute child resolves against the host's PADDING box, while
    // host.x/host.y are its border-box origin — so a bordered frame shifts
    // everything dropped into it by the border width.
    const hostBorder = host ? inlineBorderInset(host.element) : { x: 0, y: 0 };
    const hostLeft = host ? left - host.x - hostBorder.x : left;
    const hostTop = host ? top - host.y - hostBorder.y : top;
    const finishPrimitive = (element: Element): string => {
      if (options?.positioning === "flow") {
        // Keep a positioned containing block for Frame children, while
        // forcing all authored primitive kinds into the parent's layout.
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
      // Figma fills only closed regions: a fill added to an open path stays in
      // the file for when it closes, but must not paint the chord meanwhile.
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
      // Kind marker so the layers panel shows a true vector/line/arrow icon for
      // this SVG primitive instead of falling through to the rectangle glyph.
      // Read by treeTypeForNode in shared/code-layer.ts.
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute(
        "viewBox",
        explicitPathData
          ? `${geometry.x} ${geometry.y} ${pathViewBoxWidth} ${pathViewBoxHeight}`
          : `0 0 ${width} ${height}`,
      );
      // P4: without this, resizing the shape non-uniformly (e.g. dragging
      // only the right handle) letterboxes the path inside its viewBox
      // (SVG's default preserveAspectRatio is "xMidYMid meet") instead of
      // stretching it to fill the new box — every other primitive kind here
      // (polygon/star, div-based shapes) already stretches to its
      // width/height, so pen paths/lines/arrows should match.
      svg.setAttribute("preserveAspectRatio", "none");
      // Box and viewBox must stay 1:1, or vector edit reads a scaled SVG.
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
      // Kind marker so the layers panel shows a true polygon/star icon for this
      // SVG primitive instead of falling through to the rectangle glyph.
      // Read by treeTypeForNode in shared/code-layer.ts.
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      // Without this, resizing the shape non-uniformly (e.g. dragging only
      // the height handle) letterboxes the polygon inside its viewBox
      // (SVG's default preserveAspectRatio is "xMidYMid meet") instead of
      // stretching it to fill the new box — the box's own width/height
      // still resize correctly, but the visible shape stays centered at its
      // creation-time aspect ratio, masking any later resize (including a
      // flip-through-zero) since the rendered polygon barely changes. The
      // path/pen-tool primitive right above already sets this for the same
      // reason; polygon/star never did despite the comment there claiming it
      // did.
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
    // Kind marker so the layers panel shows a shape/text/frame icon for this
    // primitive (rectangle/ellipse/text/frame) instead of the generic code
    // glyph. Read by treeTypeForNode in shared/code-layer.ts.
    element.setAttribute("data-an-primitive", primitive.kind);
    element.style.position = "absolute";
    element.style.left = `${hostLeft}px`;
    element.style.top = `${hostTop}px`;
    if (primitive.kind === "text" && primitive.autoSize) {
      // Point text grows to its intrinsic width, independent of how much room
      // remains between the insertion point and the screen edge. Keeping the
      // explicit auto dimensions also lets the inspector identify this as the
      // same auto-width mode it applies to existing text layers.
      element.style.width = "max-content";
      element.style.height = "auto";
    } else {
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    if (geometry.rotation) {
      element.style.transform = `rotate(${geometry.rotation}deg)`;
    }

    // Use the shared canvas-primitive-style module so committed output is
    // pixel-identical to the draft preview (fixes B5 color jump, B6 ellipse
    // radius jump).  User-supplied fill/stroke/strokeWidth override the
    // canonical defaults so hand-chosen colours are preserved.
    const canonical = canvasPrimitiveVisual(
      primitive.kind === "rectangle" ? "rect" : primitive.kind,
    );
    if (primitive.kind === "frame") {
      // A committed frame carries a real surface, not the draft preview's
      // dashed tint (editor chrome, canvas-primitive-style.ts): selection
      // chrome only covers the frame while it stays selected, and a bare
      // container is invisible the moment it is not.
      // overflow:hidden matches Figma frames clipping their content.
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
        // Figma defaults fixed-size text frames to TOP vertical alignment,
        // not centered — match that instead of centering the text block.
        element.style.alignItems = "flex-start";
      }
      // "currentColor" inherits the unstyled document's black body text, so
      // it is invisible on any dark surface. The board renderer forces its own
      // document transparent, so a colour on that body is never painted and
      // measuring it would judge a surface nobody sees — a frame inside the
      // board still can be. The canvas behind it arrives from the host.
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
      // Stamp the auto-color marker whenever the color came from the
      // default (no explicit primitive.fill) rather than a user-chosen
      // value, so a later cross-screen or in-screen re-parent (see
      // adaptAutoTextColorForCrossScreenNode below and
      // adaptAutoTextColorForNest in editor-chrome.bridge.ts) can safely
      // detect "this white was auto-applied" and rewrite it to inherit
      // instead of leaving invisible white-on-white text.
      if (primitive.fill === undefined) {
        element.setAttribute(BOARD_TEXT_AUTO_COLOR_MARKER, "");
      }
      element.style.fontSize = "16px";
      element.style.lineHeight = "1.2";
      element.style.whiteSpace = "pre-wrap";
      element.style.border = canonical.border;
      element.style.borderRadius = canonical.borderRadius;
      // Item 2: canvas-drawn text defaulted to the browser's serif fallback
      // (no font-family was ever set here) — match the editor's own Inter
      // stack instead. Only applies when the caller doesn't already carry an
      // explicit font (kept future-proof even though CanvasPrimitiveInsert
      // has no fontFamily field today).
      element.style.fontFamily = CANVAS_TEXT_DEFAULT_FONT_FAMILY;
    } else if (primitive.kind === "ellipse") {
      element.style.background = primitive.fill ?? canonical.background;
      element.style.border =
        primitive.stroke !== undefined || primitive.strokeWidth !== undefined
          ? `${primitive.strokeWidth ?? 1}px solid ${primitive.stroke ?? canonical.border.split(" ").slice(2).join(" ")}`
          : canonical.border;
      element.style.borderRadius = canonical.borderRadius; // "50%"
    } else {
      // rect / rectangle / frame fallthrough
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

/**
 * Extract one newly-created primitive from a temporary document as markup the
 * live iframe bridge can insert. URL-backed screens keep their route URL in the
 * Design file, so their creation path must serialize a node without ever
 * rewriting that file content.
 */
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
