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

import { parseFragment } from "parse5";

import type { BoardObjectEntry } from "./board-objects.js";
import { resolveLayerNameAttribute } from "./layer-name.js";
import {
  vectorEndpointAttributesMarkup,
  vectorEndpointDefsMarkup,
  vectorEndpointPairForPrimitive,
  VECTOR_END_ENDPOINT_PROPERTY,
  VECTOR_START_ENDPOINT_PROPERTY,
} from "./vector-endpoints.js";

export const BOARD_FILENAME = "__board__.html";

// guard:allow-raw-color — Figma's default shape paint (D9D9D9), independent of the document theme.
const DEFAULT_SHAPE_FILL = "rgb(217 217 217)";
const DEFAULT_SHAPE_STROKE = "rgb(168 168 168)";

const DEFAULT_LINE_STROKE = "#000000";
const DEFAULT_LINE_STROKE_WIDTH_PX = 1;

function getHtmlAttributeValue(tag: string, name: string): string {
  const element = parseFragment(tag).childNodes[0];
  if (!element || !("attrs" in element)) return "";
  return (
    element.attrs.find((attribute) => attribute.name === name.toLowerCase())
      ?.value ?? ""
  );
}

export function isBoardFile(filename: string): boolean {
  return filename === BOARD_FILENAME;
}

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
    startPoint,
    endPoint,
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

  const isAutoSizeText = kind === "text" && entry.autoSize === true;

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
    ` data-an-primitive="${escapeAttr(kind)}"`;

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
    const endpoints = vectorEndpointPairForPrimitive(
      kind,
      startPoint,
      endPoint,
    );
    const endpointStyle = `;${VECTOR_START_ENDPOINT_PROPERTY}:${endpoints.startPoint};${VECTOR_END_ENDPOINT_PROPERTY}:${endpoints.endPoint}`;
    const markerDefs = vectorEndpointDefsMarkup(nodeId, endpoints);
    const markerAttributes = vectorEndpointAttributesMarkup(nodeId, endpoints);

    const viewBoxAttr = pathData
      ? ` viewBox="${x} ${y} ${width} ${height}"`
      : "";

    return `<svg style="${baseStyle}${endpointStyle}" xmlns="http://www.w3.org/2000/svg" overflow="visible"${viewBoxAttr} ${dataAttrs}>${markerDefs}<path d="${escapeAttr(d)}" fill="${escapeAttr(fill ?? "none")}" stroke="${escapeAttr(strokeColor)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${markerAttributes}/></svg>`;
  }

  if (kind === "ellipse") {
    const bgColor = fill ?? DEFAULT_SHAPE_FILL;
    const borderStyle = stroke
      ? `border:${strokeWidth ?? 1}px solid ${stroke};`
      : `border:1px solid ${DEFAULT_SHAPE_STROKE};`;
    const style = `${baseStyle};background:${bgColor};border-radius:50%;${borderStyle}`;
    return `<div style="${style}" ${dataAttrs}></div>`;
  }

  if (kind === "text") {
    const color = fill ?? "inherit";
    const style = `${baseStyle};color:${color};white-space:pre-wrap;font-size:16px;line-height:1.2;`;
    return `<div style="${style}" ${dataAttrs}>${text ? escapeHtml(text) : ""}</div>`;
  }

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
 * | Inline style contains `background:transparent` or no background, but has a layer-name attribute starting with "Frame" | `"frame"` |
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
  if (!html.includes("data-agent-native-node-id=")) return html;

  const bodyStart = html.indexOf("<body");
  if (bodyStart === -1) return html;
  const bodyTagEnd = html.indexOf(">", bodyStart);
  if (bodyTagEnd === -1) return html;

  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose === -1) return html;

  const before = html.slice(0, bodyTagEnd + 1);
  const children = html.slice(bodyTagEnd + 1, bodyClose);
  const after = html.slice(bodyClose);

  const patched = _patchDirectChildren(children);
  if (patched === children) return html;
  return before + patched + after;
}

