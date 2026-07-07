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

const DEFAULT_SHAPE_FILL = "rgb(218 218 218)";
const DEFAULT_SHAPE_STROKE = "rgb(168 168 168)";

// Figma-parity default stroke for vector primitives (line/arrow/pen path).
// Mirrors DEFAULT_LINE_STROKE / DEFAULT_LINE_STROKE_WIDTH_PX in
// app/components/design/canvas-primitive-style.ts — duplicated as literal
// values (not imported) so this module stays free of any dependency on the
// React-adjacent app component tree, per this file's module doc above.
// Keep these two values in sync if either canonical token ever changes.
const DEFAULT_LINE_STROKE = "#000000";
const DEFAULT_LINE_STROKE_WIDTH_PX = 1;

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
  html, body { background: transparent; }
  body { margin: 0; position: relative; overflow: visible; }
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

  // Auto-sized text grows to fit its content (matches the creation path in
  // DesignEditor.tsx canvasPrimitiveHtmlDocument, which omits width/height for
  // `kind === "text" && primitive.autoSize`). Persisting a fixed width/height
  // for these would fight the auto-size behavior on reload.
  const isAutoSizeText = kind === "text" && entry.autoSize === true;

  // Base inline style — negative left/top are kept as-is.
  const baseStyle = [
    "position:absolute",
    `left:${x}px`,
    `top:${y}px`,
    ...(isAutoSizeText ? [] : [`width:${width}px`, `height:${height}px`]),
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
    const strokeColor = stroke ?? DEFAULT_LINE_STROKE;
    const sw = strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX;

    let markerDefs = "";
    let markerEnd = "";
    if (kind === "arrow") {
      const markerId = `${nodeId}-arrow`;
      markerDefs = `<defs><marker id="${escapeAttr(markerId)}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeAttr(strokeColor)}"/></marker></defs>`;
      markerEnd = ` marker-end="url(#${escapeAttr(markerId)})"`;
    }

    // Pen-authored paths (pathData present) serialize anchors in absolute
    // canvas/geometry space, not relative to the fragment's own 0,0 origin
    // like the synthesized `pts`-based `d` above. Without a matching viewBox,
    // the SVG paints those absolute coordinates directly inside its own
    // top-left-at-0,0 box while the box itself is *also* offset to
    // geometry.x/y via baseStyle's left/top — doubling the displacement.
    // Give the SVG a viewBox anchored at the geometry origin so pathData
    // coordinates land exactly where they were authored.
    const viewBoxAttr = pathData
      ? ` viewBox="${x} ${y} ${width} ${height}"`
      : "";

    return `<svg style="${baseStyle}" xmlns="http://www.w3.org/2000/svg" overflow="visible"${viewBoxAttr} ${dataAttrs}>${markerDefs}<path d="${escapeAttr(d)}" fill="none" stroke="${escapeAttr(strokeColor)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${markerEnd}/></svg>`;
  }

  // Ellipse kind uses a <div> with border-radius.
  if (kind === "ellipse") {
    const bgColor = fill ?? DEFAULT_SHAPE_FILL;
    const borderStyle = stroke
      ? `border:${strokeWidth ?? 1}px solid ${stroke};`
      : `border:1px solid ${DEFAULT_SHAPE_STROKE};`;
    const style = `${baseStyle};background:${bgColor};border-radius:50%;${borderStyle}`;
    return `<div style="${style}" ${dataAttrs}></div>`;
  }

  // Text kind uses a <div> with text content. font-size/line-height defaults
  // match the creation path (DesignEditor.tsx canvasPrimitiveHtmlDocument:
  // element.style.fontSize = "16px"; element.style.lineHeight = "1.2";) so a
  // freshly persisted board text object looks identical to its draft preview.
  if (kind === "text") {
    const color = fill ?? "inherit";
    const style = `${baseStyle};color:${color};white-space:pre-wrap;font-size:16px;line-height:1.2;`;
    return `<div style="${style}" ${dataAttrs}>${text ? escapeHtml(text) : ""}</div>`;
  }

  // Frame / rectangle / polygon / star / default — basic colored <div>.
  const bgColor =
    fill ?? (kind === "frame" ? "transparent" : DEFAULT_SHAPE_FILL);
  const borderStyle = stroke
    ? `border:${strokeWidth ?? 1}px solid ${stroke};`
    : kind === "frame"
      ? ""
      : `border:1px solid ${DEFAULT_SHAPE_STROKE};`;
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

