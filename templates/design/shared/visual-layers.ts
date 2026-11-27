/**
 * Geometry-based scan for visible paint layers, including the ones a pointer
 * can never hit. `document.elementsFromPoint` skips `pointer-events: none`,
 * which is exactly how decorative hero canvases, videos, and gradient washes
 * are usually styled, so selection built only on it cannot reach the layer that
 * actually paints the effect.
 *
 * Runs inside the canvas iframe (inlined into the editor chrome bridge), so it
 * must stay import-free and DOM-only.
 */

export type VisualLayerKind =
  | "webgl"
  | "canvas"
  | "video"
  | "image"
  | "svg"
  | "embed"
  | "background"
  | "effect";

const VISUAL_LAYER_KINDS: readonly string[] = [
  "webgl",
  "canvas",
  "video",
  "image",
  "svg",
  "embed",
  "background",
  "effect",
];

export function isVisualLayerKind(value: unknown): value is VisualLayerKind {
  return typeof value === "string" && VISUAL_LAYER_KINDS.includes(value);
}

export type VisualLayerRelation = "behind" | "inside" | "above";

export interface VisualLayerMatch {
  element: Element;
  kind: VisualLayerKind;
  /** Whether the layer animates: WebGL, a playing video, or running CSS animations. */
  animated: boolean;
}

export interface VisualLayerOverlap extends VisualLayerMatch {
  relation: VisualLayerRelation;
  /** Fraction (0–1) of the target's box this layer covers. */
  coverage: number;
}

/** Bounds a full-document walk on very large pages. */
export const VISUAL_LAYER_SCAN_MAX_ELEMENTS = 6000;
const MIN_LAYER_EXTENT_PX = 2;

const CANVAS_CONTEXT_KINDS_KEY = "__agentNativeCanvasContextKinds";

// Built at runtime: this module is inlined into the bridge, itself an inline
// <script>, where a literal closing tag would end it early.
const SCRIPT_CLOSE = ["</", "script>"].join("");

/**
 * Head script that records which context each canvas opened. Probing a canvas
 * with `getContext` would create a context on an unused one and lock its type,
 * breaking a page that later asks for a different kind, so WebGL is detected
 * only from this record (or a renderer's own marker).
 */
export const CANVAS_CONTEXT_RECORDER_SCRIPT = `<script data-agent-native-canvas-context-recorder>(function(){try{var p=window.HTMLCanvasElement&&HTMLCanvasElement.prototype;if(!p||p.__agentNativeContextRecorder)return;var kinds=new WeakMap();window.${CANVAS_CONTEXT_KINDS_KEY}=kinds;var original=p.getContext;p.getContext=function(type){var ctx=original.apply(this,arguments);if(ctx&&!kinds.has(this))kinds.set(this,String(type));return ctx;};p.__agentNativeContextRecorder=true;}catch(e){console.error("[agent-native] canvas context recorder failed",e);}})();${SCRIPT_CLOSE}`;

/**
 * Puts the recorder first in the document's head. Only the markup before the
 * first script, style or body is searched: a `<head>` further down is text in
 * a script, not the head. Call it on the page's own markup, before any bridge
 * script is added, whose string literals contain such text.
 */
export function injectCanvasContextRecorder(html: string): string {
  return injectHeadStartMarkup(html, CANVAS_CONTEXT_RECORDER_SCRIPT);
}

export function injectHeadStartMarkup(html: string, markup: string): string {
  // Same length, so offsets still match: a tag inside a comment is not a tag.
  const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) =>
    " ".repeat(comment.length),
  );
  const rawStart =
    /<(?:script|style|body)\b/i.exec(visible)?.index ?? html.length;
  const prefix = visible.slice(0, rawStart);
  const opener =
    /<head(?:\s[^>]*)?>/i.exec(prefix) ??
    /<html(?:\s[^>]*)?>/i.exec(prefix) ??
    /<!doctype[^>]*>/i.exec(prefix);
  if (!opener) return markup + html;
  const end = opener.index + opener[0].length;
  return html.slice(0, end) + markup + html.slice(end);
}

function recordedCanvasContextKind(canvas: Element): string | null {
  const view = canvas.ownerDocument.defaultView as
    | (Window & { [CANVAS_CONTEXT_KINDS_KEY]?: WeakMap<Element, string> })
    | null;
  const kinds = view ? view[CANVAS_CONTEXT_KINDS_KEY] : undefined;
  return kinds ? (kinds.get(canvas) ?? null) : null;
}

