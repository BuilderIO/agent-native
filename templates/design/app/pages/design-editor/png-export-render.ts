import type { ElementInfo } from "@/components/design/types";
import { isDesignHotkeyEditableTarget } from "@/hooks/useDesignHotkeys";

import {
  computeExportCropBox,
  EDITOR_CHROME_OVERLAY_SELECTOR,
  resolveRasterExportScale,
  unionExportCropRects,
  waitForExportReady,
} from "./export-capture";
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

function elementInlineStyle(
  element: Element | undefined,
): CSSStyleDeclaration | null {
  if (!element) return null;
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  return style && typeof style.setProperty === "function" ? style : null;
}

function sanitizeHtml2CanvasClone(
  sourceDocument: Document,
  clonedDocument: Document,
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
      clonedStyle.setProperty(property, "none", "important");
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
function resolveElementExportCropRect(
  doc: Document,
  selected: ElementInfo,
): { x: number; y: number; width: number; height: number } | null {
  if (isScreenRootElementInfo(selected)) return null;
  const view = doc.defaultView;
  if (!view) return null;
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
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // getBoundingClientRect is viewport-relative; add the iframe scroll offset so
  // coordinates match the full-document render (which starts at the page top).
  return {
    x: rect.left + (view.scrollX ?? 0),
    y: rect.top + (view.scrollY ?? 0),
    width: rect.width,
    height: rect.height,
  };
}

export function resolveExportCropRect(
  doc: Document,
  selected: ElementInfo | readonly ElementInfo[] | null | undefined,
): { x: number; y: number; width: number; height: number } | null {
  const selections = Array.isArray(selected)
    ? selected
    : selected
      ? [selected]
      : [];
  return unionExportCropRects(
    selections.flatMap((selection) => {
      const rect = resolveElementExportCropRect(doc, selection);
      return rect ? [rect] : [];
    }),
  );
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
  render,
}: {
  doc: Document;
  iframe: HTMLIFrameElement;
  exportScale: number;
  render: (typeof import("html2canvas"))["default"];
}): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  // A freshly loaded preview iframe (new generation, screen switch, or just a
  // fast click) can still be mid-load for its CDN Tailwind/Alpine script and
  // Google Fonts — capturing before either lands renders plain unstyled HTML.
  // Bounded wait; never blocks an export indefinitely. See
  // export-capture.ts's waitForExportReady docblock.
  await waitForExportReady(doc);
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
  const effectiveScale = resolveRasterExportScale({
    width,
    height,
    requestedScale: exportScale,
  });
  const options = {
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scale: effectiveScale,
    useCORS: true,
    backgroundColor: null,
    onclone: (clonedDocument: Document) => {
      sanitizeHtml2CanvasClone(doc, clonedDocument);
      removeEditorChromeOverlays(clonedDocument);
    },
  };
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
    console.warn(
      "PNG canvas capture failed; retrying foreignObject renderer:",
      primaryError,
    );
    const canvas = await render(doc.documentElement, {
      ...options,
      foreignObjectRendering: true,
    });
    return { canvas, scale: effectiveScale };
  }
}

export type PngCaptureErrorCode =
  | "no-preview"
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
