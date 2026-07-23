import type { FrameGeometry } from "./types";

export function hasBoardSurfaceContent(html: string | undefined) {
  if (!html) return false;
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch?.[1] ?? html;
  return content.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

const BOARD_SURFACE_RENDER_STYLE = `<style data-agent-native-board-surface-render>html,body{background:transparent!important;background-color:transparent!important;background-image:none!important;}body{margin:0!important;position:relative;overflow:visible;}body>:not([data-agent-native-node-id]):not(style):not(script),body>[data-agent-native-node-id]:not([data-an-primitive]):not([data-agent-native-preserve-styles="true"]):has([data-agent-native-node-id]),body>[data-agent-native-node-id="body"],body>[data-agent-native-node-id="Body"],body>[data-agent-native-layer-name="body"],body>[data-agent-native-layer-name="Body"],body>[data-agent-native-layer-name="<body>"]{background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;}[data-agent-native-board-backdrop-candidate="true"]{display:none!important;pointer-events:none!important;}</style>`;
export const BOARD_SURFACE_BACKGROUND = "hsl(0 0% 10%)";

const BOARD_SURFACE_BACKDROP_MIN_EDGE_PX = 2400;
const BOARD_SURFACE_BACKDROP_MIN_AREA_PX = 8_000_000;
const HTML_VOID_TAGS = new Set([
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
const HTML_TAG_RE = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)([^<>]*?)\/?>/g;

function getHtmlAttributeValue(tag: string, name: string) {
  const match = tag.match(
    new RegExp(
      `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
      "i",
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function getCssDeclarationValue(style: string, name: string) {
  const match = style.match(
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"),
  );
  return match?.[1]?.trim() ?? "";
}

function getCssPixelValue(style: string, name: string) {
  const value = getCssDeclarationValue(style, name);
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Returns the canvas-space bounds occupied by top-level board nodes.
 *
 * Board coordinates are persisted directly in each root node's absolute
 * `left`/`top`. Keeping this parser string-only makes it usable during SSR and
 * in the jsdom-less unit suite, while restricting the scan to root nodes keeps
 * nested children from being counted twice with parent-relative coordinates.
 */
export function getBoardSurfaceContentBounds(
  html: string | undefined,
): FrameGeometry | null {
  if (!html) return null;

  const stack: Array<{
    tagName: string;
    nodeId: string;
    offsetX: number;
    offsetY: number;
  }> = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const match of html.matchAll(HTML_TAG_RE)) {
    const token = match[0];
    const tagName = match[1]?.toLowerCase();
    if (!tagName) continue;

    if (token.startsWith("</")) {
      const index = findLastHtmlStackTagIndex(stack, tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }

    const nodeId = getHtmlAttributeValue(token, "data-agent-native-node-id");
    const style = getHtmlAttributeValue(token, "style");
    const left = getCssPixelValue(style, "left") ?? 0;
    const top = getCssPixelValue(style, "top") ?? 0;
    const parentOffsetX = stack.reduce(
      (total, entry) => total + entry.offsetX,
      0,
    );
    const parentOffsetY = stack.reduce(
      (total, entry) => total + entry.offsetY,
      0,
    );
    const isDocumentRootTag =
      tagName === "html" ||
      tagName === "body" ||
      tagName === "style" ||
      tagName === "script";
    if (nodeId && !isDocumentRootTag && !isAccidentalBoardBackdropTag(token)) {
      const primitiveKind = getHtmlAttributeValue(
        token,
        "data-an-primitive",
      ).toLowerCase();
      // Auto-sized text has no persisted width/height. A one-pixel extent is
      // not enough when it sits near a render-window edge. Reserve a modest
      // intrinsic text box; the camera viewport remains the final authority
      // for unusually long content.
      const fallbackWidth = primitiveKind === "text" ? 256 : 1;
      const fallbackHeight = primitiveKind === "text" ? 64 : 1;
      const width = Math.max(
        1,
        getCssPixelValue(style, "width") ?? fallbackWidth,
      );
      const height = Math.max(
        1,
        getCssPixelValue(style, "height") ?? fallbackHeight,
      );
      const absoluteLeft = parentOffsetX + left;
      const absoluteTop = parentOffsetY + top;
      minX = Math.min(minX, absoluteLeft);
      minY = Math.min(minY, absoluteTop);
      maxX = Math.max(maxX, absoluteLeft + width);
      maxY = Math.max(maxY, absoluteTop + height);
    }

    const selfClosing = token.endsWith("/>") || HTML_VOID_TAGS.has(tagName);
    if (!selfClosing) {
      stack.push({ tagName, nodeId, offsetX: left, offsetY: top });
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function parseCssColor(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "transparent") return null;
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/,
  );
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if (alpha <= 0) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as const;
  }
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex?.[1]) return null;
  const raw = hex[1];
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => part + part)
          .join("")
      : raw;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ] as const;
}

function isNeutralBackdropColor(value: string) {
  const color = parseCssColor(value);
  if (!color) return false;
  const max = Math.max(...color);
  const min = Math.min(...color);
  return min >= 180 && max - min <= 24;
}

function isAccidentalBoardBackdropTag(tag: string) {
  if (
    getHtmlAttributeValue(tag, "data-agent-native-board-backdrop-candidate")
  ) {
    return false;
  }
  const primitive = getHtmlAttributeValue(
    tag,
    "data-an-primitive",
  ).toLowerCase();
  if (primitive !== "rectangle" && primitive !== "rect") return false;
  const style = getHtmlAttributeValue(tag, "style");
  if (!style) return false;
  const width = getCssPixelValue(style, "width");
  const height = getCssPixelValue(style, "height");
  if (width === null || height === null) return false;
  if (
    width < BOARD_SURFACE_BACKDROP_MIN_EDGE_PX ||
    height < BOARD_SURFACE_BACKDROP_MIN_EDGE_PX ||
    width * height < BOARD_SURFACE_BACKDROP_MIN_AREA_PX
  ) {
    return false;
  }
  const background =
    getCssDeclarationValue(style, "background-color") ||
    getCssDeclarationValue(style, "background");
  return isNeutralBackdropColor(background);
}

function markAccidentalBoardBackdropCandidates(html: string) {
  return html.replace(HTML_TAG_RE, (tag: string, tagName?: string) => {
    if (!tagName || tag.startsWith("</")) return tag;
    if (!isAccidentalBoardBackdropTag(tag)) return tag;
    return tag.replace(
      /\/?>$/,
      (ending) => ` data-agent-native-board-backdrop-candidate="true"${ending}`,
    );
  });
}

function findLastHtmlStackTagIndex(
  stack: Array<{ tagName: string; nodeId: string }>,
  tagName: string,
) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.tagName === tagName) return i;
  }
  return -1;
}

function getCurrentLayerParentNodeId(
  stack: Array<{ tagName: string; nodeId: string }>,
) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const nodeId = stack[i]?.nodeId;
    if (nodeId) return nodeId;
  }
  return "body";
}

export function getBoardSurfaceRenderContent(html: string) {
  if (!html) return html;
  const renderHtml = markAccidentalBoardBackdropCandidates(html);
  if (renderHtml.includes("data-agent-native-board-surface-render")) {
    return renderHtml;
  }
  if (/<\/head>/i.test(html)) {
    return renderHtml.replace(
      /<\/head>/i,
      `${BOARD_SURFACE_RENDER_STYLE}</head>`,
    );
  }
  if (/<body\b/i.test(html)) {
    return renderHtml.replace(/<body\b/i, `${BOARD_SURFACE_RENDER_STYLE}<body`);
  }
  return `${BOARD_SURFACE_RENDER_STYLE}${renderHtml}`;
}

function stripExecutableStaticPreviewContent(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "") // i18n-ignore static-preview sanitizer regex, not visible UI copy
    .replace(/<script\b[^>]*\/?\s*>/gi, "")
    .replace(/<(iframe|object|audio|video)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "") // i18n-ignore static-preview sanitizer regex, not visible UI copy
    .replace(/<(?:iframe|object|embed|audio|video|source)\b[^>]*\/?\s*>/gi, "")
    .replace(/<(?:link|meta|base)\b[^>]*>/gi, "")
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*[^;]*;/gi, "")
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, "none")
    .replace(/<(?:img|image|use)\b[^>]*>/gi, (tag) =>
      tag.replace(
        /\s+(?:src|srcset|href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
        "",
      ),
    )
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * Produces the inert, compressed document painted behind the live board
 * window at very low zoom. The document is also rendered in an iframe with an
 * empty sandbox, but removing executable markup here is defense in depth and
 * guarantees Alpine/React never starts a duplicate runtime.
 *
 * Root offsets use the same `translate` seam as the interactive finite board
 * iframe. Scaling the body into a small browser-safe viewport makes the whole
 * logical board paintable without allocating or scrolling a 131k iframe.
 */
export function getBoardSurfaceStaticPreviewContent(args: {
  html: string;
  logicalGeometry: FrameGeometry;
  viewport: { width: number; height: number };
}) {
  const renderHtml = stripExecutableStaticPreviewContent(
    getBoardSurfaceRenderContent(args.html),
  );
  const width = Math.max(1, args.logicalGeometry.width);
  const height = Math.max(1, args.logicalGeometry.height);
  const viewportWidth = Math.max(1, args.viewport.width);
  const viewportHeight = Math.max(1, args.viewport.height);
  const scale = Math.min(viewportWidth / width, viewportHeight / height);
  const offsetX = -args.logicalGeometry.x;
  const offsetY = -args.logicalGeometry.y;
  const style = `<style data-agent-native-board-static-preview>*,*::before,*::after{animation:none!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;}html{width:${viewportWidth}px!important;height:${viewportHeight}px!important;overflow:hidden!important;}body{margin:0!important;width:${width}px!important;height:${height}px!important;overflow:visible!important;transform:scale(${scale})!important;transform-origin:0 0!important;}body>[data-agent-native-node-id]{translate:${offsetX}px ${offsetY}px!important;}</style>`;
  if (/<\/head>/i.test(renderHtml)) {
    return renderHtml.replace(/<\/head>/i, `${style}</head>`);
  }
  if (/<body\b/i.test(renderHtml)) {
    return renderHtml.replace(/<body\b/i, `${style}<body`);
  }
  return `${style}${renderHtml}`;
}

/** Simple djb2-xor string hash, used to build cheap cache keys elsewhere in
 *  the multi-screen canvas (board content signatures, primitive-parse cache
 *  keys, etc). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // h = h * 33 ^ charCode  (djb2 xor variant)
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep as unsigned 32-bit
  }
  return h.toString(16);
}

export function getBoardContentLayerSignature(html: string) {
  const layers: string[] = [];
  const stack: Array<{ tagName: string; nodeId: string }> = [];
  const childCountsByParent = new Map<string, number>();

  for (const match of html.matchAll(HTML_TAG_RE)) {
    const token = match[0];
    const tagName = match[1]?.toLowerCase();
    if (!tagName) continue;

    if (token.startsWith("</")) {
      const index = findLastHtmlStackTagIndex(stack, tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }

    const nodeId = getHtmlAttributeValue(token, "data-agent-native-node-id");
    if (nodeId) {
      const parentNodeId = getCurrentLayerParentNodeId(stack);
      const childIndex = childCountsByParent.get(parentNodeId) ?? 0;
      childCountsByParent.set(parentNodeId, childIndex + 1);
      layers.push(`${nodeId}<${parentNodeId}#${childIndex}`);
    }

    const selfClosing = token.endsWith("/>") || HTML_VOID_TAGS.has(tagName);
    if (!selfClosing) stack.push({ tagName, nodeId });
  }

  return `${layers.length}:${hashString(layers.join("\n"))}`;
}

export function getBoardContentKey(args: {
  boardFileId: string;
  boardFileContent: string;
  boardIsActive: boolean;
}) {
  return `${args.boardFileId}:surface`;
}
