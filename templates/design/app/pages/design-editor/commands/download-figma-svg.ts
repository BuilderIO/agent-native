import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import {
  browserDesignExportErrorType,
  trackBrowserDesignExported,
  type BrowserDesignExportContext,
} from "@/lib/design-export-tracking";
import {
  exportDesignAsFigmaSvg,
  type LiveFigmaSvgSnapshot,
  type LiveFigmaSvgSource,
} from "@/lib/figma-svg-copy";
import type { DesignFile } from "@/pages/design-editor/types";

export interface DownloadFigmaSvgArgs {
  activeFile: DesignFile | undefined;
  /** Join keys for the `design_exported` this command reports. */
  exportTracking?: BrowserDesignExportContext;
  fallbackExportName: (extension: string, suffix?: string) => string;
  figmaSvgExportingRef: RefObject<boolean>;
  id: string | undefined;
  resolveLiveFigmaSvgSnapshot: (
    targetFileId: string | undefined,
  ) => LiveFigmaSvgSnapshot | null;
  resolveLiveFigmaSvgSource: (
    targetFileId: string | undefined,
  ) => LiveFigmaSvgSource | null;
  selectedElementLayerId: string | null;
  selectedScreenIds: string[];
  setFigmaSvgExporting: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

export async function runDownloadFigmaSvg({
  activeFile,
  exportTracking,
  fallbackExportName,
  figmaSvgExportingRef,
  id,
  resolveLiveFigmaSvgSnapshot,
  resolveLiveFigmaSvgSource,
  selectedElementLayerId,
  selectedScreenIds,
  setFigmaSvgExporting,
  t,
  triggerBlobDownload,
}: DownloadFigmaSvgArgs) {
  if (figmaSvgExportingRef.current) return;
  const targetFileId = activeFile?.id ?? selectedScreenIds[0] ?? undefined;
  if (!targetFileId) {
    trackBrowserDesignExported("figma_download", {
      ...exportTracking,
      status: "failed",
      errorType: "no_preview",
    });
    toast.error(t("designEditor.toasts.openScreenSvg"));
    return;
  }
  figmaSvgExportingRef.current = true;
  setFigmaSvgExporting(true);
  try {
    const result = await exportDesignAsFigmaSvg(
      {
        designId: id,
        fileId: targetFileId,
        nodeId: selectedElementLayerId ?? undefined,
      },
      {
        liveSource: resolveLiveFigmaSvgSource(targetFileId),
        liveSnapshot: resolveLiveFigmaSvgSnapshot(targetFileId),
      },
    );
    triggerBlobDownload(
      new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
      result.filename || fallbackExportName("svg", "figma"),
    );
    toast.success(t("designEditor.toasts.figmaSvgDownloaded"));
    trackBrowserDesignExported("figma_download", {
      ...exportTracking,
      status: "completed",
    });
  } catch (error) {
    trackBrowserDesignExported("figma_download", {
      ...exportTracking,
      status: "failed",
      errorType: browserDesignExportErrorType(error),
    });
    toast.error(
      error instanceof Error
        ? error.message
        : t("designEditor.toasts.figmaSvgExportError"),
    );
  } finally {
    figmaSvgExportingRef.current = false;
    setFigmaSvgExporting(false);
  }
}
