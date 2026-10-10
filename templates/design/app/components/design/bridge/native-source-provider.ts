import {
  NativeCaptureCache,
  NativeCaptureCacheError,
} from "../../../../shared/native-capture-cache";
import {
  resolveNativeClipRadii,
  type NativeClipRadii,
} from "../../../../shared/native-clip-geometry";
import {
  classifyNativeComputedOverflowClip,
  MAX_NATIVE_SOURCE_CLIPS,
  planNativeSourceClips,
  type NativeOverflowClipResult,
  type NativeSourceClipCandidate,
  type NativeSourceRoundedClip,
} from "../../../../shared/native-source-clip-plan";
import {
  hasUnsupportedSourceMask,
  hasUnsupportedStackingOrder,
  nativeBoxesOverlap,
  type NativeSourceBox,
  type NativeStackingFootprint,
} from "../../../../shared/native-source-composition";
import type { NativeSourceIsolation } from "../../../../shared/native-source-composition-tree";
import {
  nativeCaptureRoi,
  planNativeCaptureRoi,
  setNativeCaptureRoi,
  type NativeCaptureRoi,
} from "./native-capture-roi";
import { supportsNativeOutput2D } from "./native-effect-output-geometry";
import {
  composeNativeSourceAffine,
  invertNativeSourceAffine,
  planNativeSourceAffine,
  type NativeAffine2D,
  type NativeAffineBox,
} from "./native-source-affine-geometry";
import type { NativeImageRendering } from "./native-source-sampling";
import {
  NativeSvgSourceError,
  rasterNativeSvgSource,
} from "./native-svg-source";

// guard:allow-raw-color — alpha coverage masks use opaque white independently of the editor theme.
const OPAQUE_COVERAGE_COLOR = "rgb(255 255 255)";

export type NativeSourceKind = "image" | "video" | "canvas" | "dom" | "native";

export class NativeSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeSourceError";
  }
}

export function nativePresentationVisible(
  canvas: HTMLCanvasElement,
  viewport: { width: number; height: number },
): boolean {
  if (!canvas.isConnected) return false;
  for (let node: Element | null = canvas; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse")
      return false;
    const opacity = Number(style.opacity);
    if (!Number.isFinite(opacity))
      throw new NativeSourceError(
        "source-opacity-invalid",
        "A native presentation ancestor has unreadable opacity.",
      );
    if (node.hasAttribute("data-an-native-scene-suppressed")) {
      const saved = node.getAttribute("data-an-native-authored-opacity");
      const authored = saved === null || !saved.trim() ? NaN : Number(saved);
      if (!Number.isFinite(authored) || authored < 0 || authored > 1)
        throw new NativeSourceError(
          "source-opacity-invalid",
          "A scene-suppressed ancestor has unreadable authored opacity.",
        );
      if (authored === 0) return false;
      continue;
    }
    if (opacity <= 0) {
      if (
        node !== canvas ||
        !canvas.hasAttribute("data-an-native-backdrop-presentation") ||
        canvas.getAttribute("data-an-native-authored-opacity") !== "1"
      )
        return false;
    }
  }
  const rect = canvas.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.right > 0 &&
    rect.bottom > 0
  );
}

export interface NativeSourceRecord {
  key: number;
  node: Element;
  kind: NativeSourceKind;
  sourceRole?: "viewport-background";
  source?: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  nativeInstanceId?: string;
  imageRendering?: NativeImageRendering;
  width: number;
  height: number;
  revision: number;
  coordinateSpace:
    | "target-local"
    | "target-local-global"
    | "target-viewport-axis-aligned";
  rect: { x: number; y: number; width: number; height: number };
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  clip: { x: number; y: number; width: number; height: number };
  clips: NativeSourceClip[];
  groupClips: { id: string; clip: NativeSourceClip }[];
  isolationPath: NativeSourceIsolation[];
  opacity: number;
  uv?: { x: number; y: number; width: number; height: number };
}

export interface NativeSourceClip {
  rect: { x: number; y: number; width: number; height: number };
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  radii: NativeClipRadii;
}

export interface NativeFillBackgroundPaint {
  color: string;
  image: string;
  borderTopColor: string;
  borderRightColor: string;
  borderBottomColor: string;
  borderLeftColor: string;
  borderImageSource: string;
}

export interface NativeSceneProvider {
  readScene(): Promise<NativeSourceRecord[]>;
  setGroupLocalBackdropSource(enabled: boolean): void;
  groupLocalBackdropClipState(canvas: HTMLCanvasElement): "empty" | "nonempty";
  readFillBackground(
    paint: NativeFillBackgroundPaint,
  ): Promise<NativeSourceRecord[]>;
  readFillBoxPhase(
    paint: NativeFillBackgroundPaint,
    phase: "background" | "border" | "coverage" | "inner-coverage",
  ): Promise<NativeSourceRecord[]>;
  readFillGlyph(): Promise<NativeSourceRecord[]>;
  hasFillGlyph(): boolean;
  readFillForeground(): Promise<NativeSourceRecord[]>;
  setDensity(density: number): void;
  setLayerTargetOpacityDeferred(deferred: boolean): void;
  invalidate(): void;
  needsContinuousFrames(): boolean;
  captureCount(): number;
  sourceEpoch?(): number;
  authoredSourceEpoch?(): number;
  diagnosticSnapshot(): NativeSourceProviderDiagnostic;
  dispose(): void;
}

export type NativeSourceInvalidationReason =
  | "initial"
  | "attributes"
  | "content"
  | "resize"
  | "dimensions"
  | "density"
  | "ancestor-style"
  | "head"
  | "font"
  | "load"
  | "explicit";

type NativeSourceReasonCounts = Partial<
  Record<NativeSourceInvalidationReason, number>
>;

interface NativeSourceAttributeObservation {
  targetTag: string;
  targetNodeId: string | null;
  withinBody: boolean;
  withinHead: boolean;
  omitted: boolean;
  name: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface NativeSourceProviderDiagnostic {
  readSceneCalls: number;
  captures: number;
  activeLeaves: number;
  createdLeaves: number;
  retiredLeaves: number;
  invalidations: NativeSourceReasonCounts;
  leaves: Array<{
    key: number;
    kind: "own-paint" | "media-background" | "svg";
    nodeId: string | null;
    captures: number;
    invalidations: NativeSourceReasonCounts;
    captureCauses: NativeSourceReasonCounts;
    recreations: number;
    observedAttributes: NativeSourceAttributeObservation[];
  }>;
  omittedLeaves: number;
}

interface NativeSourceLeafDiagnostic {
  key: number;
  kind: "own-paint" | "media-background" | "svg";
  nodeId: string | null;
  captures: number;
  invalidations: NativeSourceReasonCounts;
  captureCauses: NativeSourceReasonCounts;
  recreations: number;
  observedAttributes: NativeSourceAttributeObservation[];
  lastReason: NativeSourceInvalidationReason;
}

function countSourceReason(
  counts: NativeSourceReasonCounts,
  reason: NativeSourceInvalidationReason,
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

const OMIT =
  "[data-agent-native-edit-overlay],[data-agent-native-editor-chrome],[data-agent-native-editor-chrome-host],[data-an-native-presentation],[data-an-native-scene-presentation]";

function authoredOpacity(element: Element): number {
  const saved = element.getAttribute("data-an-native-authored-opacity");
  const opacity = Number(saved ?? getComputedStyle(element).opacity);
  if (!Number.isFinite(opacity)) {
    throw new NativeSourceError(
      "source-opacity-invalid",
      "Source opacity is not finite.",
    );
  }
  return Math.max(0, Math.min(1, opacity));
}

export function nativeDocumentOrigin(): string {
  if (location.origin !== "null") return location.origin;
  try {
    const origin = window.parent.location.origin;
    if (origin && origin !== "null") return origin;
  } catch {
    throw new NativeSourceError(
      "source-origin-unavailable",
      "The parent source origin could not be verified.",
    );
  }
  throw new NativeSourceError(
    "source-origin-unavailable",
    "The source document has no trusted inherited origin.",
  );
}

function assertLocalAsset(raw: string): void {
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return;
  const url = new URL(raw, document.baseURI);
  if (url.origin !== nativeDocumentOrigin()) {
    throw new NativeSourceError(
      "source-cross-origin",
      `Cross-origin source assets cannot be captured: ${url.origin}`,
    );
  }
}

function assertLeafSupported(element: Element, target?: Element): void {
  if (element.shadowRoot) {
    throw new NativeSourceError(
      "source-shadow-dom",
      "Shadow DOM source content is unsupported.",
    );
  }
  if (element instanceof HTMLIFrameElement) {
    throw new NativeSourceError(
      "source-iframe",
      "Iframe source content is unsupported.",
    );
  }
  const style = getComputedStyle(element);
  if (
    style.mixBlendMode !== "normal" ||
    style.filter !== "none" ||
    style.backdropFilter !== "none"
  ) {
    throw new NativeSourceError(
      "source-css-composite",
      "CSS blend modes, filters, and backdrop filters need a separate compositor path.",
    );
  }
  if (element === target) {
    if (!supportsNativeOutput2D(style))
      throw new NativeSourceError(
        "source-transform",
        "The selected source target has a 3D or perspective transform.",
      );
  } else if (element instanceof HTMLElement) {
    nodeGlobalTransform(element);
  }
  for (const animation of element.getAnimations({ subtree: false })) {
    if (animation.playState !== "running") continue;
    const keyframes =
      animation.effect instanceof KeyframeEffect
        ? animation.effect.getKeyframes()
        : [];
    const keys = new Set(keyframes.flatMap((frame) => Object.keys(frame)));
    for (const key of keys) {
      if (
        ![
          "offset",
          "easing",
          "composite",
          "computedOffset",
          "transform",
          "translate",
          "scale",
        ].includes(key)
      ) {
        throw new NativeSourceError(
          "source-animation",
          "An animated source changes pixels; cached DOM capture supports transform-only motion.",
        );
      }
    }
  }
  for (const value of [style.backgroundImage, style.maskImage]) {
    for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/g))
      assertLocalAsset(match[1]);
  }
  for (const pseudo of ["::before", "::after"]) {
    const content = getComputedStyle(element, pseudo).content;
    if (content && content !== "none" && content !== "normal") {
      throw new NativeSourceError(
        "source-pseudo",
        "CSS pseudo-element content is unsupported.",
      );
    }
  }
}

function hasDirectText(element: Element): boolean {
  return [...element.childNodes].some(
    (child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim(),
  );
}

function isInlineFlowChild(element: Element): boolean {
  if (element instanceof HTMLBRElement) return true;
  const display = getComputedStyle(element).display;
  return display === "contents" || display.startsWith("inline");
}

function copyComputedCss(original: Element, clone: HTMLElement): void {
  const style = getComputedStyle(original);
  let css = "";
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    css += `${name}:${style.getPropertyValue(name)};`;
  }
  clone.setAttribute("style", css);
}

function isPureTextFlow(element: HTMLElement): boolean {
  if (!element.textContent?.trim()) return false;
  for (const child of element.children) {
    if (
      child.matches(
        "canvas[data-an-native-canvas]:not([data-an-native-presentation])",
      )
    )
      continue;
    if (
      child.hasAttribute("data-an-native-layer-instance") ||
      child.querySelector(
        "[data-an-native-layer-instance],canvas[data-an-native-canvas]:not([data-an-native-presentation])",
      )
    )
      return false;
    if (
      !(child instanceof HTMLElement) ||
      child instanceof HTMLImageElement ||
      child instanceof HTMLVideoElement ||
      child instanceof HTMLCanvasElement ||
      child instanceof HTMLIFrameElement ||
      ["SCRIPT", "STYLE"].includes(child.tagName)
    )
      return false;
    const style = getComputedStyle(child);
    if (style.position === "absolute" || style.position === "fixed")
      return false;
    if (child instanceof HTMLBRElement) continue;
    if (child.textContent?.trim() && !isPureTextFlow(child)) return false;
  }
  return true;
}

function isSourceTextFlow(element: HTMLElement): boolean {
  if (
    [...element.children].some((child) =>
      child.matches(
        "canvas[data-an-native-canvas]:not([data-an-native-presentation])",
      ),
    )
  )
    return false;
  return isPureTextFlow(element);
}

