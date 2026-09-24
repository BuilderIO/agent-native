import { splitCssLayers } from "@/components/design/edit-panel/fill-gradient-helpers";
import type { ElementInfo } from "@/components/design/types";
import { isDesignHotkeyEditableTarget } from "@/hooks/useDesignHotkeys";

import {
  computeExportCropBox,
  EDITOR_CHROME_OVERLAY_SELECTOR,
  resolveRasterExportScale,
  unionExportCropRects,
  waitForExportReady,
} from "./export-capture";
import type { ExportCropRect } from "./export-capture";
import {
  getHtml2CanvasPlaceholderStyle,
  mirrorPreviewWebFonts,
} from "./export-font-mirror";
import { isScreenRootElementInfo } from "./selection-state";

const UNSUPPORTED_HTML2CANVAS_COLOR_RE =
  /\b(?:color|color-mix|oklch|oklab|lab|lch)\(/i;
const HTML2CANVAS_COLOR_PROPERTIES = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
] as const;
const HTML2CANVAS_SHADOW_PROPERTIES = ["box-shadow", "text-shadow"] as const;
const HTML2CANVAS_UNSUPPORTED_VALUE_PROPERTIES = [
  "background-image",
  "border-image-source",
  "list-style-image",
] as const;
const HTML2CANVAS_PLACEHOLDER_TEXT_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "word-spacing",
] as const;

export function blurActiveDesignEditableTarget() {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && isDesignHotkeyEditableTarget(active)) {
    active.blur();
  }
}

let html2CanvasColorContext: CanvasRenderingContext2D | null | undefined;

function getHtml2CanvasColorContext(): CanvasRenderingContext2D | null {
  if (html2CanvasColorContext !== undefined) return html2CanvasColorContext;
  if (typeof document === "undefined") {
    html2CanvasColorContext = null;
    return html2CanvasColorContext;
  }
  html2CanvasColorContext = document.createElement("canvas").getContext("2d");
  return html2CanvasColorContext;
}

function parseColorFunctionComponent(component: string): number {
  const trimmed = component.trim();
  if (trimmed.endsWith("%")) {
    return (Number(trimmed.slice(0, -1)) / 100) * 255;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) <= 1 ? value * 255 : value;
}

function parseColorFunctionAlpha(alpha: string | undefined): number {
  if (!alpha) return 1;
  const trimmed = alpha.trim();
  if (trimmed.endsWith("%")) return Number(trimmed.slice(0, -1)) / 100;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 1;
}

function parseRgbLikeColorFunction(value: string): string | null {
  const match = value.match(/color\(\s*[\w-]+\s+([^)]+)\)/i);
  if (!match) return null;
  const [componentsPart, alphaPart] = match[1].split("/");
  const channels = componentsPart.trim().split(/\s+/).slice(0, 3);
  if (channels.length < 3) return null;
  const [red, green, blue] = channels
    .map(parseColorFunctionComponent)
    .map((channel) => Math.round(Math.max(0, Math.min(255, channel))));
  const alpha = Math.max(0, Math.min(1, parseColorFunctionAlpha(alphaPart)));
  return alpha < 1
    ? `rgba(${red}, ${green}, ${blue}, ${alpha})`
    : `rgb(${red}, ${green}, ${blue})`;
}

function normalizeHtml2CanvasColor(value: string): string {
  if (!UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) return value;
  const context = getHtml2CanvasColorContext();
  if (context) {
    try {
      context.fillStyle = "#000";
      context.fillStyle = value;
      const normalized = String(context.fillStyle);
      if (normalized && !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(normalized)) {
        return normalized;
      }
    } catch {
      // Fall back to small parser below.
    }
  }
  return parseRgbLikeColorFunction(value) ?? "rgb(0, 0, 0)";
}

