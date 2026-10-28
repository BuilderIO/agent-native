import { parse } from "parse5";

const PRIMITIVE_ATTRIBUTE = "data-an-primitive";
const LAYER_NAME_ATTRIBUTE = "data-agent-native-layer-name";
const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const LOCKED_ATTRIBUTE = "data-agent-native-locked";
const EDITABLE_SVG_PRIMITIVE = "pasted-svg";
// Icons stay one layer; anything with an edge at least this long is artwork.
const MIN_ARTWORK_EDGE = 64;
const MAX_USE_DEPTH = 8;
const DRAWABLE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "use",
  "image",
]);
const RESOURCE_TAGS = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
  "filter",
]);
const RAW_TEXT_TAGS = new Set(["style", "script"]);
const USE_GEOMETRY_ATTRIBUTES = new Set(["href", "x", "y", "width", "height"]);
const LOCAL_URL_REFERENCE = /url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g;

type HtmlAttribute = { name: string; value: string; prefix?: string };

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode | null;
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { startOffset: number; endOffset: number };
  } | null;
};

type SourceEdit = { start: number; end: number; text: string };

type Box = { x: number; y: number; width: number; height: number };

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((attr) => attr.name === name)?.value ?? null;
}

function children(node: HtmlNode): HtmlNode[] {
  return node.childNodes ?? [];
}

function isElement(node: HtmlNode): boolean {
  return typeof node.tagName === "string";
}

function descendants(node: HtmlNode): HtmlNode[] {
  const found: HtmlNode[] = [];
  const pending = [...children(node)].reverse();
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (!isElement(next)) continue;
    found.push(next);
    pending.push(...[...children(next)].reverse());
  }
  return found;
}

function number(value: string | null): number | null {
  if (value === null) return null;
  const match = /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(?:px)?\s*$/i.exec(value);
  return match ? Number(match[1]) : null;
}