export function nativeTextFlowUsesDocumentFont(element: HTMLElement): boolean {
  if (!document.fonts) return false;
  const faces = [...document.fonts];
  if (!faces.length) return false;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const families = getComputedStyle(parent)
      .fontFamily.split(",")
      .map((family) =>
        family
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .toLowerCase(),
      );
    if (
      faces.some((face) =>
        families.includes(
          face.family.replace(/^['"]|['"]$/g, "").toLowerCase(),
        ),
      )
    )
      return true;
  }
  return false;
}

export async function paintNativeTextFlow(
  element: HTMLElement,
  canvas: HTMLCanvasElement,
  mask: boolean,
  glyphColors?: Map<Element, string>,
  captureRoi?: { density: number; pixelOffset: { x: number; y: number } },
): Promise<void> {
  if (!isPureTextFlow(element))
    throw new NativeSourceError(
      "source-webfont-layout",
      "Canvas text capture needs a text-only flow without embedded media.",
    );
  const textNodes = [element, ...element.querySelectorAll<HTMLElement>("*")];
  const ancestors = new Set<HTMLElement>();
  for (const textNode of textNodes) {
    for (
      let ancestor: HTMLElement | null = textNode;
      ancestor;
      ancestor = ancestor.parentElement
    )
      ancestors.add(ancestor);
  }
  for (const ancestor of ancestors) {
    const matrix = nodeGlobalTransform(ancestor);
    if (
      Math.abs(matrix.a - 1) > 1e-5 ||
      Math.abs(matrix.b) > 1e-5 ||
      Math.abs(matrix.c) > 1e-5 ||
      Math.abs(matrix.d - 1) > 1e-5
    )
      throw new NativeSourceError(
        "source-webfont-transform-unsupported",
        "Viewport Range measurements cannot capture transformed webfont text in local coordinates.",
      );
  }
  await document.fonts?.ready;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context)
    throw new NativeSourceError(
      "source-canvas-unavailable",
      "A 2D text canvas is unavailable.",
    );
  const bounds = element.getBoundingClientRect();
  const scaleX =
    captureRoi?.density ?? canvas.width / Math.max(1, element.offsetWidth);
  const scaleY =
    captureRoi?.density ?? canvas.height / Math.max(1, element.offsetHeight);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  context.save();
  if (captureRoi)
    context.translate(captureRoi.pixelOffset.x, captureRoi.pixelOffset.y);
  context.scale(scaleX, scaleY);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent ?? "";
    if (!value.trim()) continue;
    if (/[\u200d\uFE0F\p{Mark}]/u.test(value))
      throw new NativeSourceError(
        "source-webfont-grapheme",
        "Complex joined glyphs need browser-shaped text capture.",
      );
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-an-native-canvas]")) continue;
    const style = getComputedStyle(parent);
    if (
      style.writingMode !== "horizontal-tb" ||
      style.direction !== "ltr" ||
      style.textTransform !== "none" ||
      style.textDecorationLine !== "none" ||
      style.textShadow !== "none" ||
      style.fontVariantCaps !== "normal"
    )
      throw new NativeSourceError(
        "source-webfont-style",
        "This text style needs browser-shaped glyph capture.",
      );
    const family = style.fontFamily;
    const face = [...document.fonts].find((font) =>
      family.split(",").some(
        (name) =>
          name
            .trim()
            .replace(/^['"]|['"]$/g, "")
            .toLowerCase() ===
          font.family.replace(/^['"]|['"]$/g, "").toLowerCase(),
      ),
    );
    if (face && face.status !== "loaded")
      throw new NativeSourceError(
        "source-webfont-pending",
        `Font ${face.family} is not loaded for Canvas2D capture.`,
      );
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.fontKerning = "normal";
    context.letterSpacing = style.letterSpacing;
    context.textBaseline = "alphabetic";
    // guard:allow-raw-color — text masks encode opaque coverage, independent of the editor theme.
    context.fillStyle = mask
      ? OPAQUE_COVERAGE_COLOR
      : (glyphColors?.get(parent) ?? style.color);
    const segments: { index: number; segment: string }[] = [];
    for (let index = 0; index < value.length; ) {
      const segment = String.fromCodePoint(value.codePointAt(index)!);
      segments.push({ index, segment });
      index += segment.length;
    }
    let lineStart = 0;
    let lineTop = Number.NaN;
    let lineRect: DOMRect | null = null;
    const drawLine = (end: number): void => {
      if (!lineRect || end <= lineStart) return;
      const text = value.slice(lineStart, end);
      const metric = context.measureText(text);
      const ascent =
        metric.actualBoundingBoxAscent ||
        Number.parseFloat(style.fontSize) * 0.8;
      const descent =
        metric.actualBoundingBoxDescent ||
        Number.parseFloat(style.fontSize) * 0.2;
      const baseline =
        lineRect.top - bounds.top + (lineRect.height + ascent - descent) / 2;
      context.fillText(text, lineRect.left - bounds.left, baseline);
    };
    for (const segment of segments) {
      range.setStart(node, segment.index);
      range.setEnd(node, segment.index + segment.segment.length);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      if (lineRect && Math.abs(rect.top - lineTop) > 1) {
        drawLine(segment.index);
        lineStart = segment.index;
        lineRect = null;
      }
      if (!lineRect) {
        lineRect = rect;
        lineTop = rect.top;
        lineStart = segment.index;
      }
    }
    drawLine(value.length);
  }
  context.restore();
  range.detach();
}

function preserveTextFlowStyles(
  original: HTMLElement,
  clone: HTMLElement,
): void {
  for (let index = original.children.length - 1; index >= 0; index -= 1) {
    const child = original.children[index];
    const copy = clone.children[index] as HTMLElement;
    if (
      child.matches(
        "canvas[data-an-native-canvas]:not([data-an-native-presentation])",
      )
    ) {
      copy.remove();
      continue;
    }
    assertLeafSupported(child);
    copyComputedCss(child, copy);
    if (child instanceof HTMLElement) preserveTextFlowStyles(child, copy);
  }
}

function hasOwnPaint(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    authoredOpacity(element) <= 0
  )
    return false;
  return (
    hasDirectText(element) ||
    isSourceTextFlow(element) ||
    hasVisibleBoxPaint(style)
  );
}

function hasVisibleBoxPaint(style: CSSStyleDeclaration): boolean {
  return (
    style.backgroundImage !== "none" ||
    // guard:allow-raw-color — this compares the browser's computed transparent pixel value.
    (style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      style.backgroundColor !== "transparent") ||
    style.boxShadow !== "none" ||
    [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].some((width) => Number.parseFloat(width) > 0)
  );
}

function isCanvasBackgroundOnly(
  element: HTMLElement,
  style: CSSStyleDeclaration,
): boolean {
  return (
    (element === document.documentElement || element === document.body) &&
    !hasDirectText(element) &&
    style.backgroundImage === "none" &&
    style.boxShadow === "none" &&
    style.outlineStyle === "none" &&
    [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].every((width) => Number.parseFloat(width) === 0)
  );
}

function mediaPlacement(
  element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  rect: NativeSourceRecord["rect"],
  sourceWidth: number,
  sourceHeight: number,
): {
  rect: NativeSourceRecord["rect"];
  uv: NonNullable<NativeSourceRecord["uv"]>;
} {
  const style = getComputedStyle(element);
  const fit = style.objectFit;
  if (!["fill", "contain", "cover"].includes(fit))
    throw new NativeSourceError(
      "source-object-fit",
      `Media object-fit ${fit} is unsupported.`,
    );
  const parts = style.objectPosition.split(/\s+/);
  const position = (value: string | undefined, axis: "x" | "y"): number => {
    if (!value || value === "center") return 0.5;
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return 1;
    if (value.endsWith("%")) return Number.parseFloat(value) / 100;
    throw new NativeSourceError(
      "source-object-position",
      `Media object-position ${style.objectPosition} is unsupported.`,
    );
  };
  const px = position(parts[0], "x");
  const py = position(parts[1], "y");
  if (![px, py].every(Number.isFinite))
    throw new NativeSourceError(
      "source-object-position",
      "Media object-position is invalid.",
    );
  const uv = { x: 0, y: 0, width: 1, height: 1 };
  if (fit === "fill") return { rect, uv };
  const sx = rect.width / sourceWidth;
  const sy = rect.height / sourceHeight;
  const scale = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  if (fit === "contain") {
    return {
      rect: {
        x: rect.x + (rect.width - width) * px,
        y: rect.y + (rect.height - height) * py,
        width,
        height,
      },
      uv,
    };
  }
  uv.x = ((width - rect.width) * px) / width;
  uv.y = ((height - rect.height) * py) / height;
  uv.width = rect.width / width;
  uv.height = rect.height / height;
  return { rect, uv };
}

function mediaHasSolidBackground(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const background = style.backgroundColor.replace(/\s+/g, "").toLowerCase();
  const transparent =
    background === "transparent" ||
    /^rgba\([^)]*,0(?:\.0+)?\)$/.test(background);
  if (
    style.backgroundImage !== "none" ||
    style.boxShadow !== "none" ||
    style.outlineStyle !== "none" ||
    (!transparent &&
      style.backgroundClip !== "border-box" &&
      style.backgroundClip !== "padding-box") ||
    [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].some((width) => Number.parseFloat(width) > 0)
  )
    throw new NativeSourceError(
      "source-media-own-paint-unsupported",
      "Media background images, borders, outlines, shadows, and content-box background clips need a separate paint path.",
    );
  return !transparent;
}

function sizeOf(element: HTMLElement | SVGSVGElement): {
  width: number;
  height: number;
} {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(
    element instanceof HTMLElement
      ? element.offsetWidth || rect.width
      : rect.width,
  );
  const height = Math.ceil(
    element instanceof HTMLElement
      ? element.offsetHeight || rect.height
      : rect.height,
  );
  if (width <= 0 || height <= 0)
    throw new NativeSourceError(
      "source-empty",
      "A source has no visible bounds.",
    );
  if (width > 4096 || height > 4096 || width * height > 8_388_608) {
    throw new NativeSourceError(
      "source-too-large",
      "A DOM source exceeds the bounded capture size.",
    );
  }
  return { width, height };
}

function contentBoxOf(element: HTMLElement | SVGSVGElement): {
  width: number;
  height: number;
} {
  if (element instanceof SVGSVGElement) {
    let box: DOMRect;
    try {
      box = element.getBBox();
    } catch {
      throw new NativeSourceError(
        "source-svg-size",
        "The SVG source content box is unreadable.",
      );
    }
    if (
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height) ||
      box.width < 0 ||
      box.height < 0
    )
      throw new NativeSourceError(
        "source-svg-size",
        "The SVG source content box is invalid.",
      );
    if (box.width > 0 && box.height > 0)
      return { width: box.width, height: box.height };
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height))
      throw new NativeSourceError(
        "source-svg-size",
        "The empty SVG viewport bounds are unreadable.",
      );
    return { width: rect.width, height: rect.height };
  }
  const style = getComputedStyle(element);
  const px = (value: string): number => {
    const normalized = value.trim();
    if (normalized === "" || normalized === "0") return 0;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(normalized))
      throw new NativeSourceError(
        "source-invalid-box",
        "A source padding or border width is unreadable.",
      );
    const parsed = Number(normalized.slice(0, -2));
    if (!Number.isFinite(parsed) || parsed > 4096)
      throw new NativeSourceError(
        "source-invalid-box",
        "A source padding or border width is invalid.",
      );
    return parsed;
  };
  const horizontal =
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.borderLeftWidth) +
    px(style.borderRightWidth);
  const vertical =
    px(style.paddingTop) +
    px(style.paddingBottom) +
    px(style.borderTopWidth) +
    px(style.borderBottomWidth);
  const dimension = (value: string): number => {
    const normalized = value.trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(normalized))
      throw new NativeSourceError(
        "source-invalid-box",
        "A source content dimension is unreadable.",
      );
    const parsed = Number(normalized.slice(0, -2));
    if (!Number.isFinite(parsed) || parsed > 4096)
      throw new NativeSourceError(
        "source-invalid-box",
        "A source content dimension is invalid.",
      );
    return parsed;
  };
  const fallbackWidth =
    element.clientWidth > 0
      ? element.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
      : element.offsetWidth - horizontal;
  const fallbackHeight =
    element.clientHeight > 0
      ? element.clientHeight - px(style.paddingTop) - px(style.paddingBottom)
      : element.offsetHeight - vertical;
  const width =
    style.width.trim() === "" || style.width.trim() === "auto"
      ? fallbackWidth
      : dimension(style.width) -
        (style.boxSizing === "border-box" ? horizontal : 0);
  const height =
    style.height.trim() === "" || style.height.trim() === "auto"
      ? fallbackHeight
      : dimension(style.height) -
        (style.boxSizing === "border-box" ? vertical : 0);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0
  )
    throw new NativeSourceError(
      "source-invalid-box",
      "A source content box is invalid.",
    );
  return { width, height };
}

export function solidBackgroundAlpha(color: string): 0 | 1 | null {
  if (color.trim().toLowerCase() === "transparent") return 0;
  const rgb = /^rgba?\(([^)]*)\)$/i.exec(color.trim());
  if (!rgb) return null;
  const channels = rgb[1].replace(/[,/]/g, " ").trim().split(/\s+/).map(Number);
  if (
    (channels.length !== 3 && channels.length !== 4) ||
    channels
      .slice(0, 3)
      .some(
        (channel) => !Number.isFinite(channel) || channel < 0 || channel > 255,
      )
  )
    return null;
  const alpha = channels[3] ?? 1;
  return alpha === 0 || alpha === 1 ? alpha : null;
}

function intersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

function viewportRelativeRect(
  element: Element,
  target: Element,
): { x: number; y: number; width: number; height: number } {
  const a = element.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return {
    x: a.left - b.left,
    y: a.top - b.top,
    width: a.width,
    height: a.height,
  };
}

function layoutPosition(element: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  let count = 0;
  while (node) {
    if (++count > 64)
      throw new NativeSourceError(
        "source-transform",
        "The source offset chain is too deep.",
      );
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    x -= ancestor.scrollLeft;
    y -= ancestor.scrollTop;
  }
  return { x, y };
}

function axisLength(raw: string, size: number): number | null {
  const value = raw.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(value))
    return Number(value.slice(0, -2));
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(value))
    return (Number(value.slice(0, -1)) * size) / 100;
  return null;
}

const IDENTITY_AFFINE: NativeAffine2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

function translated(x: number, y: number): NativeAffine2D {
  return { ...IDENTITY_AFFINE, e: x, f: y };
}

function composeAffine(
  outer: NativeAffine2D,
  inner: NativeAffine2D,
): NativeAffine2D {
  const result = composeNativeSourceAffine(outer, inner);
  if (!result.ok)
    throw new NativeSourceError(
      "source-transform",
      `A 2D source transform is ${result.reason}.`,
    );
  return result.matrix;
}

function rotateRadians(value: string): number {
  if (!value || value === "none") return 0;
  const raw = value.startsWith("z ") ? value.slice(2) : value;
  const match = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(deg|rad|turn)$/);
  if (!match)
    throw new NativeSourceError(
      "source-transform",
      "A descendant needs unsupported 3D or unreadable rotation.",
    );
  const amount = Number(match[1]);
  return match[2] === "deg"
    ? (amount * Math.PI) / 180
    : match[2] === "turn"
      ? amount * Math.PI * 2
      : amount;
}

function nodeGlobalTransform(element: HTMLElement): NativeAffine2D {
  const style = getComputedStyle(element);
  if (
    (style.perspective && style.perspective !== "none") ||
    style.transformStyle === "preserve-3d"
  )
    throw new NativeSourceError(
      "source-transform",
      "A descendant needs unsupported 3D or perspective projection.",
    );
  let css = IDENTITY_AFFINE;
  if (style.transform && style.transform !== "none") {
    let matrix: DOMMatrixReadOnly;
    try {
      matrix = new DOMMatrixReadOnly(style.transform);
    } catch {
      throw new NativeSourceError(
        "source-transform",
        "A descendant source transform is unreadable.",
      );
    }
    if (!matrix.is2D)
      throw new NativeSourceError(
        "source-transform",
        "A descendant source uses a 3D transform.",
      );
    css = {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      e: matrix.e,
      f: matrix.f,
    };
  }
  const scales =
    !style.scale || style.scale === "none"
      ? []
      : style.scale.split(/\s+/).map(Number);
  if (
    scales.length > 2 ||
    scales.some((value) => !Number.isFinite(value) || value === 0)
  )
    throw new NativeSourceError(
      "source-transform",
      "A descendant source scale is unreadable or singular.",
    );
  const scaleX = scales[0] ?? 1;
  const scaleY = scales[1] ?? scaleX;
  css = composeAffine({ a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 }, css);
  const radians = rotateRadians(style.rotate);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  css = composeAffine(
    { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 },
    css,
  );
  const translations =
    !style.translate || style.translate === "none"
      ? []
      : style.translate.split(/\s+/);
  if (translations.length > 2)
    throw new NativeSourceError(
      "source-transform",
      "A descendant source has a 3D translation.",
    );
  const translateX = translations.length
    ? axisLength(translations[0], element.offsetWidth)
    : 0;
  const translateY =
    translations.length > 1
      ? axisLength(translations[1], element.offsetHeight)
      : 0;
  const origins = (style.transformOrigin || "50% 50%").split(/\s+/);
  const originX = axisLength(origins[0], element.offsetWidth);
  const originY = axisLength(origins[1], element.offsetHeight);
  if (
    translateX === null ||
    translateY === null ||
    originX === null ||
    originY === null ||
    (origins[2] && origins[2] !== "0px")
  )
    throw new NativeSourceError(
      "source-transform",
      "A descendant source transform length is unreadable.",
    );
  css = composeAffine(translated(translateX, translateY), css);
  const anchor = layoutPosition(element);
  const pivotX = anchor.x + originX;
  const pivotY = anchor.y + originY;
  return composeAffine(
    translated(pivotX, pivotY),
    composeAffine(css, translated(-pivotX, -pivotY)),
  );
}

function sourceLayoutSize(
  element: HTMLElement,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
): { width: number; height: number } {
  if (
    space !== "target-viewport-axis-aligned" &&
    element === target &&
    element === document.documentElement &&
    Number.isFinite(element.offsetWidth) &&
    Number.isFinite(element.offsetHeight) &&
    element.offsetWidth >= 0 &&
    element.offsetHeight >= 0 &&
    (element.offsetWidth === 0 || element.offsetHeight === 0)
  )
    return { width: innerWidth, height: innerHeight };
  return { width: element.offsetWidth, height: element.offsetHeight };
}

function hasEmptySourceLayout(size: {
  width: number;
  height: number;
}): boolean {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width < 0 ||
    size.height < 0
  )
    throw new NativeSourceError(
      "source-transform",
      "A source has invalid layout dimensions.",
    );
  return size.width === 0 || size.height === 0;
}

function viewportSourceAffine(element: HTMLElement): NativeAffine2D {
  const position = layoutPosition(element);
  let matrix = translated(position.x, position.y);
  for (let node: HTMLElement | null = element; node; node = node.parentElement)
    matrix = composeAffine(nodeGlobalTransform(node), matrix);
  const measured = element.getBoundingClientRect();
  const projected = planNativeSourceAffine({
    localBox: {
      x: 0,
      y: 0,
      width: element.offsetWidth,
      height: element.offsetHeight,
    },
    localToTarget: matrix,
    physicalScale: { x: 1, y: 1 },
  });
  if (
    !projected.ok ||
    Math.abs(projected.physicalBounds.width - measured.width) >
      Math.max(0.5, measured.width * 0.02) ||
    Math.abs(projected.physicalBounds.height - measured.height) >
      Math.max(0.5, measured.height * 0.02)
  )
    throw new NativeSourceError("source-transform", "source-transform");
  return {
    ...matrix,
    e: matrix.e + measured.left - projected.physicalBounds.x,
    f: matrix.f + measured.top - projected.physicalBounds.y,
  };
}

