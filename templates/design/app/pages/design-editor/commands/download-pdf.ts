import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
import {
  PDF_MIN_PRINT_RASTER_SCALE,
  createSinglePageRasterPdf,
} from "@/pages/design-editor/export-capture";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import {
  resolveBoardExportCropRect,
  resolveExportCropRect,
} from "@/pages/design-editor/png-export-render";

export interface DownloadPdfArgs {
  fallbackExportName: (extension: string, suffix?: string) => string;
  pngExportingRef: RefObject<boolean>;
  renderPngBlob: (arg0: {
    scope: PngCaptureScope;
    settings?: Partial<ExportSettingsValue>;
    format?: "png" | "jpg" | "webp";
  }) => Promise<Blob>;
  resolvePngCaptureTarget: (scope: PngCaptureScope) => {
    cropSelection: ElementInfo | readonly ElementInfo[] | null;
    doc: Document;
    iframe: HTMLIFrameElement;
  };
  setPngExporting: Dispatch<SetStateAction<boolean>>;
  showRasterCaptureError: (error: unknown, format?: "png" | "pdf") => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

export async function runDownloadPdf(
  {
    fallbackExportName,
    pngExportingRef,
    renderPngBlob,
    resolvePngCaptureTarget,
    setPngExporting,
    showRasterCaptureError,
    t,
    triggerBlobDownload,
  }: DownloadPdfArgs,
  settings?: Partial<ExportSettingsValue>,
) {
  if (pngExportingRef.current) return;
  pngExportingRef.current = true;
  setPngExporting(true);
  try {
    const { cropSelection, doc, iframe } = resolvePngCaptureTarget("document");
    const crop = resolveExportCropRect(doc, cropSelection);
    const pageCrop = crop ?? resolveBoardExportCropRect(doc, iframe);
    const pageWidth = Math.max(
      1,
      pageCrop?.width ??
        Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0,
          iframe.clientWidth,
        ),
    );
    const pageHeight = Math.max(
      1,
      pageCrop?.height ??
        Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
          iframe.clientHeight,
        ),
    );
    const pdfScale = Math.max(
      PDF_MIN_PRINT_RASTER_SCALE,
      settings?.scale ?? PDF_MIN_PRINT_RASTER_SCALE,
    );
    const png = await renderPngBlob({
      scope: "document",
      settings: { ...settings, scale: pdfScale },
      format: "png",
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(reader.error ?? new Error("PDF read failed"));
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(png);
    });
    const pdf = await createSinglePageRasterPdf({
      dataUrl,
      width: pageWidth,
      height: pageHeight,
    });
    triggerBlobDownload(pdf, fallbackExportName("pdf", settings?.suffix));
    toast.success(t("designEditor.toasts.pdfDownloaded"));
  } catch (error) {
    showRasterCaptureError(error, "pdf");
  } finally {
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