export function normalizeHtml2CanvasImage(value: string): string {
  // Computed sRGB color-mix stops can use the normal renderer, preserving
  // external images and webfonts that a foreignObject cannot load.
  if (!/\bin srgb\b/.test(value)) return value;
  return splitCssLayers(value)
    .map((layer) => {
      if (
        !/^(?:linear|radial)-gradient\(/.test(layer) ||
        !/\bin srgb\b/.test(layer)
      )
        return layer;
      return layer
        .replace(
          /\bcolor\(\s*srgb\s+[^)]+\)/gi,
          (color) => parseRgbLikeColorFunction(color) ?? color,
        )
        .replace(/(\(\s*)in srgb\s*,\s*/g, "$1")
        .replace(/\s+in srgb(?=\s*,)/g, "");
    })
    .join(", ");
}

function elementInlineStyle(
  element: Element | undefined,
): CSSStyleDeclaration | null {
  if (!element) return null;
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  return style && typeof style.setProperty === "function" ? style : null;
}

function resolveClonedElement(
  sourceDocument: Document,
  clonedDocument: Document,
  sourceElement: Element,
): Element | null {
  const nodeId = sourceElement.getAttribute("data-agent-native-node-id");
  if (nodeId) {
    const matchingNode = Array.from(
      clonedDocument.querySelectorAll("[data-agent-native-node-id]"),
    ).find(
      (element) => element.getAttribute("data-agent-native-node-id") === nodeId,
    );
    if (matchingNode) return matchingNode;
  }
  const id = sourceElement.getAttribute("id");
  if (id) {
    const matchingId = clonedDocument.getElementById(id);
    if (matchingId) return matchingId;
  }

  const path: number[] = [];
  for (
    let element: Element | null = sourceElement;
    element && element !== sourceDocument.documentElement;
    element = element.parentElement
  ) {
    const parent = element.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children).indexOf(element);
    if (index < 0) return null;
    path.push(index);
  }
  if (path.length === 0)
    return sourceElement === sourceDocument.documentElement
      ? clonedDocument.documentElement
      : null;

  let clonedElement: Element = clonedDocument.documentElement;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const sourceIndex = path[index]!;
    const children = Array.from(clonedElement.children).filter(
      (child) => child.localName !== "html2canvaspseudoelement",
    );
    const child = children[sourceIndex];
    if (!child) return null;
    clonedElement = child;
  }
  return clonedElement;
}

export function isolateSelectedExportElements(
  sourceDocument: Document,
  clonedDocument: Document,
  selectedElements: readonly Element[],
): void {
  if (selectedElements.length === 0) return;

  const selectedClones = new Set<Element>();
  for (const element of selectedElements) {
    const clone = resolveClonedElement(sourceDocument, clonedDocument, element);
    if (!clone) throw new PngCaptureError("selection-unresolved");
    selectedClones.add(clone);
  }

  const selectedSubtreeClones = new Set<Element>();
  const ancestorClones = new Set<Element>();
  for (const element of selectedClones) {
    element
      .querySelectorAll("*")
      .forEach((child) => selectedSubtreeClones.add(child));
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      ancestorClones.add(ancestor);
    }
  }
  const visibleClones = new Set([
    ...selectedClones,
    ...selectedSubtreeClones,
    ...ancestorClones,
  ]);

  const sourceElements = [
    sourceDocument.documentElement,
    ...Array.from(sourceDocument.documentElement.querySelectorAll("*")),
  ];
  for (const sourceElement of sourceElements) {
    const clone = resolveClonedElement(
      sourceDocument,
      clonedDocument,
      sourceElement,
    );
    if (!clone) continue;
    const parentVisible = clone.parentElement
      ? visibleClones.has(clone.parentElement)
      : true;
    if (!visibleClones.has(clone) && parentVisible) {
      const style = elementInlineStyle(clone);
      style?.setProperty("opacity", "0", "important");
    }
  }

  for (const ancestor of ancestorClones) {
    const style = elementInlineStyle(ancestor);
    if (!style) continue;
    style.setProperty("background-color", "transparent", "important");
    style.setProperty("background-image", "none", "important");
    style.setProperty("border-top-color", "transparent", "important");
    style.setProperty("border-right-color", "transparent", "important");
    style.setProperty("border-bottom-color", "transparent", "important");
    style.setProperty("border-left-color", "transparent", "important");
    style.setProperty("outline-color", "transparent", "important");
    style.setProperty("box-shadow", "none", "important");
  }
}

/** html2canvas ignores CSS `filter`, so filtered images export pre-filtered. */
async function bakeFilteredImages(
  doc: Document,
): Promise<Map<Element, string>> {
  const baked = new Map<Element, string>();
  const view = doc.defaultView;
  if (!view) return baked;
  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const filter = view.getComputedStyle(image).filter;
    if (!filter || filter === "none" || !image.naturalWidth) continue;
    const draw = (source: HTMLImageElement) => {
      const canvas = doc.createElement("canvas");
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas unavailable");
      context.filter = filter;
      context.drawImage(source, 0, 0);
      return canvas.toDataURL("image/png");
    };
    try {
      baked.set(image, draw(image));
      continue;
      // coercion-ok: a cross-origin image taints the canvas; retried with CORS below
    } catch {}
    try {
      const corsImage = new view.Image();
      corsImage.crossOrigin = "anonymous";
      corsImage.src = image.currentSrc || image.src;
      await corsImage.decode();
      baked.set(image, draw(corsImage));
      // coercion-ok: without CORS headers the image exports unfiltered, and says so
    } catch (error) {
      console.warn("PNG export could not apply an image filter:", error);
    }
  }
  return baked;
}

