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
// Poisoned nested-coordinate normalization
// ---------------------------------------------------------------------------

/**
 * Half-size of the board's oversized iframe surface (131072 / 2). The board
 * renderer shifts top-level board elements by this amount via a
 * `body > [data-agent-native-node-id]{translate:65536px 65536px}` rule
 * (DesignCanvas.tsx embeddedContentOffsetStyle) so board coordinate (0,0)
 * lands at the center of the surface.
 *
 * Historic bugs wrote NESTED board children's left/top in board-IFRAME
 * viewport coordinates (board coordinate + 65536) instead of parent-relative
 * coordinates — and, before the offset rule was scoped to top-level children,
 * the compounding translate could stack the offset more than once. The
 * helpers below detect and repair those persisted values.
 */
export const BOARD_SURFACE_CONTENT_OFFSET_PX = 65_536;

/**
 * How far from an exact 65536-multiple a coordinate may sit and still be
 * classified as "poisoned by the surface offset". Real poisoned values look
 * like `k * 65536 + boardCoordinate` where the board coordinate of actual
 * content is at most a few thousand px from origin; real parent-relative
 * coordinates of nested children are bounded by their parent's size (far
 * below this). A quarter of the offset is a comfortable margin on both sides.
 */
const BOARD_COORD_POISON_REMAINDER_MAX_PX = 16_384;

/**
 * Largest magnitude a rebased nested coordinate may have (when the parent's
 * size is unknown) before it is considered garbage and clamped back into the
 * parent's box. No sane nested child sits 16k px from its parent's origin.
 */
const BOARD_NESTED_COORD_SANE_MAX_PX = 16_384;

/**
 * Returns true when a persisted left/top value carries the board-surface
 * offset fingerprint: within BOARD_COORD_POISON_REMAINDER_MAX_PX of a
 * non-zero multiple of 65536.
 */
export function isBoardSurfacePoisonedCoord(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const k = Math.round(value / BOARD_SURFACE_CONTENT_OFFSET_PX);
  if (k === 0) return false;
  return (
    Math.abs(value - k * BOARD_SURFACE_CONTENT_OFFSET_PX) <=
    BOARD_COORD_POISON_REMAINDER_MAX_PX
  );
}

/**
 * Strips the board-surface offset from a coordinate when (and only when) it
 * carries the poison fingerprint; all other values pass through untouched.
 * `66904 → 1368`, `-65420 → 116`, `131172 → 100`, `250 → 250`.
 */
export function stripBoardSurfaceOffsetFromCoord(value: number): number {
  if (!isBoardSurfacePoisonedCoord(value)) return value;
  const k = Math.round(value / BOARD_SURFACE_CONTENT_OFFSET_PX);
  return value - k * BOARD_SURFACE_CONTENT_OFFSET_PX;
}

/**
 * Parent-relative position for a node being reparented INTO a target
 * container, from the two elements' persisted absolute positions in the same
 * coordinate space. This is the pure seam used by
 * `handleOverviewPrimitiveReparent` (DesignEditor.tsx).
 *
 * The flat subtraction below is only correct when both `source` and `target`
 * are already expressed in the SAME coordinate space — historically that
 * meant "both are direct children of the screen root", because callers used
 * to read a node's own inline left/top verbatim (parent-relative, not
 * root-relative). DesignEditor.tsx's `getAbsolutePositioningForNodeInHtml`
 * now resolves both inputs with an ancestor walk
 * (`authoredElementPosition`) up to the screen root before calling this, so
 * the subtraction is valid regardless of how deeply either node is nested —
 * dropping a node into a container that's itself nested inside another frame
 * no longer produces a garbage delta.
 *
 * Both inputs are also normalized with `stripBoardSurfaceOffsetFromCoord`
 * first: a source that was persisted in board-iframe viewport coordinates
 * (boardCoord + 65536 — see BOARD_SURFACE_CONTENT_OFFSET_PX) is rebased to
 * board space before subtracting the target's origin, so the child's new
 * left/top always comes out parent-relative regardless of which upstream
 * path produced the source position. For in-screen reparenting (small
 * screen-root coordinates on both sides) the strip is a no-op and this is a
 * plain subtraction.
 */
export function computeReparentedChildPosition(
  source: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  return {
    x:
      stripBoardSurfaceOffsetFromCoord(source.x) -
      stripBoardSurfaceOffsetFromCoord(target.x),
    y:
      stripBoardSurfaceOffsetFromCoord(source.y) -
      stripBoardSurfaceOffsetFromCoord(target.y),
  };
}

interface BoardWalkFrame {
  tagName: string;
  isNodeIdElement: boolean;
  left: number | null;
  top: number | null;
  width: number | null;
  height: number | null;
}

const BOARD_HTML_TAG_RE =
  /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'<>])*)\/?>/g;

/** Tags whose raw text content must not be tag-walked. */
const BOARD_RAW_TEXT_TAGS = new Set(["script", "style", "textarea"]);

