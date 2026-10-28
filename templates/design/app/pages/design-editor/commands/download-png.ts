import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import {
  browserDesignExportErrorType,
  trackBrowserDesignExported,
  type BrowserDesignExportContext,
} from "@/lib/design-export-tracking";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";

export interface DownloadPngArgs {
  /** Join keys for the `design_exported` this command reports. */
  exportTracking?: BrowserDesignExportContext;
  fallbackExportName: (extension: string, suffix?: string) => string;
  pngExportingRef: RefObject<boolean>;
  renderPngBlob: (arg0: {
    scope: PngCaptureScope;
    settings?: Partial<ExportSettingsValue>;
    format?: "png" | "jpg" | "webp";
  }) => Promise<Blob>;
  setPngExporting: Dispatch<SetStateAction<boolean>>;
  showRasterCaptureError: (error: unknown, format?: "png" | "pdf") => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

export async function runDownloadPng(
  {
    exportTracking,
    fallbackExportName,
    pngExportingRef,
    renderPngBlob,
    setPngExporting,
    showRasterCaptureError,
    t,
    triggerBlobDownload,
  }: DownloadPngArgs,
  settings?: Partial<ExportSettingsValue>,
  format: "png" | "jpg" | "webp" = "png",
  scope: PngCaptureScope = "document",
) {
  if (pngExportingRef.current) return;
  pngExportingRef.current = true;
  setPngExporting(true);
  try {
    const blob = await renderPngBlob({
      scope,
      settings,
      format,
    });
    triggerBlobDownload(blob, fallbackExportName(format, settings?.suffix));
    toast.success(t("designEditor.toasts.pngDownloaded"));
    trackBrowserDesignExported(format, {
      ...exportTracking,
      status: "completed",
    });
  } catch (error) {
    trackBrowserDesignExported(format, {
      ...exportTracking,
      status: "failed",
      errorType: browserDesignExportErrorType(error),
    });
    showRasterCaptureError(error);
  } finally {
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