function sanitizeHtml2CanvasClone(
  sourceDocument: Document,
  clonedDocument: Document,
  bakedImages: ReadonlyMap<Element, string>,
) {
  const sourceView = sourceDocument.defaultView;
  if (!sourceView) return;
  const sourceElements = [
    sourceDocument.documentElement,
    ...Array.from(sourceDocument.documentElement.querySelectorAll("*")),
  ];
  const clonedElements = [
    clonedDocument.documentElement,
    ...Array.from(clonedDocument.documentElement.querySelectorAll("*")),
  ];
  sourceElements.forEach((sourceElement, index) => {
    const clonedStyle = elementInlineStyle(clonedElements[index]);
    if (!clonedStyle) return;
    const computed = sourceView.getComputedStyle(sourceElement);
    const bakedSource = bakedImages.get(sourceElement);
    if (bakedSource) {
      clonedElements[index]!.setAttribute("src", bakedSource);
      clonedElements[index]!.removeAttribute("srcset");
      clonedStyle.setProperty("filter", "none", "important");
    }
    for (const property of HTML2CANVAS_COLOR_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) continue;
      clonedStyle.setProperty(
        property,
        normalizeHtml2CanvasColor(value),
        "important",
      );
    }
    for (const property of HTML2CANVAS_SHADOW_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) continue;
      clonedStyle.setProperty(property, "none", "important");
    }
    for (const property of HTML2CANVAS_UNSUPPORTED_VALUE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) continue;
      clonedStyle.setProperty(
        property,
        normalizeHtml2CanvasImage(value),
        "important",
      );
    }

    // html2canvas paints a placeholder as the input value, using the input's
    // styles instead of the styles attached to ::placeholder.
    const placeholderStyle = getHtml2CanvasPlaceholderStyle(
      sourceElement,
      sourceView,
    );
    if (placeholderStyle) {
      for (const property of HTML2CANVAS_PLACEHOLDER_TEXT_PROPERTIES) {
        const value = placeholderStyle.getPropertyValue(property);
        if (!value) continue;
        clonedStyle.setProperty(
          property,
          property === "color" ? normalizeHtml2CanvasColor(value) : value,
          "important",
        );
      }
    }
  });
}

/**
 * Remove editor-chrome overlays from a cloned document/element before it is
 * rasterized (PNG) or serialized (SVG) for export.
 */
export function removeEditorChromeOverlays(root: ParentNode): void {
  root
    .querySelectorAll(EDITOR_CHROME_OVERLAY_SELECTOR)
    .forEach((element) => element.remove());
}

export function sanitizeSerializedXmlForSvg(value: string): string {
  // SVG opened as XML only knows the five predefined entities. HTML serializers
  // can leave named entities or bare ampersands in foreignObject content; escape
  // those so the downloaded SVG parses cleanly in browsers and editors.
  return value.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
    "&amp;",
  );
}

/**
 * Resolve the document-space rect of the currently selected element inside the
 * preview iframe so image exports (PNG/SVG) can crop to just that frame instead
 * of the whole screen. Returns null — meaning "export the whole screen" — when
 * there is no element selection, when the selection is the screen root
 * (BODY/HTML, which is the whole screen anyway), or when the element can no
 * longer be resolved in the live document.
 */
function resolveElementForExport(
  doc: Document,
  selected: ElementInfo,
): Element | null {
  let element: Element | null = null;
  if (selected.sourceId) {
    try {
      element = doc.querySelector(
        `[data-agent-native-node-id="${CSS.escape(selected.sourceId)}"]`,
      );
    } catch {
      element = null;
    }
  }
  if (!element && selected.selector) {
    try {
      element = doc.querySelector(selected.selector);
    } catch {
      element = null;
    }
  }
  return element;
}

export function resolveSelectedExportElements(
  doc: Document,
  selected: ElementInfo | readonly ElementInfo[] | null | undefined,
): Element[] {
  const selections = Array.isArray(selected)
    ? selected
    : selected
      ? [selected]
      : [];
  const screenRootSelections = selections.filter(isScreenRootElementInfo);
  if (screenRootSelections.length > 0) {
    if (selections.length !== 1)
      throw new PngCaptureError("selection-unresolved");
    return [];
  }
  return selections.map((selection) => {
    const element = resolveElementForExport(doc, selection);
    if (!element) throw new PngCaptureError("selection-unresolved");
    return element;
  });
}

