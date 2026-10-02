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
  NativeExportRenderError,
  renderNativeExportPng,
} from "./native-export-render";
import { isScreenRootElementInfo } from "./selection-state";

export function blurActiveDesignEditableTarget() {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && isDesignHotkeyEditableTarget(active)) {
    active.blur();
  }
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

  const path: Array<{ tagName: string; sameTagIndex: number }> = [];
  for (
    let element: Element | null = sourceElement;
    element && element !== sourceDocument.documentElement;
    element = element.parentElement
  ) {
    const parent = element.parentElement;
    if (!parent) return null;
    const sameTagIndex = Array.from(parent.children)
      .filter((sibling) => sibling.localName === element!.localName)
      .indexOf(element);
    if (sameTagIndex < 0) return null;
    path.push({ tagName: element.localName, sameTagIndex });
  }
  if (path.length === 0)
    return sourceElement === sourceDocument.documentElement
      ? clonedDocument.documentElement
      : null;

  let clonedElement: Element = clonedDocument.documentElement;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const { tagName, sameTagIndex } = path[index]!;
    const children = Array.from(clonedElement.children).filter(
      (child) => child.localName === tagName,
    );
    const child = children[sameTagIndex];
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

export function removeEditorChromeOverlays(root: ParentNode): void {
  root
    .querySelectorAll(EDITOR_CHROME_OVERLAY_SELECTOR)
    .forEach((element) => element.remove());
}

export function sanitizeSerializedXmlForSvg(value: string): string {
  return value.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
    "&amp;",
  );
}

function resolveElementForExport(
  doc: Document,
  selected: ElementInfo,
): Element | null {
  for (const sourceId of [selected.runtimeSourceId, selected.sourceId]) {
    if (!sourceId) continue;
    try {
      const element = doc.querySelector(
        `[data-agent-native-node-id="${CSS.escape(sourceId)}"]`,
      );
      if (element) return element;
    } catch {
      // coercion-ok: Invalid optional IDs fall through; unresolved exports still error below.
      // Continue with the remaining selection identities.
    }
  }
  for (const selector of [selected.runtimeSelector, selected.selector]) {
    if (!selector) continue;
    try {
      const element = doc.querySelector(selector);
      if (element) return element;
    } catch {
      // coercion-ok: Invalid optional selectors fall through; unresolved exports still error below.
      // Continue with the remaining selection identities.
    }
  }
  return null;
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
    )
      return { kind: "unresolved" };
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
  isolateSelectedElements = [],
}: {
  doc: Document;
  iframe: HTMLIFrameElement;
  exportScale: number;
  cropRect?: ExportCropRect | null;
  isolateSelectedElements?: readonly Element[];
}): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
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
  const renderWidth = cropRect?.width ?? width;
  const renderHeight = cropRect?.height ?? height;
  const effectiveScale = resolveRasterExportScale({
    width: renderWidth,
    height: renderHeight,
    requestedScale: exportScale,
  });
  const clonedDocument = doc.cloneNode(true) as Document;
  isolateSelectedExportElements(doc, clonedDocument, isolateSelectedElements);
  removeEditorChromeOverlays(clonedDocument);
  const serializedHtml = `<!doctype html>${clonedDocument.documentElement.outerHTML}`;
  const exportBridge = (
    doc.defaultView as
      | (Window & {
          __anEditorChromeBridgeInstance?: {
            inlineExportResources?: (html: string) => Promise<{
              html: string;
              complete: boolean;
              errorCode?: "export_too_large" | "export_resources_unavailable";
            }>;
          };
        })
      | null
  )?.__anEditorChromeBridgeInstance;
  const inlinedSnapshot =
    await exportBridge?.inlineExportResources?.(serializedHtml);
  if (inlinedSnapshot && !inlinedSnapshot.complete) {
    throw new NativeExportRenderError(
      "The export snapshot is too large or has unavailable resources.",
      inlinedSnapshot.errorCode ?? "export_resources_unavailable",
    );
  }
  const png = await renderNativeExportPng({
    html: inlinedSnapshot?.html ?? serializedHtml,
    width,
    height: Math.max(1, iframe.clientHeight),
    scale: effectiveScale,
  });
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new PngCaptureError("blob-failed");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    canvas: cropRect
      ? (cropCanvasToRect(canvas, cropRect, effectiveScale) ?? canvas)
      : canvas,
    scale: effectiveScale,
  };
}

export type PngCaptureScope = "document" | "screens" | "element";

export type PngCaptureErrorCode =
  | "no-preview"
  | "selection-unresolved"
  | "external-preview"
  | "read-only-preview"
  | "blob-failed";

export class PngCaptureError extends Error {
  readonly code: PngCaptureErrorCode;

  constructor(code: PngCaptureErrorCode, detail?: string) {
    super(detail ? `PNG capture ${code}: ${detail}` : `PNG capture ${code}`);
    this.name = "PngCaptureError";
    this.code = code;
  }
}
