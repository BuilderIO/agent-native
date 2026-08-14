import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
import {
  PDF_MIN_PRINT_RASTER_SCALE,
  createSinglePageRasterPdf,
} from "@/pages/design-editor/export-capture";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";
import { resolveExportCropRect } from "@/pages/design-editor/png-export-render";

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
  showPngCaptureError: (error: unknown) => void;
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
    showPngCaptureError,
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
    const pageWidth = Math.max(
      1,
      crop?.width ??
        Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0,
          iframe.clientWidth,
        ),
    );
    const pageHeight = Math.max(
      1,
      crop?.height ??
        Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
          iframe.clientHeight,
        ),
    );
    // Force a print-quality raster floor: the PDF page renders at a fixed
    // physical size (see createSinglePageRasterPdf), so a 1x capture —
    // the export panel's ordinary default — embeds only ~96 DPI, which
    // looks visibly soft once printed. Still honor an explicit higher
    // user-selected scale (3x/4x).
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
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(png);
    });
    const pdf = await createSinglePageRasterPdf({
      dataUrl,
      width: pageWidth,
      height: pageHeight,
    });
    triggerBlobDownload(pdf, fallbackExportName("pdf", settings?.suffix));
    toast.success(t("designEditor.toasts.pngDownloaded"));
  } catch (error) {
    showPngCaptureError(error);
  } finally {
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