export type ExportCropTarget =
  | {
      kind: "rect";
      rect: { x: number; y: number; width: number; height: number };
    }
  | { kind: "whole-screen" }
  | { kind: "unresolved" };

export function resolveExportCropTarget(
  doc: Document,
  selected: ElementInfo | readonly ElementInfo[] | null | undefined,
): ExportCropTarget {
  const selections = Array.isArray(selected)
    ? selected
    : selected
      ? [selected]
      : [];
  if (selections.length === 0) return { kind: "whole-screen" };
  const includesScreenRoot = selections.some(isScreenRootElementInfo);

  try {
    const elements = resolveSelectedExportElements(
      doc,
      includesScreenRoot
        ? selections.filter((selection) => !isScreenRootElementInfo(selection))
        : selections,
    );
    // A Screen root widens the crop to the full document, but every ordinary
    // member still has to resolve before the selection can be exported.
    if (includesScreenRoot) return { kind: "whole-screen" };
    if (elements.length === 0) return { kind: "unresolved" };
    const rect = unionExportCropRects(
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          throw new PngCaptureError("selection-unresolved");
        }
        const view = doc.defaultView;
        return {
          x: rect.left + (view?.scrollX ?? 0),
          y: rect.top + (view?.scrollY ?? 0),
          width: rect.width,
          height: rect.height,
        };
      }),
    );
    return rect ? { kind: "rect", rect } : { kind: "unresolved" };
  } catch (error) {
    if (
      error instanceof PngCaptureError &&
      error.code === "selection-unresolved"
    ) {
      return { kind: "unresolved" };
    }
    throw error;
  }
}

export function resolveExportCropRect(
  doc: Document,
  selected: ElementInfo | readonly ElementInfo[] | null | undefined,
): { x: number; y: number; width: number; height: number } | null {
  const target = resolveExportCropTarget(doc, selected);
  if (target.kind === "unresolved") {
    throw new PngCaptureError("selection-unresolved");
  }
  return target.kind === "rect" ? target.rect : null;
}

/**
 * Board preview iframes are finite windows around the infinite canvas. Export
 * their placed nodes, not the mostly-empty render window; keep a small bleed
 * so strokes and shadows at the outer edge are not clipped. DesignCanvas marks
 * ordinary screen frames with data-screen-iframe-id; board previews omit it.
 */