function isWebGlCanvas(canvas: Element): boolean {
  const recorded = recordedCanvasContextKind(canvas);
  if (recorded) return /webgl|webgpu/i.test(recorded);
  const engine = canvas.getAttribute("data-engine") || "";
  return /three|babylon|pixi|ogl|regl/i.test(engine);
}

function hasPaintedPseudo(el: Element, pseudo: "::before" | "::after") {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const cs = view.getComputedStyle(el, pseudo);
  if (cs.content === "none" || cs.display === "none") return false;
  return cs.backgroundImage !== "none" || /url\(/.test(cs.content);
}

function isTransparentColor(value: string): boolean {
  return (
    value === "transparent" ||
    /^rgba\([^)]*,\s*0\s*\)$/.test(value) ||
    /\/\s*0\s*\)$/.test(value)
  );
}

function hasRunningAnimation(el: Element): boolean {
  const animated = el as Element & { getAnimations?: () => Animation[] };
  if (typeof animated.getAnimations !== "function") return false;
  return animated.getAnimations().some(function (animation) {
    return animation.playState === "running";
  });
}

export function visualLayerKindFor(
  el: Element,
  cs: CSSStyleDeclaration,
): VisualLayerKind | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "canvas") return isWebGlCanvas(el) ? "webgl" : "canvas";
  if (tag === "video") return "video";
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "svg") return el.parentElement?.closest("svg") ? null : "svg";
  if (tag === "iframe" || tag === "embed" || tag === "object") return "embed";
  if (
    cs.backgroundImage !== "none" ||
    hasPaintedPseudo(el, "::before") ||
    hasPaintedPseudo(el, "::after")
  ) {
    return "background";
  }
  if (
    (cs.filter && cs.filter !== "none") ||
    (cs.backdropFilter && cs.backdropFilter !== "none") ||
    (cs.mixBlendMode && cs.mixBlendMode !== "normal")
  ) {
    return "effect";
  }
  if (
    (cs.position === "absolute" || cs.position === "fixed") &&
    cs.pointerEvents === "none" &&
    !isTransparentColor(cs.backgroundColor)
  ) {
    return "background";
  }
  return null;
}

function isPainted(el: Element, cs: CSSStyleDeclaration, rect: DOMRect) {
  if (rect.width < MIN_LAYER_EXTENT_PX || rect.height < MIN_LAYER_EXTENT_PX)
    return false;
  if (cs.display === "none" || cs.visibility !== "visible") return false;
  const checkable = el as Element & {
    checkVisibility?: (options: Record<string, boolean>) => boolean;
  };
  if (typeof checkable.checkVisibility === "function") {
    return checkable.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true,
    });
  }
  return Number(cs.opacity) > 0;
}

function matchFor(el: Element, rect: DOMRect): VisualLayerMatch | null {
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  const cs = view.getComputedStyle(el);
  if (!isPainted(el, cs, rect)) return null;
  const kind = visualLayerKindFor(el, cs);
  if (!kind) return null;
  const video = el as HTMLVideoElement;
  const animated =
    kind === "webgl" ||
    (kind === "video" && !video.paused && !video.ended) ||
    hasRunningAnimation(el);
  return { element: el, kind, animated };
}

/** Returns true when the document has more elements than the scan visits. */
function scanElements(
  root: Element,
  visit: (el: Element, rect: DOMRect) => void,
): boolean {
  const elements = root.getElementsByTagName("*");
  const limit = Math.min(elements.length, VISUAL_LAYER_SCAN_MAX_ELEMENTS);
  for (let i = 0; i < limit; i += 1) {
    const el = elements.item(i);
    if (!el || el.parentElement?.closest("svg")) continue;
    visit(el, el.getBoundingClientRect());
  }
  return elements.length > limit;
}

// True when an element with `z-index: auto` still paints as its own stacking
// context, trapping the z-index of everything inside it.
function createsStackingContext(cs: CSSStyleDeclaration): boolean {
  return (
    cs.position === "fixed" ||
    cs.position === "sticky" ||
    Number(cs.opacity) < 1 ||
    [
      cs.transform,
      cs.translate,
      cs.rotate,
      cs.scale,
      cs.perspective,
      cs.filter,
      cs.backdropFilter,
      cs.clipPath,
      cs.maskImage,
    ].some((value) => !!value && value !== "none") ||
    (!!cs.mixBlendMode && cs.mixBlendMode !== "normal") ||
    cs.isolation === "isolate" ||
    /layout|paint|strict|content/.test(cs.contain) ||
    /transform|opacity|filter|perspective/.test(cs.willChange)
  );
}