function viewportToTargetAffine(target: HTMLElement): NativeAffine2D {
  const inverted = invertNativeSourceAffine(viewportSourceAffine(target));
  if (!inverted.ok)
    throw new NativeSourceError("source-transform", "source-transform");
  return inverted.matrix;
}

function relativeAffine(
  element: Element,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
  localBox?: NativeAffineBox,
): {
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  rect: NativeAffineBox;
} {
  if (!(element instanceof HTMLElement) || !(target instanceof HTMLElement))
    throw new NativeSourceError(
      "source-transform",
      "A source has no HTML layout box.",
    );
  const size = sourceLayoutSize(element, target, space);
  const box = localBox ?? { x: 0, y: 0, ...size };
  let matrix: NativeAffine2D;
  if (space === "target-local") {
    const position = layoutPosition(element);
    matrix = translated(position.x, position.y);
    let node: HTMLElement | null = element;
    while (node && node !== target) {
      matrix = composeAffine(nodeGlobalTransform(node), matrix);
      node = node.parentElement;
    }
    if (node !== target)
      throw new NativeSourceError(
        "source-transform",
        "The source is outside the selected target.",
      );
    const targetPosition = layoutPosition(target);
    matrix = composeAffine(
      translated(-targetPosition.x, -targetPosition.y),
      matrix,
    );
  } else if (space === "target-local-global") {
    matrix = composeAffine(
      viewportToTargetAffine(target),
      viewportSourceAffine(element),
    );
  } else {
    const targetRect = target.getBoundingClientRect();
    matrix = composeAffine(
      translated(-targetRect.left, -targetRect.top),
      viewportSourceAffine(element),
    );
  }
  const result = planNativeSourceAffine({
    localBox: box,
    localToTarget: matrix,
    physicalScale: { x: 1, y: 1 },
  });
  if (!result.ok)
    throw new NativeSourceError(
      "source-transform",
      `A source has ${result.reason} affine geometry.`,
    );
  return {
    localBox: box,
    localToTarget: matrix,
    rect: result.physicalBounds,
  };
}

function targetLocalRect(
  element: Element,
  target: Element,
): NativeSourceRecord["rect"] {
  return relativeAffine(element, target, "target-local").rect;
}

function relativeRect(
  element: Element,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
): NativeSourceRecord["rect"] {
  return relativeAffine(element, target, space).rect;
}

function sourceClipAncestors(
  element: Element,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
): Element[] {
  const ancestors: Element[] = [];
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (space === "target-local" && !target.contains(ancestor)) break;
    ancestors.push(ancestor);
    if (ancestor === target) break;
  }
  return ancestors;
}

export function sourceClipPlan(
  element: Element,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
  includeOwnMedia: boolean,
  ownTextClipEdge: NativeSourceClipCandidate["edge"] | null = null,
  ownTextClipOutset = 0,
  ownMediaClipEdge: NativeSourceClipCandidate["edge"] = "content",
): {
  clip: NativeSourceRecord["clip"];
  ancestorClip: NativeSourceRecord["clip"];
  clips: NativeSourceClip[];
  groupClips: { node: Element; clip: NativeSourceClip }[];
} {
  const targetBox =
    space === "target-viewport-axis-aligned"
      ? viewportRelativeRect(target, target)
      : relativeAffine(target, target, space).rect;
  let targetClip = {
    x: 0,
    y: 0,
    width: targetBox.width,
    height: targetBox.height,
  };
  const allClips: NativeSourceClip[] = [];
  const groups: Element[] = [];
  const append = (
    node: Element,
    edge: NativeSourceClipCandidate["edge"],
    group: boolean,
    outset = 0,
  ): void => {
    if (allClips.length >= MAX_NATIVE_SOURCE_CLIPS)
      throw new NativeSourceError(
        "source-clip-too-many-clips",
        `A source requires more than ${MAX_NATIVE_SOURCE_CLIPS} rounded clips.`,
      );
    assertLeafSupported(node, space === "target-local" ? target : undefined);
    if (!(node instanceof HTMLElement))
      throw new NativeSourceError(
        "source-clip-unreadable",
        "A source clip has no HTML border box.",
      );
    const style = getComputedStyle(node);
    const { width: localWidth, height: localHeight } = sourceLayoutSize(
      node,
      target,
      space,
    );
    const radii = resolveNativeClipRadii({
      width: localWidth,
      height: localHeight,
      cssPixelScale: 1,
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
    });
    if (!radii.ok)
      throw new NativeSourceError("source-clip-unreadable", radii.detail);
    const inset = (value: string): number => {
      const result = Number.parseFloat(value);
      if (!Number.isFinite(result) || result < 0)
        throw new NativeSourceError(
          "source-clip-unreadable",
          `Cannot resolve source clip inset ${value}.`,
        );
      return result;
    };
    const plan = planNativeSourceClips([
      {
        borderBox: { x: 0, y: 0, width: localWidth, height: localHeight },
        localWidth,
        localHeight,
        scaleX: 1,
        scaleY: 1,
        axisAligned: true,
        border: {
          top: inset(style.borderTopWidth),
          right: inset(style.borderRightWidth),
          bottom: inset(style.borderBottomWidth),
          left: inset(style.borderLeftWidth),
        },
        padding: {
          top: inset(style.paddingTop),
          right: inset(style.paddingRight),
          bottom: inset(style.paddingBottom),
          left: inset(style.paddingLeft),
        },
        outerRadii: radii.radii,
        edge,
        outset,
      },
    ]);
    if (!plan.ok)
      throw new NativeSourceError(`source-clip-${plan.reason}`, plan.detail);
    const localClip = plan.clips[0];
    const geometry = relativeAffine(node, target, space, localClip.rect);
    allClips.push({
      rect: geometry.rect,
      localBox: localClip.rect,
      localToTarget: geometry.localToTarget,
      radii: localClip.radii,
    });
    if (group) groups.push(node);
  };
  if (includeOwnMedia) append(element, ownMediaClipEdge, false);
  if (ownTextClipEdge)
    append(element, ownTextClipEdge, true, ownTextClipOutset);
  for (const ancestor of sourceClipAncestors(element, target, space)) {
    const style = getComputedStyle(ancestor);
    const overflow = classifyNativeComputedOverflowClip(style);
    if (!overflow.ok)
      throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
    if (overflow.edge !== "none")
      append(ancestor, overflow.edge, true, overflow.outset);
  }
  const ownCount = includeOwnMedia ? 1 : 0;
  const expandTargetClip = (shape: NativeSourceClip["rect"]): void => {
    const x = Math.min(0, shape.x);
    const y = Math.min(0, shape.y);
    const right = Math.max(targetBox.width, shape.x + shape.width);
    const bottom = Math.max(targetBox.height, shape.y + shape.height);
    targetClip = { x, y, width: right - x, height: bottom - y };
  };
  if (space !== "target-viewport-axis-aligned") {
    const targetIndex = groups.indexOf(target);
    if (targetIndex >= 0) {
      expandTargetClip(allClips[ownCount + targetIndex].rect);
    } else {
      const targetOverflow = classifyNativeComputedOverflowClip(
        getComputedStyle(target),
      );
      if (!targetOverflow.ok)
        throw new NativeSourceError(
          `source-${targetOverflow.reason}`,
          targetOverflow.detail,
        );
      if (targetOverflow.edge !== "none") {
        append(target, targetOverflow.edge, false, targetOverflow.outset);
        const targetShape = allClips.pop();
        if (!targetShape)
          throw new NativeSourceError(
            "source-clip-unreadable",
            "The target overflow clip has no projected geometry.",
          );
        expandTargetClip(targetShape.rect);
      }
    }
  }
  let clip = targetClip;
  for (const sourceClip of allClips) clip = intersect(clip, sourceClip.rect);
  let ancestorClip = targetClip;
  for (const group of allClips.slice(ownCount))
    ancestorClip = intersect(ancestorClip, group.rect);
  return {
    clip,
    ancestorClip,
    clips: includeOwnMedia ? allClips.slice(0, 1) : [],
    groupClips: groups.map((node, index) => ({
      node,
      clip: allClips[index + ownCount],
    })),
  };
}

function nativeBackdropReceiver(canvas: HTMLCanvasElement): HTMLElement {
  let sibling = canvas.nextElementSibling;
  while (
    sibling instanceof HTMLCanvasElement &&
    sibling.hasAttribute("data-an-native-backdrop-presentation")
  )
    sibling = sibling.nextElementSibling;
  const receiverNodeId = canvas.getAttribute(
    "data-an-native-backdrop-receiver-node-id",
  );
  if (
    !receiverNodeId ||
    !(sibling instanceof HTMLElement) ||
    sibling.getAttribute("data-agent-native-node-id") !== receiverNodeId
  )
    throw new NativeSourceError(
      "source-composition-unsupported",
      "source-composition-unsupported",
    );
  return sibling;
}

export function nativeTargetOverflowInsets(target: HTMLElement): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const overflow = classifyNativeComputedOverflowClip(getComputedStyle(target));
  if (!overflow.ok)
    throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
  if (overflow.edge === "none") return { top: 0, right: 0, bottom: 0, left: 0 };
  const clip = sourceClipPlan(
    target,
    target,
    "target-local",
    false,
    overflow.edge,
    overflow.outset,
  ).groupClips[0]?.clip.localBox;
  if (!clip)
    throw new NativeSourceError(
      "source-clip-unreadable",
      "The target overflow clip has no local geometry.",
    );
  const width = target.offsetWidth;
  const height = target.offsetHeight;
  return {
    top: Math.max(0, -clip.y),
    right: Math.max(0, clip.x + clip.width - width),
    bottom: Math.max(0, clip.y + clip.height - height),
    left: Math.max(0, -clip.x),
  };
}

function assertCurrentCaptureRoi(
  committed: NativeCaptureRoi | null,
  expected: NativeCaptureRoi,
  requiresExpandedCapture: boolean,
): void {
  if (!committed && !requiresExpandedCapture) return;
  if (
    !committed ||
    Object.keys(expected.cssBox).some(
      (key) =>
        committed.cssBox[key as keyof NativeCaptureRoi["cssBox"]] !==
        expected.cssBox[key as keyof NativeCaptureRoi["cssBox"]],
    ) ||
    Object.keys(expected.pixelBox).some(
      (key) =>
        committed.pixelBox[key as keyof NativeCaptureRoi["pixelBox"]] !==
        expected.pixelBox[key as keyof NativeCaptureRoi["pixelBox"]],
    )
  )
    throw new NativeSourceError(
      "source-capture-geometry-stale",
      "The committed source raster no longer matches its clip geometry.",
    );
}

export function assertDomSiblingOrder(
  parent: Element,
  receiverBranch: Element,
  receiver: Element,
  records: readonly Pick<NativeSourceRecord, "node" | "rect" | "clip">[],
): void {
  if (parent.childElementCount < 2) return;
  const siblings: {
    firstRecord: number;
    footprints: NativeStackingFootprint[];
    unsupportedFlexGridPaint: boolean;
  }[] = [];
  const flexOrGrid = isFlexOrGridDisplay(getComputedStyle(parent).display);
  let paintCount = 0;
  let passedReceiverBranch = false;
  const receiverRect = receiver.getBoundingClientRect();
  const receiverBox = {
    x: receiverRect.left,
    y: receiverRect.top,
    width: receiverRect.width,
    height: receiverRect.height,
  };
  const receiverOrder = sourceStackingOrder(receiver, parent);
  for (const child of parent.children) {
    if (passedReceiverBranch) {
      if (
        laterPaintMayPrecedeReceiver(
          child,
          receiverBox,
          receiverOrder,
          flexOrGrid && hasUnsupportedFlexGridItemPaint(child),
        )
      )
        throw new NativeSourceError(
          "source-stacking-order",
          "A later source may paint behind the backdrop receiver.",
        );
      continue;
    }
    if (child.matches(OMIT) || child.hasAttribute("data-an-native-canvas")) {
      if (child === receiverBranch) passedReceiverBranch = true;
      continue;
    }
    const firstRecord = records.findIndex(
      (record) => child === record.node || child.contains(record.node),
    );
    const boxes = records
      .filter((record) => child === record.node || child.contains(record.node))
      .map((record) => intersect(record.rect, record.clip))
      .filter((box) => box.width > 0 && box.height > 0);
    if (!boxes.length) {
      if (child === receiverBranch) passedReceiverBranch = true;
      continue;
    }
    const style = getComputedStyle(child);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      authoredOpacity(child) <= 0
    ) {
      if (child === receiverBranch) passedReceiverBranch = true;
      continue;
    }
    const phase = sourceStackingContext(child).order.phase;
    siblings.push({
      firstRecord,
      footprints: boxes.map((box) => ({ box, zIndex: style.zIndex, phase })),
      unsupportedFlexGridPaint:
        flexOrGrid && hasUnsupportedFlexGridItemPaint(child),
    });
    paintCount += boxes.length;
    if (paintCount > 256)
      throw new NativeSourceError(
        "source-stacking-complex",
        "More than 256 overlapping-order candidates need a bounded source compositor.",
      );
    if (child === receiverBranch) passedReceiverBranch = true;
  }
  siblings.sort((first, second) => first.firstRecord - second.firstRecord);
  for (let earlier = 0; earlier < siblings.length; earlier++)
    for (let later = earlier + 1; later < siblings.length; later++)
      for (const first of siblings[earlier].footprints)
        for (const second of siblings[later].footprints)
          if (
            (nativeBoxesOverlap(first.box, second.box) &&
              (siblings[earlier].unsupportedFlexGridPaint ||
                siblings[later].unsupportedFlexGridPaint)) ||
            hasUnsupportedStackingOrder([first, second])
          )
            throw new NativeSourceError(
              "source-stacking-order",
              "Overlapping CSS stacking order differs from this source compositor's DOM order.",
            );
}

interface SourceStackingOrder {
  rank: number;
  phase: NativeStackingFootprint["phase"];
}

function isFlexOrGridDisplay(display: string): boolean {
  return /^(inline-)?(flex|grid)$/.test(display);
}

function hasUnsupportedFlexGridItemPaint(element: Element): boolean {
  const style = getComputedStyle(element);
  const order = Number(style.order);
  return (
    !/^[-+]?\d+$/.test(style.order ?? "") ||
    !Number.isSafeInteger(order) ||
    order !== 0 ||
    (style.zIndex !== "auto" && style.zIndex !== "")
  );
}

function hasSourceTransform(style: CSSStyleDeclaration): boolean {
  return (
    (!!style.transform && style.transform !== "none") ||
    (!!style.translate && style.translate !== "none") ||
    (!!style.rotate && style.rotate !== "none") ||
    (!!style.scale && style.scale !== "none")
  );
}

function sourceStackingContext(element: Element): {
  order: SourceStackingOrder;
  isolates: boolean;
} {
  const style = getComputedStyle(element);
  const parentDisplay = element.parentElement
    ? getComputedStyle(element.parentElement).display
    : "block";
  const positioned = style.position !== "static";
  const flexOrGridItem = isFlexOrGridDisplay(parentDisplay);
  const transformed = hasSourceTransform(style);
  const zIndex = Number(style.zIndex);
  const explicit =
    /^[-+]?\d+$/.test(style.zIndex ?? "") &&
    Number.isSafeInteger(zIndex) &&
    (positioned || flexOrGridItem);
  const phase: SourceStackingOrder["phase"] =
    positioned ||
    (explicit && flexOrGridItem) ||
    transformed ||
    style.isolation === "isolate" ||
    authoredOpacity(element) < 1
      ? "positioned"
      : "flow";
  return {
    order: { rank: explicit ? zIndex : 0, phase },
    isolates:
      explicit ||
      style.position === "fixed" ||
      style.position === "sticky" ||
      transformed ||
      style.isolation === "isolate" ||
      authoredOpacity(element) < 1,
  };
}

function sourceStackingOrder(
  receiver: Element,
  parent: Element,
): SourceStackingOrder {
  const path: Element[] = [];
  for (
    let node: Element | null = receiver;
    node && node !== parent;
    node = node.parentElement
  )
    path.unshift(node);
  let phase: SourceStackingOrder["phase"] = "flow";
  for (const element of path) {
    const context = sourceStackingContext(element);
    if (context.order.phase === "positioned") phase = "positioned";
    if (context.isolates) return { ...context.order, phase };
  }
  return { rank: 0, phase };
}