function styleLength(node: HtmlNode, property: string): number | null {
  for (const declaration of (attribute(node, "style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    if (declaration.slice(0, colon).trim().toLowerCase() !== property) continue;
    return number(declaration.slice(colon + 1));
  }
  return null;
}

function viewBox(node: HtmlNode): Box | null {
  const parts = (attribute(node, "viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function longestEdge(svg: HtmlNode): number {
  const width = styleLength(svg, "width") ?? number(attribute(svg, "width"));
  const height = styleLength(svg, "height") ?? number(attribute(svg, "height"));
  if (width !== null || height !== null) {
    return Math.max(width ?? 0, height ?? 0);
  }
  const box = viewBox(svg);
  return box ? Math.max(box.width, box.height) : 0;
}

function insideResource(node: HtmlNode, root: HtmlNode): boolean {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent === root) return false;
    if (parent.tagName && RESOURCE_TAGS.has(parent.tagName)) return true;
  }
  return false;
}

function isLocked(node: HtmlNode): boolean {
  for (let current: HtmlNode | null | undefined = node; current; ) {
    if (attribute(current, LOCKED_ATTRIBUTE) === "true") return true;
    current = current.parentNode;
  }
  return false;
}

function isArtworkSvg(svg: HtmlNode): boolean {
  if (attribute(svg, PRIMITIVE_ATTRIBUTE) !== null) return false;
  if (isLocked(svg)) return false;
  if (longestEdge(svg) < MIN_ARTWORK_EDGE) return false;
  const inner = descendants(svg);
  if (inner.some((node) => node.tagName === "foreignObject")) return false;
  return inner.some(
    (node) =>
      DRAWABLE_TAGS.has(node.tagName ?? "") && !insideResource(node, svg),
  );
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function qualifiedName(attr: HtmlAttribute): string {
  return attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function viewBoxTransform(
  box: Box,
  width: number,
  height: number,
  preserveAspectRatio: string | null,
): string {
  const [align = "xMidYMid", meetOrSlice = "meet"] = (preserveAspectRatio ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let scaleX = width / box.width;
  let scaleY = height / box.height;
  let x = 0;
  let y = 0;
  if (align !== "none") {
    const scale =
      meetOrSlice === "slice"
        ? Math.max(scaleX, scaleY)
        : Math.min(scaleX, scaleY);
    scaleX = scale;
    scaleY = scale;
    const spareX = width - box.width * scale;
    const spareY = height - box.height * scale;
    if (align.startsWith("xMid")) x = spareX / 2;
    else if (align.startsWith("xMax")) x = spareX;
    if (align.endsWith("YMid")) y = spareY / 2;
    else if (align.endsWith("YMax")) y = spareY;
  }
  x -= box.x * scaleX;
  y -= box.y * scaleY;
  const parts: string[] = [];
  if (round(x) !== 0 || round(y) !== 0) {
    parts.push(`translate(${round(x)} ${round(y)})`);
  }
  if (round(scaleX) !== 1 || round(scaleY) !== 1) {
    parts.push(
      round(scaleX) === round(scaleY)
        ? `scale(${round(scaleX)})`
        : `scale(${round(scaleX)} ${round(scaleY)})`,
    );
  }
  return parts.join(" ");
}

function hrefTarget(use: HtmlNode): string | null {
  const href = use.attrs?.find((attr) => attr.name === "href")?.value.trim();
  return href?.startsWith("#") && href.length > 1 ? href.slice(1) : null;
}

class UseExpander {
  private readonly usedIds: Set<string>;
  private instance = 0;

  constructor(private readonly byId: Map<string, HtmlNode>) {
    this.usedIds = new Set(byId.keys());
  }

  expand(use: HtmlNode, chain: string[] = []): string | null {
    const id = hrefTarget(use);
    const target = id ? this.byId.get(id) : undefined;
    if (!id || !target || chain.includes(id) || chain.length >= MAX_USE_DEPTH) {
      return null;
    }
    const scope = this.scopeIds(target);
    const nextChain = [...chain, id];
    const x = number(attribute(use, "x")) ?? 0;
    const y = number(attribute(use, "y")) ?? 0;
    const transforms = [attribute(use, "transform") ?? ""];
    if (x !== 0 || y !== 0) transforms.push(`translate(${x} ${y})`);
    let content: string;
    if (target.tagName === "symbol" || target.tagName === "svg") {
      const box = viewBox(target);
      const width =
        number(attribute(use, "width")) ??
        number(attribute(target, "width")) ??
        box?.width;
      const height =
        number(attribute(use, "height")) ??
        number(attribute(target, "height")) ??
        box?.height;
      if (box && width && height) {
        transforms.push(
          viewBoxTransform(
            box,
            width,
            height,
            attribute(target, "preserveAspectRatio"),
          ),
        );
      }
      content = children(target)
        .map((child) => this.serialize(child, scope, nextChain))
        .join("");
    } else {
      content = this.serialize(target, scope, nextChain, { dropId: true });
    }
    const attributes = (use.attrs ?? [])
      .filter(
        (attr) =>
          !USE_GEOMETRY_ATTRIBUTES.has(attr.name) &&
          attr.name !== "transform" &&
          attr.name !== NODE_ID_ATTRIBUTE,
      )
      .map(
        (attr) => ` ${qualifiedName(attr)}="${escapeAttribute(attr.value)}"`,
      );
    if (attribute(use, LAYER_NAME_ATTRIBUTE) === null) {
      attributes.push(` ${LAYER_NAME_ATTRIBUTE}="${escapeAttribute(id)}"`);
    }
    const transform = transforms.filter(Boolean).join(" ").trim();
    if (transform)
      attributes.push(` transform="${escapeAttribute(transform)}"`);
    return `<g${attributes.join("")}>${content}</g>`;
  }

  // Each expansion gets its own copy of the ids inside the referenced
  // element, so gradients and clips it owns still resolve and never collide.
  private scopeIds(target: HtmlNode): Map<string, string> {
    this.instance += 1;
    const scope = new Map<string, string>();
    for (const node of descendants(target)) {
      const id = attribute(node, "id");
      if (!id || scope.has(id)) continue;
      let scoped = `${id}-${this.instance}`;
      while (this.usedIds.has(scoped)) scoped = `${scoped}-${this.instance}`;
      this.usedIds.add(scoped);
      scope.set(id, scoped);
    }
    return scope;
  }

  private serialize(
    node: HtmlNode,
    scope: Map<string, string>,
    chain: string[],
    options: { dropId?: boolean } = {},
  ): string {
    if (node.nodeName === "#text") {
      const parent = node.parentNode?.tagName;
      return parent && RAW_TEXT_TAGS.has(parent)
        ? (node.value ?? "")
        : escapeText(node.value ?? "");
    }
    if (!isElement(node)) return "";
    if (node.tagName === "use") {
      const expanded = this.expand(node, chain);
      if (expanded !== null) return expanded;
    }
    const attributes = (node.attrs ?? [])
      .filter(
        (attr) =>
          attr.name !== NODE_ID_ATTRIBUTE &&
          !(options.dropId && attr.name === "id"),
      )
      .map((attr) => {
        let value = attr.value;
        if (attr.name === "id") value = scope.get(value) ?? value;
        else if (attr.name === "href" && value.startsWith("#")) {
          value = `#${scope.get(value.slice(1)) ?? value.slice(1)}`;
        } else {
          value = value.replace(
            LOCAL_URL_REFERENCE,
            (reference, quote: string, id: string) => {
              const scoped = scope.get(id);
              return scoped ? `url(${quote}#${scoped}${quote})` : reference;
            },
          );
        }
        return ` ${qualifiedName(attr)}="${escapeAttribute(value)}"`;
      })
      .join("");
    const content = children(node)
      .map((child) => this.serialize(child, scope, chain))
      .join("");
    return `<${node.tagName}${attributes}>${content}</${node.tagName}>`;
  }
}

function applyEdits(source: string, edits: SourceEdit[]): string {
  let result = source;
  let previousStart = source.length + 1;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end > previousStart) {
      throw new Error("Authored SVG layer edits overlap.");
    }
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    previousStart = edit.start;
  }
  return result;
}

/**
 * Marks illustration-sized inline `<svg>` artwork the agent authored as an
 * editable vector group, so each shape is its own layer, and expands its
 * `<use>` references into real shapes the user can select and restyle.
 * Icon-sized SVGs and SVGs already owned by an editor primitive are left
 * alone.
 */
export function promoteAuthoredSvgArtworkInHtml(html: string): {
  content: string;
  promoted: number;
} {
  if (!/<svg[\s>]/i.test(html)) return { content: html, promoted: 0 };
  const document = parse(html, {
    sourceCodeLocationInfo: true,
  }) as unknown as HtmlNode;
  const elements = descendants(document);
  const byId = new Map<string, HtmlNode>();
  for (const element of elements) {
    const id = attribute(element, "id");
    if (id && !byId.has(id)) byId.set(id, element);
  }
  const topLevelSvgs = elements.filter((element) => {
    if (element.tagName !== "svg") return false;
    for (let parent = element.parentNode; parent; parent = parent.parentNode) {
      if (parent.tagName === "svg") return false;
    }
    return true;
  });
  const expander = new UseExpander(byId);
  const edits: SourceEdit[] = [];
  let promoted = 0;
  for (const svg of topLevelSvgs) {
    const startTag = svg.sourceCodeLocation?.startTag;
    if (!startTag || !isArtworkSvg(svg)) continue;
    const selfClosing = html
      .slice(startTag.startOffset, startTag.endOffset)
      .trimEnd()
      .endsWith("/>");
    const insertAt = selfClosing
      ? html.lastIndexOf("/", startTag.endOffset)
      : startTag.endOffset - 1;
    edits.push({
      start: insertAt,
      end: insertAt,
      text: ` ${PRIMITIVE_ATTRIBUTE}="${EDITABLE_SVG_PRIMITIVE}"`,
    });
    for (const use of descendants(svg)) {
      if (use.tagName !== "use" || insideResource(use, svg)) continue;
      if (use.parentNode?.tagName === "use") continue;
      const location = use.sourceCodeLocation;
      if (!location) continue;
      const expanded = expander.expand(use);
      if (expanded === null) continue;
      edits.push({
        start: location.startOffset,
        end: location.endOffset,
        text: expanded,
      });
    }
    promoted += 1;
  }
  if (promoted === 0) return { content: html, promoted: 0 };
  return { content: applyEdits(html, edits), promoted };
}