export function resolveBoardExportCropRect(
  doc: Document,
  iframe: HTMLIFrameElement,
): ExportCropRect | null {
  if (iframe.hasAttribute("data-screen-iframe-id")) return null;
  const view = doc.defaultView;
  if (!view || !doc.body) return null;

  const contentBounds = unionExportCropRects(
    Array.from(
      doc.body.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
    ).flatMap((element) => {
      if (element.closest(EDITOR_CHROME_OVERLAY_SELECTOR)) return [];
      const style = view.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [];
      return [
        {
          x: rect.left + (view.scrollX ?? 0),
          y: rect.top + (view.scrollY ?? 0),
          width: rect.width,
          height: rect.height,
        },
      ];
    }),
  );
  if (!contentBounds) return null;

  const documentWidth = Math.max(
    doc.documentElement.scrollWidth,
    doc.body.scrollWidth,
    iframe.clientWidth,
  );
  const documentHeight = Math.max(
    doc.documentElement.scrollHeight,
    doc.body.scrollHeight,
    iframe.clientHeight,
  );
  const padding = 16;
  const x = Math.max(0, contentBounds.x - padding);
  const y = Math.max(0, contentBounds.y - padding);
  const right = Math.min(
    documentWidth,
    contentBounds.x + contentBounds.width + padding,
  );
  const bottom = Math.min(
    documentHeight,
    contentBounds.y + contentBounds.height + padding,
  );
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Crop a rendered html2canvas canvas down to a document-space rect so image
 * exports capture just the selected frame. Returns null when the crop is empty,
 * so callers can fall back to the full render.
 */
export function cropCanvasToRect(
  source: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): HTMLCanvasElement | null {
  const box = computeExportCropBox(source.width, source.height, rect, scale);
  if (!box) return null;
  const cropped = document.createElement("canvas");
  cropped.width = box.sw;
  cropped.height = box.sh;
  const context = cropped.getContext("2d");
  if (!context) return null;
  context.drawImage(
    source,
    box.sx,
    box.sy,
    box.sw,
    box.sh,
    0,
    0,
    box.sw,
    box.sh,
  );
  return cropped;
}

export async function renderExportDocumentCanvas({
  doc,
  iframe,
  exportScale,
  cropRect,
  render,
  isolateSelectedElements = [],
}: {
  doc: Document;
  iframe: HTMLIFrameElement;
  exportScale: number;
  cropRect?: ExportCropRect | null;
  render: (typeof import("html2canvas"))["default"];
  isolateSelectedElements?: readonly Element[];
}): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  // A freshly loaded preview iframe (new generation, screen switch, or just a
  // fast click) can still be mid-load for its CDN Tailwind/Alpine script and
  // Google Fonts — capturing before either lands renders plain unstyled HTML.
  // Bounded wait; never blocks an export indefinitely. See
  // export-capture.ts's waitForExportReady docblock.
  await waitForExportReady(doc);
  // html2canvas paints glyphs through a canvas owned by *this* document while
  // measuring every box in the preview iframe, so the design's webfonts have
  // to exist on both sides or decorations drift away from the text they sit
  // behind. See export-font-mirror.ts.
  const mirroredFonts = await mirrorPreviewWebFonts(doc, iframe.ownerDocument);
  const bakedImages = await bakeFilteredImages(doc);
  if (mirroredFonts.unreadableStylesheets.length > 0) {
    console.warn(
      "Export font mirroring skipped unreadable stylesheets; text metrics may drift:",
      mirroredFonts.unreadableStylesheets,
    );
  }
  const width = Math.max(
    doc.documentElement.scrollWidth,
    doc.body?.scrollWidth ?? 0,
    iframe.clientWidth,
  );
  const height = Math.max(
    doc.documentElement.scrollHeight,
    doc.body?.scrollHeight ?? 0,
    iframe.clientHeight,
  );
  const renderWidth = cropRect?.width ?? width;
  const renderHeight = cropRect?.height ?? height;
  const effectiveScale = resolveRasterExportScale({
    width: renderWidth,
    height: renderHeight,
    requestedScale: exportScale,
  });
  const options = {
    ...(cropRect ? { x: cropRect.x, y: cropRect.y } : {}),
    width: renderWidth,
    height: renderHeight,
    windowWidth: width,
    windowHeight: height,
    scale: effectiveScale,
    useCORS: true,
    backgroundColor: null,
    onclone: (clonedDocument: Document) => {
      sanitizeHtml2CanvasClone(doc, clonedDocument, bakedImages);
      isolateSelectedExportElements(
        doc,
        clonedDocument,
        isolateSelectedElements,
      );
      removeEditorChromeOverlays(clonedDocument);
    },
  };
  try {
    try {
      // html2canvas's normal renderer handles native form controls, clipping,
      // and computed layout more consistently than its foreignObject shortcut.
      // Prefer it for production exports and retain foreignObject as a fallback
      // for the uncommon CSS feature the canvas renderer cannot parse.
      const canvas = await render(doc.documentElement, {
        ...options,
        foreignObjectRendering: false,
      });
      return { canvas, scale: effectiveScale };
    } catch (primaryError) {
      if (primaryError instanceof PngCaptureError) throw primaryError;
      console.warn(
        "PNG canvas capture failed; retrying foreignObject renderer:",
        primaryError,
      );
      const canvas = await render(doc.documentElement, {
        ...options,
        foreignObjectRendering: true,
        onclone: (clonedDocument: Document) => {
          isolateSelectedExportElements(
            doc,
            clonedDocument,
            isolateSelectedElements,
          );
          removeEditorChromeOverlays(clonedDocument);
        },
      });
      return { canvas, scale: effectiveScale };
    }
  } finally {
    mirroredFonts.dispose();
  }
}

/**
 * What a raster capture is of. Overview mode resolves a different iframe and a
 * different crop per scope, so "the current selection" is not one thing: Copy
 * as PNG wants the selected screen, the export preview wants the selected
 * element inside it.
 */
export type PngCaptureScope = "document" | "screens" | "element";

export type PngCaptureErrorCode =
  | "no-preview"
  | "selection-unresolved"
  | "external-preview"
  | "read-only-preview"
  | "blob-failed";

export class PngCaptureError extends Error {
  readonly code: PngCaptureErrorCode;

  constructor(code: PngCaptureErrorCode) {
    super(`PNG capture ${code}`);
    this.name = "PngCaptureError";
    this.code = code;
  }
}
