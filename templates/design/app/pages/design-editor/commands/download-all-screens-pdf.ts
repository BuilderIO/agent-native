import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { normalizeDesignSourceType } from "@shared/source-mode";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { measureNaturalDocumentHeight } from "@/components/design/design-canvas/content-size-report";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { RasterPdfPage } from "@/pages/design-editor/export-capture";
import {
  PDF_MIN_PRINT_RASTER_SCALE,
  createMultiPageRasterPdf,
  waitForExportReady,
} from "@/pages/design-editor/export-capture";
import {
  PngCaptureError,
  cropCanvasToRect,
  renderExportDocumentCanvas,
} from "@/pages/design-editor/png-export-render";

export interface DownloadAllScreensPdfArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  fallbackExportName: (extension: string, suffix?: string) => string;
  overviewScreens: OverviewScreen[];
  prepareScreenForExport: (screenId: string) => void;
  releaseScreenFromExport: () => void;
  pngExportingRef: RefObject<boolean>;
  setPngExporting: Dispatch<SetStateAction<boolean>>;
  showRasterCaptureError: (error: unknown, format?: "png" | "pdf") => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

const SCREEN_PREVIEW_READY_TIMEOUT_MS = 15_000;
const SCREEN_IMAGES_READY_TIMEOUT_MS = 10_000;

async function nextAnimationFrame(view: Window): Promise<void> {
  await new Promise<void>((resolve) =>
    view.requestAnimationFrame(() => resolve()),
  );
}

async function waitForScreenPreview(
  screen: OverviewScreen,
  activeCanvasSourceType: DownloadAllScreensPdfArgs["activeCanvasSourceType"],
): Promise<{ iframe: HTMLIFrameElement; doc: Document | null }> {
  const deadline = window.performance.now() + SCREEN_PREVIEW_READY_TIMEOUT_MS;
  while (window.performance.now() < deadline) {
    const iframe = document.querySelector<HTMLIFrameElement>(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screen.id)}"]`,
    );
    if (iframe?.isConnected) {
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        if (!doc?.documentElement) doc = null;
      } catch {
        doc = null;
      }
      const sourceType =
        normalizeDesignSourceType(
          iframe.dataset.designSourceType ?? screen.sourceType,
        ) ?? activeCanvasSourceType;
      const bridgeWindow = doc?.defaultView as
        | (Window & { __agentNativeContentSizeReport?: boolean })
        | null;
      if (
        doc?.readyState === "complete" &&
        (sourceType !== "inline" ||
          bridgeWindow?.__agentNativeContentSizeReport === true)
      ) {
        return { iframe, doc };
      }
      if (!doc && sourceType !== "inline") return { iframe, doc: null };
    }
    await nextAnimationFrame(window);
  }
  throw new Error(`Timed out waiting for screen preview ${screen.id} to load.`);
}

function withDeadline<T>(
  promise: Promise<T>,
  view: Window,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId = 0;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timeoutId = view.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => view.clearTimeout(timeoutId));
}

