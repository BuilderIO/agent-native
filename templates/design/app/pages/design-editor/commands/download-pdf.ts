import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import {
  browserDesignExportErrorType,
  trackBrowserDesignExported,
  type BrowserDesignExportContext,
} from "@/lib/design-export-tracking";
import {
  PDF_MIN_PRINT_RASTER_SCALE,
  createSinglePageRasterPdf,
} from "@/pages/design-editor/export-capture";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";

import type { PngCaptureResult, PngRenderOptions } from "./render-png-blob";

export interface DownloadPdfArgs {
  /** Join keys for the `design_exported` this command reports. */
  exportTracking?: BrowserDesignExportContext;
  fallbackExportName: (extension: string, suffix?: string) => string;
  pngExportingRef: RefObject<boolean>;
  renderPngCapture: (options: PngRenderOptions) => Promise<PngCaptureResult>;
  setPngExporting: Dispatch<SetStateAction<boolean>>;
  showRasterCaptureError: (error: unknown, format?: "png" | "pdf") => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

export async function runDownloadPdf(
  {
    exportTracking,
    fallbackExportName,
    pngExportingRef,
    renderPngCapture,
    setPngExporting,
    showRasterCaptureError,
    t,
    triggerBlobDownload,
  }: DownloadPdfArgs,
  settings?: Partial<ExportSettingsValue>,
  scope: PngCaptureScope = "document",
) {
  if (pngExportingRef.current) return;
  pngExportingRef.current = true;
  setPngExporting(true);
  try {
    const pdfScale = Math.max(
      PDF_MIN_PRINT_RASTER_SCALE,
      settings?.scale ?? PDF_MIN_PRINT_RASTER_SCALE,
    );
    const capture = await renderPngCapture({
      scope,
      settings: { ...settings, scale: pdfScale },
      format: "png",
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(reader.error ?? new Error("PDF read failed"));
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(capture.blob);
    });
    const pdf = await createSinglePageRasterPdf({
      dataUrl,
      width: capture.width,
      height: capture.height,
    });
    triggerBlobDownload(pdf, fallbackExportName("pdf", settings?.suffix));
    toast.success(t("designEditor.toasts.pdfDownloaded"));
    trackBrowserDesignExported("pdf", {
      ...exportTracking,
      status: "completed",
    });
  } catch (error) {
    trackBrowserDesignExported("pdf", {
      ...exportTracking,
      status: "failed",
      errorType: browserDesignExportErrorType(error),
    });
    showRasterCaptureError(error, "pdf");
  } finally {
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