function orderAutoStackingSiblingPaint(
  parent: Element,
  groups: readonly (readonly NativeSourceRecord[])[],
): (readonly NativeSourceRecord[])[] {
  if (isFlexOrGridDisplay(getComputedStyle(parent).display)) return [...groups];
  const phases = groups.map((records) => {
    const first = sourceStackingOrder(records[0].node, parent);
    if (
      first.rank !== 0 ||
      records.some((record) => {
        const order = sourceStackingOrder(record.node, parent);
        return order.rank !== 0 || order.phase !== first.phase;
      })
    )
      return null;
    return first.phase;
  });
  if (phases.includes(null)) return [...groups];
  return [
    ...groups.filter((_, index) => phases[index] === "flow"),
    ...groups.filter((_, index) => phases[index] === "positioned"),
  ];
}

function commonSourcePaintAncestor(
  first: Element,
  second: Element,
  stop: Element,
): Element {
  const firstPath = new Set<Element>();
  for (let node: Element | null = first; node; node = node.parentElement) {
    firstPath.add(node);
    if (node === stop) break;
  }
  for (let node: Element | null = second; node; node = node.parentElement) {
    if (firstPath.has(node)) return node;
    if (node === stop) break;
  }
  throw new NativeSourceError(
    "source-stacking-order",
    "Source paint records do not share the selected composition root.",
  );
}

export function transformedSourcePaintIsContiguous(
  nodes: readonly Element[],
  owners: readonly (Element | null)[],
): boolean {
  const intervals = new Map<Element, { first: number; last: number }>();
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    if (!owner) continue;
    const interval = intervals.get(owner);
    if (interval) interval.last = index;
    else intervals.set(owner, { first: index, last: index });
  }
  for (const [owner, interval] of intervals)
    for (let index = interval.first; index <= interval.last; index += 1)
      if (!owner.contains(nodes[index])) return false;
  return true;
}

function sourcePaintScope(leaf: Element, stop: Element): Element {
  if (leaf !== stop && getComputedStyle(leaf).isolation === "isolate")
    return leaf;
  for (
    let current = leaf.parentElement;
    current && current !== stop;
    current = current.parentElement
  )
    if (sourceStackingContext(current).isolates) return current;
  return stop;
}

function sourceLeafPaintOrder(
  leaf: Element,
  scope: Element,
): SourceStackingOrder {
  if (leaf === scope) return { rank: 0, phase: "context-own" };
  let phase: SourceStackingOrder["phase"] = "flow";
  for (
    let current: Element | null = leaf;
    current && current !== scope;
    current = current.parentElement
  ) {
    const context = sourceStackingContext(current);
    if (context.order.phase === "positioned") phase = "positioned";
    if (context.isolates) return { ...context.order, phase };
  }
  return { rank: 0, phase };
}

function laterPaintMayPrecedeReceiver(
  root: Element,
  receiver: NativeSourceBox,
  receiverOrder: SourceStackingOrder,
  uncertainFlexGridOrder = false,
): boolean {
  const pending: Array<{
    element: Element;
    context: SourceStackingOrder | null;
  }> = [{ element: root, context: null }];
  let visited = 0;
  while (pending.length) {
    if (++visited > 256)
      throw new NativeSourceError(
        "source-stacking-complex",
        "A later source has too many stacking candidates to classify.",
      );
    const { element, context } = pending.pop()!;
    if (element.matches(OMIT) || element.hasAttribute("data-an-native-canvas"))
      continue;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      authoredOpacity(element) <= 0
    )
      continue;
    const current = sourceStackingContext(element);
    const order = context ?? current.order;
    const precedes =
      uncertainFlexGridOrder ||
      order.rank < receiverOrder.rank ||
      (order.rank === receiverOrder.rank &&
        receiverOrder.phase === "positioned" &&
        order.phase === "flow");
    if (
      precedes &&
      ((element instanceof HTMLElement &&
        (hasOwnPaint(element) ||
          element instanceof HTMLImageElement ||
          element instanceof HTMLVideoElement ||
          element instanceof HTMLCanvasElement)) ||
        element instanceof SVGElement)
    ) {
      const rect = element.getBoundingClientRect();
      if (
        nativeBoxesOverlap(receiver, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        })
      )
        return true;
    }
    if (
      !uncertainFlexGridOrder &&
      (order.rank > receiverOrder.rank ||
        (context && !precedes && order.rank === receiverOrder.rank))
    )
      continue;
    const nextContext = context ?? (current.isolates ? order : null);
    for (const child of element.children)
      pending.push({ element: child, context: nextContext });
  }
  return false;
}

type NativeOwnPaintPhase =
  | "all"
  | "background"
  | "border"
  | "coverage"
  | "inner-coverage"
  | "foreground"
  | "glyph";

function cloneOwnPaint(
  element: HTMLElement,
  preserveNativeTextFlow = false,
  phase: NativeOwnPaintPhase = "all",
  fillPaint?: NativeFillBackgroundPaint,
): HTMLElement {
  const boxPhase =
    phase === "background" ||
    phase === "border" ||
    phase === "coverage" ||
    phase === "inner-coverage";
  const clone = boxPhase
    ? document.createElement("div")
    : (element.cloneNode(true) as HTMLElement);
  for (const node of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
    node.removeAttribute("data-an-native-fill-suppressed");
    node.removeAttribute("data-an-native-text-suppressed");
    node.removeAttribute("data-an-native-fill-instance");
  }
  const fullTextFlow =
    phase === "foreground" ||
    phase === "glyph" ||
    (phase === "all" &&
      (preserveNativeTextFlow
        ? isPureTextFlow(element)
        : isSourceTextFlow(element)));
  const ownText = !boxPhase && hasDirectText(element);
  if (fullTextFlow) preserveTextFlowStyles(element, clone);
  for (
    let index = fullTextFlow || boxPhase ? -1 : element.children.length - 1;
    index >= 0;
    index -= 1
  ) {
    const child = element.children[index];
    const copy = clone.children[index] as HTMLElement;
    const style = getComputedStyle(child);
    if (
      style.position === "absolute" ||
      style.position === "fixed" ||
      style.display === "none"
    ) {
      copy.remove();
      continue;
    }
    if (ownText && isInlineFlowChild(child)) {
      if (
        !(child instanceof HTMLElement) ||
        child instanceof HTMLImageElement ||
        child instanceof HTMLCanvasElement ||
        child instanceof HTMLVideoElement
      ) {
        throw new NativeSourceError(
          "source-inline-media",
          "Inline media mixed into a text flow needs a separate source path.",
        );
      }
      copyComputedCss(child, copy);
      continue;
    }
    if (ownText)
      throw new NativeSourceError(
        "source-mixed-flow",
        "Block children mixed with direct text cannot be split without changing text layout.",
      );
    copy.remove();
  }
  copyComputedCss(element, clone);
  clone.style.position = "static";
  clone.style.left = "auto";
  clone.style.top = "auto";
  clone.style.margin = "0";
  clone.style.transform = "none";
  clone.style.translate = "none";
  clone.style.rotate = "none";
  clone.style.scale = "none";
  clone.style.opacity = "1";
  if (boxPhase) {
    if (!fillPaint)
      throw new NativeSourceError(
        "fill-background-unreadable",
        "The authored Fill background is unavailable.",
      );
    for (const match of fillPaint.image.matchAll(/url\(["']?([^"')]+)["']?\)/g))
      assertLocalAsset(match[1]);
    for (const match of fillPaint.borderImageSource.matchAll(
      /url\(["']?([^"')]+)["']?\)/g,
    ))
      assertLocalAsset(match[1]);
    clone.style.backgroundColor =
      phase === "coverage" || phase === "inner-coverage"
        ? OPAQUE_COVERAGE_COLOR
        : phase === "background"
          ? fillPaint.color
          : "transparent";
    clone.style.backgroundImage =
      phase === "background" ? fillPaint.image : "none";
    clone.style.borderTopColor =
      phase === "border" ? fillPaint.borderTopColor : "transparent";
    clone.style.borderRightColor =
      phase === "border" ? fillPaint.borderRightColor : "transparent";
    clone.style.borderBottomColor =
      phase === "border" ? fillPaint.borderBottomColor : "transparent";
    clone.style.borderLeftColor =
      phase === "border" ? fillPaint.borderLeftColor : "transparent";
    clone.style.borderImageSource =
      phase === "border" ? fillPaint.borderImageSource : "none";
    if (phase === "coverage") clone.style.backgroundClip = "border-box";
    if (phase === "inner-coverage") {
      const style = getComputedStyle(element);
      const overflow = classifyNativeComputedOverflowClip(style);
      if (!overflow.ok)
        throw new NativeSourceError(
          `source-${overflow.reason}`,
          overflow.detail,
        );
      clone.style.backgroundClip =
        overflow.edge === "content"
          ? "content-box"
          : overflow.edge === "padding"
            ? "padding-box"
            : "border-box";
    }
    clone.style.boxShadow = "none";
    clone.style.outlineColor = "transparent";
  }
  if (phase === "foreground" || phase === "glyph") {
    if (!isPureTextFlow(element))
      throw new NativeSourceError(
        "fill-text-complex",
        "A Fill text foreground needs a text-only flow.",
      );
    const clearBox = (node: HTMLElement): void => {
      node.style.backgroundColor = "transparent";
      node.style.backgroundImage = "none";
      node.style.borderColor = "transparent";
      node.style.borderImageSource = "none";
      node.style.boxShadow = "none";
      node.style.outlineColor = "transparent";
      for (const child of node.children)
        if (
          child instanceof HTMLElement &&
          !child.hasAttribute("data-an-native-canvas")
        )
          clearBox(child);
    };
    clearBox(clone);
  }
  return clone;
}

export function cloneNativeFillBackground(
  element: HTMLElement,
  paint: NativeFillBackgroundPaint,
): HTMLElement {
  return cloneOwnPaint(element, false, "background", paint);
}

export function cloneNativeFillBoxPhase(
  element: HTMLElement,
  paint: NativeFillBackgroundPaint,
  phase: "background" | "border" | "coverage" | "inner-coverage",
): HTMLElement {
  return cloneOwnPaint(element, false, phase, paint);
}

export function cloneNativeTextFlow(element: HTMLElement): HTMLElement {
  if (!isPureTextFlow(element))
    throw new NativeSourceError(
      "text-mask-complex",
      "Text masks require an editable text-only subtree without media.",
    );
  const clone = cloneOwnPaint(element, true);
  const whiten = (node: HTMLElement): void => {
    // guard:allow-raw-color — source capture text masks encode opaque white coverage.
    node.style.color = OPAQUE_COVERAGE_COLOR;
    // guard:allow-raw-color — the WebKit text-fill path must encode the same mask coverage.
    node.style.setProperty("-webkit-text-fill-color", OPAQUE_COVERAGE_COLOR);
    node.style.backgroundColor = "transparent";
    node.style.backgroundImage = "none";
    node.style.borderColor = "transparent";
    node.style.boxShadow = "none";
    node.style.opacity = "1";
    for (const child of node.children)
      if (child instanceof HTMLElement) whiten(child);
  };
  whiten(clone);
  return clone;
}

export function traceNativeRoundedBoxPath(
  context: Pick<
    CanvasRenderingContext2D,
    "beginPath" | "moveTo" | "lineTo" | "ellipse" | "closePath"
  >,
  box: { x: number; y: number; width: number; height: number },
  radii: NativeClipRadii,
  scaleX = 1,
  scaleY = 1,
): void {
  const left = box.x * scaleX;
  const top = box.y * scaleY;
  const right = (box.x + box.width) * scaleX;
  const bottom = (box.y + box.height) * scaleY;
  const tl = radii.topLeft;
  const tr = radii.topRight;
  const br = radii.bottomRight;
  const bl = radii.bottomLeft;
  const roundedTl = tl.x > 0 && tl.y > 0;
  const roundedTr = tr.x > 0 && tr.y > 0;
  const roundedBr = br.x > 0 && br.y > 0;
  const roundedBl = bl.x > 0 && bl.y > 0;
  context.beginPath();
  context.moveTo(left + (roundedTl ? tl.x * scaleX : 0), top);
  context.lineTo(right - (roundedTr ? tr.x * scaleX : 0), top);
  if (roundedTr)
    context.ellipse(
      right - tr.x * scaleX,
      top + tr.y * scaleY,
      tr.x * scaleX,
      tr.y * scaleY,
      0,
      -Math.PI / 2,
      0,
    );
  else context.lineTo(right, top);
  context.lineTo(right, bottom - (roundedBr ? br.y * scaleY : 0));
  if (roundedBr)
    context.ellipse(
      right - br.x * scaleX,
      bottom - br.y * scaleY,
      br.x * scaleX,
      br.y * scaleY,
      0,
      0,
      Math.PI / 2,
    );
  else context.lineTo(right, bottom);
  context.lineTo(left + (roundedBl ? bl.x * scaleX : 0), bottom);
  if (roundedBl)
    context.ellipse(
      left + bl.x * scaleX,
      bottom - bl.y * scaleY,
      bl.x * scaleX,
      bl.y * scaleY,
      0,
      Math.PI / 2,
      Math.PI,
    );
  else context.lineTo(left, bottom);
  context.lineTo(left, top + (roundedTl ? tl.y * scaleY : 0));
  if (roundedTl)
    context.ellipse(
      left + tl.x * scaleX,
      top + tl.y * scaleY,
      tl.x * scaleX,
      tl.y * scaleY,
      0,
      Math.PI,
      (3 * Math.PI) / 2,
    );
  else context.lineTo(left, top);
  context.closePath();
}

export function clipCanvasToOwnTextOverflow(
  element: HTMLElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  captureRoi?: NativeCaptureRoi,
  density?: number,
): boolean {
  const style = getComputedStyle(element);
  const overflow = classifyNativeComputedOverflowClip(style);
  if (!overflow.ok)
    throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
  if (overflow.edge === "none") return false;
  const clip = sourceClipPlan(
    element,
    element,
    "target-local",
    false,
    overflow.edge,
    overflow.outset,
  ).groupClips[0]?.clip;
  if (!clip)
    throw new NativeSourceError(
      "source-clip-unreadable",
      "The text overflow clip has no local shape.",
    );
  const size = sizeOf(element);
  const scaleX = density ?? width / size.width;
  const scaleY = density ?? height / size.height;
  context.save();
  if (captureRoi)
    context.translate(captureRoi.pixelOffset.x, captureRoi.pixelOffset.y);
  traceNativeRoundedBoxPath(context, clip.localBox, clip.radii, scaleX, scaleY);
  context.clip();
  if (captureRoi)
    context.translate(-captureRoi.pixelOffset.x, -captureRoi.pixelOffset.y);
  return true;
}

export function applyNativeCaptureOverflowClip(
  clone: HTMLElement,
  overflow: Extract<NativeOverflowClipResult, { ok: true }>,
): void {
  if (overflow.edge === "none" || overflow.outset <= 0) return;
  const box =
    overflow.edge === "content"
      ? "content-box"
      : overflow.edge === "padding"
        ? "padding-box"
        : "border-box";
  clone.style.overflow = "clip";
  clone.style.setProperty(
    "overflow-clip-margin",
    `${box} ${overflow.outset}px`,
  );
}

