/**
 * Shared constants and helpers for the board file — a reserved design_file
 * whose HTML document holds absolute-positioned board elements.
 *
 * The board file is identified by the filename "__board__.html" and its id is
 * stored in designs.data.boardFileId.  Board elements are direct children of
 * <body style="margin:0;position:relative;background:transparent;overflow:visible">
 * each with an absolute position derived from their original BoardObjectEntry
 * geometry.
 *
 * This module is imported by the editor UI, actions, and migration code.
 * It must stay free of React, Nitro, and database imports.
 */

import type { BoardObjectEntry } from "./board-objects.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reserved filename for the board overlay file. */
export const BOARD_FILENAME = "__board__.html";

// ---------------------------------------------------------------------------
// isBoardFile
// ---------------------------------------------------------------------------

/**
 * Returns true when `filename` is the reserved board file.
 * Comparison is case-sensitive to match the rest of the codebase.
 */
export function isBoardFile(filename: string): boolean {
  return filename === BOARD_FILENAME;
}

// ---------------------------------------------------------------------------
// emptyBoardHtml
// ---------------------------------------------------------------------------

/**
 * The canonical empty-board document template.
 *
 * The <body> uses:
 *   - margin:0 — no browser default whitespace
 *   - position:relative — so absolute children are positioned within the body
 *   - background:transparent — the board layer sits behind screen iframes
 *   - overflow:visible — board elements may extend beyond the logical surface
 */
export function emptyBoardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; position: relative; background: transparent; overflow: visible; }
</style>
</head>
<body>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// boardObjectEntryToHtmlFragment
// ---------------------------------------------------------------------------

/**
 * Convert a BoardObjectEntry to an absolute-positioned HTML fragment for
 * insertion into the board file's <body>.
 *
 * Negative left/top coordinates are intentionally preserved — board objects
 * may live anywhere in the infinite canvas space, including at negative offsets
 * (e.g. to the left of or above the primary frame cluster).
 *
 * The fragment sets `data-agent-native-node-id` so the bridge engine can
 * select, style, and move elements exactly as it does for screen elements.
 */
export function boardObjectEntryToHtmlFragment(
  entry: BoardObjectEntry,
): string {
  const {
    id,
    kind,
    geometry,
    fill,
    stroke,
    strokeWidth,
    text,
    pathData,
    points,
    name,
  } = entry;
  const x = Math.round(geometry.x);
  const y = Math.round(geometry.y);
  const width = Math.max(1, Math.round(geometry.width));
  const height = Math.max(1, Math.round(geometry.height));

  const nodeId = id;
  const layerName = name ?? kindToLayerName(kind);

  // Base inline style — negative left/top are kept as-is.
  const baseStyle = [
    "position:absolute",
    `left:${x}px`,
    `top:${y}px`,
    `width:${width}px`,
    `height:${height}px`,
    ...(geometry.rotation ? [`transform:rotate(${geometry.rotation}deg)`] : []),
    ...(typeof geometry.z === "number" ? [`z-index:${geometry.z}`] : []),
  ].join(";");

  const dataAttrs =
    `data-agent-native-node-id="${escapeAttr(nodeId)}"` +
    ` data-agent-native-layer-name="${escapeAttr(layerName)}"` +
    // Kind marker so the layers panel renders a shape/text/frame icon for the
    // primitive (a rectangle looks like a rectangle), matching in-screen drawn
    // primitives, instead of the generic code/element glyph.
    ` data-an-primitive="${escapeAttr(kind)}"`;

  // Path / line / arrow kinds use an inline SVG.
  if (kind === "path" || kind === "line" || kind === "arrow") {
    const pts = points?.length
      ? points
      : [
          { x: 0, y: height / 2 },
          { x: width, y: height / 2 },
        ];
    const originX = Math.min(...pts.map((p) => p.x));
    const originY = Math.min(...pts.map((p) => p.y));
    const d =
      pathData ??
      pts
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"} ${Math.round(p.x - originX)} ${Math.round(p.y - originY)}`,
        )
        .join(" ");
    const strokeColor = stroke ?? "var(--primary, #2563eb)";
    const sw = strokeWidth ?? 3;

    let markerDefs = "";
    let markerEnd = "";
    if (kind === "arrow") {
      const markerId = `${nodeId}-arrow`;
      markerDefs = `<defs><marker id="${escapeAttr(markerId)}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeAttr(strokeColor)}"/></marker></defs>`;
      markerEnd = ` marker-end="url(#${escapeAttr(markerId)})"`;
    }

    return `<svg style="${baseStyle}" xmlns="http://www.w3.org/2000/svg" overflow="visible" ${dataAttrs}>${markerDefs}<path d="${escapeAttr(d)}" fill="none" stroke="${escapeAttr(strokeColor)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${markerEnd}/></svg>`;
  }

  // Ellipse kind uses a <div> with border-radius.
  if (kind === "ellipse") {
    const bgColor = fill ?? "var(--primary, #2563eb)";
    const borderStyle = stroke
      ? `border:${strokeWidth ?? 1}px solid ${stroke};`
      : "";
    const style = `${baseStyle};background:${bgColor};border-radius:50%;${borderStyle}`;
    return `<div style="${style}" ${dataAttrs}></div>`;
  }

  // Text kind uses a <div> with text content.
  if (kind === "text") {
    const color = fill ?? "inherit";
    const style = `${baseStyle};color:${color};white-space:pre-wrap;`;
    return `<div style="${style}" ${dataAttrs}>${text ? escapeHtml(text) : ""}</div>`;
  }

  // Frame / rectangle / polygon / star / default — basic colored <div>.
  const bgColor =
    fill ?? (kind === "frame" ? "transparent" : "var(--primary, #2563eb)");
  const borderStyle = stroke
    ? `border:${strokeWidth ?? 1}px solid ${stroke};`
    : "";
  const style = `${baseStyle};background:${bgColor};${borderStyle}`;

  if (kind === "frame") {
    return `<div style="${style}" ${dataAttrs}>${text ? escapeHtml(text) : ""}</div>`;
  }

  return `<div style="${style}" ${dataAttrs}>${text ? escapeHtml(text) : ""}</div>`;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function kindToLayerName(kind: BoardObjectEntry["kind"]): string {
  switch (kind) {
    case "frame":
      return "Frame";
    case "rectangle":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "polygon":
      return "Polygon";
    case "star":
      return "Star";
    case "line":
      return "Line";
    case "arrow":
      return "Arrow";
    case "text":
      return "Text";
    case "path":
      return "Path";
    default:
      return "Shape";
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