export async function waitForScreenImages(doc: Document): Promise<void> {
  const view = doc.defaultView;
  if (!view) return;
  const images = Array.from(doc.images).filter(
    (image) =>
      image.currentSrc ||
      image.getAttribute("src")?.trim() ||
      image.getAttribute("srcset")?.trim(),
  );
  for (const image of images) image.loading = "eager";

  const pendingImages = images.filter((image) => !image.complete);
  try {
    await new Promise<void>((resolve, reject) => {
      const listeners = new Map<
        HTMLImageElement,
        { load: () => void; error: () => void }
      >();
      let timeoutId = 0;
      let settled = false;
      const cleanup = () => {
        view.clearTimeout(timeoutId);
        for (const [image, handlers] of listeners) {
          image.removeEventListener("load", handlers.load);
          image.removeEventListener("error", handlers.error);
        }
        listeners.clear();
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const loaded = (image: HTMLImageElement) => {
        if (image.naturalWidth <= 0) {
          finish(new Error("A screen image failed to load."));
          return;
        }
        const handlers = listeners.get(image);
        if (handlers) {
          image.removeEventListener("load", handlers.load);
          image.removeEventListener("error", handlers.error);
        }
        listeners.delete(image);
        if (listeners.size === 0) finish();
      };

      for (const image of pendingImages) {
        const load = () => loaded(image);
        const error = () => finish(new Error("A screen image failed to load."));
        listeners.set(image, { load, error });
        image.addEventListener("load", load);
        image.addEventListener("error", error);
      }
      timeoutId = view.setTimeout(
        () => finish(new Error("Timed out waiting for screen images to load.")),
        SCREEN_IMAGES_READY_TIMEOUT_MS,
      );
      for (const image of pendingImages) {
        if (image.complete) loaded(image);
      }
      const failedImage = images.find(
        (image) => image.complete && image.naturalWidth <= 0, // i18n-ignore image load failure predicate
      );
      if (failedImage) {
        finish(new Error("A screen image failed to load."));
      } else if (pendingImages.length === 0) {
        finish();
      }
    });

    await withDeadline(
      Promise.all(
        images.map((image) =>
          typeof image.decode === "function"
            ? image.decode()
            : Promise.resolve(),
        ),
      ),
      view,
      SCREEN_IMAGES_READY_TIMEOUT_MS,
      "Timed out waiting for screen images to decode.",
    );
  } catch (error) {
    console.error("PDF image readiness failed:", error);
    throw new PngCaptureError("blob-failed");
  }
}

export async function runDownloadAllScreensPdf({
  activeCanvasSourceType,
  canEditDesign,
  canvasFrameGeometryById,
  fallbackExportName,
  overviewScreens,
  prepareScreenForExport,
  releaseScreenFromExport,
  pngExportingRef,
  setPngExporting,
  showRasterCaptureError,
  t,
  triggerBlobDownload,
}: DownloadAllScreensPdfArgs) {
  if (pngExportingRef.current) return;
  if (overviewScreens.length < 2) return;
  pngExportingRef.current = true;
  setPngExporting(true);
  let requestedScreenId: string | null = null;
  try {
    const html2canvas = (await import("html2canvas")).default;
    const pages: RasterPdfPage[] = [];
    for (const screen of overviewScreens) {
      requestedScreenId = screen.id;
      prepareScreenForExport(screen.id);
      let iframe: HTMLIFrameElement | null = null;
      let priorInlineHeight: string | null = null;
      try {
        const preview = await waitForScreenPreview(
          screen,
          activeCanvasSourceType,
        );
        iframe = preview.iframe;
        const doc = preview.doc;
        if (!doc) {
          const sourceType =
            normalizeDesignSourceType(iframe.dataset.designSourceType) ??
            activeCanvasSourceType;
          if (sourceType !== "inline") {
            throw new PngCaptureError("external-preview");
          }
          if (!canEditDesign) {
            throw new PngCaptureError("read-only-preview");
          }
          throw new PngCaptureError("no-preview");
        }
        await waitForExportReady(doc, {
          timeoutMs: SCREEN_PREVIEW_READY_TIMEOUT_MS,
        });
        await waitForScreenImages(doc);
        const geometry = canvasFrameGeometryById[screen.id] ?? {};
        const pageWidth = Math.max(
          1,
          geometry.width ?? screen.width ?? iframe.clientWidth,
        );
        const naturalHeight =
          screen.heightMode === "hug"
            ? measureNaturalDocumentHeight(doc)
            : null;
        if (screen.heightMode === "hug" && naturalHeight === null) {
          throw new Error(
            `The natural content height for Hug screen ${screen.id} is unavailable.`,
          );
        }
        const pageHeight = Math.max(
          1,
          naturalHeight ??
            geometry.height ??
            screen.height ??
            iframe.clientHeight,
        );
        if (naturalHeight !== null) {
          priorInlineHeight = iframe.style.height;
          iframe.style.height = `${pageHeight}px`;
          await nextAnimationFrame(doc.defaultView ?? window);
        }
        const rendered = await renderExportDocumentCanvas({
          doc,
          iframe,
          exportScale: PDF_MIN_PRINT_RASTER_SCALE,
          render: html2canvas,
        });
        const view = doc.defaultView;
        const viewportCanvas = cropCanvasToRect(
          rendered.canvas,
          {
            x: view?.scrollX ?? 0,
            y: view?.scrollY ?? 0,
            width: Math.max(1, iframe.clientWidth),
            height: Math.max(1, iframe.clientHeight),
          },
          rendered.scale,
        );
        const dataUrl = (viewportCanvas ?? rendered.canvas).toDataURL(
          "image/png",
        );
        pages.push({ dataUrl, width: pageWidth, height: pageHeight });
      } finally {
        if (iframe && priorInlineHeight !== null) {
          iframe.style.height = priorInlineHeight;
        }
        releaseScreenFromExport();
        requestedScreenId = null;
      }
    }
    const pdf = await createMultiPageRasterPdf(pages);
    triggerBlobDownload(pdf, fallbackExportName("pdf", "all-screens"));
    toast.success(t("designEditor.toasts.pdfAllScreensDownloaded"));
  } catch (error) {
    console.error("All-screens PDF export failed:", error);
    showRasterCaptureError(
      error instanceof PngCaptureError
        ? error
        : new PngCaptureError("blob-failed"),
      "pdf",
    );
  } finally {
    if (requestedScreenId !== null) releaseScreenFromExport();
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
