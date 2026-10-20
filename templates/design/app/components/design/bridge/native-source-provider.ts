import { splitTopLevelCommas } from "../../../../shared/css-box-shadow";
import {
  NativeCaptureCache,
  NativeCaptureCacheError,
} from "../../../../shared/native-capture-cache";
import {
  resolveNativeClipRadii,
  type NativeClipRadii,
} from "../../../../shared/native-clip-geometry";
import { readNativeCssPaintOutsets } from "../../../../shared/native-css-paint-outsets";
import {
  classifyNativeComputedOverflowClip,
  MAX_NATIVE_SOURCE_CLIPS,
  planNativeSourceClips,
  type NativeOverflowClipResult,
  type NativeSourceClipCandidate,
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
  classifyNativeImageReplaySafety,
  type NativeReplaySafety,
} from "./native-image-replay-safety";
import { fitNativeRasterDensity } from "./native-preview-geometry";
import {
  composeNativeSourceAffine,
  invertNativeSourceAffine,
  planNativeSourceAffine,
  type NativeAffine2D,
  type NativeAffineBox,
} from "./native-source-affine-geometry";
import type { NativeImageRendering } from "./native-source-sampling";
import {
  nativeSvgViewportSize,
  nativeSvgViewportToClient,
} from "./native-svg-geometry";
import {
  NativeSvgSourceError,
  rasterNativeSvgSource,
  rasterNativeSvgGroupSource,
  validateNativeSvgPrimitiveMarkup,
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
    if (
      node === canvas &&
      canvas.hasAttribute("data-an-native-presentation") &&
      document.documentElement.hasAttribute("data-an-native-scene-managed")
    ) {
      const saved = canvas.getAttribute("data-an-native-authored-opacity");
      const authored = saved === null || !saved.trim() ? NaN : Number(saved);
      if (!Number.isFinite(authored) || authored < 0 || authored > 1)
        throw new NativeSourceError(
          "source-opacity-invalid",
          "A managed native surface has unreadable authored opacity.",
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
  sourceRole?: "viewport-background" | "ancestor-fill-prefix";
  source?: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  imageSourceUrl?: string;
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

export type NativeSourceReadSceneMetrics = {
  calls: number;
  scenePresentationCalls: number;
  mountSourceCalls: number;
  dependencyRefreshCalls: number;
  otherCalls: number;
  wallMs: number;
  walkWallMs: number;
  validationWallMs: number;
  leafWaitWallMs: number;
  walkNodeVisits: number;
  walkDirectStyleReads: number;
  walkDirectLayoutSizeReads: number;
  walkDirectAffineReads: number;
  recordDirectStyleReads: number;
  recordDirectLayoutSizeReads: number;
  recordDirectAffineReads: number;
  recordDirectRectReads: number;
};

export type NativeSourceReadSceneCallSite =
  | "scene-presentation"
  | "mount-source"
  | "dependency-refresh"
  | "other";

export interface NativeAncestorFillPrefix {
  ancestor: HTMLElement;
  instanceId: string;
  unpublished: boolean;
  width: number;
  height: number;
  localBox: NativeAffineBox;
  revision: number;
  authoredSourceEpoch: number;
}

export interface NativeSceneProvider {
  readReceiverCoverage(): Promise<{
    source: HTMLCanvasElement;
    cssBox: NativeAffineBox;
    width: number;
    height: number;
    revision: number;
    geometryKind: "svg-silhouette" | "svg-group-silhouette" | "box";
  }>;
  readScene(
    metrics?: NativeSourceReadSceneMetrics,
    callSite?: NativeSourceReadSceneCallSite,
    fillPrefix?: NativeAncestorFillPrefix,
  ): Promise<NativeSourceRecord[]>;
  readLayerVisibleScene(): Promise<{
    records: NativeSourceRecord[];
    captureInsets: NativeSourceCaptureInsets;
  }>;
  layerVisiblePaintInsets(
    records: readonly NativeSourceRecord[],
  ): NativeSourceCaptureInsets;
  replaySafety(
    records: readonly NativeSourceRecord[],
    nativeMode?: "committed-native",
  ): Promise<NativeReplaySafety>;
  setGroupLocalBackdropSource(enabled: boolean): void;
  groupLocalBackdropClipState(canvas: HTMLCanvasElement): "empty" | "nonempty";
  readFillBackground(
    paint: NativeFillBackgroundPaint,
  ): Promise<NativeSourceRecord[]>;
  readFillBoxPhase(
    paint: NativeFillBackgroundPaint,
    phase: "background" | "border" | "coverage" | "inner-coverage",
  ): Promise<NativeSourceRecord[]>;
  readFillOwnPaintPhase(
    phase: "outer-shadow" | "inset-shadow" | "outline",
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

export interface NativeSourceCaptureInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
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

function authoredOpacity(
  element: Element,
  readStyle: SourceStyleReader = getComputedStyle,
): number {
  const saved = element.getAttribute("data-an-native-authored-opacity");
  const opacity = Number(saved ?? readStyle(element).opacity);
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

function assertLeafSupported(
  element: Element,
  target?: Element,
  readStyle: SourceStyleReader = getComputedStyle,
): void {
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
  const style = readStyle(element);
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
    nodeGlobalTransform(element, readStyle);
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
    (style.outlineStyle &&
      style.outlineStyle !== "none" &&
      style.outlineStyle !== "hidden") ||
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
  suppliedStyle?: CSSStyleDeclaration,
): {
  rect: NativeSourceRecord["rect"];
  uv: NonNullable<NativeSourceRecord["uv"]>;
} {
  const style = suppliedStyle ?? getComputedStyle(element);
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

function mediaBoxPaint(style: CSSStyleDeclaration): {
  underlay: boolean;
  overlay: boolean;
} {
  const borderImageSource = style.borderImageSource;
  if (borderImageSource && borderImageSource !== "none") {
    const outset = style.borderImageOutset?.trim().split(/\s+/) ?? [];
    if (
      outset.length === 0 ||
      outset.length > 4 ||
      outset.some((value) => !/^0+(?:\.0+)?(?:px)?$/.test(value))
    )
      throw new NativeSourceError(
        "source-media-border-image-extent-unsupported",
        "The authored media border image extends beyond the bounded paint capture.",
      );
  }
  const background = style.backgroundColor.replace(/\s+/g, "").toLowerCase();
  const transparent =
    background === "transparent" ||
    /^rgba\([^)]*,0(?:\.0+)?\)$/.test(background);
  const backgroundPaint = !transparent || style.backgroundImage !== "none";
  const shadowPaint = style.boxShadow !== "none";
  const borderPaint =
    (!!borderImageSource && borderImageSource !== "none") ||
    [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].some((width) => Number.parseFloat(width) > 0);
  const outlinePaint =
    style.outlineStyle !== "none" && style.outlineStyle !== "hidden";
  return {
    underlay: backgroundPaint || shadowPaint,
    overlay: borderPaint || outlinePaint,
  };
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

function layoutPosition(
  element: HTMLElement,
  memo?: SourceGeometryMemo,
): { x: number; y: number } {
  const cached = memo?.positions.get(element);
  if (cached) return cached;
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
  const position = { x, y };
  memo?.positions.set(element, position);
  return position;
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

function nodeGlobalTransform(
  element: HTMLElement,
  readStyle: SourceStyleReader = getComputedStyle,
  memo?: SourceGeometryMemo,
): NativeAffine2D {
  const cached = memo?.transforms.get(element);
  if (cached) return cached;
  const style = readStyle(element);
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
  const anchor = layoutPosition(element, memo);
  const pivotX = anchor.x + originX;
  const pivotY = anchor.y + originY;
  const transform = composeAffine(
    translated(pivotX, pivotY),
    composeAffine(css, translated(-pivotX, -pivotY)),
  );
  memo?.transforms.set(element, transform);
  return transform;
}

function sourceLayoutSize(
  element: HTMLElement | SVGSVGElement,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
  memo?: SourceGeometryMemo,
): { width: number; height: number } {
  const cache = memo?.matches(target, space) ? memo.sizes : undefined;
  const cached = cache?.get(element);
  if (cached) return cached;
  if (element instanceof SVGSVGElement) return nativeSvgViewportSize(element);
  if (
    element === document.documentElement &&
    Number.isFinite(element.offsetWidth) &&
    Number.isFinite(element.offsetHeight) &&
    element.offsetWidth >= 0 &&
    element.offsetHeight >= 0 &&
    (element.offsetWidth === 0 || element.offsetHeight === 0)
  )
    return { width: innerWidth, height: innerHeight };
  const size = { width: element.offsetWidth, height: element.offsetHeight };
  cache?.set(element, size);
  return size;
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

function viewportSourceAffine(
  element: HTMLElement,
  readStyle: SourceStyleReader = getComputedStyle,
  memo?: SourceGeometryMemo,
): NativeAffine2D {
  const cached = memo?.viewportAffines.get(element);
  if (cached) return cached;
  const usesViewportRootBox =
    element === document.documentElement &&
    (element.offsetWidth === 0 || element.offsetHeight === 0);
  const layoutSize = usesViewportRootBox
    ? { width: innerWidth, height: innerHeight }
    : { width: element.offsetWidth, height: element.offsetHeight };
  const position = layoutPosition(element, memo);
  let matrix = translated(position.x, position.y);
  for (let node: HTMLElement | null = element; node; node = node.parentElement)
    matrix = composeAffine(nodeGlobalTransform(node, readStyle, memo), matrix);
  const measured = element.getBoundingClientRect();
  const projected = planNativeSourceAffine({
    localBox: {
      x: 0,
      y: 0,
      ...layoutSize,
    },
    localToTarget: matrix,
    physicalScale: { x: 1, y: 1 },
  });
  const measuredWidth = usesViewportRootBox ? innerWidth : measured.width;
  const measuredHeight = usesViewportRootBox ? innerHeight : measured.height;
  if (
    !projected.ok ||
    Math.abs(projected.physicalBounds.width - measuredWidth) >
      Math.max(0.5, measuredWidth * 0.02) ||
    Math.abs(projected.physicalBounds.height - measuredHeight) >
      Math.max(0.5, measuredHeight * 0.02)
  )
    throw new NativeSourceError("source-transform", "source-transform");
  const affine = {
    ...matrix,
    e: matrix.e + measured.left - projected.physicalBounds.x,
    f: matrix.f + measured.top - projected.physicalBounds.y,
  };
  memo?.viewportAffines.set(element, affine);
  return affine;
}

function viewportToTargetAffine(
  target: HTMLElement | SVGSVGElement,
  readStyle: SourceStyleReader = getComputedStyle,
  memo?: SourceGeometryMemo,
): NativeAffine2D {
  const inverted = invertNativeSourceAffine(
    target instanceof SVGSVGElement
      ? nativeSvgViewportToClient(target)
      : viewportSourceAffine(target, readStyle, memo),
  );
  if (!inverted.ok)
    throw new NativeSourceError("source-transform", "source-transform");
  return inverted.matrix;
}

export function nativeClientToTargetAffine(
  target: HTMLElement | SVGSVGElement,
): NativeAffine2D {
  return viewportToTargetAffine(target);
}

function relativeAffine(
  element: Element,
  target: Element,
  space: NativeSourceRecord["coordinateSpace"],
  localBox?: NativeAffineBox,
  readStyle: SourceStyleReader = getComputedStyle,
  measuredSize?: { width: number; height: number },
  memo?: SourceGeometryMemo,
): {
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  rect: NativeAffineBox;
} {
  if (
    (element instanceof SVGSVGElement || target instanceof SVGSVGElement) &&
    (element instanceof HTMLElement || element instanceof SVGSVGElement) &&
    (target instanceof HTMLElement || target instanceof SVGSVGElement)
  ) {
    const box = localBox ?? {
      x: 0,
      y: 0,
      ...(measuredSize ?? sourceLayoutSize(element, target, space, memo)),
    };
    const elementToClient =
      element instanceof SVGSVGElement
        ? nativeSvgViewportToClient(element)
        : viewportSourceAffine(element, readStyle);
    const matrix =
      space === "target-viewport-axis-aligned"
        ? composeAffine(
            translated(
              -target.getBoundingClientRect().left,
              -target.getBoundingClientRect().top,
            ),
            elementToClient,
          )
        : composeAffine(
            viewportToTargetAffine(target, readStyle),
            elementToClient,
          );
    const geometry = planNativeSourceAffine({
      localBox: box,
      localToTarget: matrix,
      physicalScale: { x: 1, y: 1 },
    });
    if (!geometry.ok)
      throw new NativeSourceError(
        "source-transform",
        "The SVG receiver has invalid affine geometry.",
      );
    return {
      localBox: box,
      localToTarget: matrix,
      rect: geometry.physicalBounds,
    };
  }
  if (!(element instanceof HTMLElement) || !(target instanceof HTMLElement))
    throw new NativeSourceError(
      "source-transform",
      "A source has no HTML layout box.",
    );
  const activeMemo = memo?.matches(target, space) ? memo : undefined;
  const cache = activeMemo?.matrices;
  const size =
    measuredSize ?? sourceLayoutSize(element, target, space, activeMemo);
  const box = localBox ?? { x: 0, y: 0, ...size };
  let matrix = cache?.get(element);
  if (!matrix && space === "target-local") {
    const position = layoutPosition(element, activeMemo);
    matrix = translated(position.x, position.y);
    let node: HTMLElement | null = element;
    while (node && node !== target) {
      matrix = composeAffine(
        nodeGlobalTransform(node, readStyle, activeMemo),
        matrix,
      );
      node = node.parentElement;
    }
    if (node !== target)
      throw new NativeSourceError(
        "source-transform",
        "The source is outside the selected target.",
      );
    const targetPosition = layoutPosition(target, activeMemo);
    matrix = composeAffine(
      translated(-targetPosition.x, -targetPosition.y),
      matrix,
    );
  } else if (!matrix && space === "target-local-global") {
    matrix = composeAffine(
      viewportToTargetAffine(target, readStyle, activeMemo),
      viewportSourceAffine(element, readStyle, activeMemo),
    );
  } else if (!matrix) {
    const targetRect = target.getBoundingClientRect();
    matrix = composeAffine(
      translated(-targetRect.left, -targetRect.top),
      viewportSourceAffine(element, readStyle, activeMemo),
    );
  }
  cache?.set(element, matrix);
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
  suppliedReadStyle?: SourceStyleReader,
  memo?: SourceGeometryMemo,
  allowVisibleTargetOverflow = false,
  visibleTargetRect?: NativeSourceRecord["rect"],
  ignoreTargetOwnOverflow = false,
): {
  clip: NativeSourceRecord["clip"];
  ancestorClip: NativeSourceRecord["clip"];
  clips: NativeSourceClip[];
  groupClips: { node: Element; clip: NativeSourceClip }[];
} {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const readStyle: SourceStyleReader =
    suppliedReadStyle ??
    ((element) => {
      let style = styles.get(element);
      if (!style) {
        style = getComputedStyle(element);
        styles.set(element, style);
      }
      return style;
    });
  const targetBox =
    space === "target-viewport-axis-aligned"
      ? viewportRelativeRect(target, target)
      : relativeAffine(
          target,
          target,
          space,
          undefined,
          readStyle,
          undefined,
          memo,
        ).rect;
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
    assertLeafSupported(
      node,
      space === "target-local" ? target : undefined,
      readStyle,
    );
    if (!(node instanceof HTMLElement) && !(node instanceof SVGSVGElement))
      throw new NativeSourceError(
        "source-clip-unreadable",
        "A source clip has no HTML border box.",
      );
    const style = readStyle(node);
    const { width: localWidth, height: localHeight } = sourceLayoutSize(
      node,
      target,
      space,
      memo,
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
      throw new NativeSourceError(
        `source-clip-${plan.reason}`,
        `${plan.detail} Source ${node.tagName} (${node.getAttribute("data-agent-native-node-id") ?? "unidentified"}), layout ${localWidth}x${localHeight}, edge ${edge}.`,
      );
    const localClip = plan.clips[0];
    const geometry = relativeAffine(
      node,
      target,
      space,
      localClip.rect,
      readStyle,
      { width: localWidth, height: localHeight },
      memo,
    );
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
    const style = readStyle(ancestor);
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
        readStyle(target),
      );
      if (!targetOverflow.ok)
        throw new NativeSourceError(
          `source-${targetOverflow.reason}`,
          targetOverflow.detail,
        );
      if (targetOverflow.edge !== "none" && !ignoreTargetOwnOverflow) {
        append(target, targetOverflow.edge, false, targetOverflow.outset);
        const targetShape = allClips.pop();
        if (!targetShape)
          throw new NativeSourceError(
            "source-clip-unreadable",
            "The target overflow clip has no projected geometry.",
          );
        expandTargetClip(targetShape.rect);
      } else if (allowVisibleTargetOverflow || ignoreTargetOwnOverflow) {
        expandTargetClip(
          visibleTargetRect ??
            relativeAffine(
              element,
              target,
              space,
              undefined,
              readStyle,
              undefined,
              memo,
            ).rect,
        );
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

function nativeBackdropReceiver(
  canvas: HTMLCanvasElement,
): HTMLElement | SVGSVGElement {
  const receiverNodeId = canvas.getAttribute(
    "data-an-native-backdrop-receiver-node-id",
  );
  if (!receiverNodeId)
    throw new NativeSourceError(
      "source-composition-unsupported",
      "source-composition-unsupported",
    );
  for (const direction of [
    "previousElementSibling",
    "nextElementSibling",
  ] as const) {
    let sibling = canvas[direction];
    while (
      sibling instanceof HTMLCanvasElement &&
      sibling.hasAttribute("data-an-native-backdrop-presentation")
    )
      sibling = sibling[direction];
    if (
      (sibling instanceof HTMLElement || sibling instanceof SVGSVGElement) &&
      sibling.getAttribute("data-agent-native-node-id") === receiverNodeId
    )
      return sibling;
  }
  throw new NativeSourceError(
    "source-composition-unsupported",
    "source-composition-unsupported",
  );
}

export function nativeTargetOverflowInsets(
  target: HTMLElement | SVGSVGElement,
  includeOwnPaint = false,
): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const style = getComputedStyle(target);
  const overflow = classifyNativeComputedOverflowClip(style);
  if (!overflow.ok)
    throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
  if (target instanceof SVGSVGElement) {
    if (overflow.edge === "none")
      throw new NativeSourceError(
        "source-svg-overflow-unsupported",
        "An SVG root needs a bounded vector viewport clip.",
      );
    return {
      top: overflow.outset,
      right: overflow.outset,
      bottom: overflow.outset,
      left: overflow.outset,
    };
  }
  const paint = includeOwnPaint
    ? readNativeCssPaintOutsets(style)
    : {
        kind: "ok" as const,
        outsets: { top: 0, right: 0, bottom: 0, left: 0 },
      };
  if (paint.kind === "unreadable")
    throw new NativeSourceError(
      "source-paint-outset-unreadable",
      `Cannot resolve computed ${paint.property} for source paint.`,
    );
  if (overflow.edge === "none") return paint.outsets;
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
    top: Math.max(paint.outsets.top, -clip.y, 0),
    right: Math.max(paint.outsets.right, clip.x + clip.width - width, 0),
    bottom: Math.max(paint.outsets.bottom, clip.y + clip.height - height, 0),
    left: Math.max(paint.outsets.left, -clip.x, 0),
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

type SourceStyleReader = (element: Element) => CSSStyleDeclaration;

class SourceGeometryMemo {
  readonly styles = new Map<Element, CSSStyleDeclaration>();
  readonly positions = new Map<HTMLElement, { x: number; y: number }>();
  readonly sizes = new Map<
    HTMLElement | SVGSVGElement,
    { width: number; height: number }
  >();
  readonly transforms = new Map<HTMLElement, NativeAffine2D>();
  readonly viewportAffines = new Map<HTMLElement, NativeAffine2D>();
  readonly matrices = new Map<HTMLElement, NativeAffine2D>();
  readonly sceneFrameEntries = new Map<Element, readonly (number | string)[]>();

  constructor(
    private readonly target: Element,
    private readonly space: NativeSourceRecord["coordinateSpace"],
  ) {}

  matches(
    target: Element,
    space: NativeSourceRecord["coordinateSpace"],
  ): boolean {
    return this.target === target && this.space === space;
  }

  clear(): void {
    this.styles.clear();
    this.positions.clear();
    this.sizes.clear();
    this.transforms.clear();
    this.viewportAffines.clear();
    this.matrices.clear();
    this.sceneFrameEntries.clear();
  }
}

type SourceWalkStep = void | Promise<void>;

function runSourceWalkSteps<T>(
  steps: Generator<SourceWalkStep, T, boolean>,
  memo?: SourceGeometryMemo,
): T | Promise<T> {
  return runSourceWalkStepsFrom(steps, memo, false);
}

function runSourceWalkStepsAfterAsync<T>(
  steps: Generator<SourceWalkStep, T, boolean>,
  memo?: SourceGeometryMemo,
): T | Promise<T> {
  return runSourceWalkStepsFrom(steps, memo, true);
}

function runSourceWalkStepsFrom<T>(
  steps: Generator<SourceWalkStep, T, boolean>,
  memo: SourceGeometryMemo | undefined,
  resumedAfterAsync: boolean,
): T | Promise<T> {
  for (;;) {
    const next = steps.next(resumedAfterAsync);
    resumedAfterAsync = false;
    if (next.done) return next.value;
    const step = next.value;
    if (step && typeof step.then === "function")
      return step.then(() => {
        memo?.clear();
        return runSourceWalkStepsAfterAsync(steps, memo);
      });
  }
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

function sourceStackingContext(
  element: Element,
  readStyle: SourceStyleReader = getComputedStyle,
): {
  order: SourceStackingOrder;
  isolates: boolean;
} {
  const style = readStyle(element);
  const parentDisplay = element.parentElement
    ? readStyle(element.parentElement).display
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
    authoredOpacity(element, readStyle) < 1
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
      authoredOpacity(element, readStyle) < 1,
  };
}

function sourceStackingOrder(
  receiver: Element,
  parent: Element,
  readStyle: SourceStyleReader = getComputedStyle,
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
    const context = sourceStackingContext(element, readStyle);
    if (context.order.phase === "positioned") phase = "positioned";
    if (context.isolates) return { ...context.order, phase };
  }
  return { rank: 0, phase };
}

function orderAutoStackingSiblingPaint(
  parent: Element,
  groups: readonly (readonly NativeSourceRecord[])[],
  memo?: SourceGeometryMemo,
): (readonly NativeSourceRecord[])[] {
  const readStyle: SourceStyleReader = memo
    ? (element) => {
        let style = memo.styles.get(element);
        if (!style) {
          style = getComputedStyle(element);
          memo.styles.set(element, style);
        }
        return style;
      }
    : getComputedStyle;
  if (isFlexOrGridDisplay(readStyle(parent).display)) return [...groups];
  const phases = groups.map((records) => {
    const first = sourceStackingOrder(records[0].node, parent, readStyle);
    if (
      first.rank !== 0 ||
      records.some((record) => {
        const order = sourceStackingOrder(record.node, parent, readStyle);
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

function sourcePaintScope(
  leaf: Element,
  stop: Element,
  readStyle: SourceStyleReader = getComputedStyle,
): Element {
  if (leaf !== stop && readStyle(leaf).isolation === "isolate") return leaf;
  for (
    let current = leaf.parentElement;
    current && current !== stop;
    current = current.parentElement
  )
    if (sourceStackingContext(current, readStyle).isolates) return current;
  return stop;
}

function sourceLeafPaintOrder(
  leaf: Element,
  scope: Element,
  readStyle: SourceStyleReader = getComputedStyle,
): SourceStackingOrder {
  if (leaf === scope) return { rank: 0, phase: "context-own" };
  let phase: SourceStackingOrder["phase"] = "flow";
  for (
    let current: Element | null = leaf;
    current && current !== scope;
    current = current.parentElement
  ) {
    const context = sourceStackingContext(current, readStyle);
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
  | "outer-shadow"
  | "inset-shadow"
  | "outline"
  | "media-underlay"
  | "media-overlay"
  | "foreground"
  | "glyph";

function rasterOwnedStyleNodes(
  element: HTMLElement | SVGSVGElement,
  phase: NativeOwnPaintPhase,
): Element[] {
  if (element instanceof SVGSVGElement)
    return [element, ...element.querySelectorAll("*")];
  if (
    phase === "background" ||
    phase === "border" ||
    phase === "coverage" ||
    phase === "inner-coverage" ||
    phase === "outer-shadow" ||
    phase === "inset-shadow" ||
    phase === "outline" ||
    phase === "media-underlay" ||
    phase === "media-overlay"
  )
    return [element];
  if (phase === "foreground" || phase === "glyph" || isSourceTextFlow(element))
    return [element, ...element.querySelectorAll("*")];
  const nodes: Element[] = [element];
  if (hasDirectText(element))
    for (const child of element.children)
      if (isInlineFlowChild(child)) nodes.push(child);
  return nodes;
}

const NORMALIZED_ROOT_PAINT_PROPERTIES = new Set([
  "position",
  "left",
  "top",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "scale",
  "opacity",
]);

const BOX_PHASE_ROOT_PAINT_PROPERTIES = new Set([
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-image-source",
  "box-shadow",
  "outline-color",
]);

export function nativeRasterComputedStyleValues(
  style: CSSStyleDeclaration,
  options: { isRoot: boolean; phase: NativeOwnPaintPhase },
): unknown[] {
  const omittedProperties = new Set<string>();
  if (options.isRoot) {
    for (const property of NORMALIZED_ROOT_PAINT_PROPERTIES)
      omittedProperties.add(property);
    const boxPhase =
      options.phase === "background" ||
      options.phase === "border" ||
      options.phase === "coverage" ||
      options.phase === "inner-coverage";
    if (boxPhase)
      for (const property of BOX_PHASE_ROOT_PAINT_PROPERTIES)
        omittedProperties.add(property);
    if (options.phase === "coverage" || options.phase === "inner-coverage")
      omittedProperties.add("background-clip");
  }
  if (typeof style.item === "function" && Number.isInteger(style.length)) {
    const values: unknown[] = [];
    for (let index = 0; index < style.length; index += 1) {
      const name = style.item(index);
      if (omittedProperties.has(name)) continue;
      values.push([name, style.getPropertyValue(name)]);
    }
    return values;
  }
  return Object.keys(style)
    .filter((name) => {
      const cssName = name.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`,
      );
      return (
        !omittedProperties.has(cssName) &&
        typeof style[name as keyof CSSStyleDeclaration] !== "function"
      );
    })
    .sort()
    .map((name) => [name, style[name as keyof CSSStyleDeclaration]]);
}

function snapshotComputedStyle(element: Element): CSSStyleDeclaration {
  const live = getComputedStyle(element);
  const snapshot: Record<string, unknown> = {};
  const properties: string[] = [];
  const values = new Map<string, string>();
  const add = (name: string, value: string) => {
    properties.push(name);
    values.set(name, value);
    const camelName = name.replace(/-([a-z])/g, (_match, letter: string) =>
      letter.toUpperCase(),
    );
    if (/^[a-z]/.test(camelName)) snapshot[camelName] = value;
  };
  for (const name of [
    "display",
    "visibility",
    "opacity",
    "position",
    "z-index",
    "order",
    "isolation",
    "mix-blend-mode",
    "filter",
    "backdrop-filter",
    "transform",
    "transform-origin",
    "translate",
    "rotate",
    "scale",
    "perspective",
    "transform-style",
    "overflow-x",
    "overflow-y",
    "clip-path",
    "background-image",
    "background-color",
    "background-clip",
    "border-image-source",
    "border-image-outset",
    "box-shadow",
    "outline-style",
    "mask-image",
    "image-rendering",
    "object-fit",
    "object-position",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ]) {
    const camelName = name.replace(/-([a-z])/g, (_match, letter: string) =>
      letter.toUpperCase(),
    );
    const direct = live[camelName as keyof CSSStyleDeclaration];
    const canReadCssomProperty =
      typeof live.item === "function" && Number.isInteger(live.length);
    const value =
      typeof direct === "string"
        ? direct
        : canReadCssomProperty
          ? live.getPropertyValue(name)
          : undefined;
    if (typeof value !== "string") continue;
    add(name, value);
  }
  if (snapshot.outlineStyle !== "none" && snapshot.outlineStyle !== "hidden") {
    for (const name of ["outline-width", "outline-offset"]) {
      const camelName = name.replace(/-([a-z])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      );
      const direct = live[camelName as keyof CSSStyleDeclaration];
      const canReadCssomProperty =
        typeof live.item === "function" && Number.isInteger(live.length);
      const value =
        typeof direct === "string"
          ? direct
          : canReadCssomProperty
            ? live.getPropertyValue(name)
            : undefined;
      if (typeof value === "string") add(name, value);
    }
  }
  for (const name of [
    "overflow-clip-margin",
    "-webkit-mask-image",
    "mask-border-source",
    "-webkit-mask-box-image-source",
  ])
    values.set(name, live.getPropertyValue(name));
  snapshot.length = properties.length;
  snapshot.item = (index: number) => properties[index] ?? "";
  snapshot.getPropertyValue = (name: string) => values.get(name) ?? "";
  return snapshot as unknown as CSSStyleDeclaration;
}

function cloneOwnPaint(
  element: HTMLElement,
  preserveNativeTextFlow = false,
  phase: NativeOwnPaintPhase = "all",
  fillPaint?: NativeFillBackgroundPaint,
  authoredTextPaint?: { color: string; textFillColor: string },
): HTMLElement {
  const boxPhase =
    phase === "background" ||
    phase === "border" ||
    phase === "coverage" ||
    phase === "inner-coverage";
  const ownEffectPhase =
    phase === "outer-shadow" || phase === "inset-shadow" || phase === "outline";
  const mediaBoxPhase = phase === "media-underlay" || phase === "media-overlay";
  const clone =
    boxPhase || ownEffectPhase || mediaBoxPhase
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
    let index =
      fullTextFlow || boxPhase || ownEffectPhase || mediaBoxPhase
        ? -1
        : element.children.length - 1;
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
  if (authoredTextPaint) {
    clone.style.color = authoredTextPaint.color;
    clone.style.setProperty(
      "-webkit-text-fill-color",
      authoredTextPaint.textFillColor,
    );
  }
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
  if (ownEffectPhase) {
    clone.style.backgroundColor = "transparent";
    clone.style.backgroundImage = "none";
    clone.style.borderColor = "transparent";
    clone.style.borderImageSource = "none";
    clone.style.textShadow = "none";
    if (phase === "outline") {
      clone.style.boxShadow = "none";
    } else {
      const shadows = splitTopLevelCommas(getComputedStyle(element).boxShadow);
      clone.style.boxShadow =
        shadows
          .filter(
            (shadow) => /\binset\b/.test(shadow) === (phase === "inset-shadow"),
          )
          .join(", ") || "none";
      clone.style.outlineColor = "transparent";
    }
  }
  if (mediaBoxPhase) {
    const style = getComputedStyle(element);
    for (const value of [style.backgroundImage, style.borderImageSource])
      for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/g))
        assertLocalAsset(match[1]);
    if (phase === "media-underlay") {
      clone.style.borderColor = "transparent";
      clone.style.borderImageSource = "none";
      clone.style.outlineColor = "transparent";
      clone.style.outlineStyle = "none";
    } else {
      clone.style.backgroundColor = "transparent";
      clone.style.backgroundImage = "none";
      clone.style.boxShadow = "none";
    }
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

function nativeOwnPaintCaptureBox(
  style: CSSStyleDeclaration,
  phase: NativeOwnPaintPhase,
  size: { width: number; height: number },
): NativeAffineBox {
  if (
    phase !== "all" &&
    phase !== "outer-shadow" &&
    phase !== "outline" &&
    phase !== "media-underlay" &&
    phase !== "media-overlay"
  )
    return { x: 0, y: 0, ...size };
  const result = readNativeCssPaintOutsets(
    style,
    phase === "all"
      ? "all"
      : phase === "media-underlay"
        ? "outer-shadow"
        : phase === "media-overlay"
          ? "outline"
          : phase,
  );
  if (result.kind === "unreadable")
    throw new NativeSourceError(
      "source-paint-outset-unreadable",
      `Cannot resolve computed ${result.property} for source paint.`,
    );
  const { top, right, bottom, left } = result.outsets;
  return {
    x: left > 0 ? -left : 0,
    y: top > 0 ? -top : 0,
    width: size.width + left + right,
    height: size.height + top + bottom,
  };
}

function nativeLeafCaptureDensity(
  element: HTMLElement | SVGSVGElement,
  requested: number,
  phase: NativeOwnPaintPhase = "all",
): number {
  const size =
    element instanceof SVGSVGElement
      ? nativeSvgViewportSize(element)
      : sizeOf(element);
  const style = getComputedStyle(element);
  const paint =
    element instanceof SVGSVGElement
      ? { x: 0, y: 0, ...size }
      : nativeOwnPaintCaptureBox(style, phase, size);
  const overflow = classifyNativeComputedOverflowClip(style);
  if (!overflow.ok)
    throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
  const outset = overflow.edge === "none" ? 0 : overflow.outset;
  const width =
    Math.max(paint.x + paint.width, size.width + outset) -
    Math.min(paint.x, -outset);
  const height =
    Math.max(paint.y + paint.height, size.height + outset) -
    Math.min(paint.y, -outset);
  return fitNativeRasterDensity({
    width,
    height,
    density: requested,
    maxDimension: 4096,
    maxPixels: 8_388_608,
    pixelPadding: 2,
  });
}

async function inlineMediaPaintImages(
  clone: HTMLElement,
  phase: "media-underlay" | "media-overlay" | "viewport-background",
  css: string,
): Promise<void> {
  if (!css || css === "none") return;
  const tokens = [
    ...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi),
  ];
  if ((css.match(/url\(/gi) ?? []).length !== tokens.length)
    throw new NativeSourceError(
      "source-paint-image-url-unreadable",
      "A CSS paint image URL could not be resolved for native capture.",
    );
  if (tokens.length > 8)
    throw new NativeSourceError(
      "source-paint-image-too-large",
      "The CSS paint images exceed the bounded native capture size.",
    );
  let inlined = "";
  let cursor = 0;
  let embeddedLength = 0;
  for (const token of tokens) {
    const raw = (token[1] ?? token[2] ?? token[3] ?? "").trim();
    if (!raw || raw.startsWith("#"))
      throw new NativeSourceError(
        "source-paint-image-url-unreadable",
        "A CSS paint image URL could not be resolved for native capture.",
      );
    inlined += css.slice(cursor, token.index);
    if (/^data:/i.test(raw)) {
      inlined += token[0];
    } else {
      let sourceUrl: URL;
      try {
        assertLocalAsset(raw);
        sourceUrl = new URL(raw, document.baseURI);
      } catch (error) {
        if (error instanceof NativeSourceError) throw error;
        throw new NativeSourceError(
          "source-paint-image-url-unreadable",
          "A CSS paint image URL could not be resolved for native capture.",
        );
      }
      const image = new Image();
      image.src = sourceUrl.href;
      try {
        await image.decode();
      } catch {
        throw new NativeSourceError(
          "source-paint-image-unavailable",
          "The CSS paint image could not be decoded for native capture.",
        );
      }
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 4096 ||
        height > 4096 ||
        width * height > 8_388_608
      )
        throw new NativeSourceError(
          "source-paint-image-too-large",
          "The CSS paint image exceeds the bounded native capture size.",
        );
      const pixels = document.createElement("canvas");
      pixels.width = width;
      pixels.height = height;
      const context = pixels.getContext("2d", { alpha: true });
      if (!context)
        throw new NativeSourceError(
          "source-canvas-unavailable",
          "A CSS paint image canvas is unavailable.",
        );
      let dataUrl: string;
      try {
        context.drawImage(image, 0, 0);
        dataUrl = pixels.toDataURL("image/png");
      } catch {
        throw new NativeSourceError(
          "source-paint-image-unreadable",
          "The CSS paint image pixels could not be read for native capture.",
        );
      }
      embeddedLength += dataUrl.length;
      if (
        !dataUrl.startsWith("data:image/png;base64,") ||
        embeddedLength > 22_000_000
      )
        throw new NativeSourceError(
          "source-paint-image-too-large",
          "The CSS paint image exceeds the bounded native capture size.",
        );
      inlined += `url("${dataUrl}")`;
    }
    cursor = token.index + token[0].length;
  }
  const property =
    phase === "media-overlay" ? "border-image-source" : "background-image";
  clone.setAttribute(
    "style",
    `${clone.getAttribute("style") ?? ""};${property}:${inlined}${css.slice(cursor)}`,
  );
}

function supportedViewportBackgroundImage(image: string): boolean {
  if (!image || image === "none") return true;
  return splitTopLevelCommas(image).every((layer) =>
    /^(?:(?:repeating-)?(?:linear|radial|conic)-gradient|url)\(/i.test(
      layer.trim(),
    ),
  );
}

async function rasterViewportBackground(
  style: CSSStyleDeclaration,
  canvas: HTMLCanvasElement,
  viewport: { width: number; height: number },
  density: number,
): Promise<void> {
  const width = Math.ceil(viewport.width * density);
  const height = Math.ceil(viewport.height * density);
  const clone = document.createElement("div");
  clone.style.cssText = [
    `width:${viewport.width}px`,
    `height:${viewport.height}px`,
    `background-color:${style.backgroundColor}`,
    `background-image:${style.backgroundImage}`,
    `background-position:${style.backgroundPosition}`,
    `background-size:${style.backgroundSize}`,
    `background-repeat:${style.backgroundRepeat}`,
    `background-origin:${style.backgroundOrigin}`,
    `background-clip:${style.backgroundClip}`,
    `background-attachment:${style.backgroundAttachment}`,
    `background-blend-mode:${style.backgroundBlendMode}`,
  ].join(";");
  await inlineMediaPaintImages(
    clone,
    "viewport-background",
    style.backgroundImage,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden"><div style="width:${viewport.width}px;height:${viewport.height}px;transform:scale(${density});transform-origin:0 0">${new XMLSerializer().serializeToString(clone)}</div></div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
  } catch {
    throw new NativeSourceError(
      "source-viewport-background-unavailable",
      "A viewport background source cannot be rasterized.",
    );
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context)
    throw new NativeSourceError(
      "source-canvas-unavailable",
      "A viewport background canvas is unavailable.",
    );
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
  } catch {
    throw new NativeSourceError(
      "source-viewport-background-unavailable",
      "A viewport background source cannot be rasterized.",
    );
  }
}

async function rasterOwnPaint(
  element: HTMLElement,
  canvas: HTMLCanvasElement,
  density: number,
  phase: NativeOwnPaintPhase = "all",
  fillPaint?: NativeFillBackgroundPaint,
  glyphClone?: HTMLElement,
  glyphColors?: Map<Element, string>,
  authoredTextPaint?: { color: string; textFillColor: string },
): Promise<void> {
  const size = sizeOf(element);
  const style = getComputedStyle(element);
  const overflow = classifyNativeComputedOverflowClip(style);
  if (!overflow.ok)
    throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
  const ownPaintBox = nativeOwnPaintCaptureBox(style, phase, size);
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
    ownBox: ownPaintBox,
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
  const clone =
    glyphClone ??
    cloneOwnPaint(
      element,
      !!authoredTextPaint,
      phase,
      fillPaint,
      authoredTextPaint,
    );
  if (phase === "media-underlay" || phase === "media-overlay") {
    clone.style.display = "block";
    clone.style.boxSizing = "border-box";
    clone.style.width = `${size.width}px`;
    clone.style.height = `${size.height}px`;
    await inlineMediaPaintImages(
      clone,
      phase,
      phase === "media-underlay"
        ? style.backgroundImage
        : style.borderImageSource,
    );
  }
  applyNativeCaptureOverflowClip(clone, overflow);
  const canvasText =
    phase !== "background" &&
    phase !== "border" &&
    phase !== "coverage" &&
    phase !== "inner-coverage" &&
    phase !== "outer-shadow" &&
    phase !== "inset-shadow" &&
    phase !== "outline" &&
    phase !== "media-underlay" &&
    phase !== "media-overlay" &&
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
      await paintNativeTextFlow(
        element,
        canvas,
        false,
        authoredTextPaint
          ? new Map([[element, authoredTextPaint.textFillColor]])
          : glyphColors,
        {
          density,
          pixelOffset: capture.plan.pixelOffset,
        },
      );
    } finally {
      if (clipped) context.restore();
    }
  }
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

function unchangedAttributeMutation(record: MutationRecord): boolean {
  return (
    record.type === "attributes" &&
    record.target instanceof Element &&
    record.attributeName !== null &&
    record.oldValue === record.target.getAttribute(record.attributeName)
  );
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

export function isNativeSourceOmittedMutation(record: MutationRecord): boolean {
  return runtimeCanvasMutation(record) || omittedSourceMutation(record);
}

function isNativeSvgVectorGroup(element: Element): boolean {
  return (
    element instanceof HTMLElement &&
    element.hasAttribute("data-an-svg-vector-group")
  );
}

export class CachedLeaf<T extends HTMLElement | SVGSVGElement = HTMLElement> {
  private canvas = document.createElement("canvas");
  private readonly capture = new NativeCaptureCache<HTMLCanvasElement>();
  private readonly captureSceneSnapshots = new WeakMap<
    HTMLCanvasElement,
    string
  >();
  private readonly capturePaintSnapshots = new WeakMap<
    HTMLCanvasElement,
    string
  >();
  private captureSceneSnapshot: string | null = null;
  private capturePaintSnapshot: string | null = null;
  private hasCommittedCapture = false;
  private invalidationGeneration = 0;

  get capturedSceneSnapshot(): string | null {
    return this.captureSceneSnapshot;
  }
  get capturedPaintSnapshot(): string | null {
    return this.capturePaintSnapshot;
  }
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
    private readonly captureDescendantMotion = false,
  ) {
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (unchangedAttributeMutation(record) || runtimeCanvasMutation(record))
          continue;
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
          if (this.captureDescendantMotion && record.target !== this.element)
            this.invalidate("attributes");
          else this.onInvalidate();
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

  read(
    sceneSnapshot?: () => string,
    paintSnapshot?: () => string,
  ): HTMLCanvasElement | Promise<HTMLCanvasElement> {
    try {
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
      if (this.hasCommittedCapture) return this.canvas;
      return this.capture
        .read(
          async () => {
            const snapshot = sceneSnapshot?.() ?? null;
            const paint = paintSnapshot?.() ?? null;
            const candidate = document.createElement("canvas");
            try {
              await this.raster(this.element, candidate, density);
              if (snapshot !== null)
                this.captureSceneSnapshots.set(candidate, snapshot);
              if (paint !== null)
                this.capturePaintSnapshots.set(candidate, paint);
              return candidate;
            } catch (error) {
              candidate.width = 0;
              candidate.height = 0;
              throw error;
            }
          },
          (candidate) => {
            const previous = this.canvas;
            const invalidationGeneration = this.invalidationGeneration;
            this.canvas = candidate;
            this.captureSceneSnapshot =
              this.captureSceneSnapshots.get(candidate) ?? null;
            this.capturePaintSnapshot =
              this.capturePaintSnapshots.get(candidate) ?? null;
            this.revision += 1;
            this.onCapture();
            if (this.invalidationGeneration === invalidationGeneration)
              this.hasCommittedCapture = true;
            previous.width = 0;
            previous.height = 0;
          },
          (candidate) => {
            candidate.width = 0;
            candidate.height = 0;
          },
        )
        .catch((error) => {
          throw normalizeCachedLeafError(error, this.element);
        });
    } catch (error) {
      return Promise.reject(normalizeCachedLeafError(error, this.element));
    }
  }

  invalidate(reason: NativeSourceInvalidationReason = "explicit"): void {
    this.invalidationGeneration += 1;
    this.hasCommittedCapture = false;
    this.contentMeasurementDirty = true;
    this.capture.invalidate();
    this.onInvalidationReason(reason);
    this.onInvalidate();
  }
  dispose(): void {
    this.hasCommittedCapture = false;
    this.observer.disconnect();
    this.resizeObserver.disconnect();
    this.capture.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

function afterMaybePromise<T>(
  value: T | Promise<T>,
  continuation: (resolved: T) => void,
): void | Promise<void> {
  if (value instanceof Promise) return value.then(continuation);
  continuation(value);
}

function normalizeCachedLeafError(error: unknown, element?: Element): unknown {
  if (error instanceof NativeCaptureCacheError)
    return new NativeSourceError(error.code, error.message);
  if (error instanceof NativeSvgSourceError) {
    const sources = element
      ? [
          element,
          ...(isNativeSvgVectorGroup(element)
            ? element.querySelectorAll("svg")
            : []),
        ]
          .map(
            (source) =>
              source.id ||
              source.getAttribute("data-an-name") ||
              source.tagName.toLowerCase(),
          )
          .join(", ")
      : null;
    return new NativeSourceError(
      error.code,
      sources ? `${error.message} Source nodes: ${sources}.` : error.message,
    );
  }
  return error;
}

const MAX_REPLAY_IMAGE_BYTES = 16 * 1024 * 1024;

async function readReplayImageSafety(
  raw: string,
  signal: AbortSignal,
): Promise<NativeReplaySafety> {
  try {
    if (raw.length > MAX_REPLAY_IMAGE_BYTES * 2) return "unknown";
    const url = new URL(raw, document.baseURI);
    if (
      url.protocol !== "data:" &&
      url.protocol !== "blob:" &&
      url.origin !== nativeDocumentOrigin()
    )
      return "unknown";
    if (!["data:", "blob:", "http:", "https:"].includes(url.protocol))
      return "unknown";
    const network = url.protocol === "http:" || url.protocol === "https:";
    const response = await fetch(url.href, {
      signal,
      ...(network
        ? {
            credentials: "same-origin" as const,
            mode: "same-origin" as const,
            cache: "force-cache" as const,
          }
        : {}),
    });
    if (!response.ok || response.type === "opaque") return "unknown";
    const mime = response.headers.get("content-type")?.split(";", 1)[0].trim();
    if (!mime?.startsWith("image/")) return "unknown";
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_REPLAY_IMAGE_BYTES)
      return "unknown";
    if (!response.body) return "unknown";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_REPLAY_IMAGE_BYTES) {
        await reader.cancel();
        return "unknown";
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return classifyNativeImageReplaySafety(bytes, mime);
  } catch {
    return "unknown";
  }
}

function staticDomRecord(record: NativeSourceRecord): NativeReplaySafety {
  if (record.node instanceof SVGSVGElement) {
    return validateNativeSvgPrimitiveMarkup(record.node.outerHTML);
  }
  if (!(record.node instanceof HTMLElement)) return "unknown";
  try {
    for (const pseudo of [undefined, "::before", "::after"]) {
      const style = getComputedStyle(record.node, pseudo);
      if (
        [style.backgroundImage, style.maskImage, style.borderImageSource].some(
          (value) => value && value !== "none",
        )
      )
        return "unknown";
    }
    return "immutable";
  } catch {
    return "unknown";
  }
}

class SceneProvider implements NativeSceneProvider {
  private readonly coordinateSpace: NativeSourceRecord["coordinateSpace"];
  private leaves = new Map<Element, CachedLeaf>();
  private fillBoxLeaves = new Map<
    | "background"
    | "border"
    | "coverage"
    | "inner-coverage"
    | "outer-shadow"
    | "inset-shadow"
    | "outline",
    CachedLeaf
  >();
  private fillForegroundLeaf: CachedLeaf | null = null;
  private authoredContentTextSignature: string | null = null;
  private fillGlyphLeaf: CachedLeaf | null = null;
  private fillGlyphClone: HTMLElement | null = null;
  private fillGlyphColors: Map<Element, string> | null = null;
  private fillBoxIds = new Map<
    | "background"
    | "border"
    | "coverage"
    | "inner-coverage"
    | "outer-shadow"
    | "inset-shadow"
    | "outline",
    number
  >();
  private fillForegroundId = 0;
  private fillGlyphId = 0;
  private fillPaint: NativeFillBackgroundPaint | null = null;
  private mediaPaintLeaves = new Map<
    Element,
    Partial<Record<"media-underlay" | "media-overlay", CachedLeaf>>
  >();
  private mediaPaintIds = new WeakMap<
    Element,
    Partial<Record<"media-underlay" | "media-overlay", number>>
  >();
  private svgLeaves = new Map<
    HTMLElement | SVGSVGElement,
    CachedLeaf<HTMLElement | SVGSVGElement>
  >();
  private svgPaintIds = new WeakMap<Element, number>();
  private svgFillLeaves = new Map<
    "fill" | "stroke" | "coverage",
    CachedLeaf<SVGSVGElement>
  >();
  private receiverLeaf: CachedLeaf<HTMLElement | SVGSVGElement> | null = null;
  private ids = new WeakMap<Element, number>();
  private nextId = 1;
  private assetRevision = 0;
  private sourceGeneration = 0;
  private authoredSourceGeneration = 0;
  private readonly replayReads = new WeakMap<
    readonly NativeSourceRecord[],
    { sourceEpoch: number; authoredEpoch: number }
  >();
  private readonly replayImages = new WeakMap<
    HTMLImageElement,
    { url: string; epoch: number; result: Promise<NativeReplaySafety> }
  >();
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
  private viewportBackgroundSignature = "";
  private viewportBackgroundRevision = 0;
  private abort = new AbortController();
  private structureObserver: MutationObserver;
  private bodyStructureObserver: MutationObserver | null = null;
  private inheritedStyleObserver: MutationObserver;

  constructor(
    private readonly target: HTMLElement | SVGSVGElement,
    private readonly placement: "fill" | "layer" | "backdrop",
    private readonly onDirty: () => void = () => {},
    private readonly backdropPresentation?: HTMLCanvasElement,
    private readonly targetCapture?: "content" | "appearance",
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
        if (records.some((record) => !isNativeSourceOmittedMutation(record)))
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
        if (unchangedAttributeMutation(record) || runtimeCanvasMutation(record))
          continue;
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
        for (const cache of [this.leaves, this.svgLeaves])
          for (const [element, leaf] of cache)
            if (record.target !== element && record.target.contains(element)) {
              leaf.invalidate("ancestor-style");
              changed = true;
            }
        if (
          this.receiverLeaf &&
          record.target !== this.target &&
          record.target.contains(this.target)
        ) {
          this.receiverLeaf.invalidate("ancestor-style");
          changed = true;
        }
        for (const [element, phases] of this.mediaPaintLeaves)
          if (record.target !== element && record.target.contains(element))
            for (const leaf of Object.values(phases)) {
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
    if (this.placement === "fill")
      return (
        !this.target.contains(element) ||
        !this.target.contains(nativeBackdropReceiver(element))
      );
    if (!this.backdropPresentation || element === this.backdropPresentation)
      return true;
    const receiver = nativeBackdropReceiver(this.backdropPresentation);
    return !(
      element.compareDocumentPosition(receiver) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  private authoredContentTextPaint(
    element: HTMLElement | SVGSVGElement,
  ): { color: string; textFillColor: string } | undefined {
    if (
      !(element instanceof HTMLElement) ||
      this.targetCapture !== "content" ||
      element !== this.target ||
      !element.hasAttribute("data-an-native-text-suppressed")
    )
      return undefined;
    if (
      !hasDirectText(element) ||
      [...element.children].some(
        (child) =>
          !child.matches(
            "canvas[data-an-native-canvas]:not([data-an-native-presentation])",
          ),
      )
    )
      throw new NativeSourceError(
        "input-authored-content-text-unavailable",
        "Authored colors for styled descendant text are unavailable while a native text Fill is presented.",
      );
    const color = element.getAttribute("data-an-native-authored-color");
    const textFill = element.getAttribute(
      "data-an-native-authored-text-fill-color",
    );
    if (!color || textFill === null)
      throw new NativeSourceError(
        "input-authored-content-text-unavailable",
        "The authored text color has no preserved style snapshot.",
      );
    return {
      color,
      textFillColor: textFill && textFill !== "currentcolor" ? textFill : color,
    };
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
    for (const phases of this.mediaPaintLeaves.values())
      for (const leaf of Object.values(phases)) leaf.invalidate(reason);
    for (const leaf of this.svgLeaves.values()) leaf.invalidate(reason);
    for (const leaf of this.svgFillLeaves.values()) leaf.invalidate(reason);
    this.receiverLeaf?.invalidate(reason);
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
        [...this.mediaPaintLeaves.values()].reduce(
          (count, phases) => count + Object.values(phases).length,
          0,
        ) +
        this.svgLeaves.size +
        this.svgFillLeaves.size +
        Number(!!this.receiverLeaf),
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
      (scope instanceof HTMLVideoElement && !scope.paused && !scope.ended) ||
      [...scope.querySelectorAll<HTMLVideoElement>("video")].some(
        (video) => !video.paused && !video.ended,
      ) ||
      (scope instanceof HTMLCanvasElement &&
        !scope.hasAttribute("data-an-native-canvas") &&
        !scope.hasAttribute("data-an-native-presentation")) ||
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
    if (
      (this.placement !== "layer" && this.placement !== "fill") ||
      this.groupLocalBackdropSource === enabled
    )
      return;
    this.groupLocalBackdropSource = enabled;
    this.invalidateAll("explicit");
  }

  private groupLocalBackdropReceiver(
    element: Element,
  ): HTMLElement | SVGSVGElement | null {
    if (
      (this.placement !== "layer" && this.placement !== "fill") ||
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
      (this.placement !== "layer" && this.placement !== "fill") ||
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
    if (!Number.isFinite(density) || density <= 0)
      throw new NativeSourceError(
        "source-density-invalid",
        "Source capture density must be finite and positive.",
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

  private readSceneLeaf<T extends HTMLElement | SVGSVGElement>(
    leaf: CachedLeaf<T>,
    metrics?: NativeSourceReadSceneMetrics,
    phase: NativeOwnPaintPhase = "all",
    memo?: SourceGeometryMemo,
  ): HTMLCanvasElement | Promise<HTMLCanvasElement> {
    const started = metrics ? performance.now() : 0;
    const finish = () => {
      if (metrics) metrics.leafWaitWallMs += performance.now() - started;
    };
    let revision = leaf.revision;
    let plannedSnapshot = "";
    let plannedPaint = "";
    let result: HTMLCanvasElement | Promise<HTMLCanvasElement>;
    try {
      plannedSnapshot = this.sceneFrameSnapshot(leaf.element, metrics, memo);
      plannedPaint = this.rasterPaintSnapshot(leaf.element, phase, metrics);
      if (
        leaf.capturedPaintSnapshot !== null &&
        leaf.capturedPaintSnapshot !== plannedPaint
      )
        leaf.invalidate("explicit");
      revision = leaf.revision;
      result = leaf.read(
        () => this.sceneFrameSnapshot(leaf.element, metrics),
        () => this.rasterPaintSnapshot(leaf.element, phase, metrics),
      );
    } catch (error) {
      finish();
      throw normalizeCachedLeafError(error);
    }
    const validate = (source: HTMLCanvasElement) => {
      if (
        leaf.revision !== revision &&
        (leaf.capturedSceneSnapshot !== plannedSnapshot ||
          leaf.capturedPaintSnapshot !== plannedPaint)
      )
        throw new NativeSourceError(
          "source-scene-stale",
          "The source geometry changed before its raster snapshot began.",
        );
      return source;
    };
    if (result instanceof Promise)
      return result
        .then(validate)
        .catch((error) => {
          throw normalizeCachedLeafError(error);
        })
        .finally(() => {
          memo?.clear();
          finish();
        });
    try {
      return validate(result);
    } catch (error) {
      throw normalizeCachedLeafError(error);
    } finally {
      finish();
    }
  }

  private sceneFrameSnapshot(
    element: Element,
    metrics?: NativeSourceReadSceneMetrics,
    memo?: SourceGeometryMemo,
  ): string {
    const stop =
      this.placement === "backdrop" ? document.documentElement : this.target;
    const entries: (readonly (number | string)[])[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    ) {
      let entry = memo?.sceneFrameEntries.get(current);
      if (!entry) {
        if (metrics) {
          metrics.recordDirectRectReads += 1;
          metrics.recordDirectStyleReads += 1;
        }
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        entry = [
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          style.transform,
          style.translate,
          style.rotate,
          style.scale,
          style.overflowX,
          style.overflowY,
          style.clipPath,
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ];
        memo?.sceneFrameEntries.set(current, entry);
      }
      entries.push(entry);
      if (current === stop) break;
    }
    return JSON.stringify(entries);
  }

  private rasterPaintSnapshot(
    element: HTMLElement | SVGSVGElement,
    phase: NativeOwnPaintPhase,
    metrics?: NativeSourceReadSceneMetrics,
  ): string {
    const nodes = rasterOwnedStyleNodes(element, phase);
    return JSON.stringify(
      nodes.map((node) => {
        if (metrics) metrics.recordDirectStyleReads += 1;
        const style = getComputedStyle(node);
        let size: ReturnType<typeof sizeOf> | null = null;
        if (node === element) {
          if (metrics) metrics.recordDirectLayoutSizeReads += 1;
          size = sizeOf(element);
        }
        return [
          size,
          nativeRasterComputedStyleValues(style, {
            isRoot: node === element,
            phase,
          }),
        ];
      }),
    );
  }

  private recordMediaBoxPaint(
    element: HTMLElement,
    phase: "media-underlay" | "media-overlay",
    out: NativeSourceRecord[],
    metrics?: NativeSourceReadSceneMetrics,
    memo?: SourceGeometryMemo,
    allowVisibleTargetOverflow = false,
  ): void | Promise<void> {
    const style = getComputedStyle(element);
    const size = sourceLayoutSize(
      element,
      this.target,
      this.coordinateSpace,
      memo,
    );
    const ownBox = nativeOwnPaintCaptureBox(style, phase, size);
    const geometry = relativeAffine(
      element,
      this.target,
      this.coordinateSpace,
      ownBox,
      getComputedStyle,
      size,
      memo,
    );
    const sourceClip = sourceClipPlan(
      element,
      this.target,
      this.coordinateSpace,
      false,
      null,
      0,
      "content",
      getComputedStyle,
      memo,
      allowVisibleTargetOverflow,
      geometry.rect,
      element === this.target,
    );
    if (
      intersect(geometry.rect, sourceClip.clip).width <= 0 ||
      intersect(geometry.rect, sourceClip.clip).height <= 0
    )
      return;
    const isolationPath = this.isolationPath(
      element,
      sourceClip.groupClips,
      false,
    );
    if (!isolationPath) return;
    let phases = this.mediaPaintLeaves.get(element);
    if (!phases) {
      phases = {};
      this.mediaPaintLeaves.set(element, phases);
    }
    let ids = this.mediaPaintIds.get(element);
    if (!ids) {
      ids = {};
      this.mediaPaintIds.set(element, ids);
    }
    let key = ids[phase];
    if (!key) {
      key = this.nextId++;
      ids[phase] = key;
    }
    let leaf = phases[phase];
    if (!leaf) {
      this.trackLeaf(
        element,
        key,
        phase === "media-underlay" ? "media-background" : "own-paint",
      );
      leaf = new CachedLeaf(
        element,
        () => this.recordLeafCapture(key),
        () => nativeLeafCaptureDensity(element, this.density, phase),
        (node, canvas, density) => rasterOwnPaint(node, canvas, density, phase),
        this.onDirty,
        (reason) => this.recordLeafInvalidation(key, reason),
        (observation) => this.recordLeafObservedAttribute(key, observation),
      );
      phases[phase] = leaf;
    }
    const overflow = classifyNativeComputedOverflowClip(style);
    if (!overflow.ok)
      throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
    const ownClip =
      overflow.edge === "none"
        ? { x: 0, y: 0, ...size }
        : sourceClipPlan(
            element,
            element,
            "target-local",
            false,
            overflow.edge,
            overflow.outset,
          ).groupClips[0]?.clip.localBox;
    if (!ownClip)
      throw new NativeSourceError(
        "source-clip-unreadable",
        "The media paint capture clip has no local geometry.",
      );
    const expectedCapture = planNativeCaptureRoi({
      ownBox,
      clipBox: ownClip,
      density: nativeLeafCaptureDensity(element, this.density, phase),
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    if (!expectedCapture.ok)
      throw new NativeSourceError(
        `source-${expectedCapture.reason}`,
        "The current media paint geometry cannot be represented.",
      );
    return afterMaybePromise(
      this.readSceneLeaf(leaf, metrics, phase, memo),
      (source) => {
        const capture = nativeCaptureRoi(source);
        const expanded =
          ownBox.x < 0 ||
          ownBox.y < 0 ||
          ownBox.width > size.width ||
          ownBox.height > size.height;
        if (!capture && (expanded || overflow.outset > 0))
          throw new NativeSourceError(
            "source-capture-geometry-missing",
            "The media paint raster has no committed source origin.",
          );
        assertCurrentCaptureRoi(
          capture,
          expectedCapture.plan,
          expanded || overflow.outset > 0,
        );
        const capturedBox = capture?.cssBox ?? ownBox;
        const captured = relativeAffine(
          element,
          this.target,
          this.coordinateSpace,
          capturedBox,
          getComputedStyle,
          size,
          memo,
        );
        out.push({
          key,
          node: element,
          coordinateSpace: this.coordinateSpace,
          kind: "dom",
          source,
          width: source.width,
          height: source.height,
          revision: leaf.revision,
          rect: captured.rect,
          localBox: capturedBox,
          localToTarget: captured.localToTarget,
          clip: sourceClip.clip,
          clips: [],
          groupClips: sourceClip.groupClips.map(({ node, clip }) => ({
            id: `clip:${this.id(node)}`,
            clip,
          })),
          isolationPath,
          opacity: 1,
        });
      },
    );
  }

  private retireMediaBoxPaint(
    element: HTMLElement,
    phase: "media-underlay" | "media-overlay",
  ): void {
    const phases = this.mediaPaintLeaves.get(element);
    const leaf = phases?.[phase];
    if (!leaf) return;
    leaf.dispose();
    delete phases[phase];
    const ids = this.mediaPaintIds.get(element);
    if (ids) delete ids[phase];
    this.retiredLeaves += 1;
    if (Object.values(phases).length === 0)
      this.mediaPaintLeaves.delete(element);
  }

  private isolationPath(
    element: Element,
    groupClips: { node: Element; clip: NativeSourceClip }[],
    ownOpacityBaked: boolean,
    layerOutputOpacityDeferred = false,
    readStyle: SourceStyleReader = getComputedStyle,
  ): NativeSourceIsolation[] | null {
    const isBackdropCanvas = (node: Element): node is HTMLCanvasElement =>
      node instanceof HTMLCanvasElement &&
      node.hasAttribute("data-an-native-backdrop-presentation") &&
      !!node.getAttribute("data-an-native-canvas");
    const receiverForCanvas = nativeBackdropReceiver;

    const pairedBackdropCanvas = (node: Element): HTMLCanvasElement | null => {
      for (const direction of [
        "previousElementSibling",
        "nextElementSibling",
      ] as const) {
        let sibling = node[direction];
        while (sibling && isBackdropCanvas(sibling)) {
          if (receiverForCanvas(sibling) === node) return sibling;
          sibling = sibling[direction];
        }
      }
      return null;
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
      const opacity = authoredOpacity(node, readStyle);
      const receiver = isBackdropCanvas(node)
        ? receiverForCanvas(node)
        : pairedBackdropCanvas(node)
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
          authoredOpacity(receiver, readStyle) < 1
        )
          throw new NativeSourceError(
            "source-composition-unsupported",
            "source-composition-unsupported",
          );
        path.push({
          id: `receiver:${this.id(receiver)}`,
          kind: "opacity",
          opacity: authoredOpacity(receiver, readStyle),
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
    // Keep this cache synchronous: raster epochs do not track live CSS animation or layout.
    const styles = new Map<Element, CSSStyleDeclaration>();
    const readStyle: SourceStyleReader = (element) => {
      let style = styles.get(element);
      if (!style) {
        style = getComputedStyle(element);
        styles.set(element, style);
      }
      return style;
    };
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
        const style = readStyle(current);
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
      const scope = sourcePaintScope(record.node, stop, readStyle);
      const order = sourceLeafPaintOrder(record.node, scope, readStyle);
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
        const firstOrder = sourceStackingOrder(
          stackingNodes[first],
          common,
          readStyle,
        );
        const secondOrder = sourceStackingOrder(
          stackingNodes[second],
          common,
          readStyle,
        );
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

  private assertSvgVectorGroupComposition(element: Element): void {
    if (
      element.querySelector(
        "[data-an-native-canvas],[data-an-native-fill-instance],[data-an-native-layer-instance]",
      )
    )
      throw new NativeSourceError(
        "source-svg-group-native-composition-unsupported",
        "An SVG vector group with nested native effects needs a composed vector source.",
      );
  }

  private async rasterSvgVectorGroup(
    element: HTMLElement,
    canvas: HTMLCanvasElement,
    density: number,
  ): Promise<void> {
    this.assertSvgVectorGroupComposition(element);
    const children = [...element.children].filter((child) => !this.omit(child));
    if (
      hasDirectText(element) ||
      children.some((child) => !(child instanceof SVGSVGElement))
    )
      throw new NativeSourceError(
        "receiver-svg-group-unsupported",
        "An imported SVG vector group contains non-vector content.",
      );
    const sources = children.flatMap((child) => {
      const svg = child as SVGSVGElement;
      const style = getComputedStyle(svg);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      )
        return [];
      assertLeafSupported(svg);
      if (!supportsNativeOutput2D(style))
        throw new NativeSourceError(
          "source-svg-transform-unsupported",
          "An SVG vector group has unsupported child geometry.",
        );
      const size = nativeSvgViewportSize(svg);
      const geometry = relativeAffine(
        svg,
        element,
        "target-local",
        undefined,
        undefined,
        size,
      );
      return [{ svg, size, localToGroup: geometry.localToTarget }];
    });
    await rasterNativeSvgGroupSource(sources, canvas, density, {
      width: element.offsetWidth,
      height: element.offsetHeight,
    });
  }

  private recordSvg(
    element: HTMLElement | SVGSVGElement,
    out: NativeSourceRecord[],
    metrics?: NativeSourceReadSceneMetrics,
    memo?: SourceGeometryMemo,
    allowVisibleTargetOverflow = false,
  ): void | Promise<void> {
    assertLeafSupported(
      element,
      this.coordinateSpace === "target-local" ? this.target : undefined,
    );
    if (metrics) metrics.recordDirectStyleReads += 1;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (element instanceof SVGSVGElement && element.hasAttribute("transform"))
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
      if (metrics) metrics.recordDirectStyleReads += 1;
      if (!supportsNativeOutput2D(getComputedStyle(ancestor)))
        throw new NativeSourceError(
          "source-svg-transform-unsupported",
          "An SVG source has a transformed HTML layout boundary.",
        );
      if (ancestor === stop) break;
    }
    if (isNativeSvgVectorGroup(element))
      this.assertSvgVectorGroupComposition(element);
    const size =
      element instanceof SVGSVGElement
        ? nativeSvgViewportSize(element)
        : sourceLayoutSize(element, this.target, this.coordinateSpace, memo);
    const geometry = relativeAffine(
      element,
      this.target,
      this.coordinateSpace,
      undefined,
      undefined,
      size,
      memo,
    );
    const { localBox, localToTarget: svgToTarget } = geometry;
    const sourceClip = sourceClipPlan(
      element,
      this.target,
      this.coordinateSpace,
      false,
      null,
      0,
      "content",
      undefined,
      memo,
      allowVisibleTargetOverflow,
    );
    const isolationPath = this.isolationPath(
      element,
      sourceClip.groupClips,
      element instanceof SVGSVGElement,
    );
    if (
      !isolationPath ||
      sourceClip.clip.width <= 0 ||
      sourceClip.clip.height <= 0
    )
      return;
    const key = this.svgPaintIds.get(element) ?? this.nextId++;
    this.svgPaintIds.set(element, key);
    let leaf = this.svgLeaves.get(element);
    if (!leaf) {
      this.trackLeaf(element, key, "svg");
      leaf = new CachedLeaf(
        element,
        () => this.recordLeafCapture(key),
        () =>
          nativeLeafCaptureDensity(
            element,
            this.density,
            element instanceof SVGSVGElement ? "all" : "coverage",
          ),
        (node, canvas, density) =>
          node instanceof SVGSVGElement
            ? rasterNativeSvgSource(
                node,
                canvas,
                density,
                undefined,
                nativeSvgViewportSize(node),
              )
            : this.rasterSvgVectorGroup(node, canvas, density),
        this.onDirty,
        (reason) => this.recordLeafInvalidation(key, reason),
        (observation) => this.recordLeafObservedAttribute(key, observation),
        isNativeSvgVectorGroup(element),
      );
      this.svgLeaves.set(element, leaf);
    }
    return afterMaybePromise(
      this.readSceneLeaf(leaf, metrics, "all", memo),
      (source) => {
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
          ownBox: { x: 0, y: 0, width: size.width, height: size.height },
          clipBox: {
            x: -computedOverflow.outset,
            y: -computedOverflow.outset,
            width: size.width + 2 * computedOverflow.outset,
            height: size.height + 2 * computedOverflow.outset,
          },
          density: nativeLeafCaptureDensity(
            element,
            this.density,
            element instanceof SVGSVGElement ? "all" : "coverage",
          ),
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
          key,
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
      },
    );
  }

  private record(
    element: Element,
    out: NativeSourceRecord[],
    paintPhase: NativeOwnPaintPhase = "all",
    metrics?: NativeSourceReadSceneMetrics,
    memo?: SourceGeometryMemo,
    allowVisibleTargetOverflow = false,
  ): void | Promise<void> {
    if (!element.isConnected || this.omit(element)) return;
    if (element.hasAttribute("data-an-native-receiver-suppressed")) return;
    if (element instanceof SVGSVGElement)
      return this.recordSvg(
        element,
        out,
        metrics,
        memo,
        allowVisibleTargetOverflow,
      );
    if (element instanceof SVGElement)
      throw new NativeSourceError(
        "source-inline-svg",
        "An SVG fragment outside an SVG root cannot be captured.",
      );
    if (!(element instanceof HTMLElement)) return;
    const recordStyles =
      memo?.styles ?? new Map<Element, CSSStyleDeclaration>();
    const readRecordStyle: SourceStyleReader = (node) => {
      let style = recordStyles.get(node);
      if (!style) {
        style = snapshotComputedStyle(node);
        recordStyles.set(node, style);
      }
      return style;
    };
    const readCountedRecordStyle = (node: Element) => {
      if (!recordStyles.has(node) && metrics)
        metrics.recordDirectStyleReads += 1;
      return readRecordStyle(node);
    };
    const readFreshRecordStyle = (node: Element) => {
      if (metrics) metrics.recordDirectStyleReads += 1;
      return snapshotComputedStyle(node);
    };
    const style = readCountedRecordStyle(element);
    const groupLocalReceiver = this.groupLocalBackdropReceiver(element);
    const visibility = groupLocalReceiver
      ? readCountedRecordStyle(groupLocalReceiver)
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
        const ancestorStyle = readCountedRecordStyle(node);
        if (
          ancestorStyle.display === "none" ||
          ancestorStyle.visibility !== "visible" ||
          authoredOpacity(node, readRecordStyle) <= 0
        )
          return;
        if (node === this.target) break;
      }
      if (metrics) metrics.recordDirectAffineReads += 1;
      const box = relativeRect(element, this.target, this.coordinateSpace);
      if (metrics && this.coordinateSpace !== "target-viewport-axis-aligned")
        metrics.recordDirectAffineReads += 1;
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
      readRecordStyle,
    );
    if (metrics) metrics.recordDirectLayoutSizeReads += 1;
    const ownSize = sourceLayoutSize(
      element,
      this.target,
      this.coordinateSpace,
      memo,
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
    if (metrics) metrics.recordDirectAffineReads += 1;
    const geometry = relativeAffine(
      element,
      this.target,
      this.coordinateSpace,
      undefined,
      readRecordStyle,
      ownSize,
      memo,
    );
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
      paintPhase === "inner-coverage" ||
      paintPhase === "outer-shadow" ||
      paintPhase === "inset-shadow" ||
      paintPhase === "outline";
    const fillOwnEffectPhase =
      paintPhase === "outer-shadow" ||
      paintPhase === "inset-shadow" ||
      paintPhase === "outline";
    const paintedBounds =
      (paintPhase === "all" || fillOwnEffectPhase) &&
      !media &&
      !nativeInstanceId &&
      (style.boxShadow !== "none" ||
        (style.outlineStyle !== "none" && style.outlineStyle !== "hidden"))
        ? relativeAffine(
            element,
            this.target,
            this.coordinateSpace,
            nativeOwnPaintCaptureBox(style, paintPhase, ownSize),
            readRecordStyle,
            ownSize,
            memo,
          ).rect
        : undefined;
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
      readRecordStyle,
      memo,
      allowVisibleTargetOverflow || fillOwnEffectPhase,
      paintedBounds,
      fillOwnEffectPhase,
    );
    const contentVisible =
      sourceClip.clip.width > 0 && sourceClip.clip.height > 0;
    const mediaPaint = media ? mediaBoxPaint(style) : null;
    if (mediaPaint) {
      if (!mediaPaint.underlay)
        this.retireMediaBoxPaint(element, "media-underlay");
      if (!mediaPaint.overlay)
        this.retireMediaBoxPaint(element, "media-overlay");
    }
    if (!contentVisible && !mediaPaint?.underlay && !mediaPaint?.overlay)
      return;
    const isolationPath = this.isolationPath(
      element,
      sourceClip.groupClips,
      !!nativeInstanceId || boxPhase,
      false,
      readRecordStyle,
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
    const recordMediaPaint = (
      appendContent: () => void,
    ): void | Promise<void> => {
      const appendContentAndOverlay = (): void | Promise<void> => {
        if (contentVisible) appendContent();
        if (mediaPaint?.overlay)
          return this.recordMediaBoxPaint(
            element,
            "media-overlay",
            out,
            metrics,
            memo,
            allowVisibleTargetOverflow,
          );
      };
      if (mediaPaint?.underlay)
        return afterMaybePromise(
          this.recordMediaBoxPaint(
            element,
            "media-underlay",
            out,
            metrics,
            memo,
            allowVisibleTargetOverflow,
          ),
          appendContentAndOverlay,
        );
      return appendContentAndOverlay();
    };
    if (media && !contentVisible) {
      recordStyles.clear();
      return recordMediaPaint(() => undefined);
    }
    const mediaBox = sourceClip.clips[0]?.localBox ?? geometry.localBox;
    if (element instanceof HTMLImageElement) {
      const imageSourceUrl = element.currentSrc || element.src;
      assertLocalAsset(imageSourceUrl);
      const imageWidth = element.naturalWidth;
      const imageHeight = element.naturalHeight;
      const imageRendering = style.imageRendering;
      if (!element.complete || imageWidth <= 0)
        throw new NativeSourceError(
          "source-image-pending",
          "An image source has not finished loading.",
        );
      const image = mediaPlacement(
        element,
        mediaBox,
        imageWidth,
        imageHeight,
        style,
      );
      const imageRect = relativeAffine(
        element,
        this.target,
        this.coordinateSpace,
        image.rect,
        readRecordStyle,
        undefined,
        memo,
      ).rect;
      const appendImage = () => {
        if (metrics) metrics.recordDirectAffineReads += 1;
        out.push({
          ...common,
          rect: imageRect,
          localBox: image.rect,
          uv: image.uv,
          kind: "image",
          imageRendering: { value: imageRendering },
          source: element,
          imageSourceUrl,
          width: imageWidth,
          height: imageHeight,
          revision: this.assetRevision,
        });
      };
      recordStyles.clear();
      return recordMediaPaint(appendImage);
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
      const videoWidth = element.videoWidth;
      const videoHeight = element.videoHeight;
      const imageRendering = style.imageRendering;
      const video = mediaPlacement(
        element,
        mediaBox,
        videoWidth,
        videoHeight,
        style,
      );
      const videoRect = relativeAffine(
        element,
        this.target,
        this.coordinateSpace,
        video.rect,
        readRecordStyle,
        undefined,
        memo,
      ).rect;
      const appendVideo = () => {
        if (metrics) metrics.recordDirectAffineReads += 1;
        out.push({
          ...common,
          rect: videoRect,
          localBox: video.rect,
          uv: video.uv,
          kind: "video",
          imageRendering: { value: imageRendering },
          source: element,
          width: videoWidth,
          height: videoHeight,
          revision: ++this.assetRevision,
        });
      };
      recordStyles.clear();
      return recordMediaPaint(appendVideo);
    }
    if (element instanceof HTMLCanvasElement) {
      if (nativeInstanceId) {
        out.push({
          ...common,
          kind: "native",
          imageRendering: {
            value: readFreshRecordStyle(element).imageRendering,
          },
          nativeInstanceId,
          width: element.width,
          height: element.height,
          revision: this.assetRevision,
        });
      } else {
        const canvasWidth = element.width;
        const canvasHeight = element.height;
        const imageRendering = style.imageRendering;
        if (canvasWidth <= 0 || canvasHeight <= 0)
          throw new NativeSourceError(
            "source-canvas-empty",
            "A canvas source has no drawable pixels.",
          );
        const canvas = mediaPlacement(
          element,
          mediaBox,
          canvasWidth,
          canvasHeight,
          style,
        );
        const canvasRect = relativeAffine(
          element,
          this.target,
          this.coordinateSpace,
          canvas.rect,
          readRecordStyle,
          undefined,
          memo,
        ).rect;
        const appendCanvas = () => {
          if (metrics) metrics.recordDirectAffineReads += 1;
          out.push({
            ...common,
            rect: canvasRect,
            localBox: canvas.rect,
            uv: canvas.uv,
            kind: "canvas",
            imageRendering: { value: imageRendering },
            source: element,
            width: canvasWidth,
            height: canvasHeight,
            revision: ++this.assetRevision,
          });
        };
        recordStyles.clear();
        return recordMediaPaint(appendCanvas);
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
          () => nativeLeafCaptureDensity(element, this.density, paintPhase),
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
              this.authoredContentTextPaint(node),
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
      recordStyles.clear();
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
      const ownPaintBox = nativeOwnPaintCaptureBox(style, paintPhase, size);
      const expectedCapture = planNativeCaptureRoi({
        ownBox: ownPaintBox,
        clipBox: ownClip,
        density: nativeLeafCaptureDensity(element, this.density, paintPhase),
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      if (!expectedCapture.ok)
        throw new NativeSourceError(
          `source-${expectedCapture.reason}`,
          "The current DOM capture geometry cannot be represented.",
        );
      return afterMaybePromise(
        this.readSceneLeaf(leaf, metrics, paintPhase, memo),
        (source) => {
          const capture = nativeCaptureRoi(source);
          const expandedOwnPaint =
            ownPaintBox.x < 0 ||
            ownPaintBox.y < 0 ||
            ownPaintBox.width > size.width ||
            ownPaintBox.height > size.height;
          if (!capture && (ownOverflow.outset > 0 || expandedOwnPaint))
            throw new NativeSourceError(
              "source-capture-geometry-missing",
              "The DOM raster has no committed source origin.",
            );
          assertCurrentCaptureRoi(
            capture,
            expectedCapture.plan,
            ownOverflow.outset > 0 || expandedOwnPaint,
          );
          if (capture && metrics) metrics.recordDirectAffineReads += 1;
          const capturedGeometryResult = planNativeSourceAffine({
            localBox: capture?.cssBox ?? geometry.localBox,
            localToTarget: geometry.localToTarget,
            physicalScale: { x: 1, y: 1 },
          });
          if (!capturedGeometryResult.ok)
            throw new NativeSourceError("source-transform", "source-transform");
          const capturedGeometry = {
            localBox: capture?.cssBox ?? geometry.localBox,
            localToTarget: geometry.localToTarget,
            rect: capturedGeometryResult.physicalBounds,
          };
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
        },
      );
    }
  }

  private walk(
    element: Element,
    out: NativeSourceRecord[],
    metrics?: NativeSourceReadSceneMetrics,
    memo?: SourceGeometryMemo,
    allowVisibleTargetOverflow = false,
  ): void | Promise<void> {
    const result = runSourceWalkSteps(
      this.walkSteps(element, out, metrics, memo, allowVisibleTargetOverflow),
      memo,
    );
    if (result && typeof (result as Promise<boolean>).then === "function")
      return (result as Promise<boolean>).then(() => undefined);
  }

  private *walkSteps(
    element: Element,
    out: NativeSourceRecord[],
    metrics?: NativeSourceReadSceneMetrics,
    memo?: SourceGeometryMemo,
    allowVisibleTargetOverflow = false,
  ): Generator<SourceWalkStep, boolean, boolean> {
    let crossedAsyncBoundary = false;
    let initialSize: { width: number; height: number } | undefined;
    if (this.omit(element)) return false;
    if (
      isNativeSvgVectorGroup(element) &&
      element.hasAttribute("data-an-native-receiver-suppressed")
    )
      return false;
    if (metrics) metrics.walkNodeVisits += 1;
    if (element instanceof HTMLElement && element !== this.target) {
      if (metrics) metrics.walkDirectLayoutSizeReads += 1;
      initialSize = sourceLayoutSize(
        element,
        this.target,
        this.coordinateSpace,
        memo,
      );
      if (hasEmptySourceLayout(initialSize)) {
        if (metrics) metrics.walkDirectStyleReads += 1;
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
            return false;
          }
        }
      }
    }
    const captureTargetContent =
      element === this.target && this.targetCapture === "content";
    const fillInstance = captureTargetContent
      ? null
      : element.getAttribute("data-an-native-fill-instance");
    const layerInstance =
      (element !== this.target || this.targetCapture === "appearance") &&
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
      if (metrics) metrics.walkDirectStyleReads += 1;
      const imageRendering = {
        value: getComputedStyle(presentation).imageRendering,
      };
      if (metrics) metrics.walkDirectAffineReads += 1;
      const presentationGeometry = relativeAffine(
        presentation,
        this.target,
        element === this.target && replacementInstance
          ? "target-local-global"
          : this.coordinateSpace,
        undefined,
        getComputedStyle,
        undefined,
        memo,
      );
      const rect = presentationGeometry.rect;
      const sourceClip = sourceClipPlan(
        element,
        this.target,
        this.coordinateSpace,
        false,
        null,
        0,
        "content",
        undefined,
        memo,
        allowVisibleTargetOverflow || !!fillInstance,
        fillInstance ? presentationGeometry.rect : undefined,
        element === this.target && !!fillInstance,
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
      return false;
    }
    if (isNativeSvgVectorGroup(element)) {
      if (
        yield this.record(
          element,
          out,
          "all",
          metrics,
          memo,
          allowVisibleTargetOverflow,
        )
      )
        crossedAsyncBoundary = true;
      if (
        yield this.recordSvg(
          element as HTMLElement,
          out,
          metrics,
          memo,
          allowVisibleTargetOverflow,
        )
      )
        crossedAsyncBoundary = true;
      return crossedAsyncBoundary;
    }
    const fillCanvases = captureTargetContent
      ? []
      : [...element.children].filter((child) =>
          child.matches(
            "canvas[data-an-native-canvas]:not([data-an-native-presentation])",
          ),
        );
    const boxBeforeNativeFill =
      fillCanvases.length > 0 &&
      element instanceof HTMLElement &&
      !hasDirectText(element);
    if (boxBeforeNativeFill) {
      if (
        yield this.record(
          element,
          out,
          "all",
          metrics,
          memo,
          allowVisibleTargetOverflow,
        )
      )
        crossedAsyncBoundary = true;
    }
    for (const fill of fillCanvases) {
      if (
        yield* this.walkSteps(
          fill,
          out,
          metrics,
          memo,
          allowVisibleTargetOverflow,
        )
      )
        crossedAsyncBoundary = true;
    }
    if (!boxBeforeNativeFill) {
      if (
        yield this.record(
          element,
          out,
          "all",
          metrics,
          memo,
          allowVisibleTargetOverflow,
        )
      )
        crossedAsyncBoundary = true;
    }
    if (element instanceof SVGSVGElement) return crossedAsyncBoundary;
    if (element instanceof HTMLElement) {
      let size = initialSize;
      if (crossedAsyncBoundary || !size) {
        if (metrics) metrics.walkDirectLayoutSizeReads += 1;
        size = sourceLayoutSize(
          element,
          this.target,
          this.coordinateSpace,
          memo,
        );
      }
      if (!hasEmptySourceLayout(size) && isSourceTextFlow(element))
        return crossedAsyncBoundary;
    }
    const childGroups: NativeSourceRecord[][] = [];
    for (const child of element.children)
      if (
        !(
          captureTargetContent && child.hasAttribute("data-an-native-canvas")
        ) &&
        !fillCanvases.includes(child) &&
        !(hasDirectText(element) && isInlineFlowChild(child))
      ) {
        const records: NativeSourceRecord[] = [];
        if (
          yield* this.walkSteps(
            child,
            records,
            metrics,
            memo,
            allowVisibleTargetOverflow,
          )
        )
          crossedAsyncBoundary = true;
        if (records.length) childGroups.push(records);
      }
    for (const records of orderAutoStackingSiblingPaint(
      element,
      childGroups,
      memo,
    ))
      out.push(...records);
    if (element.lastElementChild)
      assertDomSiblingOrder(element, element.lastElementChild, element, out);
    return crossedAsyncBoundary;
  }

  private recordTargetBackdropPresentations(
    out: NativeSourceRecord[],
    metrics: NativeSourceReadSceneMetrics | undefined,
    memo: SourceGeometryMemo,
    side: "before" | "after",
  ): void {
    const presentations: HTMLCanvasElement[] = [];
    const direction =
      side === "before" ? "previousElementSibling" : "nextElementSibling";
    for (
      let sibling = this.target[direction];
      sibling instanceof HTMLCanvasElement &&
      sibling.hasAttribute("data-an-native-backdrop-presentation");
      sibling = sibling[direction]
    )
      if (side === "before") presentations.unshift(sibling);
      else presentations.push(sibling);
    for (const canvas of presentations) {
      if (nativeBackdropReceiver(canvas) !== this.target)
        throw new NativeSourceError(
          "source-composition-unsupported",
          "A backdrop presentation no longer belongs to the captured target.",
        );
      const instanceId = canvas.getAttribute("data-an-native-canvas");
      if (!instanceId || canvas.width < 1 || canvas.height < 1)
        throw new NativeSourceError(
          "native-presentation-missing",
          "An authored backdrop has no current native presentation surface.",
        );
      if (metrics) metrics.walkDirectAffineReads += 1;
      const geometry = relativeAffine(
        canvas,
        this.target,
        "target-local-global",
        undefined,
        getComputedStyle,
        undefined,
        memo,
      );
      const sourceClip = sourceClipPlan(
        this.target,
        this.target,
        this.coordinateSpace,
        true,
        null,
        0,
        "border",
        undefined,
        memo,
      );
      const isolationPath = this.isolationPath(
        this.target,
        sourceClip.groupClips,
        false,
      );
      if (
        !isolationPath ||
        geometry.rect.width <= 0 ||
        geometry.rect.height <= 0 ||
        sourceClip.clip.width <= 0 ||
        sourceClip.clip.height <= 0
      )
        continue;
      out.push({
        key: this.id(canvas),
        node: this.target,
        kind: "native",
        nativeInstanceId: instanceId,
        imageRendering: { value: getComputedStyle(canvas).imageRendering },
        width: canvas.width,
        height: canvas.height,
        revision: this.assetRevision,
        coordinateSpace: this.coordinateSpace,
        rect: geometry.rect,
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
      });
    }
  }

  private *readSceneWalkSteps(
    path: Element[],
    out: NativeSourceRecord[],
    metrics: NativeSourceReadSceneMetrics | undefined,
    memo: SourceGeometryMemo,
    fillPrefix?: NativeAncestorFillPrefix,
  ): Generator<SourceWalkStep, void, boolean> {
    if (this.placement === "layer") {
      if (this.targetCapture === "appearance")
        this.recordTargetBackdropPresentations(out, metrics, memo, "before");
      yield* this.walkSteps(this.target, out, metrics, memo, true);
      if (this.targetCapture === "appearance")
        this.recordTargetBackdropPresentations(out, metrics, memo, "after");
      return;
    }
    for (let index = 0; index < path.length - 1; index += 1) {
      if (path[index] === fillPrefix?.ancestor)
        this.recordAncestorFillPrefix(fillPrefix, out, metrics, memo);
      else yield this.record(path[index]!, out, "all", metrics, memo);
      for (const sibling of path[index]!.children) {
        if (sibling === path[index + 1]) break;
        yield* this.walkSteps(sibling, out, metrics, memo);
      }
    }
  }

  private recordAncestorFillPrefix(
    prefix: NativeAncestorFillPrefix,
    out: NativeSourceRecord[],
    metrics: NativeSourceReadSceneMetrics | undefined,
    memo: SourceGeometryMemo,
  ): void {
    const readStyle: SourceStyleReader = (node) => {
      let style = memo.styles.get(node);
      if (!style) {
        style = snapshotComputedStyle(node);
        memo.styles.set(node, style);
        if (metrics) metrics.recordDirectStyleReads += 1;
      }
      return style;
    };
    const style = readStyle(prefix.ancestor);
    if (
      style.display === "none" ||
      style.visibility !== "visible" ||
      !prefix.ancestor.isConnected
    )
      throw new NativeSourceError(
        "fill-prefix-unavailable",
        "The staged Fill prefix is no longer visible.",
      );
    assertLeafSupported(prefix.ancestor, undefined, readStyle);
    if (metrics) metrics.recordDirectLayoutSizeReads += 1;
    const size = sourceLayoutSize(
      prefix.ancestor,
      this.target,
      this.coordinateSpace,
      memo,
    );
    if (hasEmptySourceLayout(size))
      throw new NativeSourceError(
        "fill-prefix-unavailable",
        "The staged Fill prefix has no current layout box.",
      );
    if (metrics) metrics.recordDirectAffineReads += 1;
    const geometry = relativeAffine(
      prefix.ancestor,
      this.target,
      this.coordinateSpace,
      prefix.localBox,
      readStyle,
      size,
      memo,
    );
    const sourceClip = sourceClipPlan(
      prefix.ancestor,
      this.target,
      this.coordinateSpace,
      false,
      null,
      0,
      "content",
      readStyle,
      memo,
      true,
      geometry.rect,
    );
    const isolationPath = this.isolationPath(
      prefix.ancestor,
      sourceClip.groupClips,
      false,
      false,
      readStyle,
    );
    if (
      !isolationPath ||
      geometry.rect.width <= 0 ||
      geometry.rect.height <= 0 ||
      sourceClip.clip.width <= 0 ||
      sourceClip.clip.height <= 0
    )
      return;
    out.push({
      key: this.id(prefix.ancestor),
      node: prefix.ancestor,
      kind: "native",
      sourceRole: "ancestor-fill-prefix",
      nativeInstanceId: prefix.instanceId,
      width: prefix.width,
      height: prefix.height,
      revision: prefix.revision,
      coordinateSpace: this.coordinateSpace,
      rect: geometry.rect,
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
    });
  }

  private async viewportBackground(): Promise<NativeSourceRecord | null> {
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
    const rootAlpha = solidBackgroundAlpha(rootStyle.backgroundColor);
    const source =
      rootStyle.backgroundImage !== "none" || rootAlpha !== 0 || !document.body
        ? root
        : document.body;
    const style = source === root ? rootStyle : getComputedStyle(source);
    const alpha = solidBackgroundAlpha(style.backgroundColor);
    if (
      alpha === null ||
      getComputedStyle(root).opacity !== "1" ||
      (source !== root && style.opacity !== "1")
    )
      throw new NativeSourceError(
        "source-viewport-background-unsupported",
        "The CSS canvas background extends beyond the root box and needs a supported opaque solid source.",
      );
    const hasImage = style.backgroundImage !== "none";
    if (!hasImage && alpha === 0) return null;
    if (!supportedViewportBackgroundImage(style.backgroundImage))
      throw new NativeSourceError(
        "source-viewport-background-image-unsupported",
        "The CSS canvas background uses an image type the native renderer cannot capture.",
      );
    let density = 1;
    if (hasImage) {
      try {
        density = fitNativeRasterDensity({
          width: viewport.width,
          height: viewport.height,
          density: this.density,
          maxDimension: 4096,
          maxPixels: 8_388_608,
          pixelPadding: 1,
        });
      } catch {
        throw new NativeSourceError(
          "source-viewport-background-unavailable",
          "The viewport background exceeds the bounded raster size.",
        );
      }
    }
    const signature = JSON.stringify([
      source === root ? "root" : "body",
      style.backgroundColor,
      style.backgroundImage,
      style.backgroundPosition,
      style.backgroundSize,
      style.backgroundRepeat,
      style.backgroundOrigin,
      style.backgroundClip,
      style.backgroundAttachment,
      style.backgroundBlendMode,
      viewport.width,
      viewport.height,
      density,
    ]);
    if (
      !this.viewportBackgroundCanvas ||
      this.viewportBackgroundSignature !== signature
    ) {
      const canvas =
        this.viewportBackgroundCanvas ?? document.createElement("canvas");
      if (hasImage) {
        await rasterViewportBackground(style, canvas, viewport, density);
      } else {
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
      }
      this.viewportBackgroundCanvas = canvas;
      this.viewportBackgroundSignature = signature;
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
          width:
            (this.target instanceof SVGSVGElement
              ? nativeSvgViewportSize(this.target).width
              : this.target.offsetWidth) +
            insets.left +
            insets.right,
          height:
            (this.target instanceof SVGSVGElement
              ? nativeSvgViewportSize(this.target).height
              : this.target.offsetHeight) +
            insets.top +
            insets.bottom,
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
      width: this.viewportBackgroundCanvas.width,
      height: this.viewportBackgroundCanvas.height,
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

  private markReplayRead(records: NativeSourceRecord[]): NativeSourceRecord[] {
    this.replayReads.set(records, {
      sourceEpoch: this.sourceGeneration,
      authoredEpoch: this.authoredSourceGeneration,
    });
    return records;
  }

  async readFillBackground(
    paint: NativeFillBackgroundPaint,
  ): Promise<NativeSourceRecord[]> {
    return this.readFillBoxPhase(paint, "background");
  }

  async readFillOwnPaintPhase(
    phase: "outer-shadow" | "inset-shadow" | "outline",
  ): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    if (this.placement !== "fill")
      throw new NativeSourceError(
        "source-placement-invalid",
        "Only a Fill target has authored box paint.",
      );
    const style = getComputedStyle(this.target);
    const outsets = readNativeCssPaintOutsets(style);
    if (outsets.kind === "unreadable")
      throw new NativeSourceError(
        "source-paint-outset-unreadable",
        `Cannot resolve computed ${outsets.property} for source paint.`,
      );
    const shadows =
      style.boxShadow === "none" ? [] : splitTopLevelCommas(style.boxShadow);
    const present =
      phase === "outline"
        ? style.outlineStyle !== "none" &&
          style.outlineStyle !== "hidden" &&
          Number.parseFloat(style.outlineWidth) > 0
        : shadows.some(
            (shadow) => /\binset\b/.test(shadow) === (phase === "inset-shadow"),
          );
    this.readSceneCalls += 1;
    const out: NativeSourceRecord[] = [];
    if (!present) return this.markReplayRead(out);
    if (!this.fillBoxIds.has(phase)) this.fillBoxIds.set(phase, this.nextId++);
    await this.record(this.target, out, phase);
    this.assertSourceComposition(out);
    return this.markReplayRead(out);
  }

  async readReceiverCoverage(): Promise<{
    source: HTMLCanvasElement;
    cssBox: NativeAffineBox;
    width: number;
    height: number;
    revision: number;
    geometryKind: "svg-silhouette" | "svg-group-silhouette" | "box";
  }> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    const target = this.target;
    if (isNativeSvgVectorGroup(target))
      this.assertSvgVectorGroupComposition(target);
    assertLeafSupported(target, target);
    const size =
      target instanceof SVGSVGElement
        ? nativeSvgViewportSize(target)
        : { width: target.offsetWidth, height: target.offsetHeight };
    const density = nativeLeafCaptureDensity(
      target,
      Math.max(1, this.density),
      "coverage",
    );
    if (!this.receiverLeaf) {
      const key = this.nextId++;
      this.trackLeaf(
        target,
        key,
        target instanceof SVGSVGElement ? "svg" : "own-paint",
      );
      this.receiverLeaf = new CachedLeaf(
        target,
        () => this.recordLeafCapture(key),
        () =>
          nativeLeafCaptureDensity(
            target,
            Math.max(1, this.density),
            "coverage",
          ),
        async (element, canvas, scale) => {
          if (element instanceof SVGSVGElement) {
            await rasterNativeSvgSource(
              element,
              canvas,
              scale,
              "coverage",
              nativeSvgViewportSize(element),
            );
            return;
          }
          if (isNativeSvgVectorGroup(element)) {
            await this.rasterSvgVectorGroup(element, canvas, scale);
            return;
          }
          const width = element.offsetWidth;
          const height = element.offsetHeight;
          const style = getComputedStyle(element);
          const radii = resolveNativeClipRadii({
            width,
            height,
            cssPixelScale: 1,
            topLeft: style.borderTopLeftRadius,
            topRight: style.borderTopRightRadius,
            bottomRight: style.borderBottomRightRadius,
            bottomLeft: style.borderBottomLeftRadius,
          });
          if (!radii.ok)
            throw new NativeSourceError(
              "receiver-radius-invalid",
              radii.detail,
            );
          const box = { x: 0, y: 0, width, height };
          const capture = planNativeCaptureRoi({
            ownBox: box,
            clipBox: box,
            density: scale,
            maxDimension: 4096,
            maxPixels: 8_388_608,
          });
          if (!capture.ok)
            throw new NativeSourceError(
              "receiver-geometry-invalid",
              "The receiver exceeds bounded coverage dimensions.",
            );
          canvas.width = capture.plan.pixelBox.width;
          canvas.height = capture.plan.pixelBox.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context)
            throw new NativeSourceError(
              "receiver-coverage-unavailable",
              "The receiver has no 2D coverage surface.",
            );
          traceNativeRoundedBoxPath(context, box, radii.radii, scale, scale);
          context.fillStyle = OPAQUE_COVERAGE_COLOR;
          context.fill();
          setNativeCaptureRoi(canvas, capture.plan);
        },
        this.onDirty,
        (reason) => this.recordLeafInvalidation(key, reason),
        (observation) => this.recordLeafObservedAttribute(key, observation),
        isNativeSvgVectorGroup(target),
      );
    }
    const source = await this.readSceneLeaf(
      this.receiverLeaf,
      undefined,
      "coverage",
    );
    const box = { x: 0, y: 0, ...size };
    const expected = planNativeCaptureRoi({
      ownBox: box,
      clipBox: box,
      density,
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    if (!expected.ok)
      throw new NativeSourceError(
        "receiver-geometry-invalid",
        "The receiver exceeds bounded coverage dimensions.",
      );
    assertCurrentCaptureRoi(nativeCaptureRoi(source), expected.plan, true);
    return {
      source,
      cssBox: expected.plan.cssBox,
      ...size,
      revision: this.receiverLeaf.revision,
      geometryKind:
        target instanceof SVGSVGElement
          ? "svg-silhouette"
          : isNativeSvgVectorGroup(target)
            ? "svg-group-silhouette"
            : "box",
    };
  }

  private async readSvgFillPhase(
    svg: SVGSVGElement,
    phase: "background" | "border" | "coverage" | "inner-coverage",
  ): Promise<NativeSourceRecord[]> {
    assertLeafSupported(svg, svg);
    const size = nativeSvgViewportSize(svg);
    const paint =
      phase === "border"
        ? "stroke"
        : phase === "coverage"
          ? "coverage"
          : "fill";
    let leaf = this.svgFillLeaves.get(paint);
    if (!leaf) {
      const key = this.nextId++;
      this.trackLeaf(svg, key, "svg");
      leaf = new CachedLeaf(
        svg,
        () => this.recordLeafCapture(key),
        () => nativeLeafCaptureDensity(svg, this.density),
        (element, canvas, density) =>
          rasterNativeSvgSource(
            element,
            canvas,
            density,
            paint,
            nativeSvgViewportSize(element),
          ),
        this.onDirty,
        (reason) => this.recordLeafInvalidation(key, reason),
        (observation) => this.recordLeafObservedAttribute(key, observation),
      );
      this.svgFillLeaves.set(paint, leaf);
    }
    this.readSceneCalls += 1;
    const source = await this.readSceneLeaf(leaf, undefined, phase);
    const capture = nativeCaptureRoi(source);
    const box = { x: 0, y: 0, ...size };
    const expected = planNativeCaptureRoi({
      ownBox: box,
      clipBox: box,
      density: nativeLeafCaptureDensity(svg, this.density),
      maxDimension: 4096,
      maxPixels: 8_388_608,
    });
    if (!expected.ok)
      throw new NativeSourceError(
        "fill-svg-capture-geometry-unsupported",
        "An SVG Fill needs a bounded viewport capture.",
      );
    assertCurrentCaptureRoi(capture, expected.plan, true);
    if (!this.fillBoxIds.has(phase)) this.fillBoxIds.set(phase, this.nextId++);
    return this.markReplayRead([
      {
        key: this.fillBoxIds.get(phase)!,
        node: svg,
        kind: "dom",
        source,
        width: source.width,
        height: source.height,
        revision: leaf.revision,
        coordinateSpace: "target-local",
        rect: expected.plan.cssBox,
        localBox: expected.plan.cssBox,
        localToTarget: IDENTITY_AFFINE,
        clip: box,
        clips: [],
        groupClips: [],
        isolationPath: [],
        opacity: 1,
      },
    ]);
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
    if (this.target instanceof SVGSVGElement)
      return this.readSvgFillPhase(this.target, phase);
    const style = getComputedStyle(this.target);
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
    return this.markReplayRead(out);
  }

  async readFillGlyph(): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    if (
      this.placement !== "fill" ||
      !(this.target instanceof HTMLElement) ||
      !isPureTextFlow(this.target)
    )
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
    return this.markReplayRead(out);
  }

  hasFillGlyph(): boolean {
    return (
      !(this.target instanceof SVGSVGElement) &&
      isPureTextFlow(this.target) &&
      Boolean(this.target.textContent?.trim())
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
    if (this.target instanceof SVGSVGElement) return this.markReplayRead([]);
    if (isPureTextFlow(this.target)) return this.markReplayRead([]);
    if (hasDirectText(this.target))
      throw new NativeSourceError(
        "fill-mixed-text-layout-unsupported",
        "Direct text mixed with independent child paint needs an ordered text source.",
      );
    const groups: NativeSourceRecord[][] = [];
    for (const child of this.target.children) {
      if (this.omit(child)) continue;
      const records: NativeSourceRecord[] = [];
      await this.walk(child, records, undefined, undefined, true);
      if (records.length) groups.push(records);
    }
    const out = orderAutoStackingSiblingPaint(this.target, groups).flat();
    const style = getComputedStyle(this.target);
    const overflow = classifyNativeComputedOverflowClip(style);
    if (!overflow.ok)
      throw new NativeSourceError(`source-${overflow.reason}`, overflow.detail);
    this.assertSourceComposition(out);
    return this.markReplayRead(out);
  }

  async readScene(
    metrics?: NativeSourceReadSceneMetrics,
    callSite: NativeSourceReadSceneCallSite = "other",
    fillPrefix?: NativeAncestorFillPrefix,
  ): Promise<NativeSourceRecord[]> {
    if (this.disposed)
      throw new NativeSourceError(
        "source-disposed",
        "The source provider was disposed.",
      );
    const authoredTextPaint = this.authoredContentTextPaint(this.target);
    const authoredTextSignature = authoredTextPaint
      ? JSON.stringify(authoredTextPaint)
      : null;
    if (authoredTextSignature !== this.authoredContentTextSignature) {
      this.leaves.get(this.target)?.invalidate("attributes");
      this.authoredContentTextSignature = authoredTextSignature;
    }
    this.readSceneCalls += 1;
    if (metrics) {
      metrics.calls += 1;
      if (callSite === "scene-presentation")
        metrics.scenePresentationCalls += 1;
      else if (callSite === "mount-source") metrics.mountSourceCalls += 1;
      else if (callSite === "dependency-refresh")
        metrics.dependencyRefreshCalls += 1;
      else metrics.otherCalls += 1;
    }
    const readStarted = metrics ? performance.now() : 0;
    const memo = new SourceGeometryMemo(this.target, this.coordinateSpace);
    try {
      const background = await this.viewportBackground();
      const out: NativeSourceRecord[] = background ? [background] : [];
      const walkStarted = metrics ? performance.now() : 0;
      const path: Element[] = [];
      if (this.placement !== "layer")
        for (
          let node: Element | null = this.target;
          node;
          node = node.parentElement
        )
          path.unshift(node);
      if (fillPrefix) {
        const box = fillPrefix.localBox;
        const publishedInstance = fillPrefix.ancestor.getAttribute(
          "data-an-native-fill-instance",
        );
        if (
          this.placement !== "backdrop" ||
          !path.slice(0, -1).includes(fillPrefix.ancestor) ||
          !fillPrefix.instanceId ||
          typeof fillPrefix.unpublished !== "boolean" ||
          (publishedInstance === null
            ? !fillPrefix.unpublished
            : publishedInstance !== fillPrefix.instanceId) ||
          ![
            fillPrefix.width,
            fillPrefix.height,
            fillPrefix.revision,
            fillPrefix.authoredSourceEpoch,
          ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
          fillPrefix.width < 1 ||
          fillPrefix.height < 1 ||
          fillPrefix.width > 4096 ||
          fillPrefix.height > 4096 ||
          fillPrefix.width * fillPrefix.height > 8_388_608 ||
          ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.width <= 0 ||
          box.height <= 0 ||
          this.authoredSourceGeneration !== fillPrefix.authoredSourceEpoch
        )
          throw new NativeSourceError(
            "fill-prefix-stale",
            "The staged Fill prefix no longer matches its Backdrop source.",
          );
      }
      try {
        const traversal = runSourceWalkSteps(
          this.readSceneWalkSteps(path, out, metrics, memo, fillPrefix),
          memo,
        );
        if (traversal) await traversal;
        memo.clear();
      } finally {
        if (metrics) metrics.walkWallMs += performance.now() - walkStarted;
      }
      const validationStarted = metrics ? performance.now() : 0;
      try {
        for (let index = 0; index < path.length - 1; index += 1)
          assertDomSiblingOrder(path[index], path[index + 1], this.target, out);
        this.assertSourceComposition(out);
      } finally {
        if (metrics)
          metrics.validationWallMs += performance.now() - validationStarted;
      }
      const live = new Set(out.map((record) => record.node));
      for (const [element, leaf] of this.leaves) {
        if (!live.has(element)) {
          leaf.dispose();
          this.leaves.delete(element);
          this.retiredLeaves += 1;
        }
      }
      for (const [element, phases] of this.mediaPaintLeaves)
        if (!live.has(element)) {
          for (const leaf of Object.values(phases)) {
            leaf.dispose();
            this.retiredLeaves += 1;
          }
          this.mediaPaintLeaves.delete(element);
          this.mediaPaintIds.delete(element);
        }
      for (const [element, leaf] of this.svgLeaves) {
        if (!live.has(element)) {
          leaf.dispose();
          this.svgLeaves.delete(element);
          this.retiredLeaves += 1;
        }
      }
      if (
        JSON.stringify(this.authoredContentTextPaint(this.target) ?? null) !==
        JSON.stringify(authoredTextPaint ?? null)
      )
        throw new NativeSourceError(
          "input-authored-source-stale",
          "The authored text style changed during capture.",
        );
      if (
        fillPrefix &&
        this.authoredSourceGeneration !== fillPrefix.authoredSourceEpoch
      )
        throw new NativeSourceError(
          "fill-prefix-stale",
          "The staged Fill prefix changed during Backdrop capture.",
        );
      return this.markReplayRead(out);
    } finally {
      memo.clear();
      if (metrics) metrics.wallMs += performance.now() - readStarted;
    }
  }

  layerVisiblePaintInsets(
    records: readonly NativeSourceRecord[],
  ): NativeSourceCaptureInsets {
    if (this.disposed || this.placement !== "layer")
      throw new NativeSourceError(
        "source-layer-extent-unavailable",
        "A Layer source is required for visible paint bounds.",
      );
    const read = this.replayReads.get(records);
    if (
      !read ||
      read.sourceEpoch !== this.sourceGeneration ||
      read.authoredEpoch !== this.authoredSourceGeneration
    )
      throw new NativeSourceError(
        "source-capture-geometry-stale",
        "The Layer records no longer match the current source epoch.",
      );
    const width =
      this.target instanceof SVGSVGElement
        ? nativeSvgViewportSize(this.target).width
        : this.target.offsetWidth;
    const height =
      this.target instanceof SVGSVGElement
        ? nativeSvgViewportSize(this.target).height
        : this.target.offsetHeight;
    if (![width, height].every((value) => Number.isFinite(value) && value > 0))
      throw new NativeSourceError(
        "source-capture-geometry-invalid",
        "The Layer target has invalid capture geometry.",
      );
    const insets = nativeTargetOverflowInsets(this.target, true);
    for (const record of records) {
      if (
        record.coordinateSpace !== "target-local" ||
        ![...Object.values(record.rect), ...Object.values(record.clip)].every(
          Number.isFinite,
        ) ||
        record.rect.width < 0 ||
        record.rect.height < 0 ||
        record.clip.width < 0 ||
        record.clip.height < 0
      )
        throw new NativeSourceError(
          "source-capture-geometry-invalid",
          "A Layer source has invalid painted geometry.",
        );
      const visible = intersect(record.rect, record.clip);
      if (visible.width <= 0 || visible.height <= 0) continue;
      insets.top = Math.max(insets.top, -visible.y);
      insets.right = Math.max(insets.right, visible.x + visible.width - width);
      insets.bottom = Math.max(
        insets.bottom,
        visible.y + visible.height - height,
      );
      insets.left = Math.max(insets.left, -visible.x);
    }
    if (!Object.values(insets).every((value) => value >= 0 && value <= 4096))
      throw new NativeSourceError(
        "source-capture-geometry-invalid",
        "Visible Layer paint exceeds the bounded capture extent.",
      );
    return insets;
  }

  async readLayerVisibleScene(): Promise<{
    records: NativeSourceRecord[];
    captureInsets: NativeSourceCaptureInsets;
  }> {
    if (this.placement !== "layer")
      throw new NativeSourceError(
        "source-layer-extent-unavailable",
        "A Layer source is required for visible paint bounds.",
      );
    const records = await this.readScene();
    return { records, captureInsets: this.layerVisiblePaintInsets(records) };
  }

  async replaySafety(
    records: readonly NativeSourceRecord[],
    nativeMode?: "committed-native",
  ): Promise<NativeReplaySafety> {
    const read = this.replayReads.get(records);
    const unchanged = () =>
      !this.disposed &&
      read?.sourceEpoch === this.sourceGeneration &&
      read.authoredEpoch === this.authoredSourceGeneration;
    if (!read || !unchanged()) return "unknown";
    if (this.needsContinuousFrames()) return "dynamic";
    let safety: NativeReplaySafety = "immutable";
    for (const record of records) {
      if (!unchanged()) return "unknown";
      if (record.kind === "native") {
        if (nativeMode === "committed-native") continue;
        return "dynamic";
      }
      if (record.kind === "video") return "dynamic";
      if (record.kind === "canvas") {
        if (record.sourceRole !== "viewport-background") return "dynamic";
        continue;
      }
      if (record.kind === "dom") {
        if (staticDomRecord(record) === "unknown") safety = "unknown";
        continue;
      }
      if (
        record.kind !== "image" ||
        !(record.source instanceof HTMLImageElement)
      ) {
        safety = "unknown";
        continue;
      }
      const url = record.imageSourceUrl;
      if (!url || (record.source.currentSrc || record.source.src) !== url) {
        safety = "unknown";
        continue;
      }
      let cached = this.replayImages.get(record.source);
      if (
        !cached ||
        cached.url !== url ||
        cached.epoch !== this.sourceGeneration
      ) {
        cached = {
          url,
          epoch: this.sourceGeneration,
          result: readReplayImageSafety(url, this.abort.signal),
        };
        this.replayImages.set(record.source, cached);
      }
      const imageSafety = await cached.result;
      if (!unchanged()) return "unknown";
      if ((record.source.currentSrc || record.source.src) !== url)
        return "unknown";
      if (imageSafety === "dynamic") return "dynamic";
      if (imageSafety === "unknown") safety = "unknown";
    }
    return unchanged() ? safety : "unknown";
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
    for (const phases of this.mediaPaintLeaves.values())
      for (const leaf of Object.values(phases)) leaf.dispose();
    this.mediaPaintLeaves.clear();
    this.mediaPaintIds = new WeakMap();
    for (const leaf of this.svgLeaves.values()) leaf.dispose();
    this.svgLeaves.clear();
    for (const leaf of this.svgFillLeaves.values()) leaf.dispose();
    this.svgFillLeaves.clear();
    this.receiverLeaf?.dispose();
    this.receiverLeaf = null;
    if (this.viewportBackgroundCanvas) {
      this.viewportBackgroundCanvas.width = 0;
      this.viewportBackgroundCanvas.height = 0;
      this.viewportBackgroundCanvas = null;
    }
  }
}

export function createNativeSceneProvider(
  target: HTMLElement | SVGSVGElement,
  placement: "fill" | "layer" | "backdrop",
  onDirty?: () => void,
  backdropPresentation?: HTMLCanvasElement,
  targetCapture?: "content" | "appearance",
): NativeSceneProvider | null {
  return new SceneProvider(
    target,
    placement,
    onDirty,
    backdropPresentation,
    targetCapture,
  );
}