function _patchDirectChildren(fragment: string): string {
  let result = "";
  let pos = 0;

  while (pos < fragment.length) {
    const tagStart = fragment.indexOf("<", pos);
    if (tagStart === -1) {
      result += fragment.slice(pos);
      break;
    }

    result += fragment.slice(pos, tagStart);
    pos = tagStart;

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

    const tagEnd = _findTagEnd(fragment, pos);
    if (tagEnd === -1) {
      result += fragment.slice(pos);
      break;
    }

    const openTag = fragment.slice(pos, tagEnd + 1);

    const tagNameMatch = openTag.match(/^<([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!tagNameMatch) {
      result += openTag;
      pos = tagEnd + 1;
      continue;
    }
    const tagName = tagNameMatch[1].toLowerCase();

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

    const shouldPatch =
      openTag.includes("data-agent-native-node-id=") &&
      !openTag.includes("data-an-primitive=");

    let patchedOpenTag = openTag;
    if (shouldPatch) {
      const kind = _inferPrimitiveKind(openTag);
      patchedOpenTag = openTag.replace(
        /(\s*\/?>)$/,
        ` data-an-primitive="${kind}"$1`,
      );
    }

    const isSelfClosing = openTag.endsWith("/>") || VOID_ELEMENTS.has(tagName);
    if (isSelfClosing) {
      result += patchedOpenTag;
      pos = tagEnd + 1;
      continue;
    }

    const closeTag = `</${tagName}>`;
    const closeIdx = _findMatchingClose(fragment, tagEnd + 1, tagName);
    if (closeIdx === -1) {
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

function _findTagEnd(html: string, start: number): number {
  let i = start + 1;
  while (i < html.length) {
    const ch = html[i];
    if (ch === ">") return i;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < html.length && html[i] !== quote) i++;
      if (i < html.length) i++;
      continue;
    }
    i++;
  }
  return -1;
}

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
    openRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = html.indexOf(closeTag, pos);

    if (nextClose === -1) return -1;

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

function _inferPrimitiveKind(openTag: string): string {
  const styleMatch = openTag.match(/\bstyle="([^"]*)"/i);
  const style = styleMatch ? styleMatch[1] : "";

  if (/border-radius\s*:\s*50%/.test(style)) {
    return "ellipse";
  }

  if (/background\s*:\s*transparent/.test(style)) {
    return "frame";
  }

  const layerName =
    resolveLayerNameAttribute((attribute) =>
      getHtmlAttributeValue(openTag, attribute),
    )?.value ?? "";

  if (/^frame/i.test(layerName)) {
    return "frame";
  }

  if (
    /white-space\s*:\s*pre-wrap/.test(style) ||
    (/\bcolor\s*:/.test(style) && !/\bbackground\s*:/.test(style))
  ) {
    return "text";
  }

  return "rectangle";
}

function _inferSvgPrimitiveKind(inner: string): string | null {
  if (/marker-end\s*=/.test(inner)) {
    return "arrow";
  }

  if (/<polygon\b/i.test(inner)) {
    return "polygon";
  }

  const pathCount = (inner.match(/<path\b/gi) ?? []).length;
  const hasOtherShape = /<(rect|circle|ellipse|line|polyline)\b/i.test(inner);
  if (pathCount === 1 && !hasOtherShape) {
    return "path";
  }

  return null;
}

export const BOARD_SURFACE_CONTENT_OFFSET_PX = 65_536;

const BOARD_COORD_POISON_REMAINDER_MAX_PX = 16_384;

const BOARD_NESTED_COORD_SANE_MAX_PX = 16_384;

export function isBoardSurfacePoisonedCoord(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const k = Math.round(value / BOARD_SURFACE_CONTENT_OFFSET_PX);
  if (k === 0) return false;
  return (
    Math.abs(value - k * BOARD_SURFACE_CONTENT_OFFSET_PX) <=
    BOARD_COORD_POISON_REMAINDER_MAX_PX
  );
}

export function stripBoardSurfaceOffsetFromCoord(value: number): number {
  if (!isBoardSurfacePoisonedCoord(value)) return value;
  const k = Math.round(value / BOARD_SURFACE_CONTENT_OFFSET_PX);
  return value - k * BOARD_SURFACE_CONTENT_OFFSET_PX;
}

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
  const k = Math.round(value / BOARD_SURFACE_CONTENT_OFFSET_PX);
  let rebased =
    stripBoardSurfaceOffsetFromCoord(value) - (k > 0 ? ancestorOrigin : 0);
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
    if (!tagName) continue;

    if (token.startsWith("</")) {
      const index = stack.map((frame) => frame.tagName).lastIndexOf(tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }

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
