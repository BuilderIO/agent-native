import { isBoardFile } from "@shared/board-file";

import {
  canvasPrimitiveVisual,
  DEFAULT_LINE_STROKE,
  DEFAULT_LINE_STROKE_WIDTH_PX,
} from "@/components/design/canvas-primitive-style";
import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";

import {
  CANVAS_TEXT_DEFAULT_FONT_FAMILY,
  defaultCanvasTextColor,
} from "./canvas-primitives";
import { BOARD_TEXT_AUTO_COLOR_MARKER } from "./cross-screen-text-color";
import { escapeHtmlAttributeValue, escapeHtmlText } from "./dom-utils";
import type { DesignFile } from "./types";

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

export function normalizedDesignFileType(
  fileType: string,
): "html" | "css" | "jsx" | "asset" {
  return fileType === "css" ||
    fileType === "jsx" ||
    fileType === "asset" ||
    fileType === "html"
    ? fileType
    : "html";
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
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--color-bg, #ffffff);
      color: var(--color-text, #111827);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 48px;
    }
  </style>
</head>
<body>
  <main data-agent-native-layer-name="${safeTitleAttribute}">
  </main>
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
  return content.replace(
    /data-agent-native-node-id="[^"]*"/g,
    () => `data-agent-native-node-id="${uniqueLayerId("copy")}"`,
  );
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
      return primitive.text?.trim() || "Text";
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
export function appendCanvasPrimitiveToHtml(
  content: string,
  primitive: CanvasPrimitiveInsert,
  options?: { preserveNegativePosition?: boolean; isBoardTarget?: boolean },
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    if (!doc.body) return null;
    const geometry = primitive.geometry;
    const left = options?.preserveNegativePosition
      ? Math.round(geometry.x)
      : Math.max(0, Math.round(geometry.x));
    const top = options?.preserveNegativePosition
      ? Math.round(geometry.y)
      : Math.max(0, Math.round(geometry.y));
    const width = Math.max(1, Math.round(geometry.width));
    const height = Math.max(1, Math.round(geometry.height));
    const nodeId = primitive.nodeId ?? uniqueLayerId(primitive.kind);
    const layerName = primitiveLayerName(primitive);

    if (
      primitive.kind === "path" ||
      primitive.kind === "line" ||
      primitive.kind === "arrow"
    ) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      const markerId = `${nodeId}-arrow`;
      const explicitPathData = primitive.pathData?.trim()
        ? primitive.pathData
        : null;
      const pathViewBoxLeft = options?.preserveNegativePosition
        ? geometry.x
        : Math.max(0, geometry.x);
      const pathViewBoxTop = options?.preserveNegativePosition
        ? geometry.y
        : Math.max(0, geometry.y);
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
      // P11: a CLOSED pen path (serializePenPath always ends a closed path's
      // "d" string with a trailing "Z" — see shared/pen-path.ts) is a real
      // fillable shape, not just a stroked line — Figma/Illustrator give a
      // closed pen path a default fill. An open path (no trailing Z, or the
      // points-based line/arrow fallback) keeps fill:none since there's no
      // enclosed region to fill. The inspector's existing style-edit path
      // can still override this fill like any other element style.
      const isClosedPenPath = Boolean(
        explicitPathData && /Z\s*$/i.test(explicitPathData.trim()),
      );
      path.setAttribute(
        "fill",
        isClosedPenPath ? (primitive.fill ?? "#D9D9D9") : "none",
      );
      path.setAttribute("stroke", primitive.stroke ?? DEFAULT_LINE_STROKE);
      path.setAttribute(
        "stroke-width",
        String(primitive.strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX),
      );
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (primitive.kind === "arrow") {
        const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "marker",
        );
        const arrowHead = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        marker.setAttribute("id", markerId);
        marker.setAttribute("markerWidth", "10");
        marker.setAttribute("markerHeight", "10");
        marker.setAttribute("refX", "8");
        marker.setAttribute("refY", "5");
        marker.setAttribute("orient", "auto");
        marker.setAttribute("markerUnits", "strokeWidth");
        arrowHead.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
        arrowHead.setAttribute("fill", primitive.stroke ?? DEFAULT_LINE_STROKE);
        marker.appendChild(arrowHead);
        defs.appendChild(marker);
        svg.appendChild(defs);
        path.setAttribute("marker-end", `url(#${markerId})`);
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
          ? `${pathViewBoxLeft} ${pathViewBoxTop} ${pathViewBoxWidth} ${pathViewBoxHeight}`
          : `0 0 ${width} ${height}`,
      );
      // P4: without this, resizing the shape non-uniformly (e.g. dragging
      // only the right handle) letterboxes the path inside its viewBox
      // (SVG's default preserveAspectRatio is "xMidYMid meet") instead of
      // stretching it to fill the new box — every other primitive kind here
      // (polygon/star, div-based shapes) already stretches to its
      // width/height, so pen paths/lines/arrows should match.
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${left}px`,
          `top:${top}px`,
          `width:${width}px`,
          `height:${height}px`,
          "overflow:visible",
          geometry.rotation ? `transform:rotate(${geometry.rotation}deg)` : "",
        ]
          .filter(Boolean)
          .join(";"),
      );
      svg.appendChild(path);
      doc.body.appendChild(svg);
      return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
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
      polygon.setAttribute("fill", primitive.fill ?? "rgba(37, 99, 235, 0.16)");
      polygon.setAttribute("stroke", primitive.stroke ?? "rgb(37, 99, 235)");
      polygon.setAttribute(
        "stroke-width",
        String(primitive.strokeWidth ?? 1.5),
      );
      polygon.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("data-agent-native-node-id", nodeId);
      svg.setAttribute("data-agent-native-layer-name", layerName);
      // Kind marker so the layers panel shows a true polygon/star icon for this
      // SVG primitive instead of falling through to the rectangle glyph.
      // Read by treeTypeForNode in shared/code-layer.ts.
      svg.setAttribute("data-an-primitive", primitive.kind);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${left}px`,
          `top:${top}px`,
          `width:${width}px`,
          `height:${height}px`,
          "overflow:visible",
          geometry.rotation ? `transform:rotate(${geometry.rotation}deg)` : "",
        ]
          .filter(Boolean)
          .join(";"),
      );
      svg.appendChild(polygon);
      doc.body.appendChild(svg);
      return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    }

    const element = doc.createElement("div");
    element.setAttribute("data-agent-native-node-id", nodeId);
    element.setAttribute("data-agent-native-layer-name", layerName);
    // Kind marker so the layers panel shows a shape/text/frame icon for this
    // primitive (rectangle/ellipse/text/frame) instead of the generic code
    // glyph. Read by treeTypeForNode in shared/code-layer.ts.
    element.setAttribute("data-an-primitive", primitive.kind);
    element.style.position = "absolute";
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    if (!(primitive.kind === "text" && primitive.autoSize)) {
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
      // A committed frame is a BARE container <div> — no default fill,
      // border, or radius — so the markup this code-first editor emits stays
      // clean (a Figma frame reads as unstyled structure, and a dashed
      // border/tint baked into the design's real HTML would be styling
      // pollution). This deliberately diverges from the draft PREVIEW's
      // faint-tint/dashed look (canvas-primitive-style.ts), which is editor
      // affordance chrome during the drag; on commit the new frame is
      // immediately selected, so its bounds stay visible via selection
      // chrome instead. Explicit user-chosen fill/stroke still applies.
      // overflow:hidden matches Figma frames clipping their content.
      if (primitive.fill) {
        element.style.background = primitive.fill;
      }
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
      // Board (dark infinite-canvas) text needs an explicit default fill —
      // "currentColor" inherits the unstyled document's black body text,
      // invisible on the dark canvas background. The board surface is
      // always dark regardless of the editor chrome theme, so this keys off
      // the target surface only (see defaultCanvasTextColor). Screens keep
      // "currentColor" so text dropped into an existing (often light)
      // screen still inherits its surrounding styles/theme as before.
      const resolvedTextColor =
        primitive.fill ??
        defaultCanvasTextColor(options?.isBoardTarget === true);
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

    doc.body.appendChild(element);
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}