// Stacking buckets in CSS paint order: negative z, in-flow, positioned
// (auto/0), positive z. An element's bucket below `stopAt` is decided by the
// outermost stacking context on its path, as the spec paints it.
function paintLevel(el: Element, stopAt: Element | null): [number, number] {
  const view = el.ownerDocument.defaultView;
  let z: number | null = null;
  let positioned = false;
  for (
    let node: Element | null = el;
    node && node !== stopAt;
    node = node.parentElement
  ) {
    const cs = view ? view.getComputedStyle(node) : null;
    if (!cs) continue;
    const isPositioned = cs.position !== "static";
    if (isPositioned) positioned = true;
    const zIndex = parseInt(cs.zIndex, 10);
    const parentDisplay =
      view && node.parentElement
        ? view.getComputedStyle(node.parentElement).display
        : "";
    if (
      !Number.isNaN(zIndex) &&
      (isPositioned || /flex|grid/.test(parentDisplay))
    ) {
      z = zIndex;
    } else if (createsStackingContext(cs)) {
      z = 0;
      positioned = true;
    }
  }
  if (z !== null && z < 0) return [0, z];
  if (z !== null && z > 0) return [3, z];
  return positioned ? [2, 0] : [1, 0];
}

/** Positive when `a` paints above `b`, negative when below. */
export function comparePaintOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  if (a.contains(b)) return -comparePaintOrder(b, a);
  if (b.contains(a)) {
    const [bucket] = paintLevel(a, b);
    return bucket === 0 ? -1 : 1;
  }
  let common: Element | null = a.parentElement;
  while (common && !common.contains(b)) common = common.parentElement;
  const levelA = paintLevel(a, common);
  const levelB = paintLevel(b, common);
  if (levelA[0] !== levelB[0]) return levelA[0] - levelB[0];
  if (levelA[1] !== levelB[1]) return levelA[1] - levelB[1];
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

/**
 * Visual layers under a point that hit testing did not return, each placed
 * into `hitStack` (topmost first) where it paints. Returns the merged stack.
 */
export function mergeVisualLayersAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
  hitStack: readonly Element[],
  exclude: (el: Element) => boolean,
): {
  stack: Element[];
  added: Map<Element, VisualLayerMatch>;
  /** The scan stopped early, so layers further down the document are missing. */
  truncated: boolean;
} {
  const stack = hitStack.slice();
  const added = new Map<Element, VisualLayerMatch>();
  const body = doc.querySelector("body");
  if (!body) return { stack, added, truncated: false };
  const truncated = scanElements(body, function (el, rect) {
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom ||
      stack.indexOf(el) !== -1 ||
      exclude(el)
    ) {
      return;
    }
    const match = matchFor(el, rect);
    if (!match) return;
    let index = stack.length;
    for (const [i, other] of stack.entries()) {
      if (comparePaintOrder(el, other) > 0) {
        index = i;
        break;
      }
    }
    stack.splice(index, 0, el);
    added.set(el, match);
  });
  return { stack, added, truncated };
}

function overlapArea(a: DOMRect, b: DOMRect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Visual layers overlapping `target`'s box: its own media/background
 * descendants and the layers painting behind or above it. Effect-like layers
 * (WebGL, animated) come first, then by coverage.
 */
export function visualLayersOverlapping(
  target: Element,
  exclude: (el: Element) => boolean,
  limit: number,
): {
  layers: VisualLayerOverlap[];
  /** The scan stopped early, so layers further down the document are missing. */
  truncated: boolean;
} {
  const doc = target.ownerDocument;
  const targetRect = target.getBoundingClientRect();
  const targetArea = targetRect.width * targetRect.height;
  const body = doc.querySelector("body");
  if (!body || targetArea <= 0) return { layers: [], truncated: false };
  const results: VisualLayerOverlap[] = [];
  const truncated = scanElements(body, function (el, rect) {
    if (el === target) return;
    const area = overlapArea(targetRect, rect);
    if (area <= 0 || exclude(el)) return;
    const match = matchFor(el, rect);
    if (!match) return;
    const relation: VisualLayerRelation = target.contains(el)
      ? "inside"
      : comparePaintOrder(el, target) > 0
        ? "above"
        : "behind";
    results.push({
      ...match,
      relation,
      coverage: Math.round((area / targetArea) * 100) / 100,
    });
  });
  const effectRank = (layer: VisualLayerOverlap) =>
    (layer.kind === "webgl" ? 2 : 0) + (layer.animated ? 1 : 0);
  results.sort(function (a, b) {
    return effectRank(b) - effectRank(a) || b.coverage - a.coverage;
  });
  return { layers: results.slice(0, limit), truncated };
}
