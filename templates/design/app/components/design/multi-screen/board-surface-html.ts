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
