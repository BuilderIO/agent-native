import { parse } from "parse5";

const PRIMITIVE_ATTRIBUTE = "data-an-primitive";
const LAYER_NAME_ATTRIBUTE = "data-agent-native-layer-name";
const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const LOCKED_ATTRIBUTE = "data-agent-native-locked";
const EDITABLE_SVG_PRIMITIVE = "pasted-svg";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
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
const FONT_STYLESHEET = /^https?:\/\/fonts\.(?:googleapis\.com|bunny\.net)\//i;
const USE_LAYOUT_PROPERTIES = new Set([
  "x",
  "y",
  "width",
  "height",
  "transform",
  "transform-origin",
  "transform-box",
  "translate",
  "rotate",
  "scale",
]);
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
  namespaceURI?: string;
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

// The viewport's `overflow` from its attribute or inline style; null when it
// is set to something other than a keyword.
function viewportOverflow(node: HtmlNode): string | null {
  let value = attribute(node, "overflow");
  for (const declaration of (attribute(node, "style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    if (declaration.slice(0, colon).trim().toLowerCase() === "overflow") {
      value = declaration.slice(colon + 1);
    }
  }
  const keyword = (value ?? "hidden").trim().toLowerCase();
  return /^(visible|auto|hidden|scroll|clip)$/.test(keyword) ? keyword : null;
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

// A `<use>` never renders its children, and expanding the outer one already
// rewrites them, so editing one inside it too would overlap.
function hasUseAncestor(node: HtmlNode, root: HtmlNode): boolean {
  for (let parent = node.parentNode; parent && parent !== root; ) {
    if (parent.tagName === "use") return true;
    parent = parent.parentNode;
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

type ViewBoxMapping = { x: number; y: number; scaleX: number; scaleY: number };

function viewBoxMapping(
  box: Box,
  width: number,
  height: number,
  preserveAspectRatio: string | null,
): ViewBoxMapping {
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
  return { x: x - box.x * scaleX, y: y - box.y * scaleY, scaleX, scaleY };
}

function formatViewBoxMapping({
  x,
  y,
  scaleX,
  scaleY,
}: ViewBoxMapping): string {
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

type CssRule = { selector: string; properties: string[] };

function cssRules(styleText: string): CssRule[] {
  const rules: CssRule[] = [];
  const text = styleText.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const chunk of text.split("}")) {
    const open = chunk.lastIndexOf("{");
    if (open < 0) continue;
    rules.push({
      selector: chunk.slice(0, open),
      properties: chunk
        .slice(open + 1)
        .split(";")
        .map((declaration) =>
          (declaration.split(":")[0] ?? "").trim().toLowerCase(),
        )
        .filter(Boolean),
    });
  }
  return rules;
}

function selectsTag(selector: string, tag: string): boolean {
  return new RegExp(`(^|[\\s>+~,(])${tag}(?![\\w-])`, "i").test(selector);
}

// Conservative: ignores combinators, so a rule that names the node's id or
// one of its classes anywhere counts as selecting it.
function mayMatchNode(selector: string, node: HtmlNode): boolean {
  if (/(^|[\s>+~,(])\*/.test(selector)) return true;
  const id = attribute(node, "id");
  if (id && new RegExp(`#${escapeRegExp(id)}(?![\\w-])`).test(selector)) {
    return true;
  }
  return classNames(node).some((name) =>
    new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`).test(selector),
  );
}

function classNames(node: HtmlNode): string[] {
  return (attribute(node, "class") ?? "").split(/\s+/).filter(Boolean);
}

const LAYOUT_UTILITY =
  /^-?(?:w|h|size|min-w|min-h|max-w|max-h|inset|top|right|bottom|left|translate|rotate|scale|skew|origin|overflow|transform)(?:-|$)/;
const ARBITRARY_LAYOUT_PROPERTY =
  /^\[(?:width|height|x|y|inset|top|right|bottom|left|transform|translate|rotate|scale|overflow)\s*:/;

function isLayoutUtilityClass(name: string): boolean {
  if (ARBITRARY_LAYOUT_PROPERTY.test(name)) return true;
  return LAYOUT_UTILITY.test(name.replace(/^(?:[\w-]+:)+/, ""));
}

function inlineProperties(node: HtmlNode): string[] {
  return (attribute(node, "style") ?? "")
    .split(";")
    .map((declaration) =>
      (declaration.split(":")[0] ?? "").trim().toLowerCase(),
    )
    .filter(Boolean);
}

class UseExpander {
  private readonly usedIds: Set<string>;
  private instance = 0;
  private remaining = MAX_EXPANDED_ELEMENTS;

  private readonly rules: CssRule[];

  constructor(
    private readonly byId: Map<string, HtmlNode>,
    private readonly styleText: string,
    private readonly hasLinkedStylesheet: boolean,
  ) {
    this.usedIds = new Set(byId.keys());
    this.rules = cssRules(styleText);
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
    if (
      !id ||
      !target ||
      target.namespaceURI !== SVG_NAMESPACE ||
      chain.includes(id) ||
      chain.length >= MAX_USE_DEPTH
    ) {
      return null;
    }
    // A copy would drop the lock its source sits under.
    if (isLocked(target)) return null;
    if (this.isSelectedById(target, id)) return null;
    if (this.stylesheetDependsOnUse(use, target)) return null;
    const x = length(attribute(use, "x"), viewport?.width);
    const y = length(attribute(use, "y"), viewport?.height);
    if (x === null || y === null) return null;
    const transforms = [attribute(use, "transform") ?? ""];
    if (x || y) transforms.push(`translate(${x ?? 0} ${y ?? 0})`);
    const nextChain = [...chain, id];
    let content: string;
    let viewportClip = "";
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
      let inherited = this.serializeAttributes(
        (target.attrs ?? []).filter(
          (attr) => !VIEWPORT_ATTRIBUTES.has(attr.name),
        ),
        scope,
      );
      if (instance.clip) {
        const clipId = escapeAttribute(this.uniqueId(`${id}-viewport`));
        const { x: clipX, y: clipY, width, height } = instance.clip;
        viewportClip = ` clip-path="url(#${clipId})"`;
        // The use's own clip-path stays on the outer group, so this one
        // moves in with the symbol's attributes.
        if (attribute(use, "clip-path") !== null) {
          inherited += viewportClip;
          viewportClip = "";
        }
        content = `<clipPath id="${clipId}"><rect x="${round(clipX)}" y="${round(clipY)}" width="${round(width)}" height="${round(height)}"></rect></clipPath>${content}`;
      }
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
          // The group takes over the use's layer identity; copies nested in a
          // symbol would duplicate it, so they get new ones on save.
          (attr.name !== NODE_ID_ATTRIBUTE || chain.length === 0),
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
    if (viewportClip) attributes.push(viewportClip);
    return `<g${attributes.join("")}>${content}</g>`;
  }

  // A symbol or nested svg instance is sized by the use, then by its own
  // width and height, then fills the viewport it is drawn in (100%). Like the
  // original, the copy is clipped to that viewport unless overflow is visible.
  private instanceViewport(
    use: HtmlNode,
    target: HtmlNode,
    viewport: Size | null,
  ): { transforms: string[]; inner: Size | null; clip: Box | null } | null {
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
    if (!width || !height || width < 0 || height < 0) return null;
    const overflow = viewportOverflow(target);
    if (overflow === null) return null;
    const clips = overflow !== "visible" && overflow !== "auto";
    if (clips && attribute(target, "clip-path") !== null) return null;
    const transforms: string[] = [];
    if (offsetX || offsetY) {
      transforms.push(`translate(${offsetX ?? 0} ${offsetY ?? 0})`);
    }
    const box = viewBox(target);
    if (!box) {
      return {
        transforms,
        inner: { width, height },
        clip: clips ? { x: 0, y: 0, width, height } : null,
      };
    }
    const mapping = viewBoxMapping(
      box,
      width,
      height,
      attribute(target, "preserveAspectRatio"),
    );
    transforms.push(formatViewBoxMapping(mapping));
    return {
      transforms,
      inner: { width: box.width, height: box.height },
      clip: clips
        ? {
            x: -mapping.x / mapping.scaleX,
            y: -mapping.y / mapping.scaleY,
            width: width / mapping.scaleX,
            height: height / mapping.scaleY,
          }
        : null,
    };
  }

  // Expansion turns the use into a `<g>` and moves the symbol's shapes out
  // from under the symbol, so a rule that selects either by tag, or sizes,
  // places, or transforms the use, would stop applying.
  private stylesheetDependsOnUse(use: HtmlNode, target: HtmlNode): boolean {
    if (inlineProperties(use).some((name) => USE_LAYOUT_PROPERTIES.has(name))) {
      return true;
    }
    // Classes no in-document rule defines come from Tailwind's runtime or a
    // linked stylesheet, which this can't read.
    const unresolved = [use, target]
      .flatMap((node) => classNames(node))
      .filter(
        (name) =>
          !new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`).test(
            this.styleText,
          ),
      );
    if (
      unresolved.some(
        (name) => this.hasLinkedStylesheet || isLayoutUtilityClass(name),
      )
    ) {
      return true;
    }
    return this.rules.some(
      (rule) =>
        selectsTag(rule.selector, "use") ||
        (target.tagName === "symbol" && selectsTag(rule.selector, "symbol")) ||
        (mayMatchNode(rule.selector, use) &&
          rule.properties.some((name) => USE_LAYOUT_PROPERTIES.has(name))) ||
        ((selectsTag(rule.selector, target.tagName ?? "") ||
          mayMatchNode(rule.selector, target)) &&
          rule.properties.includes("overflow")),
    );
  }

  private uniqueId(base: string): string {
    this.instance += 1;
    let id = `${base}-${this.instance}`;
    while (this.usedIds.has(id)) id = `${id}-${this.instance}`;
    this.usedIds.add(id);
    return id;
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

function countOccurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    count += 1;
  }
  return count;
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
export function promoteAuthoredSvgArtworkInHtml(
  html: string,
  options: { previousHtml?: string } = {},
): {
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
  const hasLinkedStylesheet = elements.some(
    (element) =>
      element.tagName === "link" &&
      /(^|\s)stylesheet(\s|$)/i.test(attribute(element, "rel") ?? "") &&
      !FONT_STYLESHEET.test(attribute(element, "href") ?? ""),
  );
  const expander = new UseExpander(byId, styleText, hasLinkedStylesheet);
  const edits: SourceEdit[] = [];
  const seenMarkup = new Map<string, number>();
  let promoted = 0;
  for (const svg of topLevelSvgs) {
    const startTag = svg.sourceCodeLocation?.startTag;
    const location = svg.sourceCodeLocation;
    if (!startTag || !location || !isArtworkSvg(svg)) continue;
    // An edit promotes only the artwork it wrote, not SVGs it left as they
    // were; a new copy of an existing SVG counts as written.
    const markup = html.slice(location.startOffset, location.endOffset);
    const seen = (seenMarkup.get(markup) ?? 0) + 1;
    seenMarkup.set(markup, seen);
    if (
      options.previousHtml !== undefined &&
      seen <= countOccurrences(options.previousHtml, markup)
    ) {
      continue;
    }
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
      if (hasUseAncestor(use, svg) || isLocked(use)) continue;
      const useLocation = use.sourceCodeLocation;
      if (!useLocation) continue;
      const expanded = expander.expandInPlace(use);
      if (expanded === null) continue;
      edits.push({
        start: useLocation.startOffset,
        end: useLocation.endOffset,
        text: expanded,
      });
    }
    promoted += 1;
  }
  if (promoted === 0) return { content: html, promoted: 0 };
  return { content: applyEdits(html, edits), promoted };
}