function parseInlineStylePx(
  style: string,
  prop: "left" | "top" | "width" | "height",
): number | null {
  const match = style.match(
    new RegExp(
      `(?:^|;)\\s*${prop}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px\\s*(?=;|$)`,
      "i",
    ),
  );
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function replaceInlineStylePx(
  style: string,
  prop: "left" | "top",
  next: number,
): string {
  return style.replace(
    new RegExp(`((?:^|;)\\s*${prop}\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)px`, "i"),
    `$1${next}px`,
  );
}

function rebaseNestedBoardCoord(args: {
  value: number;
  ancestorOrigin: number;
  parentSize: number | null;
  childSize: number | null;
}): number {
  const { value, ancestorOrigin, parentSize, childSize } = args;
  if (!isBoardSurfacePoisonedCoord(value)) return value;
  // Two distinct historic poison shapes, distinguishable by the sign of the
  // offset multiple:
  // - k >= 1 (positive): value = k*65536 + boardCoordinate — the child's
  //   board/viewport-space position was written verbatim (container-drop
  //   persist path). Parent-relative = board coordinate minus the parent's
  //   accumulated board-space origin.
  // - k <= -1 (negative): value = parentRelative - 65536 — the bridge's
  //   rect-space nest rebase pre-compensated the (old, blanket) content
  //   translate. The stripped remainder already IS parent-relative; no
  //   ancestor subtraction. (A genuine board coordinate can never reach
  //   k <= -1 here: that would put content beyond the surface edge.)
  const k = Math.round(value / BOARD_SURFACE_CONTENT_OFFSET_PX);
  let rebased =
    stripBoardSurfaceOffsetFromCoord(value) - (k > 0 ? ancestorOrigin : 0);
  // Sanity clamp: exact recovery is possible for the common single-poison
  // case, but compounded corruption (the parent moved after the child's
  // position was written, multiple stacked offsets, user "fixes" made while
  // the content rendered off-world) can leave a rebased value that is still
  // far outside the parent. Pull those back into the parent's box so the
  // child is at least visible and re-editable — the alternative is an
  // element parked tens of thousands of px off-world.
  const sane =
    parentSize !== null
      ? rebased >= -parentSize && rebased <= 2 * parentSize
      : Math.abs(rebased) <= BOARD_NESTED_COORD_SANE_MAX_PX;
  if (!sane) {
    const max =
      parentSize !== null ? Math.max(0, parentSize - (childSize ?? 0)) : 0;
    rebased = Math.min(Math.max(0, rebased), max);
  }
  return Math.round(rebased);
}

/**
 * Repairs already-persisted board content whose NESTED children carry
 * left/top values poisoned by the board-surface offset (near-65536-multiple
 * values — see BOARD_SURFACE_CONTENT_OFFSET_PX).
 *
 * For each element that (a) carries `data-agent-native-node-id`, (b) has at
 * least one node-id-bearing ancestor inside `<body>` (i.e. is a nested board
 * child, never a top-level one — top-level children legitimately use raw
 * board coordinates), and (c) has a poisoned inline left and/or top:
 *
 * 1. the nearest 65536-multiple is stripped (recovering the board-space
 *    coordinate the value was written from),
 * 2. the accumulated origin of its node-id ancestor chain (using
 *    already-normalized ancestor values, walking outer→inner) is subtracted
 *    to produce a parent-relative coordinate, and
 * 3. values that are still implausible after rebasing are clamped into the
 *    parent's box.
 *
 * Everything else — non-poisoned coordinates, top-level children, elements
 * without node ids, all other markup — passes through byte-identical. The
 * function is pure, string-level (no DOM), and idempotent: normalized output
 * contains no poisoned values, so a second pass returns `changed: false`.
 *
 * Applied on board-content load/adopt (DesignEditor) so designs corrupted by
 * the historic nest-on-drop bugs self-heal the next time an editor opens
 * them, and as a post-reparent safety net.
 *
 * Detectability (finding 4): this repair is a heuristic rewrite of
 * already-persisted content with no built-in trace — a bad heuristic could
 * silently mis-rebase real content and nobody would know. The return value
 * includes `fixedNodeCount` and a small `samples` list (each node's original
 * vs. rebased left/top) so callers can log what actually happened; this
 * function itself stays side-effect-free (no console usage) so it remains
 * safely callable from any context (including the post-reparent safety-net
 * call sites, not just the load effect) — logging is the caller's job.
 */
const NORMALIZE_POISONED_COORDS_SAMPLE_LIMIT = 5;

export function normalizePoisonedBoardNestedCoords(html: string): {
  html: string;
  changed: boolean;
  fixedNodeCount: number;
  samples: Array<{
    nodeId: string | null;
    before: { left: number | null; top: number | null };
    after: { left: number | null; top: number | null };
  }>;
} {
  if (!html || !html.includes("data-agent-native-node-id")) {
    return { html, changed: false, fixedNodeCount: 0, samples: [] };
  }
  // Cheap pre-scan: a poisoned coordinate needs at least 5 digits
  // (|value| >= 65536 - 16384 = 49152).
  if (!/(?:left|top)\s*:\s*-?\d{5,}/i.test(html)) {
    return { html, changed: false, fixedNodeCount: 0, samples: [] };
  }

  const bodyStart = html.indexOf("<body");
  const bodyTagEnd = bodyStart === -1 ? -1 : html.indexOf(">", bodyStart);
  const walkStart = bodyTagEnd === -1 ? 0 : bodyTagEnd + 1;
  const bodyClose = html.lastIndexOf("</body>");
  const walkEnd = bodyClose === -1 ? html.length : bodyClose;

  const stack: BoardWalkFrame[] = [];
  let out = "";
  let cursor = 0;
  let changed = false;
  let fixedNodeCount = 0;
  const samples: Array<{
    nodeId: string | null;
    before: { left: number | null; top: number | null };
    after: { left: number | null; top: number | null };
  }> = [];

  BOARD_HTML_TAG_RE.lastIndex = walkStart;
  let match: RegExpExecArray | null;
  while ((match = BOARD_HTML_TAG_RE.exec(html)) !== null) {
    if (match.index >= walkEnd) break;
    const token = match[0];
    const tagName = match[1]?.toLowerCase();
    if (!tagName) continue; // comment

    if (token.startsWith("</")) {
      const index = stack.map((frame) => frame.tagName).lastIndexOf(tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }

    // Raw-text elements: skip their content wholesale so stray "<" inside
    // scripts/styles can't desync the walk.
    if (BOARD_RAW_TEXT_TAGS.has(tagName) && !token.endsWith("/>")) {
      const close = html.indexOf(`</${tagName}`, BOARD_HTML_TAG_RE.lastIndex);
      if (close === -1) break;
      BOARD_HTML_TAG_RE.lastIndex = close;
      continue;
    }

    const attrs = match[2] ?? "";
    const isNodeIdElement = /\bdata-agent-native-node-id\s*=/.test(attrs);
    const styleMatch = token.match(/(\bstyle\s*=\s*)("([^"]*)"|'([^']*)')/i);
    const style = styleMatch?.[3] ?? styleMatch?.[4] ?? "";
    let left = parseInlineStylePx(style, "left");
    let top = parseInlineStylePx(style, "top");
    const width = parseInlineStylePx(style, "width");
    const height = parseInlineStylePx(style, "height");

    const nodeIdAncestors = stack.filter((frame) => frame.isNodeIdElement);
    const isNestedBoardChild = isNodeIdElement && nodeIdAncestors.length > 0;
    const leftPoisoned =
      isNestedBoardChild && left !== null && isBoardSurfacePoisonedCoord(left);
    const topPoisoned =
      isNestedBoardChild && top !== null && isBoardSurfacePoisonedCoord(top);

    if ((leftPoisoned || topPoisoned) && styleMatch) {
      const parent = nodeIdAncestors[nodeIdAncestors.length - 1];
      const originX = nodeIdAncestors.reduce(
        (sum, frame) => sum + (frame.left ?? 0),
        0,
      );
      const originY = nodeIdAncestors.reduce(
        (sum, frame) => sum + (frame.top ?? 0),
        0,
      );
      const beforeLeft = left;
      const beforeTop = top;
      let nextStyle = style;
      if (leftPoisoned && left !== null) {
        left = rebaseNestedBoardCoord({
          value: left,
          ancestorOrigin: originX,
          parentSize: parent?.width ?? null,
          childSize: width,
        });
        nextStyle = replaceInlineStylePx(nextStyle, "left", left);
      }
      if (topPoisoned && top !== null) {
        top = rebaseNestedBoardCoord({
          value: top,
          ancestorOrigin: originY,
          parentSize: parent?.height ?? null,
          childSize: height,
        });
        nextStyle = replaceInlineStylePx(nextStyle, "top", top);
      }
      if (nextStyle !== style) {
        fixedNodeCount += 1;
        if (samples.length < NORMALIZE_POISONED_COORDS_SAMPLE_LIMIT) {
          const nodeIdMatch =
            /\bdata-agent-native-node-id\s*=\s*("([^"]*)"|'([^']*)')/.exec(
              attrs,
            );
          samples.push({
            nodeId: nodeIdMatch?.[2] ?? nodeIdMatch?.[3] ?? null,
            before: { left: beforeLeft, top: beforeTop },
            after: { left, top },
          });
        }
        const quote = styleMatch[2]?.startsWith("'") ? "'" : '"';
        const rewrittenToken =
          token.slice(0, styleMatch.index ?? 0) +
          styleMatch[1] +
          quote +
          nextStyle +
          quote +
          token.slice((styleMatch.index ?? 0) + styleMatch[0].length);
        out += html.slice(cursor, match.index) + rewrittenToken;
        cursor = match.index + token.length;
        changed = true;
      }
    }

    const selfClosing = token.endsWith("/>") || VOID_ELEMENTS.has(tagName);
    if (!selfClosing) {
      stack.push({ tagName, isNodeIdElement, left, top, width, height });
    }
  }

  if (!changed) return { html, changed: false, fixedNodeCount: 0, samples: [] };
  return {
    html: out + html.slice(cursor),
    changed: true,
    fixedNodeCount,
    samples,
  };
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
