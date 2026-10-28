import { parse } from "parse5";

const PRIMITIVE_ATTRIBUTE = "data-an-primitive";
const LAYER_NAME_ATTRIBUTE = "data-agent-native-layer-name";
const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const LOCKED_ATTRIBUTE = "data-agent-native-locked";
const EDITABLE_SVG_PRIMITIVE = "pasted-svg";
// Icons stay one layer; anything with an edge at least this long is artwork.
const MIN_ARTWORK_EDGE = 64;
const MAX_USE_DEPTH = 8;
// Nested `<use>` copies multiply, so cap the shapes one screen can gain.
const MAX_EXPANDED_ELEMENTS = 2000;
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
// The instance's geometry, which the expansion turns into a transform.
const VIEWPORT_ATTRIBUTES = new Set([
  "id",
  "x",
  "y",
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
  "refX",
  "refY",
  NODE_ID_ATTRIBUTE,
]);
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

type Size = { width: number; height: number };

class ExpansionBudgetExceeded extends Error {}

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

// `undefined` when the attribute is absent, `null` when it is set to a value
// that can't be resolved to user units here.
function length(
  value: string | null,
  reference: number | undefined,
): number | null | undefined {
  if (value === null || value.trim() === "auto") return undefined;
  const absolute = number(value);
  if (absolute !== null) return absolute;
  const percent = /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/.exec(value);
  return percent && reference !== undefined
    ? (Number(percent[1]) * reference) / 100
    : null;
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

function viewportSize(svg: HtmlNode): Size | null {
  const box = viewBox(svg);
  if (box) return { width: box.width, height: box.height };
  const width = number(attribute(svg, "width"));
  const height = number(attribute(svg, "height"));
  return width !== null && height !== null ? { width, height } : null;
}

function nearestViewport(node: HtmlNode): Size | null {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent.tagName === "svg") return viewportSize(parent);
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  private remaining = MAX_EXPANDED_ELEMENTS;

  constructor(
    private readonly byId: Map<string, HtmlNode>,
    private readonly styleText: string,
  ) {
    this.usedIds = new Set(byId.keys());
  }

  /** Returns null when the `<use>` should stay as written. */
  expandInPlace(use: HtmlNode): string | null {
    if (this.remaining <= 0) return null;
    try {
      return this.expand(use, nearestViewport(use));
    } catch (error) {
      if (error instanceof ExpansionBudgetExceeded) return null;
      throw error;
    }
  }

  private expand(
    use: HtmlNode,
    viewport: Size | null,
    chain: string[] = [],
  ): string | null {
    const id = hrefTarget(use);
    const target = id ? this.byId.get(id) : undefined;
    if (!id || !target || chain.includes(id) || chain.length >= MAX_USE_DEPTH) {
      return null;
    }
    if (this.isSelectedById(target, id)) return null;
    const x = length(attribute(use, "x"), viewport?.width);
    const y = length(attribute(use, "y"), viewport?.height);
    if (x === null || y === null) return null;
    const transforms = [attribute(use, "transform") ?? ""];
    if (x || y) transforms.push(`translate(${x ?? 0} ${y ?? 0})`);
    const nextChain = [...chain, id];
    let content: string;
    if (target.tagName === "symbol" || target.tagName === "svg") {
      if (attribute(target, "transform") !== null) return null;
      const instance = this.instanceViewport(use, target, viewport);
      if (!instance) return null;
      transforms.push(...instance.transforms);
      const scope = this.scopeIds(target);
      content = children(target)
        .map((child) => this.serialize(child, scope, nextChain, instance.inner))
        .join("");
      // The referenced root's own paint and style still cascade to its shapes.
      const inherited = this.serializeAttributes(
        (target.attrs ?? []).filter(
          (attr) => !VIEWPORT_ATTRIBUTES.has(attr.name),
        ),
        scope,
      );
      if (inherited) content = `<g${inherited}>${content}</g>`;
    } else {
      const scope = this.scopeIds(target);
      content = this.serialize(target, scope, nextChain, viewport, {
        dropId: true,
      });
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

  // A symbol or nested svg instance is sized by the use, then by its own
  // width and height, then fills the viewport it is drawn in (100%).
  private instanceViewport(
    use: HtmlNode,
    target: HtmlNode,
    viewport: Size | null,
  ): { transforms: string[]; inner: Size | null } | null {
    const offsetX = length(attribute(target, "x"), viewport?.width);
    const offsetY = length(attribute(target, "y"), viewport?.height);
    const ownWidth = length(attribute(target, "width"), viewport?.width);
    const ownHeight = length(attribute(target, "height"), viewport?.height);
    const useWidth = length(attribute(use, "width"), viewport?.width);
    const useHeight = length(attribute(use, "height"), viewport?.height);
    if (
      offsetX === null ||
      offsetY === null ||
      ownWidth === null ||
      ownHeight === null ||
      useWidth === null ||
      useHeight === null
    ) {
      return null;
    }
    const width = useWidth ?? ownWidth ?? viewport?.width;
    const height = useHeight ?? ownHeight ?? viewport?.height;
    const transforms: string[] = [];
    if (offsetX || offsetY) {
      transforms.push(`translate(${offsetX ?? 0} ${offsetY ?? 0})`);
    }
    const box = viewBox(target);
    if (!box) {
      return {
        transforms,
        inner:
          width !== undefined && height !== undefined
            ? { width, height }
            : viewport,
      };
    }
    if (!width || !height || width < 0 || height < 0) return null;
    transforms.push(
      viewBoxTransform(
        box,
        width,
        height,
        attribute(target, "preserveAspectRatio"),
      ),
    );
    return { transforms, inner: { width: box.width, height: box.height } };
  }

  // Copies get new ids, which a stylesheet `#id` rule would stop matching.
  private isSelectedById(target: HtmlNode, id: string): boolean {
    if (!this.styleText) return false;
    const ids = [id];
    for (const node of descendants(target)) {
      const nested = attribute(node, "id");
      if (nested) ids.push(nested);
    }
    return ids.some((candidate) =>
      new RegExp(`#${escapeRegExp(candidate)}(?![\\w-])`).test(this.styleText),
    );
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

  private serializeAttributes(
    attrs: HtmlAttribute[],
    scope: Map<string, string>,
  ): string {
    return attrs
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
  }

  private serialize(
    node: HtmlNode,
    scope: Map<string, string>,
    chain: string[],
    viewport: Size | null,
    options: { dropId?: boolean } = {},
  ): string {
    if (node.nodeName === "#text") {
      const parent = node.parentNode?.tagName;
      return parent && RAW_TEXT_TAGS.has(parent)
        ? (node.value ?? "")
        : escapeText(node.value ?? "");
    }
    if (!isElement(node)) return "";
    this.remaining -= 1;
    if (this.remaining < 0) throw new ExpansionBudgetExceeded();
    if (node.tagName === "use") {
      const expanded = this.expand(node, viewport, chain);
      if (expanded !== null) return expanded;
    }
    const attributes = this.serializeAttributes(
      (node.attrs ?? []).filter(
        (attr) =>
          attr.name !== NODE_ID_ATTRIBUTE &&
          !(options.dropId && attr.name === "id"),
      ),
      scope,
    );
    const inner =
      node.tagName === "svg" ? (viewportSize(node) ?? viewport) : viewport;
    const content = children(node)
      .map((child) => this.serialize(child, scope, chain, inner))
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
  const styleText = elements
    .filter((element) => element.tagName === "style")
    .map((element) =>
      children(element)
        .map((child) => child.value ?? "")
        .join(""),
    )
    .join("\n");
  const expander = new UseExpander(byId, styleText);
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
      const expanded = expander.expandInPlace(use);
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