async function rasterOwnPaint(
  element: HTMLElement,
  canvas: HTMLCanvasElement,
  density: number,
  phase: NativeOwnPaintPhase = "all",
  fillPaint?: NativeFillBackgroundPaint,
  glyphClone?: HTMLElement,
  glyphColors?: Map<Element, string>,
): Promise<void> {
  const size = sizeOf(element);
  const overflow = classifyNativeComputedOverflowClip(
    getComputedStyle(element),
  );
  if (!overflow.ok)
    throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
  const clipBox =
    overflow.edge === "none"
      ? { x: 0, y: 0, width: size.width, height: size.height }
      : sourceClipPlan(
          element,
          element,
          "target-local",
          false,
          overflow.edge,
          overflow.outset,
        ).groupClips[0]?.clip.localBox;
  if (!clipBox)
    throw new NativeSourceError(
      "source-clip-unreadable",
      "The source capture clip has no local geometry.",
    );
  const capture = planNativeCaptureRoi({
    ownBox: { x: 0, y: 0, width: size.width, height: size.height },
    clipBox,
    density,
    maxDimension: 4096,
    maxPixels: 8_388_608,
  });
  if (!capture.ok)
    throw new NativeSourceError(
      `source-${capture.reason}`,
      "A source has invalid or oversized expanded capture geometry.",
    );
  const { width, height } = capture.plan.pixelBox;
  const clone = glyphClone ?? cloneOwnPaint(element, false, phase, fillPaint);
  applyNativeCaptureOverflowClip(clone, overflow);
  const canvasText =
    phase !== "background" &&
    phase !== "border" &&
    phase !== "coverage" &&
    phase !== "inner-coverage" &&
    (hasDirectText(element) ||
      isSourceTextFlow(element) ||
      phase === "foreground" ||
      phase === "glyph") &&
    nativeTextFlowUsesDocumentFont(element);
  if (canvasText) {
    if (!isPureTextFlow(element))
      throw new NativeSourceError(
        "source-webfont-layout",
        "Webfont text mixed with independent child paint needs a separate source path.",
      );
    const clearText = (node: HTMLElement): void => {
      node.style.color = "transparent";
      node.style.setProperty("-webkit-text-fill-color", "transparent");
      node.style.textShadow = "none";
      for (const child of node.children)
        if (child instanceof HTMLElement) clearText(child);
    };
    clearText(clone);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden"><div style="width:${size.width}px;height:${size.height}px;transform:translate(${capture.plan.pixelOffset.x}px,${capture.plan.pixelOffset.y}px) scale(${density});transform-origin:0 0">${new XMLSerializer().serializeToString(clone)}</div></div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
  } catch {
    throw new NativeSourceError(
      "source-raster-failed",
      "The browser could not rasterize a DOM paint chunk.",
    );
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context)
    throw new NativeSourceError(
      "source-canvas-unavailable",
      "A 2D source canvas is unavailable.",
    );
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  if (
    (phase === "coverage" || phase === "inner-coverage") &&
    overflow.edge !== "none" &&
    overflow.outset > 0
  ) {
    const clip = sourceClipPlan(
      element,
      element,
      "target-local",
      false,
      overflow.edge,
      overflow.outset,
    ).groupClips[0]?.clip;
    if (!clip)
      throw new NativeSourceError(
        "source-clip-unreadable",
        "The Fill inner coverage has no rounded clip.",
      );
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(capture.plan.pixelOffset.x, capture.plan.pixelOffset.y);
    context.fillStyle = OPAQUE_COVERAGE_COLOR;
    if (phase === "coverage") {
      const style = getComputedStyle(element);
      const radii = resolveNativeClipRadii({
        width: size.width,
        height: size.height,
        cssPixelScale: 1,
        topLeft: style.borderTopLeftRadius,
        topRight: style.borderTopRightRadius,
        bottomRight: style.borderBottomRightRadius,
        bottomLeft: style.borderBottomLeftRadius,
      });
      if (!radii.ok)
        throw new NativeSourceError("source-clip-unreadable", radii.detail);
      traceNativeRoundedBoxPath(
        context,
        { x: 0, y: 0, width: size.width, height: size.height },
        radii.radii,
        density,
        density,
      );
      context.fill();
    }
    traceNativeRoundedBoxPath(
      context,
      clip.localBox,
      clip.radii,
      density,
      density,
    );
    context.fill();
    context.restore();
  }
  setNativeCaptureRoi(canvas, capture.plan);
  if (canvasText) {
    const clipped = clipCanvasToOwnTextOverflow(
      element,
      context,
      width,
      height,
      capture.plan,
      density,
    );
    try {
      await paintNativeTextFlow(element, canvas, false, glyphColors, {
        density,
        pixelOffset: capture.plan.pixelOffset,
      });
    } finally {
      if (clipped) context.restore();
    }
  }
}

async function rasterMediaBackground(
  element: HTMLElement,
  canvas: HTMLCanvasElement,
  density: number,
): Promise<void> {
  const size = sizeOf(element);
  const width = Math.ceil(size.width * density);
  const height = Math.ceil(size.height * density);
  if (width > 4096 || height > 4096 || width * height > 8_388_608)
    throw new NativeSourceError(
      "source-too-large",
      "A media background exceeds the bounded physical capture size.",
    );
  const style = getComputedStyle(element);
  const radii = resolveNativeClipRadii({
    width: size.width,
    height: size.height,
    cssPixelScale: 1,
    topLeft: style.borderTopLeftRadius,
    topRight: style.borderTopRightRadius,
    bottomRight: style.borderBottomRightRadius,
    bottomLeft: style.borderBottomLeftRadius,
  });
  if (!radii.ok)
    throw new NativeSourceError("source-clip-unreadable", radii.detail);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context)
    throw new NativeSourceError(
      "source-canvas-unavailable",
      "A 2D media background canvas is unavailable.",
    );
  context.save();
  context.scale(width / size.width, height / size.height);
  traceNativeRoundedBoxPath(
    context,
    { x: 0, y: 0, width: size.width, height: size.height },
    radii.radii,
  );
  context.fillStyle = style.backgroundColor;
  context.fill();
  context.restore();
}

function motionOnlyStyleChange(before: string, after: string): boolean {
  const oldStyle = document.createElement("div").style;
  const newStyle = document.createElement("div").style;
  oldStyle.cssText = before;
  newStyle.cssText = after;
  const names = new Set([...Array.from(oldStyle), ...Array.from(newStyle)]);
  for (const name of names) {
    if (
      [
        "transform",
        "translate",
        "scale",
        "left",
        "top",
        "right",
        "bottom",
      ].includes(name)
    )
      continue;
    if (
      oldStyle.getPropertyValue(name) !== newStyle.getPropertyValue(name) ||
      oldStyle.getPropertyPriority(name) !== newStyle.getPropertyPriority(name)
    )
      return false;
  }
  return true;
}

function runtimeCanvasMutation(record: MutationRecord): boolean {
  const runtimeCanvas =
    "canvas[data-an-native-canvas],canvas[data-an-native-presentation]";
  if (record.target instanceof Element && record.target.closest(runtimeCanvas))
    return true;
  if (record.type !== "childList") return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return (
    changed.length > 0 &&
    changed.every(
      (node) => node instanceof Element && node.matches(runtimeCanvas),
    )
  );
}

function omittedSourceMutation(record: MutationRecord): boolean {
  const target =
    record.target instanceof Element
      ? record.target
      : record.target.parentElement;
  if (target?.closest(OMIT)) return true;
  if (record.type !== "childList") return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return (
    changed.length > 0 &&
    changed.every((node) => node instanceof Element && node.matches(OMIT))
  );
}

export class CachedLeaf<T extends HTMLElement | SVGSVGElement = HTMLElement> {
  private canvas = document.createElement("canvas");
  private readonly capture = new NativeCaptureCache<HTMLCanvasElement>();
  revision = 0;
  private requestedWidth = -1;
  private requestedHeight = -1;
  private requestedContentWidth = Number.NaN;
  private requestedContentHeight = Number.NaN;
  private requestedDensity = -1;
  private contentMeasurementDirty = true;
  private observer: MutationObserver;
  private resizeObserver: ResizeObserver;