// ---------------------------------------------------------------------------
// backfillBoardPrimitiveMarkers
// ---------------------------------------------------------------------------

/**
 * Adds `data-an-primitive="<kind>"` to board primitive elements that are
 * missing the marker.
 *
 * ## Scope
 *
 * Only elements that look like top-level board primitives are touched:
 * - Must be a direct `<body>` child (depth-1 element)
 * - Must carry `data-agent-native-node-id` (the bridge id stamp)
 * - Must NOT already have `data-an-primitive`
 *
 * ## Kind inference (conservative)
 *
 * | Condition                                              | Inferred kind |
 * |--------------------------------------------------------|---------------|
 * | `<svg>` whose path carries `marker-end`                | `"arrow"`     |
 * | `<svg>` containing a `<polygon>`                        | `"polygon"`   |
 * | `<svg>` containing exactly one `<path>` and no other shape | `"path"`  |
 * | `<svg>` with no reliable vector signal                  | *(skip — left unmarked, still classifies as a generic shape via tag)* |
 * | Inline style contains `border-radius:50%`              | `"ellipse"`   |
 * | Inline style contains `background:transparent` or no background, but has `data-agent-native-layer-name` starting with "Frame" | `"frame"` |
 * | Element has non-empty text content and no background color in style | `"text"` |
 * | Otherwise                                              | `"rectangle"` |
 *
 * The function is:
 * - **Pure** — returns a new string, never mutates.
 * - **Additive** — only inserts `data-an-primitive`; never alters geometry,
 *   structure, or any other attributes.
 * - **Idempotent** — if the marker is already present on an element, that
 *   element is skipped.
 *
 * The implementation uses string-level parsing to remain dependency-free
 * (no DOM parser, no JSDOM).  It is intentionally conservative: when in doubt,
 * an element is left as-is rather than mis-classified.
 */
export function backfillBoardPrimitiveMarkers(html: string): string {
  // Quick exit: if every node-id-bearing element already has the marker we
  // have nothing to do.
  if (!html.includes("data-agent-native-node-id=")) return html;

  // We need to find direct <body> children only.  We walk the raw HTML string
  // looking for the opening of the <body> element, then iterate sibling-level
  // opening tags until </body>.

  const bodyStart = html.indexOf("<body");
  if (bodyStart === -1) return html;
  const bodyTagEnd = html.indexOf(">", bodyStart);
  if (bodyTagEnd === -1) return html;

  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose === -1) return html;

  // The direct-child region.
  const before = html.slice(0, bodyTagEnd + 1);
  const children = html.slice(bodyTagEnd + 1, bodyClose);
  const after = html.slice(bodyClose);

  const patched = _patchDirectChildren(children);
  if (patched === children) return html; // nothing changed
  return before + patched + after;
}

/**
 * Walk the HTML fragment that represents the direct children of <body> and
 * insert `data-an-primitive` on qualifying elements that lack it.
 *
 * We do NOT recurse into children — only sibling-level (depth-1) tags are
 * touched.
 */
