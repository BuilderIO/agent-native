import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
import {
  PDF_MIN_PRINT_RASTER_SCALE,
  createSinglePageRasterPdf,
} from "@/pages/design-editor/export-capture";
import type { ExportCropRect } from "@/pages/design-editor/export-capture";
import { prepareExportCaptureTarget } from "@/pages/design-editor/export-snapshot-frame";
import type { ExportCaptureTarget } from "@/pages/design-editor/export-snapshot-frame";
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
  resolveSelectedScreensBounds: () => ExportCropRect | null;
  resolvePngCaptureTarget: (scope: PngCaptureScope) =>
    | (ExportCaptureTarget & {
        cropSelection: ElementInfo | readonly ElementInfo[] | null;
      })
    | Promise<
        ExportCaptureTarget & {
          cropSelection: ElementInfo | readonly ElementInfo[] | null;
        }
      >;
  releaseScreenFromExport?: () => void;
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
    resolveSelectedScreensBounds,
    resolvePngCaptureTarget,
    releaseScreenFromExport,
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
    const selectedScreensBounds =
      scope === "screens" ? resolveSelectedScreensBounds() : null;
    let pageWidth: number;
    let pageHeight: number;
    if (selectedScreensBounds) {
      pageWidth = Math.max(1, selectedScreensBounds.width);
      pageHeight = Math.max(1, selectedScreensBounds.height);
    } else {
      const target = await resolvePngCaptureTarget(scope);
      const prepared = await prepareExportCaptureTarget(target);
      try {
        const crop = resolveExportCropRect(prepared.doc, target.cropSelection);
        const pageCrop =
          crop ?? resolveBoardExportCropRect(prepared.doc, prepared.iframe);
        pageWidth = Math.max(
          1,
          pageCrop?.width ??
            Math.max(
              prepared.doc.documentElement.scrollWidth,
              prepared.doc.body?.scrollWidth ?? 0,
              prepared.iframe.clientWidth,
            ),
        );
        pageHeight = Math.max(
          1,
          pageCrop?.height ??
            Math.max(
              prepared.doc.documentElement.scrollHeight,
              prepared.doc.body?.scrollHeight ?? 0,
              prepared.iframe.clientHeight,
            ),
        );
      } finally {
        prepared.dispose();
      }
    }
    const pdfScale = Math.max(
      PDF_MIN_PRINT_RASTER_SCALE,
      settings?.scale ?? PDF_MIN_PRINT_RASTER_SCALE,
    );
    const png = await renderPngBlob({
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
    releaseScreenFromExport?.();
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