  constructor(
    readonly element: T,
    private readonly onCapture: () => void,
    private readonly density: () => number,
    private readonly raster: (
      element: T,
      canvas: HTMLCanvasElement,
      density: number,
    ) => Promise<void> = async (element, canvas, density) => {
      if (!(element instanceof HTMLElement))
        throw new NativeSourceError(
          "source-inline-svg",
          "An SVG source needs its vector raster path.",
        );
      await rasterOwnPaint(element, canvas, density);
    },
    private readonly onInvalidate: () => void = () => {},
    private readonly onInvalidationReason: (
      reason: NativeSourceInvalidationReason,
    ) => void = () => {},
    private readonly onObservedAttribute: (
      observation: NativeSourceAttributeObservation,
    ) => void = () => {},
  ) {
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (runtimeCanvasMutation(record)) continue;
        if (
          record.type === "attributes" &&
          document.documentElement.hasAttribute(
            "data-an-native-source-idle-observer",
          ) &&
          record.target instanceof Element &&
          record.attributeName
        ) {
          const target = record.target;
          this.onObservedAttribute({
            targetTag: target.tagName.toLowerCase(),
            targetNodeId: target.getAttribute("data-agent-native-node-id"),
            withinBody: document.body.contains(target),
            withinHead: document.head.contains(target),
            omitted: Boolean(target.closest(OMIT)),
            name: record.attributeName,
            oldValue: record.oldValue?.slice(0, 160) ?? null,
            newValue:
              target.getAttribute(record.attributeName)?.slice(0, 160) ?? null,
          });
        }
        if (omittedSourceMutation(record)) continue;
        if (record.type !== "attributes") {
          this.invalidate("content");
          break;
        }
        if (record.attributeName?.startsWith("data-an-native-")) continue;
        if (
          record.attributeName === "style" &&
          motionOnlyStyleChange(
            record.oldValue ?? "",
            (record.target as Element).getAttribute("style") ?? "",
          )
        ) {
          this.onInvalidate();
          continue;
        }
        this.invalidate("attributes");
        break;
      }
    });
    this.observer.observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
      attributeOldValue: true,
    });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.requestedWidth < 0 || this.requestedHeight < 0) return;
      try {
        const size = sizeOf(this.element);
        const content = contentBoxOf(this.element);
        const density = this.density();
        if (
          Math.ceil(size.width * density) === this.requestedWidth &&
          Math.ceil(size.height * density) === this.requestedHeight &&
          content.width === this.requestedContentWidth &&
          content.height === this.requestedContentHeight &&
          density === this.requestedDensity
        )
          return;
      } catch {
        this.invalidate("resize");
        return;
      }
      this.invalidate("resize");
    });
    this.resizeObserver.observe(element);
  }

  async read(): Promise<HTMLCanvasElement> {
    const size = sizeOf(this.element);
    const density = this.density();
    const width = Math.ceil(size.width * density);
    const height = Math.ceil(size.height * density);
    const rasterChanged =
      width !== this.requestedWidth ||
      height !== this.requestedHeight ||
      density !== this.requestedDensity;
    const content =
      this.contentMeasurementDirty || rasterChanged
        ? contentBoxOf(this.element)
        : {
            width: this.requestedContentWidth,
            height: this.requestedContentHeight,
          };
    if (
      rasterChanged ||
      content.width !== this.requestedContentWidth ||
      content.height !== this.requestedContentHeight
    ) {
      const reason =
        this.requestedWidth < 0
          ? "initial"
          : density !== this.requestedDensity
            ? "density"
            : "dimensions";
      this.requestedWidth = width;
      this.requestedHeight = height;
      this.requestedContentWidth = content.width;
      this.requestedContentHeight = content.height;
      this.requestedDensity = density;
      this.invalidate(reason);
    }
    this.contentMeasurementDirty = false;
    try {
      return await this.capture.read(
        async () => {
          const candidate = document.createElement("canvas");
          try {
            await this.raster(this.element, candidate, density);
            return candidate;
          } catch (error) {
            candidate.width = 0;
            candidate.height = 0;
            throw error;
          }
        },
        (candidate) => {
          const previous = this.canvas;
          this.canvas = candidate;
          this.revision += 1;
          this.onCapture();
          previous.width = 0;
          previous.height = 0;
        },
        (candidate) => {
          candidate.width = 0;
          candidate.height = 0;
        },
      );
    } catch (error) {
      if (error instanceof NativeCaptureCacheError)
        throw new NativeSourceError(error.code, error.message);
      if (error instanceof NativeSvgSourceError)
        throw new NativeSourceError(error.code, error.message);
      throw error;
    }
  }

  invalidate(reason: NativeSourceInvalidationReason = "explicit"): void {
    this.contentMeasurementDirty = true;
    this.capture.invalidate();
    this.onInvalidationReason(reason);
    this.onInvalidate();
  }
  dispose(): void {
    this.observer.disconnect();
    this.resizeObserver.disconnect();
    this.capture.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

class SceneProvider implements NativeSceneProvider {
  private readonly coordinateSpace: NativeSourceRecord["coordinateSpace"];
  private leaves = new Map<Element, CachedLeaf>();
  private fillBoxLeaves = new Map<
    "background" | "border" | "coverage" | "inner-coverage",
    CachedLeaf
  >();
  private fillForegroundLeaf: CachedLeaf | null = null;
  private fillGlyphLeaf: CachedLeaf | null = null;
  private fillGlyphClone: HTMLElement | null = null;
  private fillGlyphColors: Map<Element, string> | null = null;
  private fillBoxIds = new Map<
    "background" | "border" | "coverage" | "inner-coverage",
    number
  >();
  private fillForegroundId = 0;
  private fillGlyphId = 0;
  private fillPaint: NativeFillBackgroundPaint | null = null;
  private mediaBackgrounds = new Map<Element, CachedLeaf>();
  private svgLeaves = new Map<SVGSVGElement, CachedLeaf<SVGSVGElement>>();
  private ids = new WeakMap<Element, number>();
  private backgroundIds = new WeakMap<Element, number>();
  private nextId = 1;
  private assetRevision = 0;
  private sourceGeneration = 0;
  private authoredSourceGeneration = 0;
  private captures = 0;
  private readSceneCalls = 0;
  private createdLeaves = 0;
  private retiredLeaves = 0;
  private omittedLeafEntries = 0;
  private readonly invalidations: NativeSourceReasonCounts = {};
  private readonly leafDiagnostics = new Map<
    number,
    NativeSourceLeafDiagnostic
  >();
  private disposed = false;
  private groupLocalBackdropSource = false;
  private density = 1;
  private layerTargetOpacityDeferred = false;
  private viewportBackgroundCanvas: HTMLCanvasElement | null = null;
  private viewportBackgroundColor = "";
  private viewportBackgroundRevision = 0;
  private abort = new AbortController();
  private structureObserver: MutationObserver;
  private bodyStructureObserver: MutationObserver | null = null;
  private inheritedStyleObserver: MutationObserver;

  constructor(
    private readonly target: HTMLElement,
    private readonly placement: "fill" | "layer" | "backdrop",
    private readonly onDirty: () => void = () => {},
    private readonly backdropPresentation?: HTMLCanvasElement,
  ) {
    this.coordinateSpace =
      placement === "backdrop" ? "target-local-global" : "target-local";
    this.structureObserver = new MutationObserver(() =>
      this.invalidateAll("head"),
    );
    this.structureObserver.observe(document.head, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    if (
      this.placement === "layer" &&
      this.target === document.documentElement
    ) {
      this.bodyStructureObserver = new MutationObserver((records) => {
        if (
          records.some(
            (record) =>
              !runtimeCanvasMutation(record) && !omittedSourceMutation(record),
          )
        )
          this.invalidateAll("content");
      });
      this.bodyStructureObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    this.inheritedStyleObserver = new MutationObserver((records) => {
      let changed = false;
      let moved = false;
      const scope = this.placement === "backdrop" ? document.body : this.target;
      for (const record of records) {
        if (!(record.target instanceof Element)) continue;
        if (runtimeCanvasMutation(record)) continue;
        if (
          record.target.closest(OMIT) ||
          !(scope.contains(record.target) || record.target.contains(scope))
        )
          continue;
        if (
          record.attributeName === "style" &&
          motionOnlyStyleChange(
            record.oldValue ?? "",
            record.target.getAttribute("style") ?? "",
          )
        ) {
          moved = true;
          continue;
        }
        for (const cache of [
          this.leaves,
          this.mediaBackgrounds,
          this.svgLeaves,
        ])
          for (const [element, leaf] of cache)
            if (record.target !== element && record.target.contains(element)) {
              leaf.invalidate("ancestor-style");
              changed = true;
            }
        moved = true;
      }
      if (changed) this.assetRevision += 1;
      if (moved) {
        this.sourceGeneration += 1;
        this.authoredSourceGeneration += 1;
        this.onDirty();
      }
    });
    this.inheritedStyleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
      attributeOldValue: true,
      subtree: true,
    });
    document.fonts?.addEventListener("loadingdone", this.onFontLoaded, {
      signal: this.abort.signal,
    });
    document.addEventListener("load", this.onDocumentLoad, {
      capture: true,
      signal: this.abort.signal,
    });
    for (const type of [
      "play",
      "pause",
      "seeked",
      "loadeddata",
      "animationstart",
      "animationend",
      "transitionrun",
      "transitionend",
    ])
      document.addEventListener(type, this.wakeDynamicSource, {
        capture: true,
        signal: this.abort.signal,
      });
  }

  private omit(element: Element): boolean {
    if (
      !(element instanceof HTMLCanvasElement) ||
      !element.hasAttribute("data-an-native-backdrop-presentation")
    )
      return element.matches(OMIT);
    if (
      element.matches(
        "[data-agent-native-edit-overlay],[data-agent-native-editor-chrome],[data-agent-native-editor-chrome-host]",
      )
    )
      return true;
    if (this.placement === "layer")
      return (
        this.target !== document.documentElement &&
        !(this.groupLocalBackdropSource && this.target.contains(element))
      );
    if (!this.backdropPresentation || element === this.backdropPresentation)
      return true;
    return !(
      element.compareDocumentPosition(this.backdropPresentation) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  private wakeDynamicSource = (event: Event): void => {
    const scope = this.placement === "backdrop" ? document.body : this.target;
    if (!(event.target instanceof Node)) return;
    const withinSource = scope.contains(event.target);
    const ancestorAnimation =
      (event.type.startsWith("animation") ||
        event.type.startsWith("transition")) &&
      event.target instanceof Element &&
      event.target.contains(scope);
    if (withinSource || ancestorAnimation) this.onDirty();
  };

  private onFontLoaded = (): void => this.invalidateAll("font");
  private onDocumentLoad = (): void => this.invalidateAll("load");

  private invalidateAll(reason: NativeSourceInvalidationReason): void {
    this.assetRevision += 1;
    this.sourceGeneration += 1;
    if (reason !== "density") this.authoredSourceGeneration += 1;
    for (const leaf of this.leaves.values()) leaf.invalidate(reason);
    for (const leaf of this.fillBoxLeaves.values()) leaf.invalidate(reason);
    this.fillForegroundLeaf?.invalidate(reason);
    this.fillGlyphLeaf?.invalidate(reason);
    for (const leaf of this.mediaBackgrounds.values()) leaf.invalidate(reason);
    for (const leaf of this.svgLeaves.values()) leaf.invalidate(reason);
    this.onDirty();
  }

  invalidate = (): void => this.invalidateAll("explicit");

  setLayerTargetOpacityDeferred(deferred: boolean): void {
    if (
      this.placement !== "layer" ||
      this.layerTargetOpacityDeferred === deferred
    )
      return;
    this.layerTargetOpacityDeferred = deferred;
    this.invalidateAll("explicit");
  }

  private trackLeaf(
    element: Element,
    key: number,
    kind: NativeSourceLeafDiagnostic["kind"],
  ): void {
    this.createdLeaves += 1;
    const previous = this.leafDiagnostics.get(key);
    if (previous) {
      previous.recreations += 1;
      return;
    }
    if (this.leafDiagnostics.size >= 128) {
      this.omittedLeafEntries += 1;
      return;
    }
    this.leafDiagnostics.set(key, {
      key,
      kind,
      nodeId:
        element.getAttribute("data-agent-native-node-id")?.slice(0, 128) ??
        null,
      captures: 0,
      invalidations: {},
      captureCauses: {},
      recreations: 0,
      observedAttributes: [],
      lastReason: "initial",
    });
  }

  private recordLeafInvalidation(
    key: number,
    reason: NativeSourceInvalidationReason,
  ): void {
    this.sourceGeneration += 1;
    if (reason !== "initial" && reason !== "density")
      this.authoredSourceGeneration += 1;
    countSourceReason(this.invalidations, reason);
    const diagnostic = this.leafDiagnostics.get(key);
    if (!diagnostic) return;
    countSourceReason(diagnostic.invalidations, reason);
    diagnostic.lastReason = reason;
  }

  private recordLeafObservedAttribute(
    key: number,
    observation: NativeSourceAttributeObservation,
  ): void {
    const diagnostic = this.leafDiagnostics.get(key);
    if (!diagnostic) return;
    diagnostic.observedAttributes.push(observation);
    if (diagnostic.observedAttributes.length > 6)
      diagnostic.observedAttributes.shift();
  }

  private recordLeafCapture(key: number): void {
    this.captures += 1;
    const diagnostic = this.leafDiagnostics.get(key);
    if (!diagnostic) return;
    diagnostic.captures += 1;
    countSourceReason(diagnostic.captureCauses, diagnostic.lastReason);
  }

  diagnosticSnapshot(): NativeSourceProviderDiagnostic {
    const leaves = [...this.leafDiagnostics.values()]
      .sort((a, b) => b.captures - a.captures || a.key - b.key)
      .slice(0, 12)
      .map(({ lastReason: _lastReason, ...diagnostic }) => ({
        ...diagnostic,
        invalidations: { ...diagnostic.invalidations },
        captureCauses: { ...diagnostic.captureCauses },
        observedAttributes: [...diagnostic.observedAttributes],
      }));
    return {
      readSceneCalls: this.readSceneCalls,
      captures: this.captures,
      activeLeaves:
        this.leaves.size +
        this.fillBoxLeaves.size +
        Number(!!this.fillForegroundLeaf) +
        Number(!!this.fillGlyphLeaf) +
        this.mediaBackgrounds.size +
        this.svgLeaves.size,
      createdLeaves: this.createdLeaves,
      retiredLeaves: this.retiredLeaves,
      invalidations: { ...this.invalidations },
      leaves,
      omittedLeaves:
        this.omittedLeafEntries + this.leafDiagnostics.size - leaves.length,
    };
  }

  needsContinuousFrames(): boolean {
    const scope = this.placement === "backdrop" ? document.body : this.target;
    if (
      [...scope.querySelectorAll<HTMLVideoElement>("video")].some(
        (video) => !video.paused && !video.ended,
      ) ||
      scope.querySelector(
        "canvas:not([data-an-native-canvas]):not([data-an-native-presentation])",
      )
    )
      return true;
    const animated = (element: Element): boolean =>
      typeof element.getAnimations === "function" &&
      element
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === "running");
    if (animated(scope)) return true;
    for (
      let parent = scope.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (
        typeof parent.getAnimations === "function" &&
        parent
          .getAnimations({ subtree: false })
          .some((animation) => animation.playState === "running")
      )
        return true;
    return false;
  }

  setGroupLocalBackdropSource(enabled: boolean): void {
    if (this.placement !== "layer" || this.groupLocalBackdropSource === enabled)
      return;
    this.groupLocalBackdropSource = enabled;
    this.invalidateAll("explicit");
  }

  private groupLocalBackdropReceiver(element: Element): HTMLElement | null {
    if (
      this.placement !== "layer" ||
      !this.groupLocalBackdropSource ||
      !(element instanceof HTMLCanvasElement) ||
      !element.hasAttribute("data-an-native-backdrop-presentation") ||
      !element.getAttribute("data-an-native-canvas") ||
      !this.target.contains(element)
    )
      return null;
    return nativeBackdropReceiver(element);
  }

  groupLocalBackdropClipState(canvas: HTMLCanvasElement): "empty" | "nonempty" {
    if (
      this.disposed ||
      this.placement !== "layer" ||
      !this.groupLocalBackdropSource ||
      !canvas.isConnected ||
      !this.target.contains(canvas) ||
      !canvas.hasAttribute("data-an-native-backdrop-presentation")
    )
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    const receiver = this.groupLocalBackdropReceiver(canvas);
    if (!receiver)
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    const visibility = getComputedStyle(receiver);
    if (
      visibility.display === "none" ||
      visibility.visibility === "hidden" ||
      visibility.visibility === "collapse"
    )
      return "empty";
    const clip = sourceClipPlan(
      receiver,
      this.target,
      this.coordinateSpace,
      true,
      null,
      0,
      "border",
    ).clip;
    return clip.width <= 0 || clip.height <= 0 ? "empty" : "nonempty";
  }

  setDensity(density: number): void {
    if (!Number.isFinite(density) || density <= 0 || density > 4)
      throw new NativeSourceError(
        "source-density-invalid",
        "Source capture density must be between 0 and 4.",
      );
    if (this.density === density) return;
    this.density = density;
    this.invalidateAll("density");
  }

  private id(element: Element): number {
    let id = this.ids.get(element);
    if (!id) {
      id = this.nextId++;
      this.ids.set(element, id);
    }
    return id;
  }

  private backgroundId(element: Element): number {
    let id = this.backgroundIds.get(element);
    if (!id) {
      id = this.nextId++;
      this.backgroundIds.set(element, id);
    }
    return id;
  }

  private async recordMediaBackground(
    element: HTMLElement,
    common: Omit<
      NativeSourceRecord,
      "kind" | "source" | "nativeInstanceId" | "width" | "height" | "revision"
    >,
    ancestorClip: NativeSourceRecord["clip"],
    out: NativeSourceRecord[],
  ): Promise<void> {
    let leaf = this.mediaBackgrounds.get(element);
    if (!leaf) {
      const key = this.backgroundId(element);
      this.trackLeaf(element, key, "media-background");
      leaf = new CachedLeaf(
        element,
        () => this.recordLeafCapture(key),
        () => this.density,
        rasterMediaBackground,
        this.onDirty,
        (reason) => this.recordLeafInvalidation(key, reason),
        (observation) => this.recordLeafObservedAttribute(key, observation),
      );
      this.mediaBackgrounds.set(element, leaf);
    }
    const source = await leaf.read();
    out.push({
      ...common,
      key: this.backgroundId(element),
      kind: "dom",
      source,
      width: source.width,
      height: source.height,
      revision: leaf.revision,
      clip: ancestorClip,
      clips: [],
    });
  }

  private isolationPath(
    element: Element,
    groupClips: { node: Element; clip: NativeSourceClip }[],
    ownOpacityBaked: boolean,
    layerOutputOpacityDeferred = false,
  ): NativeSourceIsolation[] | null {
    const isBackdropCanvas = (node: Element): node is HTMLCanvasElement =>
      node instanceof HTMLCanvasElement &&
      node.hasAttribute("data-an-native-backdrop-presentation") &&
      !!node.getAttribute("data-an-native-canvas");
    const receiverForCanvas = nativeBackdropReceiver;

    const precedingBackdropCanvas = (
      node: Element,
    ): HTMLCanvasElement | null => {
      let sibling = node.previousElementSibling;
      let found: HTMLCanvasElement | null = null;
      while (sibling && isBackdropCanvas(sibling)) {
        found = sibling;
        sibling = sibling.previousElementSibling;
      }
      return found;
    };
    const stop =
      this.placement === "backdrop" ? document.documentElement : this.target;
    const nodes: Element[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    ) {
      nodes.push(current);
      if (current === stop) break;
    }
    const clipped = new Set(groupClips.map(({ node }) => node));
    const path: NativeSourceIsolation[] = [];
    for (const node of nodes.reverse()) {
      const opacity = authoredOpacity(node);
      const receiver = isBackdropCanvas(node)
        ? receiverForCanvas(node)
        : precedingBackdropCanvas(node)
          ? node
          : null;
      if (
        receiver &&
        !(node === this.target && this.placement === "fill") &&
        !(
          node === this.target &&
          this.placement === "layer" &&
          this.layerTargetOpacityDeferred
        )
      ) {
        if (
          receiver === node &&
          ownOpacityBaked &&
          node.hasAttribute("data-an-native-layer-instance") &&
          !layerOutputOpacityDeferred &&
          authoredOpacity(receiver) < 1
        )
          throw new NativeSourceError(
            "source-composition-unsupported",
            "source-composition-unsupported",
          );
        path.push({
          id: `receiver:${this.id(receiver)}`,
          kind: "opacity",
          opacity: authoredOpacity(receiver),
        });
      }
      const deferTargetOpacity =
        node === this.target &&
        (this.placement === "fill" ||
          (this.placement === "layer" && this.layerTargetOpacityDeferred));
      if (opacity <= 0 && receiver !== node && !deferTargetOpacity) return null;
      if (
        opacity < 1 &&
        receiver !== node &&
        !(node === element && ownOpacityBaked) &&
        !deferTargetOpacity &&
        !(node === this.target && this.groupLocalBackdropSource)
      )
        path.push({
          id: `opacity:${this.id(node)}`,
          kind: "opacity",
          opacity,
        });
      if (clipped.has(node)) {
        const id = `clip:${this.id(node)}`;
        path.push({ id, kind: "clip", clipId: id });
      }
    }
    return path;
  }

  private assertSourceComposition(records: NativeSourceRecord[]): void {
    const stop =
      this.placement === "backdrop" ? document.documentElement : this.target;
    const stackingPaints = new Map<Element, NativeStackingFootprint[]>();
    const visibleBoxes: NativeSourceBox[] = [];
    const transformOwners: (Element | null)[] = [];
    const viewportBackgrounds: boolean[] = [];
    const stackingNodes: Element[] = [];
    for (const record of records) {
      const visible = intersect(record.rect, record.clip);
      if (visible.width <= 0 || visible.height <= 0) continue;
      let transformOwner: Element | null = null;
      for (
        let current: Element | null = record.node;
        current;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        if (current !== stop && !transformOwner && hasSourceTransform(style))
          transformOwner = current;
        if (
          !(current === record.node && current instanceof SVGSVGElement) &&
          hasUnsupportedSourceMask(style.clipPath, style.maskImage)
        )
          throw new NativeSourceError(
            "source-mask-unsupported",
            "CSS clip-path and masks need an explicit source mask compositor.",
          );
        if (current === stop) break;
      }
      const scope = sourcePaintScope(record.node, stop);
      const order = sourceLeafPaintOrder(record.node, scope);
      const footprints = stackingPaints.get(scope) ?? [];
      footprints.push({
        box: visible,
        zIndex: order.rank === 0 ? "auto" : String(order.rank),
        phase: order.phase,
      });
      stackingPaints.set(scope, footprints);
      visibleBoxes.push(visible);
      transformOwners.push(transformOwner);
      viewportBackgrounds.push(record.sourceRole === "viewport-background");
      stackingNodes.push(record.node);
    }
    if (!transformedSourcePaintIsContiguous(stackingNodes, transformOwners))
      throw new NativeSourceError(
        "source-stacking-order",
        "A transformed source context is interleaved with other paint.",
      );
    for (let first = 0; first < visibleBoxes.length; first += 1)
      for (let second = first + 1; second < visibleBoxes.length; second += 1) {
        if (
          viewportBackgrounds[first] ||
          viewportBackgrounds[second] ||
          stackingNodes[first].contains(stackingNodes[second]) ||
          stackingNodes[second].contains(stackingNodes[first]) ||
          transformOwners[first] === transformOwners[second] ||
          (!transformOwners[first] && !transformOwners[second]) ||
          !nativeBoxesOverlap(visibleBoxes[first], visibleBoxes[second])
        )
          continue;
        const common = commonSourcePaintAncestor(
          stackingNodes[first],
          stackingNodes[second],
          stop,
        );
        const firstOrder = sourceStackingOrder(stackingNodes[first], common);
        const secondOrder = sourceStackingOrder(stackingNodes[second], common);
        if (
          hasUnsupportedStackingOrder([
            {
              box: visibleBoxes[first],
              zIndex: String(firstOrder.rank),
              phase: firstOrder.phase,
            },
            {
              box: visibleBoxes[second],
              zIndex: String(secondOrder.rank),
              phase: secondOrder.phase,
            },
          ])
        )
          throw new NativeSourceError(
            "source-stacking-order",
            "Overlapping transformed source paint reverses CSS stacking order.",
          );
      }
    if ([...stackingPaints.values()].some(hasUnsupportedStackingOrder))
      throw new NativeSourceError(
        "source-stacking-order",
        "Overlapping source paint crosses an explicit CSS z-index context.",
      );
  }

  private async recordSvg(
    element: SVGSVGElement,
    out: NativeSourceRecord[],
  ): Promise<void> {
    assertLeafSupported(
      element,
      this.coordinateSpace === "target-local" ? this.target : undefined,
    );
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (element.hasAttribute("transform"))
      throw new NativeSourceError(
        "source-svg-transform-unsupported",
        "An SVG root transform needs an affine vector source path.",
      );
    const stop =
      this.coordinateSpace === "target-local"
        ? this.target
        : document.documentElement;
    for (
      let ancestor: Element | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (hasSourceTransform(getComputedStyle(ancestor)))
        throw new NativeSourceError(
          "source-svg-transform-unsupported",
          "An SVG source has a transformed HTML layout boundary.",
        );
      if (ancestor === stop) break;
    }
    const box = element.getBoundingClientRect();
    const target = this.target.getBoundingClientRect();
    if (
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height) ||
      box.width <= 0 ||
      box.height <= 0 ||
      (this.coordinateSpace === "target-local" &&
        (Math.abs(target.width - this.target.offsetWidth) > 0.5 ||
          Math.abs(target.height - this.target.offsetHeight) > 0.5))
    )
      throw new NativeSourceError(
        "source-svg-geometry-unsupported",
        "An SVG source has unreadable or transformed CSS geometry.",
      );
    const localBox = { x: 0, y: 0, width: box.width, height: box.height };
    const svgToTarget =
      this.coordinateSpace === "target-local-global"
        ? composeAffine(
            viewportToTargetAffine(this.target),
            translated(box.left, box.top),
          )
        : translated(box.left - target.left, box.top - target.top);
    const projectedSvg = planNativeSourceAffine({
      localBox,
      localToTarget: svgToTarget,
      physicalScale: { x: 1, y: 1 },
    });
    if (!projectedSvg.ok)
      throw new NativeSourceError("source-transform", "source-transform");
    const rect = projectedSvg.physicalBounds;
    const sourceClip = sourceClipPlan(
      element,
      this.target,
      this.coordinateSpace,
      false,
    );
    const isolationPath = this.isolationPath(
      element,
      sourceClip.groupClips,
      true,
    );
    if (
      !isolationPath ||
      sourceClip.clip.width <= 0 ||
      sourceClip.clip.height <= 0
    )
      return;
    let leaf = this.svgLeaves.get(element);
    if (!leaf) {
      const key = this.id(element);
      this.trackLeaf(element, key, "svg");
      leaf = new CachedLeaf(
        element,
        () => this.recordLeafCapture(key),
        () => this.density,
        rasterNativeSvgSource,
        this.onDirty,
        (reason) => this.recordLeafInvalidation(key, reason),
        (observation) => this.recordLeafObservedAttribute(key, observation),
      );
      this.svgLeaves.set(element, leaf);
    }
    const source = await leaf.read();
    const capture = nativeCaptureRoi(source);
    const computedOverflow = classifyNativeComputedOverflowClip(style);
    if (!computedOverflow.ok)
      throw new NativeSourceError(
        `source-${computedOverflow.reason}`,
        computedOverflow.detail,
      );
    if (!capture && computedOverflow.outset > 0)
      throw new NativeSourceError(
        "source-capture-geometry-missing",
        "The SVG raster has no committed source origin.",
      );
    const expectedCapture = planNativeCaptureRoi({
      ownBox: { x: 0, y: 0, width: box.width, height: box.height },
      clipBox: {
        x: -computedOverflow.outset,
        y: -computedOverflow.outset,
        width: box.width + 2 * computedOverflow.outset,
        height: box.height + 2 * computedOverflow.outset,
      },
      density: this.density,
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    if (!expectedCapture.ok)
      throw new NativeSourceError(
        `source-${expectedCapture.reason}`,
        "The current SVG capture geometry cannot be represented.",
      );
    assertCurrentCaptureRoi(
      capture,
      expectedCapture.plan,
      computedOverflow.outset > 0,
    );
    const capturedLocalBox = capture?.cssBox ?? localBox;
    const captured = planNativeSourceAffine({
      localBox: capturedLocalBox,
      localToTarget: svgToTarget,
      physicalScale: { x: 1, y: 1 },
    });
    if (!captured.ok)
      throw new NativeSourceError("source-transform", "source-transform");
    const capturedRect = captured.physicalBounds;
    out.push({
      key: this.id(element),
      node: element,
      kind: "dom",
      source,
      width: source.width,
      height: source.height,
      revision: leaf.revision,
      coordinateSpace: this.coordinateSpace,
      localBox: capturedLocalBox,
      localToTarget: svgToTarget,
      rect: capturedRect,
      clip: sourceClip.clip,
      clips: [],
      groupClips: sourceClip.groupClips.map(({ node, clip }) => ({
        id: `clip:${this.id(node)}`,
        clip,
      })),
      isolationPath,
      opacity: 1,
    });
  }

  private async record(
    element: Element,
    out: NativeSourceRecord[],
    paintPhase: NativeOwnPaintPhase = "all",
  ): Promise<void> {
    if (!element.isConnected || this.omit(element)) return;
    if (element instanceof SVGSVGElement) {
      await this.recordSvg(element, out);
      return;
    }
    if (element instanceof SVGElement)
      throw new NativeSourceError(
        "source-inline-svg",
        "An SVG fragment outside an SVG root cannot be captured.",
      );
    if (!(element instanceof HTMLElement)) return;
    const style = getComputedStyle(element);
    const groupLocalReceiver = this.groupLocalBackdropReceiver(element);
    const visibility = groupLocalReceiver
      ? getComputedStyle(groupLocalReceiver)
      : style;
    if (
      visibility.display === "none" ||
      visibility.visibility === "hidden" ||
      visibility.visibility === "collapse"
    )
      return;
    if (
      element instanceof HTMLCanvasElement &&
      element.hasAttribute("data-an-shader-canvas")
    ) {
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const ancestorStyle = getComputedStyle(node);
        if (
          ancestorStyle.display === "none" ||
          ancestorStyle.visibility !== "visible" ||
          authoredOpacity(node) <= 0
        )
          return;
        if (node === this.target) break;
      }
      const box = relativeRect(element, this.target, this.coordinateSpace);
      const targetBox =
        this.coordinateSpace === "target-viewport-axis-aligned"
          ? viewportRelativeRect(this.target, this.target)
          : relativeAffine(this.target, this.target, this.coordinateSpace).rect;
      const sourceBounds = {
        x: 0,
        y: 0,
        width:
          this.target === document.documentElement
            ? Math.max(targetBox.width, innerWidth)
            : targetBox.width,
        height:
          this.target === document.documentElement
            ? Math.max(targetBox.height, innerHeight)
            : targetBox.height,
      };
      const visible = intersect(box, sourceBounds);
      if (visible.width > 0 && visible.height > 0)
        throw new NativeSourceError(
          "source-legacy-shader-unsupported",
          "A visible legacy WebGL shader has no synchronized texture and clock source for native composition.",
        );
      return;
    }
    assertLeafSupported(
      element,
      this.coordinateSpace === "target-local" ? this.target : undefined,
    );
    const ownSize = sourceLayoutSize(
      element,
      this.target,
      this.coordinateSpace,
    );
    const missingRootBox =
      element === document.documentElement &&
      (element.offsetWidth === 0 || element.offsetHeight === 0);
    if (hasEmptySourceLayout(ownSize) || missingRootBox) {
      if (
        !isCanvasBackgroundOnly(element, style) &&
        (hasDirectText(element) || hasVisibleBoxPaint(style))
      )
        throw new NativeSourceError(
          "source-empty-own-paint-unsupported",
          "A zero-size source has own paint that cannot be captured faithfully.",
        );
      return;
    }
    const geometry = relativeAffine(element, this.target, this.coordinateSpace);
    const box = geometry.rect;
    if (box.width <= 0 || box.height <= 0) return;
    const nativeInstanceId =
      element instanceof HTMLCanvasElement
        ? element.getAttribute("data-an-native-canvas")
        : null;
    const media =
      element instanceof HTMLImageElement ||
      element instanceof HTMLVideoElement ||
      (element instanceof HTMLCanvasElement && !nativeInstanceId);
    const ownOverflow = classifyNativeComputedOverflowClip(style);
    if (!ownOverflow.ok)
      throw new NativeSourceError(
        `source-${ownOverflow.reason}`,
        ownOverflow.detail,
      );
    const boxPhase =
      paintPhase === "background" ||
      paintPhase === "border" ||
      paintPhase === "coverage" ||
      paintPhase === "inner-coverage";
    const backdropReceiver =
      nativeInstanceId &&
      element.hasAttribute("data-an-native-backdrop-presentation")
        ? (groupLocalReceiver ??
          nativeBackdropReceiver(element as HTMLCanvasElement))
        : null;
    const sourceClip = sourceClipPlan(
      backdropReceiver ?? element,
      this.target,
      this.coordinateSpace,
      media || !!nativeInstanceId,
      null,
      0,
      backdropReceiver ? "border" : "content",
    );
    const contentVisible =
      sourceClip.clip.width > 0 && sourceClip.clip.height > 0;
    const hasMediaBackground = media && mediaHasSolidBackground(element);
    const backgroundBounds = intersect(box, sourceClip.ancestorClip);
    const backgroundVisible =
      hasMediaBackground &&
      backgroundBounds.width > 0 &&
      backgroundBounds.height > 0;
    if (!contentVisible && !backgroundVisible) return;
    const isolationPath = this.isolationPath(
      element,
      sourceClip.groupClips,
      !!nativeInstanceId || boxPhase,
    );
    if (!isolationPath) return;
    const key = boxPhase
      ? this.fillBoxIds.get(paintPhase)!
      : paintPhase === "foreground"
        ? this.fillForegroundId
        : paintPhase === "glyph"
          ? this.fillGlyphId
          : this.id(element);
    const common = {
      key,
      node: element,
      coordinateSpace: this.coordinateSpace,
      rect: box,
      localBox: geometry.localBox,
      localToTarget: geometry.localToTarget,
      clip: sourceClip.clip,
      clips: sourceClip.clips,
      groupClips: sourceClip.groupClips.map(({ node, clip }) => ({
        id: `clip:${this.id(node)}`,
        clip,
      })),
      isolationPath,
      opacity: 1,
    };
    if (!contentVisible && backgroundVisible) {
      await this.recordMediaBackground(
        element,
        common,
        sourceClip.ancestorClip,
        out,
      );
      return;
    }
    const mediaBox = sourceClip.clips[0]?.localBox ?? geometry.localBox;
    if (element instanceof HTMLImageElement) {
      assertLocalAsset(element.currentSrc || element.src);
      if (!element.complete || element.naturalWidth <= 0)
        throw new NativeSourceError(
          "source-image-pending",
          "An image source has not finished loading.",
        );
      const image = mediaPlacement(
        element,
        mediaBox,
        element.naturalWidth,
        element.naturalHeight,
      );
      if (hasMediaBackground)
        await this.recordMediaBackground(
          element,
          common,
          sourceClip.ancestorClip,
          out,
        );
      out.push({
        ...common,
        rect: relativeAffine(
          element,
          this.target,
          this.coordinateSpace,
          image.rect,
        ).rect,
        localBox: image.rect,
        uv: image.uv,
        kind: "image",
        imageRendering: { value: style.imageRendering },
        source: element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        revision: this.assetRevision,
      });
      return;
    }
    if (element instanceof HTMLVideoElement) {
      assertLocalAsset(element.currentSrc || element.src);
      if (
        !element.videoWidth ||
        !element.videoHeight ||
        element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      )
        throw new NativeSourceError(
          "source-video-pending",
          "A video frame is not decoded yet.",
        );
      const video = mediaPlacement(
        element,
        mediaBox,
        element.videoWidth,
        element.videoHeight,
      );
      if (hasMediaBackground)
        await this.recordMediaBackground(
          element,
          common,
          sourceClip.ancestorClip,
          out,
        );
      out.push({
        ...common,
        rect: relativeAffine(
          element,
          this.target,
          this.coordinateSpace,
          video.rect,
        ).rect,
        localBox: video.rect,
        uv: video.uv,
        kind: "video",
        imageRendering: { value: style.imageRendering },
        source: element,
        width: element.videoWidth,
        height: element.videoHeight,
        revision: ++this.assetRevision,
      });
      return;
    }
    if (element instanceof HTMLCanvasElement) {
      if (nativeInstanceId) {
        out.push({
          ...common,
          kind: "native",
          imageRendering: { value: style.imageRendering },
          nativeInstanceId,
          width: element.width,
          height: element.height,
          revision: this.assetRevision,
        });
      } else {
        if (element.width <= 0 || element.height <= 0)
          throw new NativeSourceError(
            "source-canvas-empty",
            "A canvas source has no drawable pixels.",
          );
        const canvas = mediaPlacement(
          element,
          mediaBox,
          element.width,
          element.height,
        );
        if (hasMediaBackground)
          await this.recordMediaBackground(
            element,
            common,
            sourceClip.ancestorClip,
            out,
          );
        out.push({
          ...common,
          rect: relativeAffine(
            element,
            this.target,
            this.coordinateSpace,
            canvas.rect,
          ).rect,
          localBox: canvas.rect,
          uv: canvas.uv,
          kind: "canvas",
          imageRendering: { value: style.imageRendering },
          source: element,
          width: element.width,
          height: element.height,
          revision: ++this.assetRevision,
        });
      }
      return;
    }
    if (
      hasOwnPaint(element) ||
      boxPhase ||
      paintPhase === "foreground" ||
      paintPhase === "glyph"
    ) {
      let leaf = boxPhase
        ? this.fillBoxLeaves.get(paintPhase)
        : paintPhase === "foreground"
          ? this.fillForegroundLeaf
          : paintPhase === "glyph"
            ? this.fillGlyphLeaf
            : this.leaves.get(element);
      if (!leaf) {
        this.trackLeaf(element, key, "own-paint");
        leaf = new CachedLeaf(
          element,
          () => this.recordLeafCapture(key),
          () => this.density,
          (node, canvas, density) =>
            rasterOwnPaint(
              node,
              canvas,
              density,
              paintPhase,
              this.fillPaint ?? undefined,
              paintPhase === "glyph"
                ? (this.fillGlyphClone ?? undefined)
                : undefined,
              paintPhase === "glyph"
                ? (this.fillGlyphColors ?? undefined)
                : undefined,
            ),
          this.onDirty,
          (reason) => this.recordLeafInvalidation(key, reason),
          (observation) => this.recordLeafObservedAttribute(key, observation),
        );
        if (boxPhase) this.fillBoxLeaves.set(paintPhase, leaf);
        else if (paintPhase === "foreground") this.fillForegroundLeaf = leaf;
        else if (paintPhase === "glyph") this.fillGlyphLeaf = leaf;
        else this.leaves.set(element, leaf);
      }
      const source = await leaf.read();
      const capture = nativeCaptureRoi(source);
      if (!capture && ownOverflow.outset > 0)
        throw new NativeSourceError(
          "source-capture-geometry-missing",
          "The DOM raster has no committed source origin.",
        );
      const size = sizeOf(element);
      const ownClip =
        ownOverflow.edge === "none"
          ? { x: 0, y: 0, width: size.width, height: size.height }
          : sourceClipPlan(
              element,
              element,
              "target-local",
              false,
              ownOverflow.edge,
              ownOverflow.outset,
            ).groupClips[0]?.clip.localBox;
      if (!ownClip)
        throw new NativeSourceError(
          "source-clip-unreadable",
          "The source capture clip has no local geometry.",
        );
      const expectedCapture = planNativeCaptureRoi({
        ownBox: { x: 0, y: 0, width: size.width, height: size.height },
        clipBox: ownClip,
        density: this.density,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      if (!expectedCapture.ok)
        throw new NativeSourceError(
          `source-${expectedCapture.reason}`,
          "The current DOM capture geometry cannot be represented.",
        );
      assertCurrentCaptureRoi(
        capture,
        expectedCapture.plan,
        ownOverflow.outset > 0,
      );
      const capturedGeometry = capture
        ? relativeAffine(
            element,
            this.target,
            this.coordinateSpace,
            capture.cssBox,
          )
        : geometry;
      out.push({
        ...common,
        rect: capturedGeometry.rect,
        localBox: capture?.cssBox ?? capturedGeometry.localBox,
        localToTarget: capturedGeometry.localToTarget,
        kind: "dom",
        source,
        width: source.width,
        height: source.height,
        revision: leaf.revision,
      });
    }
  }

  private async walk(
    element: Element,
    out: NativeSourceRecord[],
  ): Promise<void> {
    if (this.omit(element)) return;
    if (element instanceof HTMLElement && element !== this.target) {
      const size = sourceLayoutSize(element, this.target, this.coordinateSpace);
      if (hasEmptySourceLayout(size)) {
        const style = getComputedStyle(element);
        if (style.display !== "contents") {
          const overflow = classifyNativeComputedOverflowClip(style);
          if (!overflow.ok)
            throw new NativeSourceError(
              `source-${overflow.reason}`,
              overflow.detail,
            );
          if (overflow.edge !== "none") {
            if (hasDirectText(element) || hasVisibleBoxPaint(style))
              throw new NativeSourceError(
                "source-empty-own-paint-unsupported",
                "A zero-size clipped source has own paint that cannot be captured faithfully.",
              );
            return;
          }
        }
      }
    }
    const fillInstance = element.getAttribute("data-an-native-fill-instance");
    const layerInstance =
      element !== this.target &&
      element.getAttribute("data-an-native-layer-instance");
    const replacementInstance = layerInstance || fillInstance;
    if (replacementInstance) {
      const presentations = [...(element.parentElement?.children ?? [])].filter(
        (child): child is HTMLCanvasElement =>
          child instanceof HTMLCanvasElement &&
          child.hasAttribute("data-an-native-presentation") &&
          child.dataset.anNativeCanvas === replacementInstance,
      );
      if (presentations.length !== 1)
        throw new NativeSourceError(
          "native-presentation-missing",
          `Native output ${replacementInstance} has no unique presentation surface.`,
        );
      const presentation = presentations[0];
      const sourceWidth = presentation.width;
      const sourceHeight = presentation.height;
      if (
        ![sourceWidth, sourceHeight].every(
          (value) => Number.isSafeInteger(value) && value > 0,
        )
      )
        throw new NativeSourceError(
          "source-image-rendering-geometry",
          "source-image-rendering-geometry",
        );
      const imageRendering = {
        value: getComputedStyle(presentation).imageRendering,
      };
      const presentationGeometry = relativeAffine(
        layerInstance ? presentation : element,
        this.target,
        this.coordinateSpace,
      );
      const rect = presentationGeometry.rect;
      const sourceClip = sourceClipPlan(
        element,
        this.target,
        this.coordinateSpace,
        false,
      );
      const isolationPath = this.isolationPath(
        element,
        sourceClip.groupClips,
        !!layerInstance &&
          !element.hasAttribute("data-an-native-layer-group-local-source"),
        !!layerInstance &&
          presentations[0].getAttribute(
            "data-an-native-layer-opacity-owner",
          ) === "receiver",
      );
      if (
        isolationPath &&
        rect.width > 0 &&
        rect.height > 0 &&
        sourceClip.clip.width > 0 &&
        sourceClip.clip.height > 0
      ) {
        out.push({
          key: this.id(element),
          node: element,
          coordinateSpace: this.coordinateSpace,
          kind: "native",
          nativeInstanceId: replacementInstance,
          localBox: presentationGeometry.localBox,
          localToTarget: presentationGeometry.localToTarget,
          imageRendering,
          width: sourceWidth,
          height: sourceHeight,
          revision: this.assetRevision,
          rect,
          clip: sourceClip.clip,
          clips: [],
          groupClips: sourceClip.groupClips.map(({ node, clip }) => ({
            id: `clip:${this.id(node)}`,
            clip,
          })),
          isolationPath,
          opacity: 1,
        });
      }
      return;
    }
    const fillCanvases = [...element.children].filter((child) =>
      child.matches(
        "canvas[data-an-native-canvas]:not([data-an-native-presentation])",
      ),
    );
    const boxBeforeNativeFill =
      fillCanvases.length > 0 &&
      element instanceof HTMLElement &&
      !hasDirectText(element);
    if (boxBeforeNativeFill) await this.record(element, out);
    for (const fill of fillCanvases) await this.walk(fill, out);
    if (!boxBeforeNativeFill) await this.record(element, out);
    if (element instanceof SVGSVGElement) return;
    if (element instanceof HTMLElement) {
      const size = sourceLayoutSize(element, this.target, this.coordinateSpace);
      if (!hasEmptySourceLayout(size) && isSourceTextFlow(element)) return;
    }
    const childGroups: NativeSourceRecord[][] = [];
    for (const child of element.children)
      if (
        !fillCanvases.includes(child) &&
        !(hasDirectText(element) && isInlineFlowChild(child))
      ) {
        const records: NativeSourceRecord[] = [];
        await this.walk(child, records);
        if (records.length) childGroups.push(records);
      }
    for (const records of orderAutoStackingSiblingPaint(element, childGroups))
      out.push(...records);
    if (element.lastElementChild)
      assertDomSiblingOrder(element, element.lastElementChild, element, out);
  }

  private viewportBackground(): NativeSourceRecord | null {
    if (this.placement === "layer" && this.target !== document.documentElement)
      return null;
    const root = document.documentElement;
    const viewport = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    )
      return null;
    const rootStyle = getComputedStyle(root);
    if (rootStyle.backgroundImage !== "none")
      throw new NativeSourceError(
        "source-viewport-background-unsupported",
        "A CSS canvas background image needs a viewport-sized raster source.",
      );
    const rootAlpha = solidBackgroundAlpha(rootStyle.backgroundColor);
    const source = rootAlpha === 0 && document.body ? document.body : root;
    const style = source === root ? rootStyle : getComputedStyle(source);
    const alpha = solidBackgroundAlpha(style.backgroundColor);
    if (
      style.backgroundImage !== "none" ||
      alpha === null ||
      getComputedStyle(root).opacity !== "1" ||
      (source !== root && style.opacity !== "1")
    )
      throw new NativeSourceError(
        "source-viewport-background-unsupported",
        "The CSS canvas background extends beyond the root box and needs a supported opaque solid source.",
      );
    if (alpha === 0) return null;
    if (
      !this.viewportBackgroundCanvas ||
      this.viewportBackgroundColor !== style.backgroundColor
    ) {
      const canvas =
        this.viewportBackgroundCanvas ?? document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context)
        throw new NativeSourceError(
          "source-viewport-background-unavailable",
          "A viewport background source cannot be rasterized.",
        );
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      this.viewportBackgroundCanvas = canvas;
      this.viewportBackgroundColor = style.backgroundColor;
      this.viewportBackgroundRevision += 1;
      this.captures += 1;
    }
    const backdrop = this.placement === "backdrop";
    const backgroundBox = viewport;
    const backgroundToTarget = backdrop
      ? viewportToTargetAffine(this.target)
      : IDENTITY_AFFINE;
    const backgroundGeometry = planNativeSourceAffine({
      localBox: backgroundBox,
      localToTarget: backgroundToTarget,
      physicalScale: { x: 1, y: 1 },
    });
    if (!backgroundGeometry.ok)
      throw new NativeSourceError("source-transform", "source-transform");
    const rect = backgroundGeometry.physicalBounds;
    const insets = backdrop
      ? nativeTargetOverflowInsets(this.target)
      : { left: 0, top: 0, right: 0, bottom: 0 };
    const clip = backdrop
      ? intersect(rect, {
          x: 0 - insets.left,
          y: 0 - insets.top,
          width: this.target.offsetWidth + insets.left + insets.right,
          height: this.target.offsetHeight + insets.top + insets.bottom,
        })
      : viewport;
    if (clip.width <= 0 || clip.height <= 0) return null;
    return {
      key: -1,
      node: source,
      coordinateSpace: this.coordinateSpace,
      kind: "canvas",
      sourceRole: "viewport-background",
      source: this.viewportBackgroundCanvas,
      width: 1,
      height: 1,
      revision: this.viewportBackgroundRevision,
      rect,
      localBox: backgroundBox,
      localToTarget: backgroundToTarget,
      clip,
      clips: [],
      groupClips: [],
      isolationPath: [],
      opacity: 1,
    };
  }

  async readFillBackground(
    paint: NativeFillBackgroundPaint,
  ): Promise<NativeSourceRecord[]> {
    return this.readFillBoxPhase(paint, "background");
  }

  async readFillBoxPhase(
    paint: NativeFillBackgroundPaint,
    phase: "background" | "border" | "coverage" | "inner-coverage",
  ): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    if (this.placement !== "fill")
      throw new NativeSourceError(
        "source-placement-invalid",
        "Only a Fill target has an authored background capture.",
      );
    const style = getComputedStyle(this.target);
    if (style.boxShadow && style.boxShadow !== "none")
      throw new NativeSourceError(
        "fill-shadow-extent-unsupported",
        "The authored Fill shadow extends beyond the bounded target output.",
      );
    if (
      style.outlineStyle &&
      style.outlineStyle !== "none" &&
      Number.parseFloat(style.outlineWidth) > 0
    )
      throw new NativeSourceError(
        "fill-outline-extent-unsupported",
        "The authored Fill outline extends beyond the bounded target output.",
      );
    if (
      style.borderImageOutset &&
      style.borderImageOutset
        .split(/\s+/)
        .some((value) => Number.parseFloat(value) > 0)
    )
      throw new NativeSourceError(
        "fill-border-image-extent-unsupported",
        "The authored Fill border image extends beyond the bounded target output.",
      );
    if (
      !paint.color ||
      !paint.image ||
      !paint.borderTopColor ||
      !paint.borderRightColor ||
      !paint.borderBottomColor ||
      !paint.borderLeftColor ||
      !paint.borderImageSource
    )
      throw new NativeSourceError(
        "fill-background-unreadable",
        "The authored Fill background is unavailable.",
      );
    if (
      !this.fillPaint ||
      Object.keys(paint).some(
        (key) =>
          this.fillPaint?.[key as keyof NativeFillBackgroundPaint] !==
          paint[key as keyof NativeFillBackgroundPaint],
      )
    )
      for (const leaf of this.fillBoxLeaves.values())
        leaf.invalidate("attributes");
    this.fillPaint = { ...paint };
    this.readSceneCalls += 1;
    const out: NativeSourceRecord[] = [];
    if (!this.fillBoxIds.has(phase)) this.fillBoxIds.set(phase, this.nextId++);
    await this.record(this.target, out, phase);
    this.assertSourceComposition(out);
    return out;
  }

  async readFillGlyph(): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    if (this.placement !== "fill" || !isPureTextFlow(this.target))
      throw new NativeSourceError(
        "fill-text-complex",
        "A Fill text foreground needs a text-only flow.",
      );
    const hidden = this.target.hasAttribute("data-an-native-text-suppressed");
    if (hidden) this.target.removeAttribute("data-an-native-text-suppressed");
    try {
      this.fillGlyphClone = cloneOwnPaint(this.target, true, "glyph");
      const colors = new Map<Element, string>();
      for (const node of [
        this.target,
        ...this.target.querySelectorAll<HTMLElement>("*"),
      ])
        colors.set(node, getComputedStyle(node).color);
      this.fillGlyphColors = colors;
    } finally {
      if (hidden)
        this.target.setAttribute("data-an-native-text-suppressed", "");
    }
    if (!this.fillGlyphId) this.fillGlyphId = this.nextId++;
    const out: NativeSourceRecord[] = [];
    try {
      await this.record(this.target, out, "glyph");
    } finally {
      this.fillGlyphClone = null;
      this.fillGlyphColors = null;
    }
    this.assertSourceComposition(out);
    return out;
  }

  hasFillGlyph(): boolean {
    return (
      isPureTextFlow(this.target) && Boolean(this.target.textContent?.trim())
    );
  }

  async readFillForeground(): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    if (this.placement !== "fill")
      throw new NativeSourceError(
        "fill-foreground-unavailable",
        "Only a Fill target has a foreground phase.",
      );
    if (isPureTextFlow(this.target)) return [];
    if (hasDirectText(this.target))
      throw new NativeSourceError(
        "fill-mixed-text-layout-unsupported",
        "Direct text mixed with independent child paint needs an ordered text source.",
      );
    const groups: NativeSourceRecord[][] = [];
    for (const child of this.target.children) {
      if (child.matches(OMIT)) continue;
      const records: NativeSourceRecord[] = [];
      await this.walk(child, records);
      if (records.length) groups.push(records);
    }
    const out = orderAutoStackingSiblingPaint(this.target, groups).flat();
    const style = getComputedStyle(this.target);
    const overflow = classifyNativeComputedOverflowClip(style);
    if (!overflow.ok)
      throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
    if (
      overflow.edge === "none" &&
      out.some(
        (record) =>
          record.rect.x < -0.01 ||
          record.rect.y < -0.01 ||
          record.rect.x + record.rect.width > this.target.offsetWidth + 0.01 ||
          record.rect.y + record.rect.height > this.target.offsetHeight + 0.01,
      )
    )
      throw new NativeSourceError(
        "fill-foreground-extent-unsupported",
        "A visible Fill descendant escapes the bounded target output.",
      );
    this.assertSourceComposition(out);
    return out;
  }

  async readScene(): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    this.readSceneCalls += 1;
    const background = this.viewportBackground();
    const out: NativeSourceRecord[] = background ? [background] : [];
    if (this.placement === "layer") {
      await this.walk(this.target, out);
    } else {
      const path: Element[] = [];
      for (
        let node: Element | null = this.target;
        node;
        node = node.parentElement
      )
        path.unshift(node);
      for (let index = 0; index < path.length - 1; index += 1) {
        const parent = path[index];
        await this.record(parent, out);
        for (const sibling of parent.children) {
          if (sibling === path[index + 1]) break;
          await this.walk(sibling, out);
        }
      }
      for (let index = 0; index < path.length - 1; index += 1)
        assertDomSiblingOrder(path[index], path[index + 1], this.target, out);
    }
    this.assertSourceComposition(out);
    const live = new Set(out.map((record) => record.node));
    for (const [element, leaf] of this.leaves) {
      if (!live.has(element)) {
        leaf.dispose();
        this.leaves.delete(element);
        this.retiredLeaves += 1;
      }
    }
    for (const [element, leaf] of this.mediaBackgrounds) {
      if (!live.has(element)) {
        leaf.dispose();
        this.mediaBackgrounds.delete(element);
        this.retiredLeaves += 1;
      }
    }
    for (const [element, leaf] of this.svgLeaves) {
      if (!live.has(element)) {
        leaf.dispose();
        this.svgLeaves.delete(element);
        this.retiredLeaves += 1;
      }
    }
    return out;
  }

  captureCount(): number {
    return this.captures;
  }

  sourceEpoch(): number {
    return this.sourceGeneration;
  }

  authoredSourceEpoch(): number {
    return this.authoredSourceGeneration;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.structureObserver.disconnect();
    this.bodyStructureObserver?.disconnect();
    this.inheritedStyleObserver.disconnect();
    this.abort.abort();
    for (const leaf of this.leaves.values()) leaf.dispose();
    this.leaves.clear();
    for (const leaf of this.fillBoxLeaves.values()) leaf.dispose();
    this.fillBoxLeaves.clear();
    this.fillForegroundLeaf?.dispose();
    this.fillForegroundLeaf = null;
    this.fillGlyphLeaf?.dispose();
    this.fillGlyphLeaf = null;
    for (const leaf of this.mediaBackgrounds.values()) leaf.dispose();
    this.mediaBackgrounds.clear();
    for (const leaf of this.svgLeaves.values()) leaf.dispose();
    this.svgLeaves.clear();
    if (this.viewportBackgroundCanvas) {
      this.viewportBackgroundCanvas.width = 0;
      this.viewportBackgroundCanvas.height = 0;
      this.viewportBackgroundCanvas = null;
    }
  }
}

export function createNativeSceneProvider(
  target: HTMLElement,
  placement: "fill" | "layer" | "backdrop",
  onDirty?: () => void,
  backdropPresentation?: HTMLCanvasElement,
): NativeSceneProvider | null {
  return new SceneProvider(target, placement, onDirty, backdropPresentation);
}