function _patchDirectChildren(fragment: string): string {
  let result = "";
  let pos = 0;

  while (pos < fragment.length) {
    // Find the next '<'.
    const tagStart = fragment.indexOf("<", pos);
    if (tagStart === -1) {
      result += fragment.slice(pos);
      break;
    }

    // Copy any text / whitespace before this tag verbatim.
    result += fragment.slice(pos, tagStart);
    pos = tagStart;

    // Peek: is this a comment, closing tag, or doctype?  Copy verbatim.
    const rest = fragment.slice(pos);
    if (
      rest.startsWith("<!--") ||
      rest.startsWith("</") ||
      rest.startsWith("<!") ||
      rest.startsWith("<?")
    ) {
      const end = fragment.indexOf(">", pos);
      if (end === -1) {
        result += fragment.slice(pos);
        pos = fragment.length;
      } else {
        result += fragment.slice(pos, end + 1);
        pos = end + 1;
      }
      continue;
    }

    // Find the end of this opening tag (handling quoted attributes).
    const tagEnd = _findTagEnd(fragment, pos);
    if (tagEnd === -1) {
      // Malformed — copy rest verbatim.
      result += fragment.slice(pos);
      break;
    }

    const openTag = fragment.slice(pos, tagEnd + 1);

    // Skip the tag body + nested content and get to the matching close tag so
    // we can copy the whole element and move past it.
    // We need the tag name first.
    const tagNameMatch = openTag.match(/^<([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!tagNameMatch) {
      // Not an element tag — copy verbatim and advance.
      result += openTag;
      pos = tagEnd + 1;
      continue;
    }
    const tagName = tagNameMatch[1].toLowerCase();

    // SVG elements: vector primitives (line/path/arrow/polygon/star) render as
    // <svg>.  When the marker is missing we conservatively infer the kind from
    // the SVG's inner geometry so the layers panel shows the right vector icon
    // instead of the generic shape glyph.  Geometry is never altered — only the
    // marker attribute is inserted on the opening <svg> tag.
    if (tagName === "svg") {
      const closeTag = `</svg>`;
      const closeIdx = fragment.indexOf(closeTag, tagEnd + 1);
      if (closeIdx === -1) {
        result += fragment.slice(pos);
        pos = fragment.length;
        continue;
      }
      const inner = fragment.slice(tagEnd + 1, closeIdx);
      const shouldPatchSvg =
        openTag.includes("data-agent-native-node-id=") &&
        !openTag.includes("data-an-primitive=");
      let patchedSvgOpenTag = openTag;
      if (shouldPatchSvg) {
        const kind = _inferSvgPrimitiveKind(inner);
        if (kind) {
          patchedSvgOpenTag = openTag.replace(
            /(\s*\/?>)$/,
            ` data-an-primitive="${kind}"$1`,
          );
        }
      }
      result += patchedSvgOpenTag + inner + closeTag;
      pos = closeIdx + closeTag.length;
      continue;
    }

    // For all other elements: decide whether to patch.
    const shouldPatch =
      openTag.includes("data-agent-native-node-id=") &&
      !openTag.includes("data-an-primitive=");

    let patchedOpenTag = openTag;
    if (shouldPatch) {
      const kind = _inferPrimitiveKind(openTag);
      // Insert marker just before the closing `>` or `/>` of the opening tag.
      patchedOpenTag = openTag.replace(
        /(\s*\/?>)$/,
        ` data-an-primitive="${kind}"$1`,
      );
    }

    // Find the matching close tag (skip self-closing tags).
    const isSelfClosing = openTag.endsWith("/>") || VOID_ELEMENTS.has(tagName);
    if (isSelfClosing) {
      result += patchedOpenTag;
      pos = tagEnd + 1;
      continue;
    }

    const closeTag = `</${tagName}>`;
    const closeIdx = _findMatchingClose(fragment, tagEnd + 1, tagName);
    if (closeIdx === -1) {
      // Unmatched open tag — copy rest verbatim.
      result += patchedOpenTag + fragment.slice(tagEnd + 1);
      pos = fragment.length;
      continue;
    }

    const innerContent = fragment.slice(tagEnd + 1, closeIdx);
    result += patchedOpenTag + innerContent + closeTag;
    pos = closeIdx + closeTag.length;
  }

  return result;
}

/** Void elements that have no closing tag. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Find the index of the `>` that closes the opening tag starting at `start`
 * in `html`, skipping over quoted attribute values.
 */
function _findTagEnd(html: string, start: number): number {
  let i = start + 1; // Skip '<'
  while (i < html.length) {
    const ch = html[i];
    if (ch === ">") return i;
    if (ch === '"' || ch === "'") {
      // Skip quoted attribute value.
      const quote = ch;
      i++;
      while (i < html.length && html[i] !== quote) i++;
      if (i < html.length) i++; // skip closing quote
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Find the index of the matching `</tagName>` for an element whose opening tag
 * ended at `afterOpen`.  Handles nesting by counting open/close pairs.
 */
function _findMatchingClose(
  html: string,
  afterOpen: number,
  tagName: string,
): number {
  const openRe = new RegExp(`<${tagName}[\\s/>]`, "gi");
  const closeTag = `</${tagName}>`;
  let depth = 1;
  let pos = afterOpen;

  while (pos < html.length && depth > 0) {
    // Find the next candidate: open or close tag.
    openRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = html.indexOf(closeTag, pos);

    if (nextClose === -1) return -1; // unmatched

    if (nextOpen && nextOpen.index < nextClose) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

/**
 * Infer the `data-an-primitive` kind value for a board element whose opening
 * tag is `openTag` and which is known to lack the marker.
 *
 * Inference is conservative — only clear signals produce a non-"rectangle"
 * kind.
 */
function _inferPrimitiveKind(openTag: string): string {
  // Extract the inline style value (first style="..." attribute).
  const styleMatch = openTag.match(/\bstyle="([^"]*)"/i);
  const style = styleMatch ? styleMatch[1] : "";

  // Ellipse: CSS border-radius:50% (or border-radius: 50%).
  if (/border-radius\s*:\s*50%/.test(style)) {
    return "ellipse";
  }

  // Frame: transparent background.
  if (/background\s*:\s*transparent/.test(style)) {
    return "frame";
  }

  // Extract the layer name for additional hints.
  const layerNameMatch = openTag.match(
    /\bdata-agent-native-layer-name="([^"]*)"/i,
  );
  const layerName = layerNameMatch ? layerNameMatch[1] : "";

  // Frame: layer name starts with "Frame".
  if (/^frame/i.test(layerName)) {
    return "frame";
  }

  // Text: the element has no background-color-like value in the style, yet has
  // a color property — we detect this via the presence of "color:" without a
  // "background:" in the style.  Also check for the white-space:pre-wrap
  // pattern that text nodes emit.
  if (
    /white-space\s*:\s*pre-wrap/.test(style) ||
    (/\bcolor\s*:/.test(style) && !/\bbackground\s*:/.test(style))
  ) {
    return "text";
  }

  // Default: rectangle.
  return "rectangle";
}

/**
 * Infer the `data-an-primitive` kind value for a marker-less board `<svg>`
 * primitive from its inner geometry.  Returns `null` when no reliable signal
 * is present, in which case the SVG is left unmarked (it still classifies as a
 * generic shape via tag heuristics) rather than mis-classified.
 *
 * Conservative signals (in priority order):
 * - The path carries `marker-end` (the arrowhead reference)  → `"arrow"`
 * - The SVG contains a `<polygon>` element                   → `"polygon"`
 * - The SVG contains exactly a single `<path>` and nothing
 *   else shape-like                                          → `"path"`
 *
 * Geometry (points, path data, polygon points) is never inspected for sizing
 * and never altered — only the presence/type of child elements is consulted.
 */
function _inferSvgPrimitiveKind(inner: string): string | null {
  // Arrow: a path with a marker-end reference (the arrowhead).  The arrowhead
  // marker itself lives in <defs> as a separate path, so detect the consuming
  // `marker-end="url(...)"` attribute rather than the marker definition.
  if (/marker-end\s*=/.test(inner)) {
    return "arrow";
  }

  // Polygon / star: rendered with a <polygon> element.  Both kinds use the same
  // SVG element, so we conservatively report "polygon" (star geometry is a
  // polygon at the markup level and cannot be distinguished without sizing).
  if (/<polygon\b/i.test(inner)) {
    return "polygon";
  }

  // Pen-tool vector: a single <path> and no other shape elements.
  const pathCount = (inner.match(/<path\b/gi) ?? []).length;
  const hasOtherShape = /<(rect|circle|ellipse|line|polyline)\b/i.test(inner);
  if (pathCount === 1 && !hasOtherShape) {
    return "path";
  }

  // No reliable signal — leave unmarked.
  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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
