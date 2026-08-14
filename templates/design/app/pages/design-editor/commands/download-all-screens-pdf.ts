import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { normalizeDesignSourceType } from "@shared/source-mode";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { RasterPdfPage } from "@/pages/design-editor/export-capture";
import {
  PDF_MIN_PRINT_RASTER_SCALE,
  createMultiPageRasterPdf,
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
  pngExportingRef: RefObject<boolean>;
  setPngExporting: Dispatch<SetStateAction<boolean>>;
  showPngCaptureError: (error: unknown) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

export async function runDownloadAllScreensPdf({
  activeCanvasSourceType,
  canEditDesign,
  canvasFrameGeometryById,
  fallbackExportName,
  overviewScreens,
  pngExportingRef,
  setPngExporting,
  showPngCaptureError,
  t,
  triggerBlobDownload,
}: DownloadAllScreensPdfArgs) {
  if (pngExportingRef.current) return;
  if (overviewScreens.length < 2) return;
  pngExportingRef.current = true;
  setPngExporting(true);
  try {
    const html2canvas = (await import("html2canvas")).default;
    const pages: RasterPdfPage[] = [];
    for (const screen of overviewScreens) {
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screen.id)}"]`,
      );
      if (!iframe) throw new PngCaptureError("no-preview");
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        if (!doc?.documentElement) doc = null;
      } catch {
        doc = null;
      }
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
      const geometry = canvasFrameGeometryById[screen.id] ?? {};
      const pageWidth = Math.max(
        1,
        geometry.width ?? screen.width ?? iframe.clientWidth,
      );
      const pageHeight = Math.max(
        1,
        geometry.height ?? screen.height ?? iframe.clientHeight,
      );
      const rendered = await renderExportDocumentCanvas({
        doc,
        iframe,
        // Same print-quality floor as the single-page path: a 1x capture
        // stretched to fill a fixed physical page size reads as blurry.
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
    }
    const pdf = await createMultiPageRasterPdf(pages);
    triggerBlobDownload(pdf, fallbackExportName("pdf", "all-screens"));
    toast.success(t("designEditor.toasts.pdfAllScreensDownloaded"));
  } catch (error) {
    showPngCaptureError(error);
  } finally {
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
